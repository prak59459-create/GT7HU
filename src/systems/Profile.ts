/**
 * systems/Profile.ts
 * 計画書 Phase 3: プレイヤープロフィール（クレジット・所有車・チューニング状態）
 * と localStorage セーブ（自動保存）。
 *
 * セーブ形式バージョン: v1
 *  - credits      所持クレジット
 *  - ownedCars    所有車リスト（色・お気に入り・チューニング導入状況）
 *  - selectedId   選択中車両の vehicle id
 *  - totalRaces / wins 戦績
 *
 * file:// 起動でも localStorage は機能する（オリジンごとに保存）。
 * セーブ破損・不在時は初期プロファイル（Aurora RS-2 贈呈 + 3,000,000 Cr）を生成。
 */
import { getVehicleById } from '../vehicle/VehicleData';
import { type ChallengeDef } from '../race/ChallengeDefs';

export interface OwnedCar {
  /** 車両データID（VehicleData.id） */
  id: string;
  /** 現在のボディカラー */
  color: string;
  /** お気に入り */
  favorite: boolean;
  /** チューニング導入状況 { categoryId: stage }（未導入カテゴリは不在） */
  tuning: Record<string, number>;
  /** チューニング累計投資額（売却額算出用） */
  tuningSpent: number;
}

/** チャレンジ（ライセンス）の進行: medal 0=未達成 1=bronze 2=silver 3=gold, best=これまでの最良値 */
export interface LicenseRecord {
  medal: number;
  best: number | null;
}

export interface PlayerProfile {
  credits: number;
  ownedCars: OwnedCar[];
  selectedId: string;
  totalRaces: number;
  wins: number;
  /** Phase 4: ライセンス進行 */
  licenses: Record<string, LicenseRecord>;
  /** Phase 4: ミッション進行 */
  missions: Record<string, { done: boolean; best: number | null }>;
  /** Phase 4: トライアル記録 */
  records: {
    bestLap: number | null;
    ttMedal: number;
    driftBest: number;
    driftMedal: number;
  };
}

/** Profile の Phase 4 以降フィールドを補完（旧セーブの後方互換） */
function ensurePhase4(p: PlayerProfile): PlayerProfile {
  if (!p.licenses || typeof p.licenses !== 'object') p.licenses = {};
  if (!p.missions || typeof p.missions !== 'object') p.missions = {};
  if (!p.records || typeof p.records !== 'object') {
    p.records = { bestLap: null, ttMedal: 0, driftBest: 0, driftMedal: 0 };
  }
  if (typeof p.records.bestLap !== 'number') p.records.bestLap = null;
  if (typeof p.records.ttMedal !== 'number') p.records.ttMedal = 0;
  if (typeof p.records.driftBest !== 'number') p.records.driftBest = 0;
  if (typeof p.records.driftMedal !== 'number') p.records.driftMedal = 0;
  return p;
}

const SAVE_KEY = 'racing-sim-profile-v1';
const STARTER_CREDITS = 3000000;
const STARTER_CAR_ID = 'aurora_rs2';

export class SaveSystem {
  /** 保存データ読み込み。不正な場合は null を返す */
  static load(): PlayerProfile | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as PlayerProfile;
      if (typeof p.credits !== 'number' || !Array.isArray(p.ownedCars) || p.ownedCars.length === 0) return null;
      if (typeof p.selectedId !== 'string') return null;
      if (!p.ownedCars.some((o) => o.id === p.selectedId)) return null;
      // 各所有車の最低限の整合性
      for (const oc of p.ownedCars) {
        if (typeof oc.id !== 'string' || !getVehicleById(oc.id)) return null;
        if (!oc.tuning) oc.tuning = {};
        if (typeof oc.tuningSpent !== 'number') oc.tuningSpent = 0;
        if (typeof oc.favorite !== 'boolean') oc.favorite = false;
        if (typeof oc.color !== 'string') oc.color = getVehicleById(oc.id)!.defaultColor;
      }
      if (typeof p.totalRaces !== 'number') p.totalRaces = 0;
      if (typeof p.wins !== 'number') p.wins = 0;
      return ensurePhase4(p);
    } catch {
      return null;
    }
  }

  /** 保存（失敗してもゲームは継続） */
  static save(profile: PlayerProfile): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(profile));
    } catch {
      // プライベートモード等で localStorage が使えない環境では黙って諦める
    }
  }

  /** 初期プロファイル: Aurora RS-2 贈呈 + クレジット */
  static createStarter(): PlayerProfile {
    const starter = getVehicleById(STARTER_CAR_ID)!;
    return ensurePhase4({
      credits: STARTER_CREDITS,
      ownedCars: [
        { id: starter.id, color: starter.defaultColor, favorite: false, tuning: {}, tuningSpent: 0 }
      ],
      selectedId: starter.id,
      totalRaces: 0,
      wins: 0,
      licenses: {},
      missions: {},
      records: { bestLap: null, ttMedal: 0, driftBest: 0, driftMedal: 0 }
    });
  }
}

/**
 * レース報酬（クレジット）。
 * 基本 = 周回数 × 220,000 + 順位ボーナス、難易度倍率を掛けて1万Cr単位に丸め。
 */
export const POSITION_BONUS = [1000000, 620000, 400000, 260000, 160000, 100000];
export const DIFFICULTY_MULT: Record<string, number> = { easy: 1.0, normal: 1.6, hard: 2.2 };

export function computeRaceReward(position: number, laps: number, difficulty: string): number {
  const bonus = POSITION_BONUS[Math.max(0, Math.min(POSITION_BONUS.length - 1, position - 1))];
  const mult = DIFFICULTY_MULT[difficulty] ?? 1.0;
  const raw = (laps * 220000 + bonus) * mult;
  return Math.round(raw / 10000) * 10000;
}

// ============================================================
// Phase 4: チャレンジ報酬（ライセンス・ミッション・トライアル）
// ============================================================

/**
 * ライセンス/トライアル挑戦の結果をプロファイルへ反映し、支給額を返す。
 * メダルが過去最高を更新した場合のみ差分を支給する。
 */
export function applyChallengeResult(
  profile: PlayerProfile,
  def: ChallengeDef,
  value: number,
  medal: number
): { granted: number; newBest: boolean; newMedal: boolean } {
  const key = def.id;
  let prevMedal = 0;
  let prevBest: number | null = null;
  if (def.id === 'trial_tt') {
    prevMedal = profile.records.ttMedal;
    prevBest = profile.records.bestLap;
  } else if (def.id === 'trial_drift') {
    prevMedal = profile.records.driftMedal;
    prevBest = profile.records.driftBest;
  } else if (def.category === 'license') {
    prevMedal = profile.licenses[key]?.medal ?? 0;
    prevBest = profile.licenses[key]?.best ?? null;
  }
  const better = def.goalDir === 'less'
    ? (prevBest === null || value < prevBest)
    : (prevBest === null || value > prevBest);
  const newBest = prevBest !== null && better;
  const newMedal = medal > prevMedal;

  let granted = 0;
  if (newMedal && def.rewards) {
    // 過去メダルの報酬額を差し引いて段階支給
    const prevAmount = prevMedal > 0 ? def.rewards[prevMedal - 1] : 0;
    granted = def.rewards[medal - 1] - prevAmount;
  }
  profile.credits += granted;

  // 記録更新
  if (def.id === 'trial_tt') {
    if (better) profile.records.bestLap = value;
    profile.records.ttMedal = Math.max(profile.records.ttMedal, medal);
  } else if (def.id === 'trial_drift') {
    if (better) profile.records.driftBest = Math.round(value);
    profile.records.driftMedal = Math.max(profile.records.driftMedal, medal);
  } else if (def.category === 'license') {
    const rec = profile.licenses[key] ?? { medal: 0, best: null };
    rec.medal = Math.max(rec.medal, medal);
    if (better) rec.best = value;
    profile.licenses[key] = rec;
  }
  SaveSystem.save(profile);
  return { granted, newBest, newMedal };
}

/**
 * ミッション結果をプロファイルへ反映し、支給額を返す。
 * 初回クリアは全額、再クリアは10%。
 */
export function applyMissionResult(profile: PlayerProfile, def: ChallengeDef, value: number | null, pass: boolean): { granted: number; firstClear: boolean; newBest: boolean } {
  const rec = profile.missions[def.id];
  const firstClear = pass && !rec?.done;
  let granted = 0;
  if (pass && def.reward) {
    granted = firstClear ? def.reward : Math.round(def.reward * 0.1 / 10000) * 10000;
    profile.credits += granted;
  }
  const prevBest = rec?.best ?? null;
  const better = value !== null && (prevBest === null || (def.goalDir === 'less' ? value < prevBest : value > prevBest));
  const newBest = prevBest !== null && better;
  profile.missions[def.id] = {
    done: !!rec?.done || pass,
    best: better ? value : (rec?.best ?? null)
  };
  SaveSystem.save(profile);
  return { granted, firstClear, newBest };
}

/** ライセンスの解除条件: 同カテゴリの前の課題を bronze 以上で合格していること */
export function isLicenseUnlocked(profile: PlayerProfile, def: ChallengeDef, all: ChallengeDef[]): boolean {
  const idx = all.findIndex((c) => c.id === def.id);
  if (idx <= 0) return true;
  const prev = all[idx - 1];
  return (profile.licenses[prev.id]?.medal ?? 0) >= 1;
}

/** ミッションの解除条件: 前のミッションをクリアしていること */
export function isMissionUnlocked(profile: PlayerProfile, def: ChallengeDef, all: ChallengeDef[]): boolean {
  const idx = all.findIndex((c) => c.id === def.id);
  if (idx <= 0) return true;
  return !!profile.missions[all[idx - 1].id]?.done;
}

/**
 * vehicle/Tuning.ts
 * 計画書 Phase 3: チューニングショップ。
 *  - 7カテゴリ × 最大3ステージの段階式パーツカタログ
 *  - 所有車ごとの導入ステージを VehiclePhysicsSpec へ適用（applyTuning）
 *  - 適用はすべてストック値からの差分（ステージを上げ直しても倍率が積まれない）
 */
import type { VehiclePhysicsSpec } from './VehicleData';

export interface TuningPart {
  stage: number;      // 1..3（0=ストック）
  name: string;
  desc: string;
  price: number;
}

export interface TuningCategory {
  id: string;
  name: string;
  parts: TuningPart[];
}

/** パーツカタログ（架空パーツ。価格はクレジット） */
export const TUNING_CATEGORIES: TuningCategory[] = [
  {
    id: 'engine',
    name: 'エンジン',
    parts: [
      { stage: 1, name: 'ECUチューン',    desc: '最大トルク +8%',  price: 320000 },
      { stage: 2, name: '過給器強化',     desc: '最大トルク +16%', price: 780000 },
      { stage: 3, name: 'フルチューン',   desc: '最大トルク +26%', price: 1650000 }
    ]
  },
  {
    id: 'tires',
    name: 'タイヤ',
    parts: [
      { stage: 1, name: 'スポーツタイヤ', desc: 'グリップ +0.04', price: 240000 },
      { stage: 2, name: 'セミスリック',   desc: 'グリップ +0.09', price: 560000 },
      { stage: 3, name: 'スリック',       desc: 'グリップ +0.15', price: 980000 }
    ]
  },
  {
    id: 'suspension',
    name: 'サスペンション',
    parts: [
      { stage: 1, name: 'スポーツスプリング', desc: 'バネ・ダンパー +20%', price: 280000 },
      { stage: 2, name: 'レーシングサス',     desc: 'バネ・ダンパー +45%', price: 620000 }
    ]
  },
  {
    id: 'brakes',
    name: 'ブレーキ',
    parts: [
      { stage: 1, name: 'スポーツパッド',   desc: '制動力 +18%', price: 210000 },
      { stage: 2, name: 'カーボンセラミック', desc: '制動力 +40%', price: 540000 }
    ]
  },
  {
    id: 'aero',
    name: 'エアロダイナミクス',
    parts: [
      { stage: 1, name: 'リアウイング',   desc: 'ダウンフォース +20%', price: 260000 },
      { stage: 2, name: 'フルエアロキット', desc: 'ダウンフォース +45%', price: 680000 }
    ]
  },
  {
    id: 'weight',
    name: '軽量化',
    parts: [
      { stage: 1, name: '内装トリム除去', desc: '車両重量 -25kg', price: 350000 },
      { stage: 2, name: 'カーボンパネル', desc: '車両重量 -55kg', price: 820000 },
      { stage: 3, name: '完全軽量化',     desc: '車両重量 -90kg', price: 1780000 }
    ]
  },
  {
    id: 'drivetrain',
    name: 'ドライブトレイン',
    parts: [
      { stage: 1, name: 'スポーツクラッチ', desc: 'シフト時間 -30%', price: 180000 },
      { stage: 2, name: 'クロスレシオ',     desc: 'ファイナル +6% · シフト -40%', price: 430000 }
    ]
  }
];

/** カテゴリ内の指定ステージのパーツを取得 */
export function getTuningPart(categoryId: string, stage: number): TuningPart | null {
  const cat = TUNING_CATEGORIES.find((c) => c.id === categoryId);
  return cat?.parts.find((p) => p.stage === stage) ?? null;
}

/**
 * チューニング導入状況を VehiclePhysicsSpec へ適用したコピーを返す。
 * @param base   ベース車両スペック（変更されない）
 * @param tuning { categoryId: stage } 形式の導入状況
 */
export function applyTuning(base: VehiclePhysicsSpec, tuning: Record<string, number>): VehiclePhysicsSpec {
  // ディープコピー（トルクカーブ配列含む）
  const s: VehiclePhysicsSpec = JSON.parse(JSON.stringify(base)) as VehiclePhysicsSpec;
  const st = (id: string): number => tuning[id] ?? 0;

  // エンジン: トルクカーブ全体を乗算
  const eng = st('engine');
  if (eng > 0) {
    const mult = [0, 1.08, 1.16, 1.26][Math.min(3, eng)];
    s.engine.torqueCurve = base.engine.torqueCurve.map((p) => ({ rpm: p.rpm, torque: p.torque * mult }));
  }

  // タイヤ: ベースμに加算
  const tir = st('tires');
  if (tir > 0) s.tire.muBase = base.tire.muBase + [0, 0.04, 0.09, 0.15][Math.min(3, tir)];

  // サスペンション: バネ/ダンパー乗算、アンチロール加算
  const sus = st('suspension');
  if (sus > 0) {
    const m = [0, 1.20, 1.45][Math.min(2, sus)];
    s.suspension.springK = base.suspension.springK * m;
    s.suspension.damperC = base.suspension.damperC * m;
    s.suspension.antiRollFrontFraction = Math.min(0.75, base.suspension.antiRollFrontFraction + [0, 0.02, 0.05][Math.min(2, sus)]);
  }

  // ブレーキ: 前後トルク乗算
  const brk = st('brakes');
  if (brk > 0) {
    const m = [0, 1.18, 1.40][Math.min(2, brk)];
    s.brake.maxTorqueFront = base.brake.maxTorqueFront * m;
    s.brake.maxTorqueRear = base.brake.maxTorqueRear * m;
    s.brake.handbrakeRearTorque = base.brake.handbrakeRearTorque * m;
  }

  // エアロ: ダウンフォース乗算（ドラッグ微増）
  const aer = st('aero');
  if (aer > 0) {
    s.aero.downforceCoef = base.aero.downforceCoef * [0, 1.20, 1.45][Math.min(2, aer)];
    s.aero.dragCoeff = base.aero.dragCoeff * [0, 1.02, 1.05][Math.min(2, aer)];
  }

  // 軽量化: 質量・ヨー慣性をストックから差し引き
  const wgt = st('weight');
  if (wgt > 0) {
    s.mass = base.mass - [0, 25, 55, 90][Math.min(3, wgt)];
    s.iz = base.iz * [0, 0.98, 0.96, 0.92][Math.min(3, wgt)];
  }

  // ドライブトレイン: シフト時間短縮、ステージ2でファイナルギア変更
  const drv = st('drivetrain');
  if (drv > 0) {
    s.transmission.shiftTime = base.transmission.shiftTime * [0, 0.70, 0.60][Math.min(2, drv)];
    if (drv >= 2) s.transmission.finalDrive = base.transmission.finalDrive * 1.06;
  }

  return s;
}

/**
 * race/ChallengeDefs.ts
 * 計画書 Phase 4: ゲームコンテンツ（ライセンスセンター・ミッション・タイムトライアル・ドリフトトライアル）の定義。
 *
 * 目標値は実物理のヘッドレス計測（scripts/phase4_calib.ts）に基づいて調整:
 *  - Aurora RS-2 ストック 0-100km/h 7.33s / 150km/h→停止 84.5m
 *  - AIラップベスト（3周走行時）: easy 80.9s / normal 72.6s / hard 68.1s
 *  - コース全長 2053m・T1進入はラインから約281m
 *
 * medal は [bronze, silver, gold]。goalDir='less' なら小さいほど高評価。
 */
import type { AIDifficulty } from './AIDriver';

export type ChallengeKind =
  | 'accel'      // 0→100km/h タイム（ standing start ）
  | 'brake'      // 制動テスト（指定ゾーン内に停止）
  | 'sector'     // セクター1走破タイム
  | 'lap'        // 規定周回のラップタイム
  | 'clean'      // コースアウトなし走破
  | 'drift'      // ドリフトポイント
  | 'topspeed'   // 速度チャレンジ
  | 'race'       // AIとのデュエル（勝利）
  | 'timetrial'; // 無制限周回・ベストラップ記録

export interface ChallengeDef {
  id: string;
  code: string;
  title: string;
  category: 'license' | 'mission' | 'trial';
  kind: ChallengeKind;
  desc: string;
  /** 評価の向き: 'less' = 小さいほど良い（タイム系）, 'more' = 大きいほど良い（点数・速度系） */
  goalDir: 'less' | 'more';
  /** ライセンス/トライアルのメダル閾値 [bronze, silver, gold] */
  medals?: [number, number, number];
  /** メダルごと報酬（上位メダル取得時に差分支給） */
  rewards?: [number, number, number];
  /** ミッションの合格閾値（単一） */
  goal?: number;
  /** ミッションの固定報酬（初回クリア時） */
  reward?: number;
  laps?: number;
  rivals?: number;                 // race: AI台数（プレイヤーを含む総数は rivals+1）
  difficulty?: AIDifficulty;       // race: AI難易度
  spawnIdx?: number;               // accel/brake: ストレート上のスポーンサンプル
  brake?: { zoneFrom: number; zoneTo: number; speedReq: number };
  timeLimit?: number;              // accel/brake のタイムアウト（秒）
  /** 表示用: 値の単位と書式 */
  unit: string;
}

const LIC_REWARD_B: [number, number, number] = [80000, 150000, 250000];
const LIC_REWARD_A: [number, number, number] = [150000, 300000, 500000];
const TRIAL_REWARD: [number, number, number] = [200000, 400000, 700000];

/** ライセンスセンター: 8課題（B→A の順に解放） */
export const LICENSES: ChallengeDef[] = [
  {
    id: 'lic_b1', code: 'B-1', title: 'ACCELERATION TEST', category: 'license', kind: 'accel',
    desc: 'メインストレートでスタートし、0→100km/hの加速タイムを計測します。シフトアップのタイミングが鍵。',
    goalDir: 'less', medals: [9.0, 7.5, 6.5], rewards: LIC_REWARD_B, spawnIdx: 10, timeLimit: 30, unit: 's'
  },
  {
    id: 'lic_b2', code: 'B-2', title: 'BRAKING TEST', category: 'license', kind: 'brake',
    desc: 'ストレートから加速し、指定ゾーン内に正確に停車します。T1手前に設けられた停止ゾーンでブレーキングを制御してください。',
    goalDir: 'less', medals: [45, 12, 4], rewards: LIC_REWARD_B, spawnIdx: 10,
    brake: { zoneFrom: 200, zoneTo: 245, speedReq: 100 }, timeLimit: 60, unit: 'm'
  },
  {
    id: 'lic_b4', code: 'B-4', title: 'CORNERING FLOW', category: 'license', kind: 'sector',
    desc: 'セクター1（T1〜T3までの約680m）を1回で走破。立ち上がり加速とリズムの良いコーナリングが求められます。',
    goalDir: 'less', medals: [34.0, 31.5, 29.0], rewards: LIC_REWARD_B, unit: 's'
  },
  {
    id: 'lic_b6', code: 'B-6', title: 'ONE LAP BASICS', category: 'license', kind: 'lap',
    desc: 'コース1周のラップタイムを計測します。まずはラップを崩さず周回することを目標に。',
    goalDir: 'less', medals: [90, 85, 80], rewards: LIC_REWARD_B, laps: 1, unit: 's'
  },
  {
    id: 'lic_a2', code: 'A-2', title: 'DRIFT TRAINING', category: 'license', kind: 'drift',
    desc: '1周の間にドリフトポイントを蓄積します。サイドブレーキで滑らせ、カウンターステアで角度を維持してください。',
    goalDir: 'more', medals: [400, 700, 1100], rewards: LIC_REWARD_A, laps: 1, unit: 'PTS'
  },
  {
    id: 'lic_a4', code: 'A-4', title: 'CLEAN LAP', category: 'license', kind: 'clean',
    desc: '1周コースアウトせずに走破します。路面から出た瞬間に失格。安定したライン取りを磨きます。',
    goalDir: 'less', medals: [88, 84, 79], rewards: LIC_REWARD_A, laps: 1, unit: 's'
  },
  {
    id: 'lic_a6', code: 'A-6', title: 'TOP SPEED RUN', category: 'license', kind: 'topspeed',
    desc: '1周の中で最高速度を叩き出します。スリップストリームとライン選びが速度を伸ばします。',
    goalDir: 'more', medals: [150, 165, 180], rewards: LIC_REWARD_A, laps: 1, unit: 'km/h'
  },
  {
    id: 'lic_a8', code: 'A-8', title: 'DUEL LICENSE', category: 'license', kind: 'race',
    desc: 'NORMALライバル1台との1周デュエル。勝利が合格。勝ちっぷりがメダルを左右します。',
    goalDir: 'more', medals: [0.0, 0.8, 2.0], rewards: LIC_REWARD_A, laps: 1, rivals: 1, difficulty: 'normal', unit: 's'
  }
];

/** ミッション: 8種（順次解放・単一合格条件・初回クリア報酬） */
export const MISSIONS: ChallengeDef[] = [
  {
    id: 'mis_1', code: 'M-1', title: 'FIRST VICTORY', category: 'mission', kind: 'race',
    desc: 'EASYライバル1台と1周のデュエル。初勝利を掴みましょう。',
    goalDir: 'more', goal: 0, reward: 300000, laps: 1, rivals: 1, difficulty: 'easy', unit: 's'
  },
  {
    id: 'mis_2', code: 'M-2', title: 'SPEED HUNTER', category: 'mission', kind: 'topspeed',
    desc: '1周の走行で160km/hに到達せよ。メインストレートの全開走行が必要。',
    goalDir: 'more', goal: 160, reward: 350000, laps: 1, unit: 'km/h'
  },
  {
    id: 'mis_3', code: 'M-3', title: 'DRIFT KING', category: 'mission', kind: 'drift',
    desc: '1周で800ドリフトポイントを獲得。コーナーごとに確実に滑らせる腕が試される。',
    goalDir: 'more', goal: 800, reward: 400000, laps: 1, unit: 'PTS'
  },
  {
    id: 'mis_4', code: 'M-4', title: 'PERFECT LINE', category: 'mission', kind: 'clean',
    desc: 'コースアウト禁止で1周80秒以内。クリーンかつ速いラインを描く。',
    goalDir: 'less', goal: 80, reward: 450000, laps: 1, unit: 's'
  },
  {
    id: 'mis_5', code: 'M-5', title: 'DOUBLE DUEL', category: 'mission', kind: 'race',
    desc: 'NORMALライバル2台との2周レース。2台とも抜いてP1でフィニッシュ。',
    goalDir: 'more', goal: 0, reward: 550000, laps: 2, rivals: 2, difficulty: 'normal', unit: 's'
  },
  {
    id: 'mis_6', code: 'M-6', title: 'DRIFT MASTER', category: 'mission', kind: 'drift',
    desc: '2周で2000ドリフトポイント。連続ドリフトのコンボ倍率を活かせ。',
    goalDir: 'more', goal: 2000, reward: 700000, laps: 2, unit: 'PTS'
  },
  {
    id: 'mis_7', code: 'M-7', title: 'ENDURANCE CLEAN', category: 'mission', kind: 'clean',
    desc: '3周コースアウト禁止・合計240秒以内（平均80秒）。集中力が試される耐久ミッション。',
    goalDir: 'less', goal: 240, reward: 800000, laps: 3, unit: 's'
  },
  {
    id: 'mis_8', code: 'M-8', title: 'GRAND FINALE', category: 'mission', kind: 'race',
    desc: 'HARDライバル2台との3周決戦。最速のドライビングで頂点を奪え。',
    goalDir: 'more', goal: 0, reward: 1000000, laps: 3, rivals: 2, difficulty: 'hard', unit: 's'
  }
];

/** トライアル: タイムトライアル（無制限周回・ベストラップ記録）とドリフトトライアル（2周スコアアタック） */
export const TRIALS: ChallengeDef[] = [
  {
    id: 'trial_tt', code: 'TT', title: 'TIME TRIAL', category: 'trial', kind: 'timetrial',
    desc: '周回数無制限のタイムアタック。ベストラップはプロフィールに記録され、メダル目標達成で報酬。',
    goalDir: 'less', medals: [85, 78, 72], rewards: TRIAL_REWARD, unit: 's'
  },
  {
    id: 'trial_drift', code: 'DT', title: 'DRIFT TRIAL', category: 'trial', kind: 'drift',
    desc: '2周のスコアアタック。連続ドリフトでコンボ倍率を伸ばし、高点数を狙え。',
    goalDir: 'more', medals: [1000, 2000, 3500], rewards: TRIAL_REWARD, laps: 2, unit: 'PTS'
  }
];

export const ALL_CHALLENGES: ChallengeDef[] = [...LICENSES, ...MISSIONS, ...TRIALS];

export function getChallenge(id: string): ChallengeDef | undefined {
  return ALL_CHALLENGES.find((c) => c.id === id);
}

/** メダル判定: 0=未達成 1=bronze 2=silver 3=gold */
export function medalFor(def: ChallengeDef, value: number): number {
  if (!def.medals) return 0;
  const [b, s, g] = def.medals;
  if (def.goalDir === 'less') {
    if (value <= g) return 3;
    if (value <= s) return 2;
    if (value <= b) return 1;
  } else {
    if (value >= g) return 3;
    if (value >= s) return 2;
    if (value >= b) return 1;
  }
  return 0;
}

export const MEDAL_NAMES = ['—', 'BRONZE', 'SILVER', 'GOLD'];

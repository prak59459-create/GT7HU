/**
 * vehicle/VehicleData.ts
 * 計画書 §3.2/§3.3: 車両データは独立ファイル形式で保持し、3Dモデルと分離する。
 *
 * 【重要 / 著作権】計画書 PART 21 の通り、実在車両の車名・メーカー・ロゴ・3Dモデルは
 * 利用許諾確認前に完成版へ投入しない。Phase 1 では「実在車両に準ずるスペックを持つ
 * 架空車両」をデータ駆動形式で収録し、実車への差し替えはこのデータファイル＋
 * モデルGLB差し替えのみで完結する設計とする。
 */

export type DriveType = 'FF' | 'FR' | 'MR' | 'RR' | '4WD';

/** 車輪インデックス: 0=FL 1=FR 2=RL 3=RR */
export interface VehiclePhysicsSpec {
  mass: number;                 // kg
  wheelbase: number;            // m
  cgToFront: number;            // m（CG→前軸）
  cgToRear: number;             // m（CG→後軸）
  trackWidthFront: number;      // m
  trackWidthRear: number;       // m
  cgHeight: number;             // m
  rollCenterHeight: number;     // m
  iz: number;                   // kg·m²（ヨー慣性）
  wheelRadius: number;          // m
  wheelInertia: number;         // kg·m²（1輪分）
  weightDistFront: number;      // 0..1（静止時前軸荷重比率）
  driveType: DriveType;
  drivenWheels: number[];       // 駆動輪のインデックス
  bodyHeightAboveGround: number;// m（車体底面の地上高＝サスペンション含む描画基準）

  engine: {
    torqueCurve: { rpm: number; torque: number }[];
    idleRpm: number; redline: number; maxRpm: number;
    inertia: number; engineBrakeCoef: number;
  };
  transmission: {
    gearRatios: number[]; reverseRatio: number; finalDrive: number;
    efficiency: number; shiftTime: number; autoMode: boolean;
  };
  aero: {
    dragCoeff: number; frontalArea: number;
    downforceCoef: number; downforceFrontFraction: number;
  };
  brake: {
    maxTorqueFront: number; maxTorqueRear: number;
    biasFront: number; handbrakeRearTorque: number;
  };
  suspension: {
    springK: number; damperC: number; restLength: number;
    antiRollFrontFraction: number;
  };
  tire: {
    muBase: number;
    params: Partial<{ Bx: number; Cx: number; Dx: number; Ex: number;
      By: number; Cy: number; Dy: number; Ey: number; combinedShape: number; }>;
  };
  steering: { maxAngle: number; speedSensitiveCoeff: number };
  lsd: { lockAccel: number; lockDecel: number; preload: number };
}

export interface VehicleData {
  id: string;
  manufacturer: string;
  model: string;
  year: number;
  category: string;
  driveType: DriveType;
  price: number;
  colors: string[];
  defaultColor: string;
  description: string;
  physics: VehiclePhysicsSpec;
}

/** Phase 1 収録車両: 架空スポーツクーペ "Aurora RS-2"（FR, ~380PS, 1350kg） */
const AURORA_RS2: VehicleData = {
  id: 'aurora_rs2',
  manufacturer: 'Aurora Motors',
  model: 'RS-2',
  year: 2025,
  category: 'sports',
  driveType: 'FR',
  price: 8800000,
  colors: ['#c83232', '#0e1116', '#e2e4e6', '#1a3a8a', '#e8a832', '#1f3d2a'],
  defaultColor: '#c83232',
  description: '軽量FRスポーツクーペ。2.5Lターボ、約380PS。バランスの取れた足回りでサーキット走行に最適。',
  physics: {
    mass: 1350,
    wheelbase: 2.58,
    cgToFront: 1.32,
    cgToRear: 1.26,
    trackWidthFront: 1.52,
    trackWidthRear: 1.54,
    cgHeight: 0.40,
    rollCenterHeight: 0.18,
    iz: 2100,
    wheelRadius: 0.326,
    wheelInertia: 1.1,
    weightDistFront: 0.52,
    driveType: 'FR',
    drivenWheels: [2, 3],
    bodyHeightAboveGround: 0.42,

    engine: {
      torqueCurve: [
        { rpm: 900,  torque: 90  },
        { rpm: 1500, torque: 200 },
        { rpm: 2500, torque: 380 },
        { rpm: 3500, torque: 470 },
        { rpm: 4500, torque: 490 },
        { rpm: 5500, torque: 470 },
        { rpm: 6500, torque: 410 },
        { rpm: 7200, torque: 350 }
      ],
      idleRpm: 900, redline: 7200, maxRpm: 7800,
      inertia: 0.22, engineBrakeCoef: 0.00075
    },
    transmission: {
      gearRatios: [3.32, 2.05, 1.48, 1.12, 0.89, 0.73],
      reverseRatio: 3.60, finalDrive: 3.85,
      efficiency: 0.92, shiftTime: 0.18, autoMode: false
    },
    aero: {
      dragCoeff: 0.34, frontalArea: 2.0,
      downforceCoef: 0.28, downforceFrontFraction: 0.45
    },
    brake: {
      maxTorqueFront: 1900, maxTorqueRear: 1000,
      biasFront: 0.62, handbrakeRearTorque: 1500
    },
    suspension: {
      springK: 45000, damperC: 4800, restLength: 0.30,
      antiRollFrontFraction: 0.52
    },
    tire: {
      muBase: 1.08,
      params: { Bx: 10, Cx: 1.65, Dx: 1.0, Ex: -0.5, By: 8, Cy: 1.30, Dy: 1.0, Ey: -0.4, combinedShape: 1.0 }
    },
    steering: { maxAngle: 0.55, speedSensitiveCoeff: 0.045 },
    lsd: { lockAccel: 0.35, lockDecel: 0.18, preload: 60 }
  }
};

/** 購入可能ラインナップは Phase 3 セクション（末尾）で定義 */

export function getVehicleById(id: string): VehicleData | undefined {
  return VEHICLES.find((v) => v.id === id);
}

/* ============================================================
 * Phase 2: AI対戦車（架空ライバル）
 * すべて「Aurora RS-2と同世代の架空車両」（PART 21準拠・実在車両ではない）。
 * スペックはRS-2をベースに微調整したデータ駆動定義のみで、
 * 物理エンジン・プレイヤー車両の挙動には一切変更を加えない。
 * ============================================================ */

/** RS-2スペックの複製を作成し差分のみ上書きするヘルパー */
function variant(base: VehicleData, overrides: {
  id: string; manufacturer: string; model: string; category: string;
  description: string; colors: string[]; defaultColor: string;
  specOverrides?: (s: VehiclePhysicsSpec) => void;
}): VehicleData {
  const copy: VehicleData = {
    ...base,
    id: overrides.id,
    manufacturer: overrides.manufacturer,
    model: overrides.model,
    category: overrides.category,
    description: overrides.description,
    colors: overrides.colors,
    defaultColor: overrides.defaultColor,
    price: 0,
    physics: JSON.parse(JSON.stringify(base.physics)) as VehiclePhysicsSpec
  };
  overrides.specOverrides?.(copy.physics);
  // 【Phase 3修正】physics側で駆動方式を上書きした場合、データ側のdriveTypeも同期する
  // （表示は data.driveType、物理は physics.drivenWheels を参照するため二重管理になっている）
  copy.driveType = copy.physics.driveType;
  return copy;
}

/** ライバル1: Vectra S-R — 軽量化＋高回転型（FR） */
const VECTRA_SR: VehicleData = variant(AURORA_RS2, {
  id: 'vectra_sr',
  manufacturer: 'Vectra Works',
  model: 'S-R',
  category: 'sports',
  description: '軽量高出力FR。高回転型エンジンでアタック向き。',
  colors: ['#d8dce2', '#20242c'],
  defaultColor: '#d8dce2',
  specOverrides: (s) => {
    s.mass = 1290;
    s.engine.torqueCurve = [
      { rpm: 950, torque: 85 }, { rpm: 1500, torque: 190 }, { rpm: 2500, torque: 360 },
      { rpm: 3500, torque: 445 }, { rpm: 4500, torque: 475 }, { rpm: 5500, torque: 465 },
      { rpm: 6500, torque: 430 }, { rpm: 7400, torque: 370 }
    ];
    s.engine.redline = 7400; s.engine.maxRpm = 8000;
  }
});

/** ライバル2: Kessel GT — 重厚GT（FR・高出力） */
const KESSEL_GT: VehicleData = variant(AURORA_RS2, {
  id: 'kessel_gt',
  manufacturer: 'Kessel Automobil',
  model: 'GT',
  category: 'gt',
  description: '大排気量エンジンを積む重厚なGT。高速域に強い。',
  colors: ['#16306e', '#6e7a88'],
  defaultColor: '#16306e',
  specOverrides: (s) => {
    s.mass = 1430;
    s.iz = 2250;
    s.engine.torqueCurve = [
      { rpm: 900, torque: 110 }, { rpm: 1500, torque: 230 }, { rpm: 2500, torque: 430 },
      { rpm: 3500, torque: 530 }, { rpm: 4500, torque: 540 }, { rpm: 5500, torque: 500 },
      { rpm: 6500, torque: 430 }, { rpm: 7000, torque: 360 }
    ];
    s.engine.redline = 7000; s.engine.maxRpm = 7600;
    s.aero.dragCoeff = 0.33;
    s.aero.downforceCoef = 0.32;
  }
});

/** ライバル3: Noir RZ — 軽量ナチュラル（FR・俊敏） */
const NOIR_RZ: VehicleData = variant(AURORA_RS2, {
  id: 'noir_rz',
  manufacturer: 'Noir Cycles',
  model: 'RZ',
  category: 'sports',
  description: 'NAエンジンの軽量マシン。コーナリング重視。',
  colors: ['#e8eaec', '#1f3d2a', '#d8681c'],
  defaultColor: '#e8eaec',
  specOverrides: (s) => {
    s.mass = 1180;
    s.iz = 1850;
    s.engine.torqueCurve = [
      { rpm: 950, torque: 75 }, { rpm: 1500, torque: 150 }, { rpm: 2500, torque: 280 },
      { rpm: 3500, torque: 345 }, { rpm: 4500, torque: 360 }, { rpm: 5500, torque: 335 },
      { rpm: 6500, torque: 300 }, { rpm: 7200, torque: 260 }
    ];
    s.engine.redline = 7200; s.engine.maxRpm = 7800;
    s.tire.muBase = 1.05;
  }
});

/* ============================================================
 * Phase 3: 購入可能車両ラインナップ拡充
 *  - 計8種（FF×2 / FR×4 / 4WD×1 / MR×1）、架空ブランド6社
 *  - すべて variant() でRS-2を基礎に差分上書き（データ駆動）
 * ============================================================ */

/** 軽量FFハッチバック: Kestrel City GT（エントリーカー） */
const KESTREL_CITY: VehicleData = variant(AURORA_RS2, {
  id: 'kestrel_city',
  manufacturer: 'Kestrel Urban',
  model: 'City GT',
  category: 'compact',
  description: '軽量FFコンパクト。990kgの軽い車体で入門車として最適。ハンドルを切った分だけ素直に曲がる。',
  colors: ['#e8eaec', '#2a3140', '#c83232', '#1f3d2a'],
  defaultColor: '#e8eaec',
  specOverrides: (s) => {
    s.mass = 990; s.iz = 1400;
    s.weightDistFront = 0.62;
    s.driveType = 'FF'; s.drivenWheels = [0, 1];
    s.engine.torqueCurve = [
      { rpm: 900,  torque: 70 }, { rpm: 1500, torque: 105 }, { rpm: 2500, torque: 130 },
      { rpm: 3500, torque: 140 }, { rpm: 4500, torque: 148 }, { rpm: 5500, torque: 140 },
      { rpm: 6500, torque: 120 }, { rpm: 6800, torque: 105 }
    ];
    s.engine.redline = 6800; s.engine.maxRpm = 7300;
    s.brake.maxTorqueFront = 1500; s.brake.maxTorqueRear = 800;
    s.brake.handbrakeRearTorque = 1100;
    s.steering.maxAngle = 0.60;
    s.aero.dragCoeff = 0.36; s.aero.downforceCoef = 0.05;
    s.tire.muBase = 1.02;
  }
});

/** FFホットハッチ: Kestrel City RS */
const KESTREL_CITYRS: VehicleData = variant(AURORA_RS2, {
  id: 'kestrel_cityrs',
  manufacturer: 'Kestrel Urban',
  model: 'City RS',
  category: 'compact',
  description: '1.6Lターボを積むFFホットハッチ。260Nmの太い中間トルクで市街からサーキットまで。',
  colors: ['#0e1116', '#c83232', '#e8a832', '#e8eaec'],
  defaultColor: '#0e1116',
  specOverrides: (s) => {
    s.mass = 1050; s.iz = 1500;
    s.weightDistFront = 0.60;
    s.driveType = 'FF'; s.drivenWheels = [0, 1];
    s.engine.torqueCurve = [
      { rpm: 950,  torque: 80 }, { rpm: 1500, torque: 140 }, { rpm: 2500, torque: 200 },
      { rpm: 3500, torque: 245 }, { rpm: 4200, torque: 260 }, { rpm: 5500, torque: 235 },
      { rpm: 6500, torque: 200 }, { rpm: 7000, torque: 170 }
    ];
    s.engine.redline = 7000; s.engine.maxRpm = 7500;
    s.brake.maxTorqueFront = 1600; s.brake.maxTorqueRear = 850;
    s.aero.dragCoeff = 0.35; s.aero.downforceCoef = 0.08;
  }
});

/** ラリー4WD: Halberd Terra 4 */
const HALBERD_TERRA4: VehicleData = variant(AURORA_RS2, {
  id: 'halberd_terra4',
  manufacturer: 'Halberd Motorwerken',
  model: 'Terra 4',
  category: 'rally',
  description: '2.0Lターボ4WD。悪路寛容性とトラクションで天候に強いラリーベースマシン。',
  colors: ['#1a3a8a', '#d8681c', '#e8eaec', '#16306e'],
  defaultColor: '#d8681c',
  specOverrides: (s) => {
    s.mass = 1450; s.iz = 2300;
    s.weightDistFront = 0.55;
    s.driveType = '4WD'; s.drivenWheels = [0, 1, 2, 3];
    s.engine.torqueCurve = [
      { rpm: 900,  torque: 100 }, { rpm: 1500, torque: 220 }, { rpm: 2500, torque: 360 },
      { rpm: 3600, torque: 420 }, { rpm: 4500, torque: 405 }, { rpm: 5500, torque: 370 },
      { rpm: 6500, torque: 300 }, { rpm: 6600, torque: 260 }
    ];
    s.engine.redline = 6600; s.engine.maxRpm = 7100;
    s.bodyHeightAboveGround = 0.50;
    s.aero.dragCoeff = 0.38; s.aero.downforceCoef = 0.08;
    s.tire.muBase = 1.02;
    s.lsd.lockAccel = 0.45; s.lsd.lockDecel = 0.30;
  }
});

/** MRフラッグシップ: Lumiere Veloce */
const LUMIERE_VELOCE: VehicleData = variant(AURORA_RS2, {
  id: 'lumiere_veloce',
  manufacturer: 'Lumiere Sportif',
  model: 'Veloce',
  category: 'supercar',
  description: 'ミッドシップV8を搭載する軽量スーパーカー。強烈な旋回性能と高域パワーで頂点に立つ。',
  colors: ['#c83232', '#e2e4e6', '#0e1116', '#c9a961'],
  defaultColor: '#c83232',
  specOverrides: (s) => {
    s.mass = 1290; s.iz = 1900;
    s.weightDistFront = 0.42;
    s.driveType = 'MR'; s.drivenWheels = [2, 3];
    s.engine.torqueCurve = [
      { rpm: 1000, torque: 130 }, { rpm: 2000, torque: 280 }, { rpm: 3000, torque: 400 },
      { rpm: 4000, torque: 490 }, { rpm: 5200, torque: 545 }, { rpm: 6800, torque: 560 },
      { rpm: 7800, torque: 500 }, { rpm: 8400, torque: 420 }
    ];
    s.engine.redline = 8400; s.engine.maxRpm = 8900;
    s.brake.maxTorqueFront = 2600; s.brake.maxTorqueRear = 1400;
    s.brake.handbrakeRearTorque = 1800;
    s.aero.dragCoeff = 0.36; s.aero.downforceCoef = 0.50;
    s.aero.downforceFrontFraction = 0.40;
    s.tire.muBase = 1.12;
    s.lsd.lockAccel = 0.50; s.lsd.lockDecel = 0.35;
  }
});

// ライバル車（Phase 2）も購入可能にするため価格設定
NOIR_RZ.price = 6200000;
VECTRA_SR.price = 9600000;
KESSEL_GT.price = 12800000;
KESTREL_CITY.price = 2800000;
KESTREL_CITYRS.price = 4600000;
HALBERD_TERRA4.price = 10500000;
LUMIERE_VELOCE.price = 28000000;

/** 購入可能車両ラインナップ（全8種・価格順） */
export const VEHICLES: VehicleData[] = [
  KESTREL_CITY,
  KESTREL_CITYRS,
  NOIR_RZ,
  AURORA_RS2,
  VECTRA_SR,
  HALBERD_TERRA4,
  KESSEL_GT,
  LUMIERE_VELOCE
];

/**
 * スペックから最大出力をPS換算で概算。
 * P(kW) = T(Nm) × rpm / 9549、PS = kW / 0.7355。
 * トルクカーブ各点の内積の最大値（実用十分な近似）。
 */
export function estimatePowerPs(spec: VehiclePhysicsSpec): number {
  let maxPs = 0;
  for (const p of spec.engine.torqueCurve) {
    const ps = (p.torque * p.rpm) / 9549 / 0.7355;
    if (ps > maxPs) maxPs = ps;
  }
  return Math.round(maxPs);
}

export const RIVAL_VEHICLES: VehicleData[] = [VECTRA_SR, KESSEL_GT, NOIR_RZ];

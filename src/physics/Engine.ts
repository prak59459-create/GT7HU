/**
 * physics/Engine.ts
 * 計画書 §5.2: 回転数・トルクカーブ・スロットル・レブリミット・エンジンブレーキ・過給。
 * Phase 1: NA 2.5L 直4 想定のトルクカーブをデータ駆動で保持。
 */
export interface TorquePoint { rpm: number; torque: number; } // Nm

export class Engine {
  /** トルクカーブ（rpm昇順） */
  public torqueCurve: TorquePoint[];
  public idleRpm: number;
  public redline: number;        // レブリミット作動 rpm
  public maxRpm: number;         // 物理上限（タコメーター目盛上限）
  public starterRpm: number;
  public inertia: number;        // エンジン慣性 kg·m²（クランク）
  public engineBrakeCoef: number;// スロットル0時の吸気抵抗係数
  private limiterCut = false;    // レブリミット燃料カット状態（ヒステリシス）

  constructor(spec: {
    torqueCurve: TorquePoint[];
    idleRpm: number; redline: number; maxRpm: number;
    inertia?: number; engineBrakeCoef?: number;
  }) {
    this.torqueCurve = spec.torqueCurve;
    this.idleRpm = spec.idleRpm;
    this.redline = spec.redline;
    this.maxRpm = spec.maxRpm;
    this.starterRpm = spec.idleRpm;
    this.inertia = spec.inertia ?? 0.22;
    this.engineBrakeCoef = spec.engineBrakeCoef ?? 0.0008;
  }

  /** 指定rpmの最大トルク（スロットル1）を線形補間で返す */
  peakTorqueAt(rpm: number): number {
    const c = this.torqueCurve;
    if (c.length === 0) return 0;
    if (rpm <= c[0].rpm) return c[0].torque * (rpm / c[0].rpm);
    if (rpm >= c[c.length - 1].rpm) return c[c.length - 1].torque * 0.6; // 高回転落ち
    for (let i = 0; i < c.length - 1; i++) {
      if (rpm >= c[i].rpm && rpm <= c[i + 1].rpm) {
        const t = (rpm - c[i].rpm) / (c[i + 1].rpm - c[i].rpm);
        return c[i].torque + (c[i + 1].torque - c[i].torque) * t;
      }
    }
    return 0;
  }

  /** 燃料カット（レブリミット）を考慮した出力トルク（Nm）。throttle 0..1 */
  torqueAt(rpm: number, throttle: number): number {
    // レブリミット：超過でカット、ヒステリシスで復帰
    if (rpm >= this.redline) this.limiterCut = true;
    else if (rpm < this.redline - 250) this.limiterCut = false;
    const fuelCut = this.limiterCut ? 0.0 : 1.0;

    let t = this.peakTorqueAt(rpm) * throttle * fuelCut;
    // スロットル0時はエンジンブレーキ（負トルク）
    if (throttle <= 0.01) {
      t -= this.engineBrakeCoef * rpm * Math.max(0, rpm - this.idleRpm);
    }
    return t;
  }

  /** 出力（kW） */
  powerAt(rpm: number, throttle = 1): number {
    return (this.peakTorqueAt(rpm) * rpm * 2 * Math.PI / 60) / 1000 * throttle;
  }

  /** トルクカーブ全体から最大出力を探索（PS） */
  peakPowerPS(): number {
    let max = 0;
    for (let rpm = this.idleRpm; rpm <= this.redline; rpm += 100) {
      max = Math.max(max, this.powerAt(rpm));
    }
    return Math.round(max * 1.3596); // kW → PS
  }
}

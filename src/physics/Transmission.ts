/**
 * physics/Transmission.ts
 * 計画書 §5.3: ギア比 / 最終減速比 / クラッチ / シフト時間 / レブリミット制御 / AT・MT。
 */
export class Transmission {
  public gearRatios: number[];   // [g1, g2, ...] 前進
  public reverseRatio: number;
  public finalDrive: number;
  public efficiency: number;     // 駆動伝達効率
  public shiftTime: number;      // クラッチ切替時間
  public autoMode: boolean;

  public gear = 1;               // 0=reverse, 1..N=forward
  private shiftTimer = 0;        // >0 の間クラッチ不完全
  private pendingGear = 1;

  constructor(spec: {
    gearRatios: number[]; reverseRatio?: number; finalDrive: number;
    efficiency?: number; shiftTime?: number; autoMode?: boolean;
  }) {
    this.gearRatios = spec.gearRatios;
    this.reverseRatio = spec.reverseRatio ?? 3.5;
    this.finalDrive = spec.finalDrive;
    this.efficiency = spec.efficiency ?? 0.92;
    this.shiftTime = spec.shiftTime ?? 0.18;
    this.autoMode = spec.autoMode ?? false;
  }

  get totalRatio(): number {
    if (this.gear === 0) return -this.reverseRatio * this.finalDrive;
    return this.gearRatios[this.gear - 1] * this.finalDrive;
  }

  get numForwardGears(): number { return this.gearRatios.length; }

  /** クラッチ有効度 0..1（シフト中は 0 に近い） */
  get clutchEngagement(): number {
    if (this.shiftTimer > 0) return Math.max(0, 1 - this.shiftTimer / this.shiftTime);
    return 1;
  }

  get isShifting(): boolean { return this.shiftTimer > 0; }

  shiftUp(): void {
    if (this.shiftTimer > 0) return;
    if (this.gear === 0) { this.gear = 1; return; }
    if (this.gear < this.numForwardGears) { this._startShift(this.gear + 1); }
  }

  shiftDown(): void {
    if (this.shiftTimer > 0) return;
    if (this.gear > 0) {
      if (this.gear === 1) this.gear = 0; // 1速からRへ（停止時想定）
      else this._startShift(this.gear - 1);
    }
  }

  private _startShift(target: number): void {
    this.pendingGear = target;
    this.shiftTimer = this.shiftTime;
  }

  /** 自動シフト判定（rpmベース）。updateから毎ステップ呼ぶ */
  autoShift(rpm: number, redline: number, speed: number): void {
    if (!this.autoMode || this.shiftTimer > 0) return;
    if (this.gear === 0 && speed > 1) this.gear = 1;
    if (rpm > redline * 0.92 && this.gear > 0 && this.gear < this.numForwardGears) this.shiftUp();
    else if (rpm < redline * 0.42 && this.gear > 1 && speed > 3) this.shiftDown();
  }

  /** 毎ステップ進行。シフト完了時にギア確定 */
  tick(dt: number): void {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.shiftTimer = 0;
        this.gear = this.pendingGear;
      }
    }
  }

  /** エンジンrpm を車輪角速度から計算（クラッチ接続時） */
  engineRpmFromWheel(wheelOmega: number): number {
    return Math.abs(wheelOmega * this.totalRatio) * 60 / (2 * Math.PI);
  }
}

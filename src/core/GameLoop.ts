/**
 * core/GameLoop.ts
 * 計画書 §16.2「物理演算は固定タイムステップで実行し、描画速度の変化によって
 * 車両挙動が変化しないようにする」を実装するメインループ。
 *
 * - 物理: 120Hz 固定（dt = 1/120s）、アキュムレータ方式
 * - 描画: requestAnimationFrame（可変）
 * - 補間: 描画は前後の物理ステップ間で線形補間し、60fps環境でも滑らかに見える
 * - スパイク対策: 1フレーム最大 5 サブステップ（壁時計で 41.6ms 以上遅れた分は切り捨て）
 */
export class GameLoop {
  private readonly physicsHz: number;
  private readonly fixedDt: number;
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;
  private paused = false;

  /** 物理ステップ（固定dt） */
  public onPhysics: (dt: number) => void = () => {};
  /** 描画（補間アルファ 0..1） */
  public onRender: (alpha: number, frameDt: number) => void = () => {};

  /** パフォーマンス計測（開発用オーバーレイに表示） */
  public fps = 0;
  public physicsMs = 0;
  private fpsCounter = 0;
  private fpsTimer = 0;

  constructor(physicsHz = 120) {
    this.physicsHz = physicsHz;
    this.fixedDt = 1 / physicsHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this._tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  pause(): void { this.paused = true; }
  resume(): void {
    this.paused = false;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  /** 1ステップの物理を同期的に回す（初期化・テスト用） */
  stepPhysics(steps: number): void {
    for (let i = 0; i < steps; i++) this.onPhysics(this.fixedDt);
  }

  private _tick = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);

    const now = performance.now();
    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (frameDt > 0.25) frameDt = 0.25; // タブ復帰等のスパイク保護

    // FPS 計測
    this.fpsCounter++;
    this.fpsTimer += frameDt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsCounter / this.fpsTimer);
      this.fpsCounter = 0;
      this.fpsTimer = 0;
    }

    if (!this.paused) {
      this.accumulator += frameDt;
      const maxAccum = this.fixedDt * 5;
      if (this.accumulator > maxAccum) this.accumulator = maxAccum;

      const t0 = performance.now();
      let steps = 0;
      while (this.accumulator >= this.fixedDt) {
        this.onPhysics(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps > 0) this.physicsMs = performance.now() - t0;

      const alpha = this.accumulator / this.fixedDt;
      this.onRender(alpha, frameDt);
    } else {
      this.onRender(1, 0);
    }
  };
}

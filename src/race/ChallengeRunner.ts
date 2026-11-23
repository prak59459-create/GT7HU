/**
 * race/ChallengeRunner.ts
 * 計画書 Phase 4: チャレンジの実行時評価エンジン。
 *
 * - 種別ごとの成功/失敗判定・メダル算出（ChallengeDefs.medalFor 利用）
 * - ドリフトスコアリング（車体スリップ角ベース・コンボ倍率付き）
 * - HUD 表示用情報の生成
 *
 * Game が物理ステップごとに step() を呼び出す。timetrial は「終了しない」モードで、
 * 周回ごとに lap イベントを返す。
 */
import type { ChallengeDef } from './ChallengeDefs';
import { medalFor } from './ChallengeDefs';
import type { VehicleState } from '../physics/VehiclePhysics';
import type { TrackQueryResult } from '../tracks/TrackData';
import type { LapManager } from './LapManager';
import type { RaceManager } from './RaceManager';

export interface ChallengeCtx {
  dt: number;
  state: VehicleState;
  query: TrackQueryResult;
  lap: LapManager;
  lapResult: { lapCompleted: boolean; lapTime: number | null; isBest: boolean; sectorIndex: number; sectorTime: number | null };
  collided: boolean;
  race: RaceManager | null;
  playerFinished: boolean;
  /** 車体ローカル速度（ドリフト判定用。VehicleState に横速度がないため Game が直接渡す） */
  vLong: number;
  vLat: number;
}

export interface ChallengeEvent {
  finished: boolean;
  pass: boolean;
  value: number | null;
  reason?: string;
  /** timetrial の周回イベント */
  lap?: { time: number; medal: number; isSessionBest: boolean };
}

export interface ChallengeHUDInfo {
  title: string;
  value: string;
  target: string;
}

const DRIFT_ANGLE_MIN = 10;   // deg（ドリフト判定の最小車体スリップ角）
const DRIFT_SPEED_MIN = 25;   // km/h
const DRIFT_SPIN_ANGLE = 55;  // deg（スピン判定＝コンボリセット）
const DRIFT_GRACE = 0.7;      // 秒（非ドリフト継続でコンボリセット）

export class ChallengeRunner {
  public def: ChallengeDef;
  public elapsed = 0;
  public done = false;
  /** 加速・制動テスト用のスポーン時進行度 */
  public startProgress = 0;

  // ドリフトスコアリング
  public driftScore = 0;
  public driftMult = 1;
  public driftComboTime = 0;
  private driftGraceT = 0;

  // 種別別の作業状態
  public topSpeedKmh = 0;
  private brakeSpeedOK = false;
  private brakeStoppedT = 0;
  private brakeStopped = false;
  private sessionBest: number | null = null;
  private curProgress = 0;
  private lapNo = 1;

  constructor(def: ChallengeDef) {
    this.def = def;
  }

  /** GO のタイミングで呼ぶ（加速・制動テストの基準進行度を記録） */
  begin(startProgress: number): void {
    this.startProgress = startProgress;
    this.elapsed = 0;
    this.done = false;
    this.driftScore = 0;
    this.driftMult = 1;
    this.driftComboTime = 0;
    this.driftGraceT = 0;
    this.topSpeedKmh = 0;
    this.brakeSpeedOK = false;
    this.brakeStoppedT = 0;
    this.brakeStopped = false;
    this.sessionBest = null;
    this.curProgress = startProgress;
    this.lapNo = 1;
  }

  /** 毎物理ステップ呼び出し */
  step(ctx: ChallengeCtx): ChallengeEvent {
    const ev: ChallengeEvent = { finished: false, pass: false, value: null };
    if (this.done) return ev;
    this.elapsed += ctx.dt;
    this.curProgress = ctx.query.progress;
    const kmh = ctx.state.speedKmh;
    this.topSpeedKmh = Math.max(this.topSpeedKmh, kmh);
    if (ctx.lapResult.lapCompleted) this.lapNo = ctx.lap.lapsCompleted + 1;
    const d = this.def;

    // ドリフトスコアリング（ドリフト系種別のみ）
    if (d.kind === 'drift') this._stepDrift(ctx);

    switch (d.kind) {
      case 'accel': {
        if (!ctx.query.onRoad) return this._fail(ev, 'コースアウト');
        if (kmh >= 100) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = this.elapsed;
        } else if (d.timeLimit && this.elapsed > d.timeLimit) {
          return this._fail(ev, '100km/h 未到達（タイムオーバー）');
        }
        break;
      }
      case 'brake': {
        const z = d.brake!;
        const zoneStart = this.startProgress + z.zoneFrom;
        const zoneEnd = this.startProgress + z.zoneTo;
        const p = ctx.query.progress;
        if (!ctx.query.onRoad) return this._fail(ev, 'コースアウト');
        // 速度要求: ゾーン進入前に目標速度へ一度到達
        if (p < zoneStart && kmh >= z.speedReq) this.brakeSpeedOK = true;
        if (p >= zoneStart && !this.brakeSpeedOK) return this._fail(ev, `速度不足（進入前に${z.speedReq}km/h必要）`);
        // オーバーラン: ライン+3m を速度維持で通過
        if (p > zoneEnd + 3 && ctx.state.speed > 0.5) return this._fail(ev, 'オーバーラン（停止ゾーンを出た）');
        // 停止検出（0.5m/s 未満が0.3秒継続）
        if (ctx.state.speed < 0.5) {
          this.brakeStoppedT += ctx.dt;
          if (this.brakeStoppedT >= 0.3) this.brakeStopped = true;
        } else this.brakeStoppedT = 0;
        if (this.brakeStopped) {
          if (p < zoneStart) return this._fail(ev, '停止ゾーン手前で停止');
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = Math.max(0, zoneEnd - p); // ラインまでの距離（小=良い）
        } else if (d.timeLimit && this.elapsed > d.timeLimit) {
          return this._fail(ev, 'タイムオーバー');
        }
        break;
      }
      case 'sector': {
        if (!ctx.query.onRoad) return this._fail(ev, 'コースアウト');
        if (ctx.lapResult.sectorIndex === 0 && ctx.lapResult.sectorTime !== null) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = ctx.lapResult.sectorTime;
        } else if (d.timeLimit && this.elapsed > d.timeLimit) {
          return this._fail(ev, 'タイムオーバー');
        }
        break;
      }
      case 'lap': {
        if (!ctx.query.onRoad) return this._fail(ev, 'コースアウト');
        if (ctx.lapResult.lapCompleted && ctx.lapResult.lapTime !== null) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = ctx.lapResult.lapTime;
        }
        break;
      }
      case 'clean': {
        if (!ctx.query.onRoad) return this._fail(ev, 'コースアウト');
        if (ctx.collided) return this._fail(ev, 'バリア接触');
        if (ctx.lapResult.lapCompleted && ctx.lap.lapsCompleted >= (d.laps ?? 1)) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = this.elapsed; // 総合タイム（立ちスタートを含む）
        }
        break;
      }
      case 'topspeed': {
        if (ctx.lapResult.lapCompleted && ctx.lap.lapsCompleted >= (d.laps ?? 1)) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = this.topSpeedKmh;
        }
        break;
      }
      case 'drift': {
        if (ctx.lapResult.lapCompleted && ctx.lap.lapsCompleted >= (d.laps ?? 1)) {
          this.done = true;
          ev.finished = true;
          ev.pass = true;
          ev.value = Math.round(this.driftScore);
        }
        break;
      }
      case 'race': {
        if (ctx.playerFinished && ctx.race) {
          const pc = ctx.race.playerCar;
          const pos = pc?.position ?? 99;
          this.done = true;
          ev.finished = true;
          if (pos === 1) {
            let margin = 0;
            const second = ctx.race.cars.find((c) => c.position === 2);
            if (second && pc) margin = ctx.race.gapSecondsTo(second, pc);
            ev.pass = true;
            ev.value = margin;
          } else {
            ev.pass = false;
            ev.reason = `P${pos} フィニッシュ（P1が必要）`;
          }
        }
        break;
      }
      case 'timetrial': {
        if (ctx.lapResult.lapCompleted && ctx.lapResult.lapTime !== null) {
          const t = ctx.lapResult.lapTime;
          const isBest = this.sessionBest === null || t < this.sessionBest;
          if (isBest) this.sessionBest = t;
          ev.lap = { time: t, medal: medalFor(d, t), isSessionBest: isBest };
        }
        break;
      }
    }
    return ev;
  }

  private _fail(ev: ChallengeEvent, reason: string): ChallengeEvent {
    this.done = true;
    ev.finished = true;
    ev.pass = false;
    ev.reason = reason;
    return ev;
  }

  // --- ドリフトスコアリング ---
  private _stepDrift(ctx: ChallengeCtx): void {
    const kmh = ctx.state.speedKmh;
    const beta = Math.abs(Math.atan2(ctx.vLat, Math.max(1, Math.abs(ctx.vLong)))) * 180 / Math.PI;
    const drifting = beta >= DRIFT_ANGLE_MIN && kmh >= DRIFT_SPEED_MIN && ctx.query.onRoad && ctx.vLong > 2;
    if (drifting) {
      this.driftComboTime += ctx.dt;
      this.driftMult = Math.min(3, 1 + this.driftComboTime / 4);
      this.driftGraceT = 0;
      this.driftScore += (beta * kmh / 30) * this.driftMult * ctx.dt;
    } else {
      this.driftGraceT += ctx.dt;
      const spun = beta > DRIFT_SPIN_ANGLE;
      if (this.driftGraceT > DRIFT_GRACE || spun || ctx.collided || !ctx.query.onRoad) {
        this.driftComboTime = 0;
        this.driftMult = 1;
      }
    }
  }

  // --- HUD 表示 ---
  getHUD(): ChallengeHUDInfo {
    const d = this.def;
    const m = d.medals;
    const goalStr = m ? `B ${m[0]} · S ${m[1]} · G ${m[2]} ${d.unit}` : '';
    const cat = d.category === 'license' ? 'LICENSE ' : d.category === 'mission' ? 'MISSION ' : '';
    const title = `${cat}${d.code} · ${d.title}`;
    switch (d.kind) {
      case 'accel':
        return { title, value: `${this.elapsed.toFixed(2)} s`, target: goalStr };
      case 'brake': {
        const z = d.brake!;
        const rel = this.curProgress - this.startProgress;
        const inZone = rel >= z.zoneFrom;
        const v = this.brakeStopped
          ? `停止位置 +${rel.toFixed(0)}m`
          : inZone ? `ラインまで ${Math.max(0, z.zoneTo - rel).toFixed(0)}m` : `+${Math.max(0, rel).toFixed(0)}m`;
        return { title, value: v, target: `STOP ZONE +${z.zoneFrom}〜${z.zoneTo}m · ${this.brakeSpeedOK ? '速度OK' : `進入前に${z.speedReq}km/h`}` };
      }
      case 'sector':
        return { title, value: `${this.elapsed.toFixed(1)} s`, target: goalStr };
      case 'lap':
      case 'clean':
        return { title, value: `LAP ${this.lapNo}${d.laps && d.laps > 1 ? '/' + d.laps : ''} · ${this.elapsed.toFixed(1)} s`, target: goalStr };
      case 'topspeed':
        return { title, value: `${this.topSpeedKmh.toFixed(0)} km/h`, target: goalStr };
      case 'drift':
        return { title, value: `${Math.round(this.driftScore).toLocaleString('en-US')} PTS ×${this.driftMult.toFixed(1)}`, target: goalStr };
      case 'race':
        return { title, value: '', target: 'P1 フィニッシュで合格' };
      case 'timetrial':
        return { title, value: this.sessionBest !== null ? `BEST ${this.sessionBest.toFixed(2)}s` : '—', target: goalStr };
    }
    return { title, value: '', target: '' };
  }
}

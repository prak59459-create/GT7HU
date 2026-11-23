/**
 * race/AIDriver.ts
 * 計画書 Phase 2: AI対戦車ドライバーモデル。
 *
 * - ステアリング: ピュアパースート方式（先読み点との方位角差に比例制御）
 *   ※左右バグ修正後の符号規約に合わせ、目標方位角が増加する方向（+yaw）には
 *    負の steer 入力で旋回させる（+steer=画面右=yaw減少のため）。
 * - 速度計画: トラック曲率から左右加速度上限でコーナリング許容速度を算出し、
 *   制動距離分先読みの後方パス（v[i]=min(v[i], √(v[i+1]²+2·aBrake·ds))）で減速予約。
 * - 回避: 前方近距離車に対し一時的なレーンオフセットで回避。車同士の物理衝突は
 *   Phase 2 では非実装（計画書上は次フェーズ）。
 * - リカバリ: スタック／大外周時は最寄りサンプルへ復帰要求（RaceManager が処理）。
 * - ラバーバンド: プレイヤーとの進行差に応じて ±数% のペース調整（近接レース演出）。
 *
 * 入力は RawInput を合成して VehicleController へ通すため、プレイヤーと同一の
 * スムージング・物理経路を通る（挙動の一貫性・フェアネス確保）。
 */
import type { Vehicle } from '../vehicle/Vehicle';
import type { VehicleController, RawInput } from '../vehicle/VehicleController';
import type { TrackData, TrackQueryResult } from '../tracks/TrackData';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/** 難易度別コーナリング能力（左右加速度上限 m/s²）と制動能力 */
const DIFFICULTY_PARAMS: Record<AIDifficulty, { aLatMax: number; aBrake: number; topSpeed: number }> = {
  easy:   { aLatMax: 5.9, aBrake: 7.0, topSpeed: 74 },  // ~266 km/h
  normal: { aLatMax: 7.4, aBrake: 8.6, topSpeed: 79 },  // ~284 km/h
  hard:   { aLatMax: 8.6, aBrake: 9.6, topSpeed: 83 }   // ~299 km/h
};

/** 周回ごとにペースが多少変わる揺らぎ幅 */
const PACE_JITTER = 0.045;

export interface AICarInfo {
  /** その車の進行スコア（crossings×L + progress）。ソート済み配列を渡す想定 */
  progressScore: number;
  x: number;
  z: number;
}

export interface AIDriverConfig {
  difficulty: AIDifficulty;
  /** 基本レーンオフセット（コード右方向 m。±3 程度で分散させる） */
  laneOffset: number;
  /** 車両個体のペース倍率（0.95..1.05） */
  paceJitter: number;
}

export class AIDriver {
  public readonly vehicle: Vehicle;
  public readonly controller: VehicleController;
  private track: TrackData;
  private cfg: AIDriverConfig;
  private diff: { aLatMax: number; aBrake: number; topSpeed: number };

  private stuckTimer = 0;
  private recoveryRequest = 0;      // >0 で復帰要求フレーム数
  private lapPacePhase = 0;         // 周回ごとのペース揺らぎ位相
  private avoidTarget = 0;          // 現在の回避オフセット目標
  private avoidCur = 0;             // 平滑済み回避オフセット
  private stepCount = 0;

  /** 生の throttle/brake（HUD・後続処理用に露出） */
  public lastThrottle = 0;
  public lastBrake = 0;

  constructor(vehicle: Vehicle, controller: VehicleController, track: TrackData, cfg: AIDriverConfig) {
    this.vehicle = vehicle;
    this.controller = controller;
    this.track = track;
    this.cfg = cfg;
    this.diff = DIFFICULTY_PARAMS[cfg.difficulty];
    this.lapPacePhase = Math.random() * Math.PI * 2;
  }

  /** 周回イベント時に呼ぶ（ペース揺らぎ更新） */
  onLap(): void {
    this.lapPacePhase = Math.random() * Math.PI * 2;
  }

  /** 復帰要求（RaceManager がリセット後にクリアする） */
  consumeRecoveryRequest(): boolean {
    if (this.recoveryRequest > 0) { this.recoveryRequest = 0; return true; }
    return false;
  }

  /**
   * AI入力を計算し VehicleControls を返す（物理更新は呼び出し側で行う）。
   * @param dt          物理ステップ秒
   * @param query       自車位置の路面クエリ
   * @param raceClock   レース経過時間（ペース揺らぎ用）
   * @param myScore     自車の進行スコア（totalProgress m）
   * @param playerScore プレイヤーの進行スコア（ラバーバンド用）
   * @param others      レース参加車の位置情報（回避判定用）
   */
  compute(dt: number, query: TrackQueryResult, raceClock: number, myScore: number, playerScore: number, others: AICarInfo[]): RawInput {
    const v = this.vehicle.physics;
    const speed = Math.hypot(v.vLong, v.vLat);
    const samples = this.track.samples;
    const N = samples.length;
    const segLen = this.track.totalLength / N;

    // --- ペース（難易度×個体差×周回揺らぎ×ラバーバンド） ---
    let pace = (1 + this.cfg.paceJitter + Math.sin(raceClock * 0.13 + this.lapPacePhase) * PACE_JITTER * 0.4);
    const gapToPlayer = playerScore - myScore; // +: プレイヤー先行
    if (gapToPlayer > 260) pace *= 1.055;      // 大きく離されたら少し頑張る
    else if (gapToPlayer < -260) pace *= 0.955; // 大きく離したら少し譲る

    // --- 速度計画（曲率ベース、後方パスで制動予約） ---
    const idx = query.nearestIndex;
    const horizon = 40; // 先読みサンプル数（~140m）
    const vAllow: number[] = [];
    const aLat = this.diff.aLatMax * pace;
    for (let k = 0; k <= horizon; k++) {
      const s = samples[(idx + k) % N];
      const kappa = Math.max(1e-4, Math.abs(s.curvature));
      vAllow.push(Math.min(this.diff.topSpeed * pace, Math.sqrt(aLat / kappa)));
    }
    // 後方パス: 減速要求を現在位置へ伝播
    const aBrake = this.diff.aBrake * pace;
    for (let k = horizon - 1; k >= 0; k--) {
      const vmaxBrake = Math.sqrt(vAllow[k + 1] * vAllow[k + 1] + 2 * aBrake * segLen);
      if (vAllow[k] > vmaxBrake) vAllow[k] = vmaxBrake;
    }
    let targetSpeed = vAllow[0];
    if (!query.onRoad) targetSpeed = Math.min(targetSpeed, 11); // 路外は一旦抑える

    // --- 回避（10Hzで判定、レーンオフセットへ反映） ---
    this.stepCount++;
    if (this.stepCount % 12 === 0) {
      this.avoidTarget = this._planAvoidance(query, others, myScore);
    }
    this.avoidCur += (this.avoidTarget - this.avoidCur) * Math.min(1, dt * 1.6);

    // --- ステアリング（ピュアパースート + アッカーマン換算） ---
    // 先読み点（速度に応じた距離）を指定し、そこへの曲率から目標ステア角を逆算する。
    // これにより高速域でステアが飽和してスピンする古典的バグを避ける。
    const lookBase = query.onRoad ? 6 + speed * 0.55 : 5;
    const look = Math.min(40, lookBase);
    const lookIdx = (idx + Math.max(1, Math.round(look / segLen))) % N;
    // 路外に出ている時はレーンオフセットを切って中心線へ戻す
    const lane = query.onRoad ? (this.cfg.laneOffset + this.avoidCur) : 0;
    const tx = samples[lookIdx].position.x + samples[lookIdx].normal.x * lane;
    const tz = samples[lookIdx].position.z + samples[lookIdx].normal.z * lane;
    const dx = tx - v.pos.x, dz = tz - v.pos.z;
    const dist = Math.max(3, Math.hypot(dx, dz));
    const desiredYaw = Math.atan2(dx, dz);
    let dYaw = desiredYaw - v.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    // ピュアパースート曲率: κ = 2·sin(dYaw) / dist（符号付き）
    const kappaPP = 2 * Math.sin(dYaw) / dist;
    const wb = this.vehicle.data.physics.wheelbase;
    // 目標ステア角（アッカーマン）＋ヨーレート誤差による軽い減衰
    const desiredYawRate = speed * kappaPP;
    let steerAngleTarget = Math.atan(wb * kappaPP) * 1.12 + (desiredYawRate - v.yawRate) * 0.05;
    steerAngleTarget = Math.max(-0.6, Math.min(0.6, steerAngleTarget));
    // 車両側の最大ステア角（速度感応）で正規化して入力値へ
    // ※符号規約: steerAngle+ = yaw+ 側へ向ける車輪角。入力は −steerAngle/maxSteer
    //   （+入力=画面右=yaw減少。左右バグ修正後の規約に合わせる）
    const steerSpec = this.vehicle.data.physics.steering;
    const maxSteer = steerSpec.maxAngle / (1 + speed * steerSpec.speedSensitiveCoeff);
    let steer = -steerAngleTarget / Math.max(0.02, maxSteer);
    steer = Math.max(-1, Math.min(1, steer));

    // --- スロットル・ブレーキ ---
    let throttle = 0, brake = 0;
    const diffSpeed = targetSpeed - speed;
    if (diffSpeed > 0.4) throttle = Math.min(1, 0.35 + diffSpeed * 0.4);
    else if (diffSpeed < -0.9) {
      brake = Math.min(0.92, (-diffSpeed - 0.6) * 0.5);
      throttle = 0;
    } else {
      throttle = 0.32 + diffSpeed * 0.3;
    }

    // --- スタック検知（走行中に低速が続く） ---
    if (speed < 1.4 && targetSpeed > 4) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.6) {
        this.recoveryRequest = 1;
        this.stuckTimer = 0;
      }
    } else if (speed > 3) {
      this.stuckTimer = 0;
    }

    this.lastThrottle = throttle;
    this.lastBrake = brake;

    return {
      throttleKey: throttle > 0.5,
      brakeKey: brake > 0.4,
      steerKey: steer, // -1..1 をそのままアナログ相当で渡る
      handbrakeKey: false,
      shiftUpEdge: false,
      shiftDownEdge: false,
      throttleAnalog: throttle,
      brakeAnalog: brake,
      steerAnalog: steer
    };
  }

  /** カウントダウン中: ブレーキ保持でグリッドに留まる */
  gridHold(): RawInput {
    return {
      throttleKey: false, brakeKey: true, steerKey: 0, handbrakeKey: false,
      shiftUpEdge: false, shiftDownEdge: false,
      throttleAnalog: 0, brakeAnalog: 1, steerAnalog: 0
    };
  }

  /** フィニッシュ後: ゆっくり停止 */
  coolDown(): RawInput {
    return {
      throttleKey: false, brakeKey: true, steerKey: 0, handbrakeKey: false,
      shiftUpEdge: false, shiftDownEdge: false,
      throttleAnalog: 0, brakeAnalog: 0.42, steerAnalog: 0
    };
  }

  private _planAvoidance(query: TrackQueryResult, others: AICarInfo[], myScore: number): number {
    const v = this.vehicle.physics;
    const myLat = query.lateralOffset;
    for (const o of others) {
      if (o.x === v.pos.x && o.z === v.pos.z) continue; // 自分（近似判定）
      const ahead = o.progressScore - myScore;
      if (ahead > 1.5 && ahead < 16) {
        // 前方近距離車。自車との横関係を路面クエリで判定
        const q2 = this.track.query(o.x, o.z);
        if (Math.abs(q2.lateralOffset - myLat) < 2.4) {
          // 【修正】相手が右寄りなら左へ、左寄りなら右へ避ける（旧実装は逆だった）
          const room = (q2.lateralOffset - myLat) >= 0 ? -1 : 1;
          return Math.max(-4.2, Math.min(4.2, room * 3.4));
        }
      }
    }
    return 0;
  }
}

/**
 * physics/VehiclePhysics.ts
 * 計画書 PART 5 の中核。4輪独立モデルで各タイヤの力を計算し車体に適用する。
 *
 * 構成:
 *  - エンジン(Engine) / トランスミッション(Transmission) / タイヤ(TireModel Pacejka)
 *  - 4輪それぞれ: 駆動トルク・ブレーキトルク・角速度・スリップ率・スリップ角・タイヤ力
 *  - 荷重移動: 前後（ロング）・左右（ロール）・空力ダウンフォース
 *  - ヨー運動: 前後横力のモーメント + 左右駆動力差（LSD効果）
 *  - ブレーキ: 前後バランス・ABS・ハンドブレーキ
 *  - 駆動方式: FF/FR/MR/RR/4WD（ drivenWheels で柔軟対応）
 *  - LSD: 1.5way 相当（加速/減速ロック率）
 *  - 路面: TrackData.query で接地・摩擦・凹凸・バリア
 *
 * 積分は半陰的オイラー、120Hz固定（GameLoop 側で保証）。
 */
import * as THREE from 'three';
import { Engine } from './Engine';
import { Transmission } from './Transmission';
import { TireModel } from './TireModel';
import type { VehiclePhysicsSpec } from '../vehicle/VehicleData';
import type { TrackQueryResult } from '../tracks/TrackData';

export interface VehicleControls {
  throttle: number;      // 0..1
  brake: number;         // 0..1
  steer: number;         // -1..1（+1=右入力 → 画面右＝世界-X方向へ旋回）
  handbrake: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
  absOn: boolean;
  tcsOn: boolean;
  autoShift: boolean;
}

export interface VehicleState {
  position: THREE.Vector3;
  yaw: number;
  speed: number;          // m/s
  speedKmh: number;
  rpm: number;
  gear: number;           // 0=R, 1..N
  yawRate: number;
  gLong: number;          // m/s²
  gLat: number;           // m/s²（+右方向加速度）
  roll: number;           // 車体ロール rad（+右傾き）
  pitch: number;          // 車体ピッチ rad（+ノーズアップ）
  wheelOmega: [number, number, number, number]; // 4輪 rad/s
  wheelFz: [number, number, number, number];    // 4輪接地荷重 N
  steerAngle: number;     // 実ステア角 rad
  wheelSlip: [number, number, number, number];  // スリップ率（デバッグ/スキール音用）
  clutchEngaged: boolean;
  limiter: boolean;
}

const RHO_AIR = 1.225;
const G = 9.81;
const WHEEL_INDICES = [0, 1, 2, 3] as const; // FL FR RL RR

export class VehiclePhysics {
  private spec: VehiclePhysicsSpec;
  public engine: Engine;
  public transmission: Transmission;
  public tire: TireModel;

  // 状態
  public pos = new THREE.Vector3();
  public yaw = 0;
  public yawRate = 0;
  public vLong = 0;          // 前進速度 m/s（車体ローカル）
  public vLat = 0;           // 横速度 m/s（+右）
  public rpm: number;
  public wheelOmega: [number, number, number, number] = [0, 0, 0, 0];
  public wheelFz: [number, number, number, number] = [0, 0, 0, 0];
  public wheelSlip: [number, number, number, number] = [0, 0, 0, 0];
  public steerAngle = 0;
  public bodyRoll = 0;
  public bodyPitch = 0;
  public bodyY = 0;
  public gLong = 0;
  public gLat = 0;
  public limiter = false;

  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private wheelOffsets: THREE.Vector3[]; // 車体ローカル座標

  constructor(spec: VehiclePhysicsSpec) {
    this.spec = spec;
    this.engine = new Engine(spec.engine);
    this.transmission = new Transmission(spec.transmission);
    this.tire = new TireModel(spec.tire.params);
    this.rpm = spec.engine.idleRpm;
    this.wheelOffsets = [
      new THREE.Vector3(-spec.trackWidthFront / 2, 0, +spec.cgToFront),  // FL
      new THREE.Vector3(+spec.trackWidthFront / 2, 0, +spec.cgToFront),  // FR
      new THREE.Vector3(-spec.trackWidthRear / 2, 0, -spec.cgToRear),    // RL
      new THREE.Vector3(+spec.trackWidthRear / 2, 0, -spec.cgToRear)     // RR
    ];
  }

  reset(startPos: THREE.Vector3, startYaw: number): void {
    this.pos.copy(startPos);
    this.yaw = startYaw;
    this.yawRate = 0;
    this.vLong = 0; this.vLat = 0;
    this.rpm = this.engine.idleRpm;
    this.wheelOmega = [0, 0, 0, 0];
    this.wheelFz = [0, 0, 0, 0];
    this.wheelSlip = [0, 0, 0, 0];
    this.steerAngle = 0;
    this.bodyRoll = 0; this.bodyPitch = 0;
    this.bodyY = startPos.y + this.spec.bodyHeightAboveGround;
    this.gLong = 0; this.gLat = 0;
    this.transmission.gear = 1;
  }

  getState(): VehicleState {
    return {
      position: this.pos,
      yaw: this.yaw,
      speed: Math.hypot(this.vLong, this.vLat),
      speedKmh: Math.hypot(this.vLong, this.vLat) * 3.6,
      rpm: this.rpm,
      gear: this.transmission.gear,
      yawRate: this.yawRate,
      gLong: this.gLong,
      gLat: this.gLat,
      roll: this.bodyRoll,
      pitch: this.bodyPitch,
      wheelOmega: [...this.wheelOmega] as [number, number, number, number],
      wheelFz: [...this.wheelFz] as [number, number, number, number],
      steerAngle: this.steerAngle,
      wheelSlip: [...this.wheelSlip] as [number, number, number, number],
      clutchEngaged: this.transmission.clutchEngagement > 0.5,
      limiter: this.limiter
    };
  }

  update(dt: number, ctrl: VehicleControls, query: TrackQueryResult): { collided: boolean; impact: number } {
    const spec = this.spec;
    this.transmission.autoMode = ctrl.autoShift;

    // --- ステアリング（速度感応） ---
    // 【左右バグ修正】本モデルの横軸 right=(cos yaw,0,-sin yaw) は fwd に対して
    // 画面上の「左」を指す座標系で統一されている。そのため ctrl.steer +1（右入力）を
    // そのままステア角にすると画面左へ旋回してしまう。+1 入力＝画面右（世界-X方向、
    // yaw 減少）へ向くよう目標ステア角の符号を反転して適用する。
    const speed = Math.hypot(this.vLong, this.vLat);
    const maxSteer = spec.steering.maxAngle / (1 + speed * spec.steering.speedSensitiveCoeff);
    const targetSteer = -ctrl.steer * maxSteer;
    // ステア応答（レート制限で自然な操作感）
    const steerRate = 6.5;
    this.steerAngle += Math.max(-steerRate * dt, Math.min(steerRate * dt, targetSteer - this.steerAngle));
    // ハンドル戻し（入力ゼロ時、自然なセンターリターン）
    if (Math.abs(ctrl.steer) < 0.02 && speed > 1) {
      this.steerAngle *= Math.max(0, 1 - dt * 4);
    }

    // --- 前後・左右ベクトル ---
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // --- エンジンRPM ---
    const drivenOmegas = spec.drivenWheels.map((i) => this.wheelOmega[i]);
    const avgDrivenOmega = drivenOmegas.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, drivenOmegas.length);
    const wheelBasedRpm = this.transmission.engineRpmFromWheel(avgDrivenOmega);
    let targetRpm: number;
    const clutch = this.transmission.clutchEngagement;
    // ローンチ時（低速）はクラッチスリップでエンジンをパワーバンドに保持
    const freeRevRpm = this.engine.idleRpm + ctrl.throttle * (this.engine.redline - this.engine.idleRpm) * 0.65;
    if (this.transmission.isShifting) {
      targetRpm = wheelBasedRpm * 0.5 + freeRevRpm;
    } else {
      const speedBlend = THREE.MathUtils.clamp((speed - 2) / 5, 0, 1); // 0@2m/s, 1@7m/s
      targetRpm = wheelBasedRpm * speedBlend + freeRevRpm * (1 - speedBlend);
    }
    const rpmRate = clutch > 0.5 && speed > 7 ? 18 : 10;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * rpmRate);
    this.rpm = Math.max(this.engine.idleRpm, Math.min(this.engine.maxRpm, this.rpm));
    this.limiter = this.rpm >= this.engine.redline - 30 && this.rpm <= this.engine.redline + 30;

    // --- シフト制御 ---
    if (ctrl.shiftUp && !ctrl.autoShift) this.transmission.shiftUp();
    if (ctrl.shiftDown && !ctrl.autoShift) this.transmission.shiftDown();
    this.transmission.autoShift(this.rpm, this.engine.redline, speed);
    this.transmission.tick(dt);

    // --- 駆動トルク ---
    const engineTorque = this.engine.torqueAt(this.rpm, ctrl.throttle);
    const ratio = Math.abs(this.transmission.totalRatio);
    const driveTotalTorque = engineTorque * ratio * this.transmission.efficiency * clutch;
    const nDriven = spec.drivenWheels.length;
    let drivePerWheel = driveTotalTorque / Math.max(1, nDriven);

    // TCS：駆動輪のスリップが大きければトルクカット
    if (ctrl.tcsOn) {
      let maxSlip = 0;
      for (const i of spec.drivenWheels) {
        const sr = (this.wheelOmega[i] * spec.wheelRadius - Math.max(this.vLong, 1)) / Math.max(Math.abs(this.vLong), 2);
        maxSlip = Math.max(maxSlip, sr);
      }
      if (maxSlip > 0.12) {
        const cut = Math.min(0.8, (maxSlip - 0.12) * 4);
        drivePerWheel *= (1 - cut);
      }
    }

    // --- ブレーキトルク ---
    const brakeFront = ctrl.brake * spec.brake.maxTorqueFront * spec.brake.biasFront;
    const brakeRear = ctrl.brake * spec.brake.maxTorqueRear * (1 - spec.brake.biasFront);
    const handbrakeT = ctrl.handbrake ? spec.brake.handbrakeRearTorque : 0;

    // --- 荷重移動（準静的） ---
    const m = spec.mass;
    const staticFrontTotal = m * G * spec.weightDistFront;
    const staticRearTotal = m * G * (1 - spec.weightDistFront);
    // 前後（ロング加速度は前回値で近似 → 1ステップ遅れ許容）
    const longAccelEst = this.gLong;
    const dFzLong = (m * longAccelEst * (spec.cgHeight - spec.rollCenterHeight)) / spec.wheelbase;
    // 左右（ロール）
    const latAccelEst = this.gLat;
    const dFzLatFront = (m * Math.abs(latAccelEst) * (spec.cgHeight - spec.rollCenterHeight) * spec.suspension.antiRollFrontFraction) / spec.trackWidthFront;
    const dFzLatRear = (m * Math.abs(latAccelEst) * (spec.cgHeight - spec.rollCenterHeight) * (1 - spec.suspension.antiRollFrontFraction)) / spec.trackWidthRear;
    // 空力ダウンフォース
    const downforceTotal = spec.aero.downforceCoef * this.vLong * this.vLong;
    const downforceFront = downforceTotal * spec.aero.downforceFrontFraction;
    const downforceRear = downforceTotal * (1 - spec.aero.downforceFrontFraction);

    const signLat = Math.sign(latAccelEst) || 0; // +右加速 → 右輪荷重増

    // 4輪 Fz
    const fz: number[] = [0, 0, 0, 0];
    // FL,FR (0,1)
    fz[0] = staticFrontTotal / 2 - dFzLong / 2 + (signLat > 0 ? -dFzLatFront / 2 : +dFzLatFront / 2) + downforceFront / 2;
    fz[1] = staticFrontTotal / 2 - dFzLong / 2 + (signLat > 0 ? +dFzLatFront / 2 : -dFzLatFront / 2) + downforceFront / 2;
    // RL,RR (2,3)
    fz[2] = staticRearTotal / 2 + dFzLong / 2 + (signLat > 0 ? -dFzLatRear / 2 : +dFzLatRear / 2) + downforceRear / 2;
    fz[3] = staticRearTotal / 2 + dFzLong / 2 + (signLat > 0 ? +dFzLatRear / 2 : -dFzLatRear / 2) + downforceRear / 2;
    for (let i = 0; i < 4; i++) this.wheelFz[i] = Math.max(0, fz[i]);

    // --- 各輪のタイヤ力 ---
    const R = spec.wheelRadius;
    const tireForces: { fx: number; fy: number }[] = [{ fx: 0, fy: 0 }, { fx: 0, fy: 0 }, { fx: 0, fy: 0 }, { fx: 0, fy: 0 }];
    const wheelLatVels: number[] = [0, 0, 0, 0]; // 各輪の横方向速度（車体ローカル）

    for (const i of WHEEL_INDICES) {
      const isFront = i < 2;
      const offset = this.wheelOffsets[i];
      // 各輪の横方向速度（車体ローカル）= vLat + yawRate * wheelZ
      const wheelZ = offset.z;
      const vLatWheel = this.vLat + this.yawRate * wheelZ;
      wheelLatVels[i] = vLatWheel;
      // スリップ率（現在の wheelOmega を使用）
      const vLongWheel = this.vLong;
      const vLongAbs = Math.max(Math.abs(vLongWheel), 2.0);
      const slipRatio = THREE.MathUtils.clamp(
        (this.wheelOmega[i] * R - vLongWheel) / vLongAbs, -3, 3
      );
      // スリップ角
      const wheelHeading = isFront ? this.steerAngle : 0;
      const slipAngle = Math.atan2(vLatWheel, vLongAbs) - wheelHeading;
      this.wheelSlip[i] = slipRatio;

      // タイヤ力を先に計算（ホイール更新にフィードバックするため）
      const mu = query.surfaceMu * spec.tire.muBase;
      const tf = this.tire.compute(slipRatio, slipAngle, this.wheelFz[i], mu);
      tireForces[i] = tf;

      // ブレーキトルク（ABS）※回転方向に反対させる（ω=0時は進行方向に抗する）
      let brakeT = isFront ? brakeFront : (brakeRear + handbrakeT);
      if (ctrl.absOn && !ctrl.handbrake && slipRatio < -0.18) {
        const phase = (Math.sin(performance.now() * 0.06) + 1) * 0.5;
        brakeT *= 0.25 + 0.25 * phase;
      }
      const omegaSign = Math.sign(this.wheelOmega[i]) || Math.sign(this.vLong) || 1;
      brakeT = -omegaSign * brakeT;

      // 駆動トルク
      let driveT = 0;
      if (spec.drivenWheels.includes(i)) driveT = drivePerWheel;

      // ホイール角速度更新: I·dω/dt = T_drive + T_brake − Fx·R
      //  （T_brake は ω と逆向きの負値、Fx は車体へのかる力、その反力 −Fx·R がホイールを止める）
      const wheelAccel = (driveT + brakeT - tf.fx * R) / spec.wheelInertia;
      this.wheelOmega[i] += wheelAccel * dt;
      // 安全クランプ（発散防止）
      this.wheelOmega[i] = THREE.MathUtils.clamp(this.wheelOmega[i], -300, 300);
    }

    // --- LSD（1.5way）: 駆動輪の左右ペア ---
    const driveAxles: number[][] = [];
    if (spec.drivenWheels.includes(0) && spec.drivenWheels.includes(1)) driveAxles.push([0, 1]);
    if (spec.drivenWheels.includes(2) && spec.drivenWheels.includes(3)) driveAxles.push([2, 3]);
    for (const [l, r] of driveAxles) {
      const dw = this.wheelOmega[l] - this.wheelOmega[r];
      const lock = ctrl.throttle > 0.1 ? spec.lsd.lockAccel : spec.lsd.lockDecel;
      const torqueTransfer = Math.sign(dw) * Math.min(Math.abs(dw) * 80 * lock + spec.lsd.preload * lock, 600);
      // 速い方から遅い方へトルク移動
      this.wheelOmega[l] -= torqueTransfer / spec.wheelInertia * dt;
      this.wheelOmega[r] += torqueTransfer / spec.wheelInertia * dt;
    }

    // --- タイヤ力の総和 ---
    let FxTotal = 0, FyTotal = 0;
    for (const i of WHEEL_INDICES) {
      FxTotal += tireForces[i].fx; // 前進
      FyTotal += tireForces[i].fy; // 横（+右）
    }

    // --- 空気抵抗・転がり抵抗 ---
    const v = Math.hypot(this.vLong, this.vLat);
    const drag = 0.5 * RHO_AIR * spec.aero.dragCoeff * spec.aero.frontalArea * v * Math.max(0, this.vLong);
    const rolling = 0.012 * m * G * Math.sign(this.vLong);
    FxTotal -= drag + rolling;

    // --- ヨーモーメント ---
    const a = spec.cgToFront, b = spec.cgToRear;
    const FyFront = tireForces[0].fy + tireForces[1].fy;
    const FyRear = tireForces[2].fy + tireForces[3].fy;
    const FxLeftFront = tireForces[0].fx, FxRightFront = tireForces[1].fx;
    const FxLeftRear = tireForces[2].fx, FxRightRear = tireForces[3].fx;
    const trackF = spec.trackWidthFront, trackR = spec.trackWidthRear;
    // 前後横力のモーメント + 左右駆動力差（LSD由来含む）
    const M_yaw = a * FyFront - b * FyRear
      + (trackF / 2) * (FxLeftFront - FxRightFront)
      + (trackR / 2) * (FxLeftRear - FxRightRear);

    // --- 積分 ---
    const ax = FxTotal / m;
    const ay = FyTotal / m;
    const yawAccel = M_yaw / spec.iz;
    this.vLong += ax * dt;
    this.vLat += ay * dt;
    this.yawRate += yawAccel * dt;

    // 横速度の自然減衰（タイヤ力で既に減衰、過剰時に追加安定化）
    if (v < 0.6 && ctrl.throttle < 0.05 && ctrl.brake < 0.05) {
      this.vLong *= Math.max(0, 1 - dt * 2);
      this.vLat *= Math.max(0, 1 - dt * 4);
    }
    // 極低速でヨーレート残留を抑制
    if (v < 0.4) this.yawRate *= Math.max(0, 1 - dt * 5);

    this.gLong = ax;
    this.gLat = ay;

    // --- 位置更新 ---
    this.yaw += this.yawRate * dt;
    // 正規化
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.x += (this.fwd.x * this.vLong + this.right.x * this.vLat) * dt;
    this.pos.z += (this.fwd.z * this.vLong + this.right.z * this.vLat) * dt;

    // --- 車体高さ（路面クエリ） ---
    this.bodyY = query.groundY + spec.bodyHeightAboveGround + Math.sin(performance.now() * 0.02) * query.bump;

    // --- ロール/ピッチ（視覚用、平滑） ---
    const rollTarget = THREE.MathUtils.clamp(-this.gLat / G * 0.07, -0.09, 0.09);
    const pitchTarget = THREE.MathUtils.clamp(this.gLong / G * 0.05, -0.06, 0.06);
    this.bodyRoll += (rollTarget - this.bodyRoll) * Math.min(1, dt * 6);
    this.bodyPitch += (pitchTarget - this.bodyPitch) * Math.min(1, dt * 6);

    // --- バリア衝突 ---
    let collided = false, impact = 0;
    const lat = query.lateralOffset;
    if (Math.abs(lat) > query.wallLimit) {
      const over = Math.abs(lat) - query.wallLimit;
      const sign = Math.sign(lat);
      // 中心線方向に戻す
      const rightX = query.forwardZ, rightZ = -query.forwardX; // 進行方向に対する右
      this.pos.x -= rightX * sign * over;
      this.pos.z -= rightZ * sign * over;
      // 横方向速度反発（0.25復元）＋ 減衰
      const impactSpeed = Math.abs(this.vLat);
      this.vLat = -this.vLat * 0.25;
      this.vLong *= 0.85;
      collided = true;
      impact = impactSpeed;
    }

    return { collided, impact };
  }
}

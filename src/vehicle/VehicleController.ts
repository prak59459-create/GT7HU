/**
 * vehicle/VehicleController.ts
 * 計画書 §15.1/15.3: アナログ入力対応。キーボードは入力をスムージングして
 * アナログ相当に変換し、ゲームパッド/ハンドルはアナログ値をそのまま通す。
 */
import type { VehicleControls } from '../physics/VehiclePhysics';

export interface RawInput {
  throttleKey: boolean;
  brakeKey: boolean;
  steerKey: number;   // -1, 0, +1
  handbrakeKey: boolean;
  shiftUpEdge: boolean;
  shiftDownEdge: boolean;
  // ゲームパッド/ハンドルのアナログ値（無い場合は null）
  throttleAnalog: number | null;  // 0..1
  brakeAnalog: number | null;
  steerAnalog: number | null;     // -1..1
}

export interface ControlSettings {
  abs: boolean;
  tcs: boolean;
  autoTransmission: boolean;
  steeringSensitivity: number; // 0.5..1.5
}

export class VehicleController {
  private throttle = 0;
  private brake = 0;
  private steer = 0;
  private settings: ControlSettings;

  constructor(settings: ControlSettings) {
    this.settings = settings;
  }

  setSettings(s: ControlSettings): void { this.settings = s; }

  /** dt で入力をスムージングしつつ VehicleControls を生成 */
  compute(dt: number, raw: RawInput): VehicleControls {
    const thrTarget = raw.throttleAnalog !== null ? raw.throttleAnalog : (raw.throttleKey ? 1 : 0);
    const brkTarget = raw.brakeAnalog !== null ? raw.brakeAnalog : (raw.brakeKey ? 1 : 0);
    const strTarget = raw.steerAnalog !== null ? raw.steerAnalog * this.settings.steeringSensitivity : raw.steerKey;

    // スロットル：立ち上がり速め、戻し中程度
    this.throttle += (thrTarget - this.throttle) * Math.min(1, dt * 9);
    // ブレーキ：立ち上がり最速（緊急性）
    this.brake += (brkTarget - this.brake) * Math.min(1, dt * 14);
    // ステア：レート制限（ハンドル操作感）
    const steerRate = 4.0 * (1 + Math.abs(this.steer) * 0.5);
    const dSteer = strTarget - this.steer;
    this.steer += Math.max(-steerRate * dt, Math.min(steerRate * dt, dSteer));

    return {
      throttle: THREE_clamp01(this.throttle),
      brake: THREE_clamp01(this.brake),
      steer: THREE_clamp(this.steer, -1, 1),
      handbrake: raw.handbrakeKey,
      shiftUp: raw.shiftUpEdge,
      shiftDown: raw.shiftDownEdge,
      absOn: this.settings.abs,
      tcsOn: this.settings.tcs,
      autoShift: this.settings.autoTransmission
    };
  }
}

function THREE_clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function THREE_clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

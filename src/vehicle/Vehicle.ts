/**
 * vehicle/Vehicle.ts
 * 車両エンティティ：メッシュ＋物理＋アニメーション（タイヤ回転・ステア・ロール・ピッチ・
 * サスペンション視覚トラベル・ブレーキランプ）を統合。
 */
import * as THREE from 'three';
import { VehiclePhysics } from '../physics/VehiclePhysics';
import { buildVehicleMesh, type VehicleMesh } from './VehicleMeshFactory';
import type { VehicleData } from './VehicleData';
import type { TrackQueryResult } from '../tracks/TrackData';
import type { VehicleControls } from '../physics/VehiclePhysics';
import type { VehicleState } from '../physics/VehiclePhysics';

export class Vehicle {
  public data: VehicleData;
  public physics: VehiclePhysics;
  public mesh: VehicleMesh;
  public color: string;

  private brakeLightOn = false;
  private _euler = new THREE.Euler();
  private _quat = new THREE.Quaternion();

  constructor(data: VehicleData, color?: string) {
    this.data = data;
    this.color = color ?? data.defaultColor;
    this.physics = new VehiclePhysics(data.physics);
    this.mesh = buildVehicleMesh(data.physics, this.color);
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh.group);
  }

  removeFromScene(scene: THREE.Scene): void {
    scene.remove(this.mesh.group);
  }

  setColor(color: string): void {
    this.color = color;
    this.mesh.bodyMaterial.color.set(color);
  }

  /** 物理ステップ後にメッシュを状態へ同期 */
  syncMesh(dt: number): void {
    const s = this.physics.getState();
    const g = this.mesh.group;
    g.position.set(s.position.x, this.physics.bodyY, s.position.z);
    // 車体姿勢：yaw → roll(前進軸周り) → pitch(右軸周り) の順（YXZオイラー）
    // roll は進行方向軸（+Z）周り、pitch は右軸（+X）周り
    this._euler.set(s.pitch, s.yaw, -s.roll, 'YXZ');
    this._quat.setFromEuler(this._euler);
    g.quaternion.copy(this._quat);

    // タイヤ回転
    const R = this.data.physics.wheelRadius;
    for (const w of this.mesh.wheels) {
      const omega = s.wheelOmega[this.mesh.wheels.indexOf(w)];
      w.spinner.rotation.x += (omega * dt);
      // 前輪ステア
      if (w.isFront) {
        w.group.rotation.y = s.steerAngle;
      }
    }

    // ブレーキランプ
    const brakeOn = this._controlsBrake > 0.1;
    if (brakeOn !== this.brakeLightOn) {
      this.brakeLightOn = brakeOn;
      for (const tl of this.mesh.taillights) {
        (tl.material as THREE.MeshStandardMaterial).emissiveIntensity = brakeOn ? 1.2 : 0.35;
      }
    }
  }

  private _controlsBrake = 0;
  /** 直前のブレーキ入力を記録（ブレーキランプ用） */
  setBrakeInput(b: number): void { this._controlsBrake = b; }

  updatePhysics(dt: number, controls: VehicleControls, query: TrackQueryResult): { collided: boolean; impact: number } {
    this.setBrakeInput(controls.brake);
    return this.physics.update(dt, controls, query);
  }

  getState(): VehicleState { return this.physics.getState(); }

  reset(pos: THREE.Vector3, yaw: number): void {
    this.physics.reset(pos, yaw);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

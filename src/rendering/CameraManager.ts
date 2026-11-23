/**
 * rendering/CameraManager.ts
 * 計画書 §15.4: コックピット / ボンネット / バンパー / チェイス / 遠距離チェイス / 自由
 * 速度に応じたFOV変化、追従遅延、揺れ、視点切り替えを実装。
 */
import * as THREE from 'three';

export type CameraMode = 'chase' | 'chaseFar' | 'bumper' | 'hood' | 'cockpit' | 'orbit';

const MODE_ORDER: CameraMode[] = ['chase', 'chaseFar', 'hood', 'bumper', 'cockpit'];

export interface CameraTarget {
  position: THREE.Vector3;
  yaw: number;            // 車両姿勢（ラジアン）
  speed: number;          // m/s
  yawRate: number;        // rad/s
  lateralG: number;       // m/s²
  roll: number;           // 車体ロール（ラジアン）
}

export class CameraManager {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'chase';

  private target: CameraTarget | null = null;
  private smoothPos = new THREE.Vector3();
  private smoothLookAt = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private shakeIntensity = 0.4;
  private baseFov = 60;

  // orbit（ガレージ・展示）用
  private orbitAngle = 0;

  private _tmpPos = new THREE.Vector3();
  private _tmpLook = new THREE.Vector3();
  private _fwd = new THREE.Vector3();
  private _right = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);
    window.addEventListener('resize', () => this._onResize());
  }

  setTarget(t: CameraTarget): void { this.target = t; }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.initialized = false; // モード切替時にスナップ再初期化
  }

  cycleMode(): void {
    const i = MODE_ORDER.indexOf(this.mode);
    this.setMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]);
  }

  setShakeIntensity(v: number): void { this.shakeIntensity = v; }

  addShake(a: number): void { this.shake = Math.max(this.shake, a); }

  onResize(): void { this._onResize(); }
  private _onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, t: CameraTarget): void {
    this.target = t;
    if (!this.target) return;
    const tgt = this.target;
    const speed = tgt.speed;

    // 速度によるFOV拡張（迫力）
    const targetFov = this.baseFov + Math.min(22, speed * 0.45);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 5);
    this.camera.updateProjectionMatrix();

    const fwd = this._fwd.set(Math.sin(tgt.yaw), 0, Math.cos(tgt.yaw));
    const right = this._right.set(Math.cos(tgt.yaw), 0, -Math.sin(tgt.yaw));

    switch (this.mode) {
      case 'chase':       this._chase(tgt, fwd, right, dt, 7.5 + speed * 0.05, 3.2 + speed * 0.01); break;
      case 'chaseFar':    this._chase(tgt, fwd, right, dt, 13 + speed * 0.08, 6.0 + speed * 0.02); break;
      case 'hood':        this._rig(tgt, fwd, right, 1.1, 1.25, 12); break;
      case 'bumper':      this._rig(tgt, fwd, right, 2.0, 0.75, 18); break;
      case 'cockpit':     this._rig(tgt, fwd, right, -0.05, 1.05, 8); break;
      case 'orbit':       this._orbit(tgt, dt); break;
    }

    // 追従の補間（モード切替直後はスナップ）
    const lerp = this.initialized ? Math.min(1, dt * (this.mode.startsWith('chase') ? 5.5 : 12)) : 1;
    this.smoothPos.lerp(this._tmpPos, lerp);
    this.smoothLookAt.lerp(this._tmpLook, lerp);
    this.initialized = true;

    // 揺れ（衝突・路面）
    if (this.shake > 0.001) {
      const s = this.shake * this.shakeIntensity;
      this.camera.position.set(
        this.smoothPos.x + (Math.random() - 0.5) * s,
        this.smoothPos.y + (Math.random() - 0.5) * s,
        this.smoothPos.z
      );
      this.shake *= Math.pow(0.001, dt); // 急速減衰
    } else {
      this.camera.position.copy(this.smoothPos);
    }
    this.camera.lookAt(this.smoothLookAt);

    // コーナー時の微視点寄り（yawRate方向にカメラが僅かに流れる）
    // ※実装をシンプルに保つため明示的なオフセットは省略、自然な追従で表現
  }

  /** チェイス系：車両後方・上方から前方を見る */
  private _chase(t: CameraTarget, fwd: THREE.Vector3, right: THREE.Vector3, dt: number, dist: number, height: number): void {
    // 視点は車両の進行方向後方。yawRate がある程度まで視点を先行（ルックアヘッド）
    const lookahead = fwd.clone().multiplyScalar(4 + t.speed * 0.4);
    this._tmpPos.copy(t.position)
      .addScaledVector(fwd, -dist)
      .add(new THREE.Vector3(0, height, 0));
    this._tmpLook.copy(t.position).add(lookahead);
    this._tmpLook.y += 1.0;
  }

  /** 車体固定リグ（hood/bumper/cockpit） */
  private _rig(t: CameraTarget, fwd: THREE.Vector3, right: THREE.Vector3, fwdOff: number, yOff: number, lookAhead: number): void {
    this._tmpPos.copy(t.position)
      .addScaledVector(fwd, fwdOff)
      .add(new THREE.Vector3(0, yOff, 0));
    this._tmpLook.copy(t.position)
      .addScaledVector(fwd, fwdOff + lookAhead);
    this._tmpLook.y += yOff - 0.2;
  }

  private _orbit(t: CameraTarget, dt: number): void {
    this.orbitAngle += dt * 0.3;
    const r = 7;
    this._tmpPos.set(
      t.position.x + Math.cos(this.orbitAngle) * r,
      t.position.y + 2.2,
      t.position.z + Math.sin(this.orbitAngle) * r
    );
    this._tmpLook.copy(t.position);
    this._tmpLook.y += 0.6;
  }
}

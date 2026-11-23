/**
 * vehicle/VehicleMeshFactory.ts
 * 計画書 §4: 高品質3D車両。Blender/MCP連携はfile://環境で未検証のため、Phase 1 は
 * プロシージャル・ロフト（断面スイープ）で実車に準ずる形状を生成。
 *   - 断面制御点を長手方向にスイープしてボディ外殻を構築
 *   - 別途グリーンハウス（ガラス部）をロフト
 *   - フェンダー膨らみ・フロントスポイラー・リアディフューザー・ウイング・ミラー・
 *     ヘッド/テールランプ・デュアルマフラー・ブレーキディスク+キャリパー・5本スポークホイール
 *   - PBR: 塗面はクリアコート付き金属、ガラスは着色半透明、クロームトリム
 *   - 計画書 §4.4 可動: タイヤ回転 / ステアリング / サスペンション（視覚的トラベル）
 */
import * as THREE from 'three';
import type { VehiclePhysicsSpec } from './VehicleData';

export interface WheelMesh {
  group: THREE.Group;     // ステアリング回転用（前輪）
  spinner: THREE.Group;   // タイヤ回転用
  isFront: boolean;
  side: number;           // -1 left, +1 right
}

export interface VehicleMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  wheels: WheelMesh[];
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
  bodyMaterial: THREE.MeshPhysicalMaterial;
  dispose: () => void;
}

interface Station {
  z: number;
  hwFloor: number;
  hwBelt: number;
  beltY: number;
  hoodY: number;
  floorY: number;
  fenderBulge: number;
}

export function buildVehicleMesh(spec: VehiclePhysicsSpec, color: string): VehicleMesh {
  const group = new THREE.Group();
  const L = 4.5; // 全長
  const W = Math.max(spec.trackWidthFront, spec.trackWidthRear) + 0.34;

  // --- マテリアル ---
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    metalness: 0.85, roughness: 0.32,
    clearcoat: 1.0, clearcoatRoughness: 0.06,
    envMapIntensity: 1.3
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0d12, metalness: 0.0, roughness: 0.05,
    transparent: true, opacity: 0.55, clearcoat: 1.0, envMapIntensity: 1.2
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.4, roughness: 0.55 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc4c8d0, metalness: 1.0, roughness: 0.18 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.1, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, metalness: 0.95, roughness: 0.22 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, metalness: 0.9, roughness: 0.4 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd23838, metalness: 0.4, roughness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xeef4ff, emissive: 0xc8d8ff, emissiveIntensity: 0.7, metalness: 0.2, roughness: 0.15
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x401010, emissive: 0xff1010, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.3
  });

  // --- ボディ断面定義（z: +前 / -後） ---
  const floorY = 0.18;
  const beltY = 0.62;
  const hoodYmax = 0.74;
  const stations: Station[] = [
    { z: +2.25, hwFloor: 0.30, hwBelt: 0.45, beltY: 0.55, hoodY: 0.50, floorY, fenderBulge: 0.00 },
    { z: +1.95, hwFloor: 0.55, hwBelt: 0.78, beltY: 0.58, hoodY: 0.55, floorY, fenderBulge: 0.02 },
    { z: +1.60, hwFloor: 0.70, hwBelt: 0.90, beltY: 0.62, hoodY: 0.66, floorY, fenderBulge: 0.05 },
    { z: +1.32, hwFloor: 0.78, hwBelt: 0.93, beltY: 0.63, hoodY: 0.70, floorY, fenderBulge: 0.07 }, // 前軸
    { z: +0.65, hwFloor: 0.80, hwBelt: 0.93, beltY: 0.64, hoodY: 0.74, floorY, fenderBulge: 0.04 }, // カウル
    { z:  0.00, hwFloor: 0.78, hwBelt: 0.92, beltY: 0.64, hoodY: 0.72, floorY, fenderBulge: 0.03 },
    { z: -0.70, hwFloor: 0.78, hwBelt: 0.92, beltY: 0.64, hoodY: 0.70, floorY, fenderBulge: 0.03 },
    { z: -1.26, hwFloor: 0.78, hwBelt: 0.93, beltY: 0.64, hoodY: 0.66, floorY, fenderBulge: 0.07 }, // 後軸
    { z: -1.75, hwFloor: 0.70, hwBelt: 0.88, beltY: 0.62, hoodY: 0.60, floorY, fenderBulge: 0.04 },
    { z: -2.05, hwFloor: 0.55, hwBelt: 0.70, beltY: 0.58, hoodY: 0.54, floorY, fenderBulge: 0.02 },
    { z: -2.25, hwFloor: 0.30, hwBelt: 0.42, beltY: 0.52, hoodY: 0.48, floorY, fenderBulge: 0.00 }
  ];

  const body = buildLoftBody(stations, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // --- グリーンハウス（ガラス） ---
  const greenhouse = buildGreenhouse(spec, glassMat, trimMat);
  greenhouse.castShadow = true;
  group.add(greenhouse);

  // --- フロントバンパー / スプリッター ---
  const splitter = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.86, 0.05, 0.40),
    trimMat
  );
  splitter.position.set(0, 0.16, 2.05);
  splitter.castShadow = true;
  group.add(splitter);

  // --- リアディフューザー + フィン ---
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.86, 0.18, 0.35),
    trimMat
  );
  diffuser.position.set(0, 0.20, -2.10);
  group.add(diffuser);
  for (let i = -2; i <= 2; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.34), trimMat);
    fin.position.set(i * 0.22, 0.22, -2.10);
    group.add(fin);
  }

  // --- リアウイング（ダックテール） ---
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.78, 0.06, 0.28),
    bodyMat
  );
  wing.position.set(0, 0.78, -2.05);
  wing.rotation.x = -0.12;
  wing.castShadow = true;
  group.add(wing);

  // --- ヘッドライト ---
  const headlights: THREE.Mesh[] = [];
  for (const sx of [-0.62, 0.62]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 0.06), headMat);
    hl.position.set(sx, 0.62, 2.20);
    group.add(hl);
    headlights.push(hl);
    // 投光（昼間は控えめ）
    const spot = new THREE.SpotLight(0xc8d8ff, 1.2, 60, Math.PI / 7, 0.4, 1.5);
    spot.position.set(sx, 0.62, 2.20);
    spot.target.position.set(sx * 1.5, 0.0, 12);
    group.add(spot);
    group.add(spot.target);
  }

  // --- テールランプ ---
  const taillights: THREE.Mesh[] = [];
  for (const sx of [-0.62, 0.62]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.12, 0.05), tailMat.clone());
    tl.position.set(sx, 0.66, -2.22);
    group.add(tl);
    taillights.push(tl);
  }

  // --- サイドミラー ---
  for (const sx of [-0.95, 0.95]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.10), trimMat);
    stalk.position.set(sx, 0.74, 0.62);
    group.add(stalk);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.18), trimMat);
    mirror.position.set(sx + Math.sign(sx) * 0.06, 0.76, 0.62);
    group.add(mirror);
    const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.10), chromeMat);
    mirrorGlass.position.set(sx + Math.sign(sx) * 0.09, 0.76, 0.62);
    mirrorGlass.rotation.y = Math.sign(sx) * Math.PI / 2;
    group.add(mirrorGlass);
  }

  // --- デュアルマフラー ---
  for (const sx of [-0.30, 0.30]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), chromeMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(sx, 0.18, -2.28);
    group.add(tip);
  }

  // --- ドアライン/サイドインテーク（装飾） ---
  const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.60), trimMat);
  sideIntake.position.set(W * 0.46, 0.55, -0.40);
  group.add(sideIntake.clone().translateX(-W * 0.92 * 0 + -W * 0.46 * 2));

  // --- ホイール（4輪） ---
  const wheels: WheelMesh[] = [];
  const wheelPositions: Array<{ x: number; z: number; isFront: boolean; side: number }> = [
    { x: -spec.trackWidthFront / 2, z: +spec.cgToFront, isFront: true, side: -1 },
    { x: +spec.trackWidthFront / 2, z: +spec.cgToFront, isFront: true, side: +1 },
    { x: -spec.trackWidthRear / 2, z: -spec.cgToRear, isFront: false, side: -1 },
    { x: +spec.trackWidthRear / 2, z: -spec.cgToRear, isFront: false, side: +1 }
  ];
  for (const wp of wheelPositions) {
    const wheel = buildWheel(spec.wheelRadius, tireMat, rimMat, discMat, caliperMat);
    wheel.group.position.set(wp.x, spec.wheelRadius, wp.z);
    wheel.isFront = wp.isFront;
    wheel.side = wp.side;
    group.add(wheel.group);
    wheels.push(wheel);
  }

  // --- アンダーボディ影プレーン ---
  const shadowGeo = new THREE.PlaneGeometry(W * 1.05, L * 1.05);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.01;
  group.add(shadowPlane);

  const dispose = () => {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
  };

  return { group, body, wheels, headlights, taillights, bodyMaterial: bodyMat, dispose };
}

/** ロフト：断面ポイント配列をz方向にスイープしてBufferGeometry生成 */
function buildLoftBody(stations: Station[], material: THREE.Material): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  // 各断面の周回ポイント（時計回り、+X右 +Y上）
  const profiles: THREE.Vector2[][] = stations.map((s) => bodyProfile(s));

  // 頂点登録
  for (let i = 0; i < stations.length; i++) {
    const z = stations[i].z;
    const prof = profiles[i];
    for (let j = 0; j < prof.length; j++) {
      positions.push(prof[j].x, prof[j].y, z);
      uvs.push(j / prof.length, i / (stations.length - 1));
    }
  }
  // インデックス（隣接ステーション間をクアッドで結ぶ）
  const ringLen = profiles[0].length;
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < ringLen; j++) {
      const a = i * ringLen + j;
      const b = i * ringLen + (j + 1) % ringLen;
      const c = (i + 1) * ringLen + (j + 1) % ringLen;
      const d = (i + 1) * ringLen + j;
      // 表面向きを安定させるため両向きを試す→外向きになるようCCW
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/** 1断面の周回ポイント（Vector2 = x横, y高さ）。閉ループ。 */
function bodyProfile(s: Station): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const hwF = s.hwFloor, hwB = s.hwBelt, bY = s.beltY, hY = s.hoodY, fY = s.floorY, fb = s.fenderBulge;
  // 右下→右上→頂点→左上→左下→底辺で閉
  pts.push(new THREE.Vector2(hwF, fY));                 // 0 底右
  pts.push(new THREE.Vector2(hwB, fY + 0.05));          // 1 サイド下
  pts.push(new THREE.Vector2(hwB + fb, (bY + fY) / 2));// 2 フェンダー最広
  pts.push(new THREE.Vector2(hwB, bY));                 // 3 ベルト
  pts.push(new THREE.Vector2(hwB * 0.96, hY));         // 4 ショルダー
  pts.push(new THREE.Vector2(0, hY + 0.04));           // 5 フード中心クラウン
  pts.push(new THREE.Vector2(-hwB * 0.96, hY));        // 6 左ショルダー
  pts.push(new THREE.Vector2(-hwB, bY));               // 7 左ベルト
  pts.push(new THREE.Vector2(-(hwB + fb), (bY + fY) / 2)); // 8 左フェンダー
  pts.push(new THREE.Vector2(-hwB, fY + 0.05));        // 9 左サイド下
  pts.push(new THREE.Vector2(-hwF, fY));               // 10 底左
  pts.push(new THREE.Vector2(0, fY));                  // 11 底中心
  return pts;
}

/** グリーンハウス：ウィンドシールド〜リアガラス。A/Cピラーはトリム色の細帯。 */
function buildGreenhouse(spec: VehiclePhysicsSpec, glassMat: THREE.Material, trimMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const stations = [
    { z: +0.62, gw: 0.74, rw: 0.62, yBase: 0.64, yTop: 0.66 }, // ウィンドシールド基部
    { z: +0.20, gw: 0.70, rw: 0.66, yBase: 0.66, yTop: 0.92 }, // WS中程
    { z: -0.20, gw: 0.66, rw: 0.66, yBase: 0.66, yTop: 0.96 }, // ルーフ前
    { z: -0.75, gw: 0.66, rw: 0.66, yBase: 0.66, yTop: 0.96 }, // ルーフ後
    { z: -1.05, gw: 0.72, rw: 0.64, yBase: 0.66, yTop: 0.72 }  // リアガラス基部
  ];

  const positions: number[] = [];
  const indices: number[] = [];
  const ringLen = 5; // (gw,yBase)-(rw,yTop)-(0,yTop+)-(-rw,yTop)-(-gw,yBase)
  for (const s of stations) {
    positions.push(s.gw, s.yBase, s.z);
    positions.push(s.rw, s.yTop, s.z);
    positions.push(0, s.yTop + 0.03, s.z);
    positions.push(-s.rw, s.yTop, s.z);
    positions.push(-s.gw, s.yBase, s.z);
  }
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < ringLen; j++) {
      const a = i * ringLen + j;
      const b = i * ringLen + (j + 1) % ringLen;
      const c = (i + 1) * ringLen + (j + 1) % ringLen;
      const d = (i + 1) * ringLen + j;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const glass = new THREE.Mesh(geo, glassMat);
  glass.castShadow = true;
  g.add(glass);

  // A/Cピラー（黒帯）
  for (const pillar of [
    { z: 0.55, w: 0.04 },
    { z: -0.95, w: 0.04 }
  ]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.34, pillar.w),
      trimMat
    );
    p.position.set(0, 0.80, pillar.z);
    g.add(p);
  }
  // ルーフパネル（塗色に見せるため別途追加は Vehicle 側で body マテリアル流用しない）
  // Phase 1 はガラス1枚で简约化。
  return g;
}

/** ホイール組み立て */
function buildWheel(
  R: number,
  tireMat: THREE.Material,
  rimMat: THREE.Material,
  discMat: THREE.Material,
  caliperMat: THREE.Material
): WheelMesh {
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  group.add(spinner);

  const width = 0.26;
  // タイヤ（ドラム）
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, width, 32),
    tireMat
  );
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  spinner.add(tire);
  // タイヤ側面丸み（薄いトーラス）
  const sidewall = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.015, 0.025, 8, 32),
    tireMat
  );
  sidewall.rotation.y = Math.PI / 2;
  sidewall.position.x = width / 2;
  spinner.add(sidewall);
  const sidewall2 = sidewall.clone();
  sidewall2.position.x = -width / 2;
  spinner.add(sidewall2);

  // リム
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.62, R * 0.62, width + 0.005, 28),
    rimMat
  );
  rim.rotation.z = Math.PI / 2;
  spinner.add(rim);

  // 5本スポーク
  const spokeMat = rimMat;
  const spokeCount = 5;
  for (let i = 0; i < spokeCount; i++) {
    const ang = (i / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(R * 0.5, 0.05, 0.06),
      spokeMat
    );
    spoke.position.set(0, Math.cos(ang) * R * 0.32, Math.sin(ang) * R * 0.32);
    spoke.rotation.x = ang;
    spinner.add(spoke);
  }
  // ハブキャップ
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, width + 0.02, 12),
    rimMat
  );
  hub.rotation.z = Math.PI / 2;
  spinner.add(hub);

  // ブレーキディスク（車体側、回転しない）
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.02, 24),
    discMat
  );
  disc.rotation.z = Math.PI / 2;
  group.add(disc);
  // キャリパー
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.10, 0.14),
    caliperMat
  );
  caliper.position.set(0, R * 0.45, 0);
  group.add(caliper);

  return { group, spinner, isFront: false, side: 0 };
}

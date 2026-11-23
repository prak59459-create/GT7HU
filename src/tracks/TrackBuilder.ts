/**
 * tracks/TrackBuilder.ts
 * 計画書 §7.2: 路面・境界・縁石・路肩・ガードレール・タイヤバリア・ピット施設・観客席・
 * 建物・樹木・照明・地形 を生成。Phase 1 は高品質な環境セット一式を構築。
 */
import * as THREE from 'three';
import { TrackData, type TrackSample } from './TrackData';

export class TrackBuilder {
  public group = new THREE.Group();
  private disposables: Array<{ geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[]; texture?: THREE.Texture }> = [];

  constructor(private track: TrackData) {}

  build(scene: THREE.Scene): void {
    this._buildTerrain();
    this._buildRoad();
    this._buildKerbs();
    this._buildBarriers();
    this._buildStartGantry();
    this._buildTrees();
    this._buildGrandstand();
    scene.add(this.group);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.geometry?.dispose();
      if (d.material) Array.isArray(d.material) ? d.material.forEach((m) => m.dispose()) : d.material.dispose();
      d.texture?.dispose();
    }
    this.group.parent?.remove(this.group);
  }

  // --- 路面メッシュ（スプライン沿いにリボン生成） ---
  private _buildRoad(): void {
    const samples = this.track.samples;
    const N = samples.length;
    const halfW = this.track.width / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < N; i++) {
      const s = samples[i];
      const nx = s.normal.x, nz = s.normal.z;
      const lx = s.position.x - nx * halfW;
      const lz = s.position.z - nz * halfW;
      const rx = s.position.x + nx * halfW;
      const rz = s.position.z + nz * halfW;
      const y = s.position.y + 0.02;
      positions.push(lx, y, lz, rx, y, rz);
      uvs.push(0, i * 0.5);
      uvs.push(1, i * 0.5);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1;
      const c = ((i + 1) % N) * 2, d = ((i + 1) % N) * 2 + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const tex = makeAsphaltTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x9a9a9a, metalness: 0.1, roughness: 0.7
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.group.add(road);
    this.disposables.push({ geometry: geo, material: mat, texture: tex });

    // 路肩白線（両端）
    this._buildEdgeLine(0.18, 0xffffff);
    // スタートライン（市松）
    this._buildStartLine();
  }

  private _buildEdgeLine(width: number, color: number): void {
    const samples = this.track.samples;
    const N = samples.length;
    for (const side of [-1, 1]) {
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i < N; i++) {
        const s = samples[i];
        const nx = s.normal.x * side, nz = s.normal.z * side;
        const halfW = this.track.width / 2;
        const inner = halfW + 0.05;
        const outer = inner + width;
        const ix = s.position.x + nx * inner, iz = s.position.z + nz * inner;
        const ox = s.position.x + nx * outer, oz = s.position.z + nz * outer;
        const y = s.position.y + 0.025;
        positions.push(ix, y, iz, ox, y, oz);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = i * 2 + 1;
        const c = ((i + 1) % N) * 2, d = ((i + 1) % N) * 2 + 1;
        indices.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.6 });
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      this.group.add(m);
      this.disposables.push({ geometry: geo, material: mat });
    }
  }

  private _buildStartLine(): void {
    const s = this.track.samples[0];
    const halfW = this.track.width / 2;
    const tx = makeCheckerTexture(8, 2);
    const mat = new THREE.MeshStandardMaterial({ map: tx, metalness: 0.0, roughness: 0.7 });
    const geo = new THREE.PlaneGeometry(this.track.width, 2);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(s.tangent.x, s.tangent.z);
    m.position.set(s.position.x, s.position.y + 0.03, s.position.z);
    m.receiveShadow = true;
    this.group.add(m);
    this.disposables.push({ geometry: geo, material: mat, texture: tx });
  }

  // --- 縁石（高曲率部の赤白ストライプ） ---
  private _buildKerbs(): void {
    const samples = this.track.samples;
    const N = samples.length;
    const halfW = this.track.width / 2;
    const curbW = 0.6;
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      if (s.curvature < 0.012) continue;
      for (const side of [-1, 1]) {
        const nx = s.normal.x * side, nz = s.normal.z * side;
        const inner = halfW;
        const outer = inner + curbW;
        const ix = s.position.x + nx * inner, iz = s.position.z + nz * inner;
        const ox = s.position.x + nx * outer, oz = s.position.z + nz * outer;
        const y = s.position.y + 0.04;
        const isRed = Math.floor(i / 2) % 2 === 0;
        const geo = new THREE.BoxGeometry(curbW, 0.08, 2.0);
        const mat = new THREE.MeshStandardMaterial({
          color: isRed ? 0xd23030 : 0xe8e8e8, metalness: 0.1, roughness: 0.5
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set((ix + ox) / 2, y, (iz + oz) / 2);
        m.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
        m.receiveShadow = true;
        this.group.add(m);
        this.disposables.push({ geometry: geo, material: mat });
      }
    }
  }

  // --- ガードレール + タイヤバリア ---
  private _buildBarriers(): void {
    const samples = this.track.samples;
    const N = samples.length;
    const halfW = this.track.width / 2;
    const runoff = this.track.runoff;
    const railDist = halfW + runoff * 0.6;

    // ガードレール（連続リボン）
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      const s = samples[i];
      for (const side of [-1, 1]) {
        const nx = s.normal.x * side, nz = s.normal.z * side;
        const dx = s.position.x + nx * railDist;
        const dz = s.position.z + nz * railDist;
        positions.push(dx, s.position.y + 0.2, dz);
        positions.push(dx, s.position.y + 1.0, dz);
      }
    }
    // 簡略：各ステーション4頂点（左右上下）。インデックスは左右それぞれで結ぶ
    for (let i = 0; i < N; i++) {
      const ni = (i + 1) % N;
      // 左: index i*4+0(bottom),i*4+1(top), ni*4+0,ni*4+1
      // 右: i*4+2, i*4+3, ni*4+2, ni*4+3
      const a0 = i * 4, a1 = i * 4 + 1, b0 = ni * 4, b1 = ni * 4 + 1;
      const a2 = i * 4 + 2, a3 = i * 4 + 3, b2 = ni * 4 + 2, b3 = ni * 4 + 3;
      indices.push(a0, b0, a1, a1, b0, b1); // 左
      indices.push(a2, a3, b2, a3, b3, b2); // 右
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
    const rail = new THREE.Mesh(geo, mat);
    rail.castShadow = true;
    this.group.add(rail);
    this.disposables.push({ geometry: geo, material: mat });

    // ポール（間隔）
    for (let i = 0; i < N; i += 8) {
      const s = samples[i];
      for (const side of [-1, 1]) {
        const nx = s.normal.x * side, nz = s.normal.z * side;
        const px = s.position.x + nx * railDist;
        const pz = s.position.z + nz * railDist;
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 1.0, 0.1),
          new THREE.MeshStandardMaterial({ color: 0x505458, metalness: 0.5, roughness: 0.5 })
        );
        pole.position.set(px, s.position.y + 0.5, pz);
        this.group.add(pole);
        this.disposables.push({ geometry: pole.geometry, material: pole.material });
      }
    }
  }

  // --- スタートガントリー ---
  private _buildStartGantry(): void {
    const s = this.track.samples[0];
    const g = new THREE.Group();
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x202028, metalness: 0.6, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const nx = s.normal.x * side, nz = s.normal.z * side;
      const px = s.position.x + nx * (this.track.width / 2 + 1);
      const pz = s.position.z + nz * (this.track.width / 2 + 1);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), beamMat);
      pillar.position.set(px, s.position.y + 3, pz);
      pillar.castShadow = true;
      g.add(pillar);
      this.disposables.push({ geometry: pillar.geometry, material: beamMat });
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.track.width + 3, 1.0, 0.6), beamMat);
    beam.position.set(s.position.x, s.position.y + 5.8, s.position.z);
    beam.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);
    g.add(beam);
    // 看板
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(this.track.width + 1, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xc83232, emissive: 0x401010, side: THREE.DoubleSide })
    );
    sign.position.copy(beam.position);
    sign.position.y -= 0.05;
    sign.rotation.y = beam.rotation.y;
    g.add(sign);
    this.group.add(g);
  }

  // --- 地形（草地、起伏） ---
  private _buildTerrain(): void {
    const size = 1600;
    const seg = 80;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    // 距離に応じた緩やかな起伏
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const h = Math.sin(x * 0.01) * 1.5 + Math.cos(z * 0.012) * 1.5 + (d > 200 ? Math.sin(d * 0.005) * 4 : 0);
      pos.setY(i, h - 4);
    }
    geo.computeVertexNormals();
    const tex = makeGrassTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x3a5a32, metalness: 0, roughness: 1 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push({ geometry: geo, material: mat, texture: tex });
  }

  // --- 樹木（インスタンス） ---
  private _buildTrees(): void {
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
    const leavesGeo = new THREE.SphereGeometry(2.2, 8, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, metalness: 0, roughness: 0.9 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2c5028, metalness: 0, roughness: 0.95 });

    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, 120);
    const leavesInst = new THREE.InstancedMesh(leavesGeo, leavesMat, 120);
    trunkInst.castShadow = true;
    leavesInst.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    let placed = 0;
    let attempts = 0;
    while (placed < 120 && attempts < 2000) {
      attempts++;
      const x = (Math.random() - 0.5) * 700;
      const z = (Math.random() - 0.5) * 700;
      // 路面中心線から十分遠い位置のみ
      const q2 = this.track.query(x, z);
      if (Math.abs(q2.lateralOffset) < 35) continue;
      const y = q2.groundY;
      const sc = 0.7 + Math.random() * 0.6;
      p.set(x, y + 1.5 * sc, z);
      s.setScalar(sc);
      m.compose(p, q, s);
      trunkInst.setMatrixAt(placed, m);
      p.set(x, y + 4.5 * sc, z);
      m.compose(p, q, s);
      leavesInst.setMatrixAt(placed, m);
      placed++;
    }
    trunkInst.count = placed;
    leavesInst.count = placed;
    trunkInst.instanceMatrix.needsUpdate = true;
    leavesInst.instanceMatrix.needsUpdate = true;
    this.group.add(trunkInst, leavesInst);
    this.disposables.push({ geometry: trunkGeo, material: trunkMat });
    this.disposables.push({ geometry: leavesGeo, material: leavesMat });
  }

  // --- 観客席（メインスタンド） ---
  private _buildGrandstand(): void {
    const s = this.track.samples[Math.floor(this.track.samples.length * 0.97)];
    const g = new THREE.Group();
    const matRoof = new THREE.MeshStandardMaterial({ color: 0x303540, metalness: 0.5, roughness: 0.4 });
    const matSeat = new THREE.MeshStandardMaterial({ color: 0x808890, metalness: 0.3, roughness: 0.6 });
    const nx = s.normal.x, nz = s.normal.z;
    const dist = this.track.width / 2 + 14;
    const cx = s.position.x + nx * dist;
    const cz = s.position.z + nz * dist;
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);

    const seats = new THREE.Mesh(new THREE.BoxGeometry(50, 6, 12), matSeat);
    seats.position.set(cx, s.position.y + 3, cz);
    seats.rotation.y = yaw + Math.PI / 2;
    seats.castShadow = true;
    seats.receiveShadow = true;
    g.add(seats);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(52, 0.5, 14), matRoof);
    roof.position.set(cx, s.position.y + 7.5, cz);
    roof.rotation.y = yaw + Math.PI / 2;
    g.add(roof);
    this.group.add(g);
    this.disposables.push({ geometry: seats.geometry, material: matSeat });
    this.disposables.push({ geometry: roof.geometry, material: matRoof });
  }
}

// --- プロシージャルテクスチャ ---
function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3a3e';
  ctx.fillRect(0, 0, 256, 256);
  // ノイズ
  const img = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 30 + Math.random() * 50;
    img.data[i] = n; img.data[i + 1] = n; img.data[i + 2] = n + 4; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 80);
  t.anisotropy = 4;
  return t;
}

function makeCheckerTexture(cols: number, rows: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  const cw = 256 / cols, ch = 64 / rows;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#101010';
      ctx.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  return new THREE.CanvasTexture(c);
}

function makeGrassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2c4828';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    const g = 60 + Math.random() * 50;
    ctx.fillStyle = `rgb(${g * 0.5 | 0}, ${g | 0}, ${g * 0.4 | 0})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(80, 80);
  return t;
}

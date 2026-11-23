/**
 * tracks/TrackData.ts
 * 計画書 §7: 実在サーキット準拠のコース寸法・高低差・周辺環境のデータソース。
 * Phase 1 は架空サーキット "Aurora Valley GP Circuit"（約3.3km、高低差7m）。
 *   - Catmull-Rom 閉曲線で中心線を定義
 *   - 等間隔サンプリング（~3.5m）で累積距離・接線・曲率を事前計算
 *   - 空間グリッドで最近点クエリを高速化（物理120Hz×複数クエリに対応）
 *   - ラップタイム計測用セクター（3分割）
 */
import * as THREE from 'three';

export interface TrackSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;   // 正規化接線（進行方向）
  normal: THREE.Vector3;    // 接線×上（右方向）
  curvature: number;        // 曲率（1/m）※縁石配置等に使用
  cumDist: number;          // 累積距離（m）
}

export interface TrackQueryResult {
  groundY: number;          // 路面高さ（その地点の）
  lateralOffset: number;    // 中心線からの横方向（+右）。単位 m
  forwardX: number;         // 中心線進行方向 X
  forwardZ: number;         // 中心線進行方向 Z
  onRoad: boolean;          // 路面幅以内
  surfaceMu: number;        // 路面摩擦倍率
  bump: number;             // 路面凹凸振幅（m）
  wallLimit: number;        // バリアまでの横限界（路面半幅+ランンオフ）
  progress: number;         // 累積距離（ラップ進行 0..totalLength）
  nearestIndex: number;
}

const TRACK_WIDTH = 13;       // 路面幅
const RUNOFF = 9;             // ランオフエリア幅
const SURFACE_MU_TARMAC = 1.0;
const SURFACE_MU_GRASS = 0.55;

/** コース中心線制御点（架空サーキット）。x/z 平面配置、y は高低差。 */
const CONTROL_POINTS: Array<[number, number, number]> = [
  // x, z, y(elev)
  [   0, -180, 0.0],   // メインストレート始点（スタートライン直前）
  [   0,  -40, 0.0],   // ストレート中程
  [   0,  100, 0.4],   // T1 進入
  [  35,  185, 1.3],   // T1 右ヘアピン進入
  [ 115,  210, 2.0],   // T1 アペックス
  [ 185,  170, 2.6],   // T1 脱出
  [ 215,   85, 3.2],   // T2 左
  [ 200,   -5, 4.0],   // エッセー
  [ 245,  -70, 4.8],   // T3 右クランク
  [ 305, -110, 5.6],   // クレスト右キンク
  [ 335, -200, 6.4],   // 下り左開始
  [ 290, -285, 5.2],   // T4 左ヘアピン
  [ 195, -315, 3.8],   // バックストレート入口
  [  40, -330, 1.8],   // バックストレート中
  [ -90,-335, 0.8],    // 緩やかなキンク
  [-170,-320, 0.3],    // T6 右進入
  [-235,-255,-0.2],    // タイト化
  [-255,-160, 0.0],    // T7 複合
  [-200, -95, 0.0],    // シケーン左
  [-150,-115, 0.0],    // シケーン右
  [ -85,-145, 0.0],    // ショート chute
  [ -35,-175, 0.0]     // 最終コーナー右→メインストレート
];

export class TrackData {
  public readonly id = 'aurora_valley_gp';
  public readonly name = 'Aurora Valley GP Circuit';
  public readonly description = '架空の国際サーキット（約3.3km、高低差7m）。技術コーナーと高速セクションが混在。';
  public readonly width = TRACK_WIDTH;
  public readonly runoff = RUNOFF;

  public samples: TrackSample[] = [];
  public totalLength = 0;
  public startDir = new THREE.Vector3();
  public startPos = new THREE.Vector3();
  public sectors = [0.33, 0.66]; // ラップバリデーション用セクター（累積比）

  private grid = new Map<string, number[]>();
  private cellSize = 28;

  constructor() {
    this._buildSamples();
    this._buildSpatialGrid();
  }

  private _buildSamples(): void {
    // 【重要修正】制御点行は "x, z, y(elev)" の並び（上のコメント参照）。
    // 旧実装は [x, y, z] と誤デストラクトして y/z を入れ替えており、
    // コース全体が x-y 平面に「縦置き」になっていた（水平面は高低差0〜7mの細帯に
    // 潰れ、空間グリッドの最近点判定も退化していた）。
    // THREE は Y-up のため Vector3(x, y=elev, z) に正しく変換する。
    const pts = CONTROL_POINTS.map(([x, z, y]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    const N = Math.max(600, Math.round(this._estimateLength(curve) / 3.5));
    const span = this._estimateLength(curve);

    let cum = 0;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const tNext = ((i + 1) % N) / N;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t).normalize();
      const tanNext = curve.getTangentAt(tNext).normalize();
      // 曲率：接線変化角 / 弧長
      const dTheta = Math.acos(Math.max(-1, Math.min(1, tan.dot(tanNext))));
      const segLen = p.distanceTo(curve.getPointAt(tNext));
      const curv = segLen > 0 ? dTheta / segLen : 0;
      const normal = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      this.samples.push({
        position: p,
        tangent: tan,
        normal,
        curvature: curv,
        cumDist: cum
      });
      cum += segLen;
    }
    this.totalLength = cum;
    this.startPos.copy(this.samples[0].position);
    this.startDir.copy(this.samples[0].tangent);
  }

  private _estimateLength(curve: THREE.CatmullRomCurve3): number {
    let len = 0;
    const N = 200;
    let prev = curve.getPointAt(0);
    for (let i = 1; i <= N; i++) {
      const u = i / N; // 0..1
      const p = curve.getPointAt(u > 1 ? 1 : u);
      if (!p) break;
      len += prev.distanceTo(p);
      prev = p;
    }
    return len;
  }

  private _buildSpatialGrid(): void {
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const key = this._cellKey(s.position.x, s.position.z);
      let arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(i);
    }
  }

  private _cellKey(x: number, z: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return cx + ',' + cz;
  }

  /** 任意位置の路面情報を取得 */
  query(x: number, z: number): TrackQueryResult {
    const idx = this._nearestIndex(x, z);
    // セグメント補間で精度向上（idx 〜 idx+1）
    const s0 = this.samples[idx];
    const s1 = this.samples[(idx + 1) % this.samples.length];
    const seg = new THREE.Vector3(s1.position.x - s0.position.x, 0, s1.position.z - s0.position.z);
    const segLen2 = seg.lengthSq() || 1;
    const toP = new THREE.Vector3(x - s0.position.x, 0, z - s0.position.z);
    const t = Math.max(0, Math.min(1, toP.dot(seg) / segLen2));
    const groundY = s0.position.y + (s1.position.y - s0.position.y) * t;
    const fwdX = s0.tangent.x + (s1.tangent.x - s0.tangent.x) * t;
    const fwdZ = s0.tangent.z + (s1.tangent.z - s0.tangent.z) * t;
    const fLen = Math.hypot(fwdX, fwdZ) || 1;
    const fxN = fwdX / fLen, fzN = fwdZ / fLen;
    // 横方向（右）= 進行方向を Y軸周りに -90°（右）
    const rightX = fzN, rightZ = -fxN;
    const lateral = (x - (s0.position.x + (s1.position.x - s0.position.x) * t)) * rightX +
                    (z - (s0.position.z + (s1.position.z - s0.position.z) * t)) * rightZ;
    const absLat = Math.abs(lateral);
    const onRoad = absLat <= this.width / 2;
    const surfaceMu = onRoad ? SURFACE_MU_TARMAC : SURFACE_MU_GRASS;
    const bump = onRoad ? 0.004 : 0.05 + Math.min(0.1, (absLat - this.width / 2) * 0.01);
    const progress = s0.cumDist + s1.position.distanceTo(s0.position) * t;

    return {
      groundY,
      lateralOffset: lateral,
      forwardX: fxN,
      forwardZ: fzN,
      onRoad,
      surfaceMu,
      bump,
      wallLimit: this.width / 2 + this.runoff,
      progress,
      nearestIndex: idx
    };
  }

  private _nearestIndex(x: number, z: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    let best = 0, bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.grid.get((cx + dx) + ',' + (cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const s = this.samples[i];
          const d = (s.position.x - x) ** 2 + (s.position.z - z) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    // グリッド外（遠距離）のフォールバック：全体走査（稀）
    if (bestD === Infinity) {
      for (let i = 0; i < this.samples.length; i++) {
        const s = this.samples[i];
        const d = (s.position.x - x) ** 2 + (s.position.z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }
}

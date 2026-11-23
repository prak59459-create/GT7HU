/**
 * ui/RaceHUD.ts
 * 計画書 §9.2: GT7風シンプルHUD。
 *  - スピードメーター（デジタル + アナログタコメーター円弧）
 *  - ギア / RPM / シフトランプ
 *  - ラップ / ラップタイム / ベスト / 前回
 *  - ミニマップ（コースアウトライン + 自車・AI車位置・姿勢）
 *  - Gメーター / スロットル・ブレーキバー
 *  - センターメッセージ（カウントダウン / ラップ表示）
 *  - Phase 2: 順位（P n/6）＋前車ギャップ表示、ミニマップにAI車両マーカー
 * DOM + Canvas 描画。
 */
import * as THREE from 'three';
import type { VehicleState } from '../physics/VehiclePhysics';
import type { TrackData } from '../tracks/TrackData';

export interface RaceHUDRaceInfo {
  position: number;
  totalCars: number;
  gapAhead: number | null; // 秒（前車との差）
}

export interface MiniMapMarker {
  x: number;
  z: number;
  yaw: number;
  color: string;
  isPlayer: boolean;
}

export class RaceHUD {
  public root: HTMLElement;
  private speedo: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private minimap: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private hudVisible = true;

  // DOM要素
  private elLap: HTMLElement;
  private elLapTime: HTMLElement;
  private elBest: HTMLElement;
  private elLast: HTMLElement;
  private elCenter: HTMLElement;
  private elFps: HTMLElement;
  private elPos: HTMLElement;
  private elGap: HTMLElement;
  private markers: MiniMapMarker[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position: fixed; inset: 0; pointer-events: none; z-index: 50;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    `;
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div id="hud-tl" style="position:absolute;top:20px;left:20px;background:rgba(5,8,12,0.55);backdrop-filter:blur(6px);border-left:2px solid #c9a961;padding:10px 16px;min-width:200px;">
        <div id="hud-lap" style="font-size:11px;letter-spacing:3px;color:#8a8f99;">LAP 1</div>
        <div id="hud-laptime" style="font-size:26px;font-weight:600;color:#fff;letter-spacing:1px;font-variant-numeric:tabular-nums;margin-top:2px;">00:00.000</div>
        <div style="display:flex;gap:16px;margin-top:4px;font-size:11px;">
          <span style="color:#8a8f99;">LAST <span id="hud-last" style="color:#e0e0e0;">--:--.---</span></span>
          <span style="color:#8a8f99;">BEST <span id="hud-best" style="color:#5ab85a;">--:--.---</span></span>
        </div>
      </div>
      <div id="hud-br" style="position:absolute;bottom:20px;right:20px;display:flex;align-items:flex-end;gap:14px;">
        <canvas id="hud-speedo" width="240" height="240"></canvas>
        <div id="hud-gear" style="width:80px;height:80px;background:rgba(0,0,0,0.6);border:2px solid #c9a961;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:600;color:#c9a961;">1</div>
      </div>
      <div id="hud-bl" style="position:absolute;bottom:20px;left:20px;">
        <canvas id="hud-minimap" width="200" height="200" style="background:rgba(0,0,0,0.4);border:1px solid #1f242e;border-radius:50%;"></canvas>
      </div>
      <div id="hud-tr" style="position:absolute;top:20px;right:20px;background:rgba(5,8,12,0.55);padding:8px 12px;border-right:2px solid #c9a961;text-align:right;">
        <div style="font-size:10px;letter-spacing:2px;color:#8a8f99;">G-FORCE</div>
        <canvas id="hud-gmeter" width="100" height="100" style="display:block;margin-top:4px;"></canvas>
      </div>
      <div id="hud-center" style="position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);font-size:80px;font-weight:200;letter-spacing:6px;color:#c9a961;text-shadow:0 0 30px rgba(201,169,97,0.6);opacity:0;transition:opacity 0.25s;"></div>
      <div id="hud-fps" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);font-size:10px;color:#5a5f69;letter-spacing:1px;"></div>
      <div id="hud-pos" style="position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(5,8,12,0.55);backdrop-filter:blur(6px);border-top:2px solid #c9a961;padding:8px 26px;text-align:center;display:none;">
        <div id="hud-posnum" style="font-size:30px;font-weight:600;color:#c9a961;line-height:1;">P1</div>
        <div id="hud-gap" style="font-size:10px;color:#8a8f99;letter-spacing:1px;margin-top:3px;">&nbsp;</div>
      </div>
      <div id="hud-chal" style="position:absolute;top:86px;left:50%;transform:translateX(-50%);background:rgba(5,8,12,0.55);backdrop-filter:blur(6px);border-left:2px solid #c9a961;padding:8px 22px;text-align:center;display:none;min-width:280px;">
        <div id="hud-chal-title" style="font-size:10px;letter-spacing:2px;color:#8a8f99;">CHALLENGE</div>
        <div id="hud-chal-value" style="font-size:22px;font-weight:600;color:#fff;letter-spacing:1px;font-variant-numeric:tabular-nums;margin-top:2px;">—</div>
        <div id="hud-chal-target" style="font-size:10px;letter-spacing:1px;color:#c9a961;margin-top:3px;">&nbsp;</div>
      </div>
    `;
    this.speedo = this.root.querySelector('#hud-speedo') as HTMLCanvasElement;
    this.ctx = this.speedo.getContext('2d')!;
    this.minimap = this.root.querySelector('#hud-minimap') as HTMLCanvasElement;
    this.miniCtx = this.minimap.getContext('2d')!;
    this.elLap = this.root.querySelector('#hud-lap')!;
    this.elLapTime = this.root.querySelector('#hud-laptime')!;
    this.elBest = this.root.querySelector('#hud-best')!;
    this.elLast = this.root.querySelector('#hud-last')!;
    this.elCenter = this.root.querySelector('#hud-center')!;
    this.elFps = this.root.querySelector('#hud-fps')!;
    this.elPos = this.root.querySelector('#hud-pos')!;
    this.elPosNum = this.root.querySelector('#hud-posnum')!;
    this.elGap = this.root.querySelector('#hud-gap')!;
    this.elChal = this.root.querySelector('#hud-chal')!;
    this.elChalTitle = this.root.querySelector('#hud-chal-title')!;
    this.elChalValue = this.root.querySelector('#hud-chal-value')!;
    this.elChalTarget = this.root.querySelector('#hud-chal-target')!;
  }

  private elPosNum: HTMLElement;
  private elChal!: HTMLElement;
  private elChalTitle!: HTMLElement;
  private elChalValue!: HTMLElement;
  private elChalTarget!: HTMLElement;

  setVisible(v: boolean): void {
    this.hudVisible = v;
    this.root.style.display = v ? '' : 'none';
  }
  toggleVisible(): void { this.setVisible(!this.hudVisible); }

  showCenter(text: string, ms = 1500): void {
    this.elCenter.textContent = text;
    this.elCenter.style.opacity = '1';
    clearTimeout((this as any)._centerTimer);
    (this as any)._centerTimer = setTimeout(() => { this.elCenter.style.opacity = '0'; }, ms);
  }

  /** Phase 2: 順位パネル表示（race情報=nullで非表示） */
  setRaceInfo(info: RaceHUDRaceInfo | null): void {
    if (info) {
      this.elPos.style.display = 'block';
      this.elPosNum.textContent = `P${info.position}`;
      this.elPosNum.style.color = info.position === 1 ? '#c9a961' : '#e8e8e8';
      this.elGap.textContent = `/${info.totalCars}` + (info.gapAhead !== null && info.position > 1 ? `  ·  +${info.gapAhead.toFixed(1)}s` : '');
    } else {
      this.elPos.style.display = 'none';
    }
  }

  /** Phase 4: チャレンジ目標パネル（info=nullで非表示。毎フレーム呼ばれても負荷は軽い） */
  setChallengePanel(info: { title: string; value: string; target: string } | null): void {
    if (!info) {
      if (this.elChal.style.display !== 'none') this.elChal.style.display = 'none';
      return;
    }
    this.elChal.style.display = 'block';
    const t = this.elChalTitle.textContent;
    if (t !== info.title) this.elChalTitle.textContent = info.title;
    const v = this.elChalValue.textContent;
    if (v !== info.value) this.elChalValue.textContent = info.value;
    const g = this.elChalTarget.textContent;
    if (g !== info.target) this.elChalTarget.textContent = info.target;
  }

  /** Phase 2: ミニマップ車両マーカー（毎フレーム設定。レース外では空） */
  setMarkers(markers: MiniMapMarker[]): void {
    this.markers = markers;
  }

  update(state: VehicleState, lap: number, totalLaps: number, lapTime: number, bestTime: number | null, lastTime: number | null, track: TrackData, fps: number, physicsMs: number): void {
    if (!this.hudVisible) return;
    // テキスト
    this.elLap.textContent = `LAP ${Math.max(1, lap)}${totalLaps > 0 ? '/' + totalLaps : ''}`;
    this.elLapTime.textContent = formatTime(lapTime);
    this.elBest.textContent = formatTime(bestTime);
    this.elLast.textContent = formatTime(lastTime);
    this.elFps.textContent = `FPS ${fps} · phys ${physicsMs.toFixed(1)}ms`;

    // スピードメーター
    this._drawSpeedo(state);
    // ミニマップ
    this._drawMinimap(state, track);
    // Gメーター
    this._drawGMeter(state);
  }

  private _drawSpeedo(s: VehicleState): void {
    const ctx = this.ctx;
    const w = 240, h = 240, cx = w / 2, cy = h / 2;
    const R = 100;
    ctx.clearRect(0, 0, w, h);
    // 外枠
    ctx.beginPath();
    ctx.arc(cx, cy, R + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#1f242e';
    ctx.lineWidth = 2;
    ctx.stroke();

    const startA = Math.PI * 0.75;
    const endA = Math.PI * 2.25;
    const range = endA - startA;

    const maxRpm = s.rpm > 0 ? 8000 : 8000;
    // RPM弧 背景
    ctx.beginPath();
    ctx.arc(cx, cy, R - 14, startA, endA);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // レッドライン領域
    const redlineA = startA + (7200 / maxRpm) * range;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 14, redlineA, endA);
    ctx.strokeStyle = 'rgba(200,50,50,0.35)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // RPM弧 値
    const rpmRatio = Math.min(1, s.rpm / maxRpm);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 14, startA, startA + rpmRatio * range);
    ctx.strokeStyle = rpmRatio > 0.9 ? '#c83232' : rpmRatio > 0.7 ? '#e8a832' : '#4a90d9';
    ctx.lineWidth = 8;
    ctx.stroke();

    // 目盛（速度 0..360 km/h, 20刻み）
    const maxSpeed = 360;
    for (let v = 0; v <= maxSpeed; v += 20) {
      const a = startA + (v / maxSpeed) * range;
      const x1 = cx + Math.cos(a) * (R - 4);
      const y1 = cy + Math.sin(a) * (R - 4);
      const x2 = cx + Math.cos(a) * R;
      const y2 = cy + Math.sin(a) * R;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = v >= 280 ? '#c83232' : v >= 200 ? '#c9a961' : '#5a5f69';
      ctx.lineWidth = v % 40 === 0 ? 2 : 1;
      ctx.stroke();
      if (v % 40 === 0) {
        const tx = cx + Math.cos(a) * (R - 22);
        const ty = cy + Math.sin(a) * (R - 22);
        ctx.fillStyle = '#8a8f99';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v.toString(), tx, ty);
      }
    }

    // 速度針
    const speedA = startA + Math.min(1, s.speedKmh / maxSpeed) * range;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(speedA) * (R - 18), cy + Math.sin(speedA) * (R - 18));
    ctx.strokeStyle = '#c9a961';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#c9a961';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 中心
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a961';
    ctx.fill();

    // デジタル速度
    ctx.fillStyle = '#fff';
    ctx.font = '300 52px Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(s.speedKmh).toString(), cx, cy + 36);
    ctx.fillStyle = '#8a8f99';
    ctx.font = '10px sans-serif';
    ctx.fillText('km/h', cx, cy + 62);

    // シフトランプ（レブ近接で点灯）
    if (s.rpm > 7200 * 0.92) {
      const lampN = 5;
      for (let i = 0; i < lampN; i++) {
        const a = startA + (0.7 + i * 0.06) * range;
        const lx = cx + Math.cos(a) * (R + 12);
        const ly = cy + Math.sin(a) * (R + 12);
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fillStyle = i >= 3 ? '#ff3030' : '#e8a832';
        ctx.fill();
      }
    }
  }

  private _drawMinimap(s: VehicleState, track: TrackData): void {
    const ctx = this.miniCtx;
    const w = 200, h = 200;
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const sm of track.samples) {
      if (sm.position.x < minX) minX = sm.position.x;
      if (sm.position.x > maxX) maxX = sm.position.x;
      if (sm.position.z < minZ) minZ = sm.position.z;
      if (sm.position.z > maxZ) maxZ = sm.position.z;
    }
    const pad = 20;
    const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxZ - minZ));
    const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2;
    // 【左右バグ修正】3D追従カメラの画面右＝世界-X と一致させるため、ミニマップも
    // X・Z両軸を反転（車両マーカーは rotate(-yaw) のままで方向が一致する）。
    // ※旧実装は左右が鏡像かつ車両マーカーが後ろ向きになっていた。
    const px = (x: number) => cx - (x - midX) * scale;
    const py = (z: number) => cy - (z - midZ) * scale;
    // パス
    ctx.beginPath();
    track.samples.forEach((sm, i) => {
      const x = px(sm.position.x);
      const y = py(sm.position.z);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#c9a961'; ctx.lineWidth = 2;
    ctx.stroke();
    // スタート
    const sp = track.samples[0].position;
    ctx.beginPath();
    ctx.arc(px(sp.x), py(sp.z), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // AI車両マーカー（Phase 2）
    for (const m of this.markers) {
      if (m.isPlayer) continue;
      ctx.beginPath();
      ctx.arc(px(m.x), py(m.z), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
    }
    // 自車
    ctx.save();
    ctx.translate(px(s.position.x), py(s.position.z));
    ctx.rotate(-s.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
    ctx.fillStyle = '#c9a961';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.restore();
  }

  private _drawGMeter(s: VehicleState): void {
    const c = this.root.querySelector('#hud-gmeter') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const w = 100, h = 100, cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(cx, cy, 45, 0, Math.PI * 2);
    ctx.strokeStyle = '#1f242e'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, cy); ctx.lineTo(95, cy);
    ctx.moveTo(cx, 5); ctx.lineTo(cx, 95); ctx.stroke();
    const gx = cx + THREE.MathUtils.clamp(s.gLat / 9.81, -1, 1) * 40;
    const gy = cy - THREE.MathUtils.clamp(s.gLong / 9.81, -1, 1) * 40;
    ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#c9a961';
    ctx.fill();
  }
}

function formatTime(t: number | null): string {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

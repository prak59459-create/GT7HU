/**
 * ui/RaceResults.ts
 * 計画書 Phase 2: レース結果画面（順位・タイム・ベストラップ表示）。
 * Overlays と同じ DOM オーバーレイ形式・同一デザイントーン（黒×ゴールド）。
 */

export interface ResultRow {
  pos: number;
  name: string;
  vehicle: string;
  isPlayer: boolean;
  time: number | null;
  gap: number | null;
  bestLap: number | null;
  finished: boolean;
}

export interface RaceResultsCallbacks {
  onRestart: () => void;
  onTitle: () => void;
}

export class RaceResults {
  public root: HTMLElement;
  private panel: HTMLElement;
  private cb: RaceResultsCallbacks;

  constructor(parent: HTMLElement, cb: RaceResultsCallbacks) {
    this.cb = cb;
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;inset:0;z-index:120;font-family:'Helvetica Neue',Arial,sans-serif;pointer-events:none;`;
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div id="rr-panel" style="position:absolute;inset:0;background:radial-gradient(ellipse at center,#0d0f14f2,#000000fa);display:none;flex-direction:column;align-items:center;justify-content:center;pointer-events:auto;">
        <div id="rr-title" style="font-size:26px;font-weight:200;letter-spacing:8px;color:#e8e8e8;">RACE RESULTS</div>
        <div id="rr-sub" style="font-size:11px;letter-spacing:4px;color:#c9a961;margin-top:6px;"></div>
        <div id="rr-table" style="margin-top:28px;min-width:520px;"></div>
        <div id="rr-reward" style="margin-top:18px;font-size:14px;letter-spacing:2px;color:#c9a961;font-variant-numeric:tabular-nums;display:none;"></div>
        <div style="display:flex;gap:12px;margin-top:32px;">
          <button id="rr-restart" class="ov-btn" style="padding:12px 34px;">RESTART RACE</button>
          <button id="rr-title-btn" class="ov-btn" style="padding:12px 34px;">BACK TO TITLE</button>
        </div>
      </div>
    `;
    this.panel = this.root.querySelector('#rr-panel')!;
    this.root.querySelector('#rr-restart')!.addEventListener('click', () => this.cb.onRestart());
    this.root.querySelector('#rr-title-btn')!.addEventListener('click', () => this.cb.onTitle());
    // .ov-btn スタイルは Overlays が既に <style> 定義しているが、単独で開かれても
    // 良いようこの中でも定義しておく（二重定義は無害）
    const style = document.createElement('style');
    style.textContent = `
      #rr-panel .ov-btn { background:#161a22;border:1px solid #1f242e;color:#e8e8e8;font-size:12px;letter-spacing:2px;cursor:pointer; }
      #rr-panel .ov-btn:hover { border-color:#c9a961;color:#c9a961; }
    `;
    this.root.appendChild(style);
  }

  /** Phase 2 互換: 通常レース結果表示 */
  show(rows: ResultRow[], playerPos: number, totalLaps: number, raceTime: number, reward?: { amount: number; balance: number } | null): void {
    // 全体ベストラップ
    let fastestLap = Infinity;
    let fastestIdx = -1;
    rows.forEach((r, i) => { if (r.bestLap !== null && r.bestLap < fastestLap) { fastestLap = r.bestLap; fastestIdx = i; } });

    const header = playerPos === 1 ? 'VICTORY' : `FINISHED P${playerPos}`;
    this.root.querySelector('#rr-title')!.textContent = 'RACE RESULTS';
    const sub = this.root.querySelector('#rr-sub')! as HTMLElement;
    sub.setAttribute('style', 'font-size:11px;letter-spacing:4px;color:#c9a961;margin-top:6px;');
    sub.style.color = '#c9a961';
    sub.textContent = `${header} · ${totalLaps} ${totalLaps === 1 ? 'LAP' : 'LAPS'} · ${formatClock(raceTime)}`;
    (this.root.querySelector('#rr-restart') as HTMLElement).textContent = 'RESTART RACE';

    const table = this.root.querySelector('#rr-table')!;
    let html = `
      <table style="border-collapse:collapse;width:100%;font-size:13px;color:#d0d0d0;">
        <thead>
          <tr style="color:#8a8f99;font-size:10px;letter-spacing:2px;">
            <th style="padding:6px 10px;text-align:center;">POS</th>
            <th style="padding:6px 10px;text-align:left;">DRIVER</th>
            <th style="padding:6px 10px;text-align:left;">VEHICLE</th>
            <th style="padding:6px 10px;text-align:right;">TIME / GAP</th>
            <th style="padding:6px 10px;text-align:right;">BEST LAP</th>
          </tr>
        </thead>
        <tbody>
    `;
    rows.forEach((r, i) => {
      const timeStr = r.finished
        ? (i === 0 ? formatClock(r.time ?? 0) : `+${((r.gap ?? 0)).toFixed(3)}s`)
        : 'DNF';
      const bestStr = r.bestLap !== null ? formatTime(r.bestLap) + (i === fastestIdx ? ' ★' : '') : '--:--.---';
      const playerStyle = r.isPlayer ? 'color:#c9a961;font-weight:600;background:rgba(201,169,97,0.07);' : '';
      const posStyle = r.pos === 1 ? 'color:#c9a961;' : r.pos >= 4 ? 'color:#8a8f99;' : 'color:#d0d0d0;';
      html += `
        <tr style="${playerStyle}border-top:1px solid #1f242e;">
          <td style="padding:8px 10px;text-align:center;font-weight:600;${posStyle}">${r.pos}</td>
          <td style="padding:8px 10px;">${r.isPlayer ? 'YOU' : r.name}</td>
          <td style="padding:8px 10px;color:#8a8f99;font-size:11px;">${r.vehicle}</td>
          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;${r.finished ? '' : 'color:#5a5f69;'}">${timeStr}</td>
          <td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;">${bestStr}</td>
        </tr>
      `;
    });
    html += '</tbody></table>';
    table.innerHTML = html;

    // Phase 3: レース報酬表示
    const rw = this.root.querySelector('#rr-reward')! as HTMLElement;
    if (reward) {
      rw.style.display = 'block';
      rw.innerHTML = `REWARD +¥${Math.round(reward.amount).toLocaleString('en-US')}　·　CREDITS ¥${Math.round(reward.balance).toLocaleString('en-US')}`;
    } else {
      rw.style.display = 'none';
    }
    this.panel.style.display = 'flex';
  }

  hide(): void {
    this.panel.style.display = 'none';
  }

  /**
   * Phase 4: チャレンジ（ライセンス・ミッション・トライアル）の結果表示。
   * data.medal: 0=失格 1..3=bronze/silver/gold
   */
  showChallenge(data: {
    code: string;
    title: string;
    pass: boolean;
    medal: number;
    valueLabel: string;          // 例: 'TIME 27.43s' / 'SCORE 1,240 PTS'
    reason?: string;             // 失格理由
    medalTargets: Array<{ label: string; value: string; achieved: boolean }>;
    reward?: { amount: number; balance: number } | null;
    bestLabel?: string;          // 例: 'BEST 26.91s'
    message?: string;            // 例: 'NEW RECORD!' / 'FIRST CLEAR!'
    onRetry?: () => void;
  }): void {
    const medalNames = ['', 'BRONZE', 'SILVER', 'GOLD'];
    const medalColors = ['', '#c07a4a', '#c9c9d9', '#c9a961'];
    const head = data.pass ? (data.medal >= 1 ? medalNames[data.medal] : 'PASSED') : 'FAILED';
    const headColor = data.pass ? medalColors[data.medal] || '#5ab85a' : '#c83232';

    this.root.querySelector('#rr-title')!.textContent = `${data.code} · ${data.title}`;
    this.root.querySelector('#rr-sub')!.textContent = '';
    this.root.querySelector('#rr-sub')!.setAttribute('style', 'font-size:28px;font-weight:300;letter-spacing:8px;margin-top:10px;');
    this.root.querySelector('#rr-sub')!.textContent = head;
    (this.root.querySelector('#rr-sub') as HTMLElement).style.color = headColor;

    // 中央: 結果値 + 理由 + メダル表
    const table = this.root.querySelector('#rr-table')!;
    let html = `
      <div style="text-align:center;font-size:15px;color:#e8e8e8;letter-spacing:1px;font-variant-numeric:tabular-nums;">${data.valueLabel}</div>
      ${data.reason ? `<div style="text-align:center;font-size:11px;color:#c83232;letter-spacing:2px;margin-top:8px;">${data.reason}</div>` : ''}
      ${data.message ? `<div style="text-align:center;font-size:12px;color:#c9a961;letter-spacing:2px;margin-top:8px;">${data.message}</div>` : ''}
      <div style="display:flex;justify-content:center;gap:10px;margin-top:22px;">
        ${data.medalTargets.map((t) => `
          <div style="border:1px solid ${t.achieved ? medalColors[data.medal] || '#5ab85a' : '#1f242e'};padding:8px 14px;text-align:center;min-width:110px;background:${t.achieved ? 'rgba(201,169,97,0.08)' : 'transparent'};">
            <div style="font-size:9px;letter-spacing:2px;color:#8a8f99;">${t.label}</div>
            <div style="font-size:14px;color:${t.achieved ? '#e8e8e8' : '#5a5f69'};font-variant-numeric:tabular-nums;margin-top:2px;">${t.value}</div>
          </div>
        `).join('')}
      </div>
      ${data.bestLabel ? `<div style="text-align:center;font-size:11px;color:#8a8f99;letter-spacing:2px;margin-top:18px;">${data.bestLabel}</div>` : ''}
    `;
    table.innerHTML = html;

    const rw = this.root.querySelector('#rr-reward')! as HTMLElement;
    if (data.reward && data.reward.amount > 0) {
      rw.style.display = 'block';
      rw.innerHTML = `REWARD +¥${Math.round(data.reward.amount).toLocaleString('en-US')}　·　CREDITS ¥${Math.round(data.reward.balance).toLocaleString('en-US')}`;
    } else {
      rw.style.display = 'none';
    }

    (this.root.querySelector('#rr-restart') as HTMLElement).textContent = 'RETRY';
    this.panel.style.display = 'flex';
  }
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

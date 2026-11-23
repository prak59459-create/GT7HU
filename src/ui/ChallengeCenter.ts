/**
 * ui/ChallengeCenter.ts
 * 計画書 Phase 4: ゲームコンテンツ選択UI（ライセンスセンター / ミッション / トライアル）。
 *
 * GarageScreen と同じ DOM オーバーレイ・GT風レイアウト（黒×ゴールド）。
 * 左: 課題リスト（メダル・クリア状況・ロック表示）、右: 詳細（目標・報酬・ベスト記録）と START。
 * 解除条件は Profile 側（isLicenseUnlocked / isMissionUnlocked）で判定。
 */
import { LICENSES, MISSIONS, TRIALS, medalFor, type ChallengeDef } from '../race/ChallengeDefs';
import { isLicenseUnlocked, isMissionUnlocked, type PlayerProfile } from '../systems/Profile';

export type ChallengeTab = 'license' | 'mission' | 'trial';

export interface ChallengeCenterController {
  getProfile(): PlayerProfile;
  /** チャレンジ開始（Game が _startChallenge を実行） */
  onStart(def: ChallengeDef): void;
  onBack(): void;
}

const fmtCr = (v: number): string => `¥${Math.round(v).toLocaleString('en-US')}`;

function fmtVal(def: ChallengeDef, v: number): string {
  return `${def.unit === 's' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US')} ${def.unit}`;
}

export class ChallengeCenter {
  public root: HTMLElement;
  private ctrl: ChallengeCenterController;
  private tab: ChallengeTab = 'license';
  private selIndex = 0;
  private tabButtons: Record<ChallengeTab, HTMLElement> | null = null;

  constructor(parent: HTMLElement, ctrl: ChallengeCenterController) {
    this.ctrl = ctrl;
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;inset:0;z-index:140;display:none;font-family:'Helvetica Neue',Arial,sans-serif;`;
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,#0d0f14,#000);"></div>
      <div id="cc-top" style="position:absolute;top:0;left:0;right:0;height:56px;background:linear-gradient(180deg,rgba(5,8,12,0.95),rgba(5,8,12,0.8));border-bottom:1px solid #1f242e;display:flex;align-items:center;padding:0 22px;gap:16px;">
        <div id="cc-mode" style="font-size:16px;font-weight:200;letter-spacing:8px;color:#c9a961;min-width:210px;">LICENSE CENTER</div>
        <div id="cc-tabs" style="display:flex;gap:8px;">
          <button class="cc-tab" data-tab="license">LICENSE</button>
          <button class="cc-tab" data-tab="mission">MISSIONS</button>
          <button class="cc-tab" data-tab="trial">TRIALS</button>
        </div>
        <div style="flex:1;"></div>
        <div id="cc-credits" style="font-size:15px;color:#e8e8e8;font-variant-numeric:tabular-nums;letter-spacing:1px;">CREDITS ¥0</div>
        <button id="cc-back" class="cc-btn" style="margin-left:18px;">◀ BACK</button>
      </div>

      <div id="cc-list" style="position:absolute;top:76px;left:22px;bottom:22px;width:330px;background:rgba(5,8,12,0.78);border:1px solid #1f242e;border-left:2px solid #c9a961;padding:14px 0 14px 14px;display:flex;flex-direction:column;overflow:hidden;">
        <div id="cc-list-header" style="font-size:10px;letter-spacing:3px;color:#8a8f99;margin-bottom:10px;">CURRICULUM</div>
        <div id="cc-list-items" style="overflow-y:auto;flex:1;padding-right:8px;"></div>
      </div>

      <div id="cc-detail" style="position:absolute;top:76px;right:22px;bottom:22px;width:430px;background:rgba(5,8,12,0.78);border:1px solid #1f242e;border-right:2px solid #c9a961;padding:18px;overflow-y:auto;"></div>

      <div id="cc-tip" style="position:absolute;bottom:26px;left:50%;transform:translateX(-50%);font-size:10px;letter-spacing:2px;color:#5a5f69;">ESC / BACK でタイトルへ戻る</div>

      <style>
        .cc-btn { background:#161a22;border:1px solid #2a2f3a;color:#e8e8e8;padding:7px 14px;font-size:11px;letter-spacing:1px;cursor:pointer;font-family:inherit; }
        .cc-btn:hover { border-color:#c9a961;color:#c9a961; }
        .cc-btn.cc-gold { background:linear-gradient(180deg,#c9a961,#a88a48);color:#000;border:none;font-weight:600; }
        .cc-btn.cc-gold:hover { filter:brightness(1.1); color:#000; }
        .cc-btn:disabled { opacity:0.35;cursor:not-allowed; }
        .cc-tab { background:transparent;border:1px solid #2a2f3a;color:#8a8f99;padding:6px 16px;font-size:11px;letter-spacing:2px;cursor:pointer;font-family:inherit; }
        .cc-tab:hover { border-color:#c9a961; }
        .cc-tab.cc-on { border-color:#c9a961;color:#c9a961;background:rgba(201,169,97,0.10); }
        .cc-item { padding:11px 12px;border:1px solid #1f242e;margin-bottom:6px;cursor:pointer;background:rgba(22,26,34,0.5);display:flex;align-items:center;gap:10px; }
        .cc-item:hover { border-color:#3a414e; }
        .cc-item.cc-sel { border-color:#c9a961;background:rgba(201,169,97,0.10); }
        .cc-item.cc-locked { opacity:0.45;cursor:not-allowed; }
        .cc-item-code { font-size:16px;font-weight:600;color:#c9a961;min-width:44px;letter-spacing:1px; }
        .cc-item-name { font-size:12px;color:#e8e8e8;letter-spacing:1px;flex:1; }
        .cc-medal { display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;vertical-align:1px; }
        .cc-medal.bronze { background:#c07a4a; }
        .cc-medal.silver { background:#c9c9d9; }
        .cc-medal.gold { background:#c9a961; }
        .cc-done { font-size:9px;color:#5ab85a;border:1px solid #3a5a3a;padding:1px 6px;letter-spacing:1px; }
        .cc-lock { font-size:9px;color:#5a5f69;letter-spacing:1px; }
        #cc-list-items::-webkit-scrollbar, #cc-detail::-webkit-scrollbar { width:6px; }
        #cc-list-items::-webkit-scrollbar-thumb, #cc-detail::-webkit-scrollbar-thumb { background:#2a2f3a; }
        .cc-d-code { font-size:10px;letter-spacing:3px;color:#8a8f99; }
        .cc-d-title { font-size:26px;font-weight:300;color:#fff;letter-spacing:2px;margin-top:2px; }
        .cc-d-desc { font-size:12px;color:#8a8f99;line-height:1.8;margin-top:12px; }
        .cc-d-sec { font-size:10px;letter-spacing:3px;color:#c9a961;margin-top:18px;border-bottom:1px solid #1f242e;padding-bottom:6px; }
        .cc-d-row { display:flex;justify-content:space-between;font-size:12px;padding:6px 0;border-bottom:1px solid #141822;color:#8a8f99;letter-spacing:1px; }
        .cc-d-row b { color:#e8e8e8;font-weight:500;font-variant-numeric:tabular-nums; }
        .cc-tgt { display:flex;justify-content:space-between;font-size:12px;padding:6px 0; }
        .cc-tgt.cc-hit { color:#c9a961; }
      </style>
    `;
    this.tabButtons = {
      license: this.root.querySelector('.cc-tab[data-tab="license"]') as HTMLElement,
      mission: this.root.querySelector('.cc-tab[data-tab="mission"]') as HTMLElement,
      trial: this.root.querySelector('.cc-tab[data-tab="trial"]') as HTMLElement
    };
    this.tabButtons.license.addEventListener('click', () => this.setTab('license'));
    this.tabButtons.mission.addEventListener('click', () => this.setTab('mission'));
    this.tabButtons.trial.addEventListener('click', () => this.setTab('trial'));
    this.root.querySelector('#cc-back')!.addEventListener('click', () => this.ctrl.onBack());
  }

  private defsForTab(tab: ChallengeTab): ChallengeDef[] {
    return tab === 'license' ? LICENSES : tab === 'mission' ? MISSIONS : TRIALS;
  }

  private isUnlocked(def: ChallengeDef): boolean {
    const p = this.ctrl.getProfile();
    if (def.category === 'license') return isLicenseUnlocked(p, def, LICENSES);
    if (def.category === 'mission') return isMissionUnlocked(p, def, MISSIONS);
    return true;
  }

  /** 過去最高メダル（trial は records から） */
  private medalOf(def: ChallengeDef): number {
    const p = this.ctrl.getProfile();
    if (def.id === 'trial_tt') return p.records.ttMedal;
    if (def.id === 'trial_drift') return p.records.driftMedal;
    return p.licenses[def.id]?.medal ?? 0;
  }

  private bestOf(def: ChallengeDef): number | null {
    const p = this.ctrl.getProfile();
    if (def.id === 'trial_tt') return p.records.bestLap;
    if (def.id === 'trial_drift') return p.records.driftBest || null;
    if (def.category === 'license') return p.licenses[def.id]?.best ?? null;
    return p.missions[def.id]?.best ?? null;
  }

  private isDone(def: ChallengeDef): boolean {
    const p = this.ctrl.getProfile();
    if (def.category === 'mission') return !!p.missions[def.id]?.done;
    if (def.category === 'license') return this.medalOf(def) >= 1;
    return this.medalOf(def) >= 1;
  }

  setTab(tab: ChallengeTab): void {
    this.tab = tab;
    this.selIndex = 0;
    this.refresh();
  }

  show(tab: ChallengeTab): void {
    this.root.style.display = 'block';
    this.setTab(tab);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  refresh(): void {
    const p = this.ctrl.getProfile();
    (this.root.querySelector('#cc-credits') as HTMLElement).textContent = `CREDITS ${fmtCr(p.credits)}`;
    const modeEl = this.root.querySelector('#cc-mode') as HTMLElement;
    modeEl.textContent = this.tab === 'license' ? 'LICENSE CENTER' : this.tab === 'mission' ? 'MISSIONS' : 'TRIALS';
    for (const key of ['license', 'mission', 'trial'] as ChallengeTab[]) {
      this.tabButtons![key].classList.toggle('cc-on', key === this.tab);
    }
    (this.root.querySelector('#cc-list-header') as HTMLElement).textContent =
      this.tab === 'license' ? `CURRICULUM · ${this._clearedCount(LICENSES)} / ${LICENSES.length}` :
      this.tab === 'mission' ? `CHALLENGE LIST · ${this._clearedCount(MISSIONS)} / ${MISSIONS.length}` : 'TIME ATTACK';
    this._renderList();
    this._renderDetail();
  }

  private _clearedCount(defs: ChallengeDef[]): number {
    return defs.filter((d) => this.isDone(d)).length;
  }

  private _renderList(): void {
    const wrap = this.root.querySelector('#cc-list-items') as HTMLElement;
    const defs = this.defsForTab(this.tab);
    let html = '';
    defs.forEach((d, i) => {
      const unlocked = this.isUnlocked(d);
      const medal = this.medalOf(d);
      const done = this.isDone(d);
      const badge = medal >= 1
        ? `<span class="cc-medal ${medal >= 3 ? 'gold' : medal === 2 ? 'silver' : 'bronze'}"></span>`
        : (d.category === 'mission' ? (done ? `<span class="cc-done">CLEAR</span>` : '') : '');
      const lock = unlocked ? '' : `<span class="cc-lock">LOCKED</span>`;
      html += `
        <div class="cc-item ${i === this.selIndex ? 'cc-sel' : ''} ${unlocked ? '' : 'cc-locked'}" data-i="${i}">
          <div class="cc-item-code">${d.code}</div>
          <div class="cc-item-name">${d.title}</div>
          <div>${badge}${lock}</div>
        </div>
      `;
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.cc-item').forEach((el) => {
      el.addEventListener('click', () => {
        const i = parseInt((el as HTMLElement).dataset.i!, 10);
        const defs = this.defsForTab(this.tab);
        if (!this.isUnlocked(defs[i])) return;
        this.selIndex = i;
        this.refresh();
      });
    });
  }

  private _renderDetail(): void {
    const d = this.defsForTab(this.tab)[this.selIndex];
    const detail = this.root.querySelector('#cc-detail') as HTMLElement;
    if (!d) { detail.innerHTML = ''; return; }
    const p = this.ctrl.getProfile();
    const unlocked = this.isUnlocked(d);
    const medal = this.medalOf(d);
    const best = this.bestOf(d);

    // 目標テーブル
    let targetsHtml = '';
    if (d.medals) {
      const names = ['BRONZE', 'SILVER', 'GOLD'];
      const vals = [d.medals[0], d.medals[1], d.medals[2]];
      const mcls = ['bronze', 'silver', 'gold'];
      targetsHtml = vals.map((v, i) => `
        <div class="cc-tgt ${medal === i + 1 ? 'cc-hit' : ''}">
          <span><span class="cc-medal ${mcls[i]}"></span> ${names[i]}</span>
          <b>${fmtVal(d, v)}</b>
        </div>`).join('');
    } else if (d.goal !== undefined) {
      targetsHtml = `
        <div class="cc-tgt">
          <span>GOAL</span>
          <b>${fmtVal(d, d.goal)}</b>
        </div>`;
    }

    // 報酬
    let rewardHtml = '';
    if (d.rewards) {
      rewardHtml = d.rewards.map((r, i) => `
        <div class="cc-d-row"><span>${['BRONZE', 'SILVER', 'GOLD'][i]} 報酬</span><b>${fmtCr(r)}</b></div>`).join('');
    } else if (d.reward) {
      rewardHtml = `<div class="cc-d-row"><span>クリア報酬（初回全額・再クリア10%）</span><b>${fmtCr(d.reward)}</b></div>`;
    }

    const extra = d.difficulty
      ? `<div class="cc-d-row"><span>対戦</span><b>AI×${d.rivals}（${d.difficulty.toUpperCase()}）· ${d.laps} LAP</b></div>`
      : d.laps && d.laps > 1
        ? `<div class="cc-d-row"><span>距離</span><b>${d.laps} LAPS</b></div>`
        : d.kind === 'timetrial'
          ? `<div class="cc-d-row"><span>形式</span><b>周回無制限・ベストラップ記録</b></div>`
          : '';

    detail.innerHTML = `
      <div class="cc-d-code">${d.category === 'license' ? 'LICENSE TEST' : d.category === 'mission' ? 'MISSION' : 'TRIAL'} ${d.code}</div>
      <div class="cc-d-title">${d.title}</div>
      <div class="cc-d-desc">${d.desc}</div>
      <div class="cc-d-sec">TARGETS</div>
      ${targetsHtml}
      <div class="cc-d-sec">CONDITIONS</div>
      ${extra}
      ${best !== null ? `<div class="cc-d-row"><span>YOUR BEST</span><b>${fmtVal(d, best)}${medal >= 1 ? ` · ${['', 'BRONZE', 'SILVER', 'GOLD'][medal]}` : ''}</b></div>` : ''}
      <div class="cc-d-sec">REWARD</div>
      ${rewardHtml}
      <div style="margin-top:24px;">
        <button id="cc-start" class="cc-btn cc-gold" style="width:100%;padding:13px;font-size:13px;letter-spacing:4px;" ${unlocked ? '' : 'disabled'}>
          ${unlocked ? 'START' : 'LOCKED — 前の課題をクリアで解放'}
        </button>
      </div>
    `;
    const startBtn = detail.querySelector('#cc-start') as HTMLElement;
    startBtn.addEventListener('click', () => {
      if (!this.isUnlocked(d)) return;
      this.ctrl.onStart(d);
    });
  }
}

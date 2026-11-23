/**
 * ui/Overlays.ts
 * 計画書 §11.1/§9: メインメニュー風タイトル画面、ポーズメニュー、簡易設定。
 * Phase 1: メニュー画面を DOM オーバーレイで実装。
 * Phase 2: タイトルにモード選択（FREE RUN / RACE）＋難易度・周回数選択を追加。
 */
import type { AIDifficulty } from '../race/AIDriver';

export interface StartOptions {
  mode: 'free' | 'race';
  difficulty: AIDifficulty;
  laps: number;
}

export interface OverlayCallbacks {
  onStart: (opts: StartOptions) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onToggleCamera: () => void;
  onToggleAbs: (v: boolean) => void;
  onToggleTcs: (v: boolean) => void;
  onToggleAutoTrans: (v: boolean) => void;
  onSetVolume: (type: 'master' | 'engine' | 'sfx', v: number) => void;
  // Phase 3: 車両システム
  onOpenGarage: () => void;
  onOpenDealer: () => void;
  onOpenTuning: () => void;
  // Phase 4: ゲームコンテンツ
  onOpenChallengeCenter: (tab: 'license' | 'mission' | 'trial') => void;
}

export class Overlays {
  public root: HTMLElement;
  private title: HTMLElement;
  private pause: HTMLElement;
  private cb: OverlayCallbacks;
  private difficulty: AIDifficulty = 'normal';
  private laps = 3;

  constructor(parent: HTMLElement, cb: OverlayCallbacks) {
    this.cb = cb;
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;inset:0;z-index:100;font-family:'Helvetica Neue',Arial,sans-serif;`;
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div id="ov-title" style="position:absolute;inset:0;background:radial-gradient(ellipse at center,#0d0f14,#000);display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="width:70px;height:70px;border:2px solid #c9a961;border-radius:50%;margin-bottom:18px;position:relative;">
          <div style="position:absolute;top:50%;left:50%;width:28px;height:28px;border:2px solid #c9a961;border-top:none;border-right:none;transform:translate(-50%,-50%) rotate(-45deg);"></div>
        </div>
        <div style="font-size:34px;font-weight:200;letter-spacing:10px;color:#e8e8e8;">RACING SIMULATOR</div>
        <div style="font-size:11px;letter-spacing:12px;color:#c9a961;margin-top:4px;">PROJECT · PHASE 4</div>
        <div style="margin-top:22px;font-size:12px;color:#8a8f99;letter-spacing:2px;text-align:center;line-height:1.9;">
          WASD: 運転 ／ Shift・Ctrl: シフト ／ Space: サイドブレーキ<br>
          C: カメラ ／ R: リセット ／ H: HUD ／ Esc: ポーズ
        </div>
        <div style="margin-top:24px;display:flex;gap:14px;">
          <button id="ov-start-free" style="background:transparent;color:#e8e8e8;border:1px solid #3a414e;padding:12px 34px;font-size:13px;letter-spacing:3px;font-weight:600;cursor:pointer;">FREE RUN</button>
          <button id="ov-start-race" style="background:linear-gradient(180deg,#c9a961,#a88a48);color:#000;border:none;padding:12px 34px;font-size:13px;letter-spacing:3px;font-weight:600;cursor:pointer;">RACE</button>
        </div>
        <div style="margin-top:10px;display:flex;gap:14px;">
          <button id="ov-open-license" class="ov-btn" style="padding:11px 26px;font-size:12px;letter-spacing:2px;">LICENSE CENTER</button>
          <button id="ov-open-missions" class="ov-btn" style="padding:11px 26px;font-size:12px;letter-spacing:2px;">MISSIONS</button>
          <button id="ov-open-trials" class="ov-btn" style="padding:11px 26px;font-size:12px;letter-spacing:2px;">TIME TRIAL · DRIFT</button>
        </div>
        <div id="ov-raceopts" style="margin-top:20px;display:flex;align-items:center;gap:18px;">
          <div style="font-size:10px;letter-spacing:2px;color:#8a8f99;">RIVAL LEVEL</div>
          <div id="ov-diffgroup" style="display:flex;gap:6px;">
            <button class="ov-seg" data-diff="easy">EASY</button>
            <button class="ov-seg" data-diff="normal">NORMAL</button>
            <button class="ov-seg" data-diff="hard">HARD</button>
          </div>
          <div style="font-size:10px;letter-spacing:2px;color:#8a8f99;">LAPS</div>
          <div id="ov-lapgroup" style="display:flex;gap:6px;">
            <button class="ov-seg" data-laps="1">1</button>
            <button class="ov-seg" data-laps="3">3</button>
            <button class="ov-seg" data-laps="5">5</button>
          </div>
        </div>
        <div id="ov-credits" style="margin-top:18px;font-size:13px;color:#c9a961;letter-spacing:2px;font-variant-numeric:tabular-nums;">CREDITS ¥0</div>
        <div id="ov-carinfo" style="margin-top:6px;font-size:11px;color:#8a8f99;letter-spacing:1px;">愛車: Aurora Motors RS-2</div>
        <div id="ov-record" style="margin-top:4px;font-size:10px;color:#5a5f69;letter-spacing:1px;">RACES 0 · WINS 0</div>
        <div style="margin-top:12px;display:flex;gap:12px;">
          <button id="ov-garage" class="ov-btn" style="padding:9px 22px;font-size:11px;">GARAGE</button>
          <button id="ov-dealer" class="ov-btn" style="padding:9px 22px;font-size:11px;">DEALER</button>
          <button id="ov-tuning" class="ov-btn" style="padding:9px 22px;font-size:11px;">TUNING</button>
        </div>
        <div style="margin-top:18px;font-size:11px;color:#5a5f69;max-width:560px;text-align:center;line-height:1.7;">
          コース: Aurora Valley GP Circuit (3.3km)<br>
          RACE: 架空ライバル5台との6台スタート（プレイヤーはP6グリッド）<br>
          実在車両・実在サーキットは利用許諾確認後にデータ差し替えで対応（計画書 PART 21 準拠）
        </div>
      </div>
      <div id="ov-pause" style="position:absolute;inset:0;background:rgba(0,0,0,0.7);display:none;align-items:center;justify-content:center;">
        <div style="background:#0d0f14;border:1px solid #1f242e;padding:32px 40px;min-width:320px;">
          <div style="font-size:20px;letter-spacing:6px;color:#c9a961;font-weight:300;margin-bottom:24px;text-align:center;">PAUSED</div>
          <button class="ov-btn" data-act="resume" style="display:block;width:100%;margin-bottom:10px;">RESUME</button>
          <button class="ov-btn" data-act="restart" style="display:block;width:100%;margin-bottom:10px;">RESTART</button>
          <button class="ov-btn" data-act="camera" style="display:block;width:100%;margin-bottom:10px;">CHANGE CAMERA</button>
          <div style="border-top:1px solid #1f242e;margin:14px 0;padding-top:14px;">
            <div style="font-size:11px;letter-spacing:2px;color:#8a8f99;margin-bottom:10px;">ASSISTS</div>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#e0e0e0;margin-bottom:8px;cursor:pointer;">ABS <input type="checkbox" id="ov-abs" checked></label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#e0e0e0;margin-bottom:8px;cursor:pointer;">TCS <input type="checkbox" id="ov-tcs" checked></label>
            <label style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#e0e0e0;margin-bottom:8px;cursor:pointer;">AUTO TRANSMISSION <input type="checkbox" id="ov-auto" checked></label>
          </div>
          <div style="border-top:1px solid #1f242e;margin:8px 0;padding-top:14px;">
            <div style="font-size:11px;letter-spacing:2px;color:#8a8f99;margin-bottom:10px;">VOLUME</div>
            <label style="display:block;font-size:11px;color:#8a8f99;margin-bottom:4px;">MASTER <input type="range" id="ov-vmaster" min="0" max="1" step="0.05" value="0.7" style="width:100%;"></label>
            <label style="display:block;font-size:11px;color:#8a8f99;margin-bottom:4px;">ENGINE <input type="range" id="ov-vengine" min="0" max="1" step="0.05" value="0.8" style="width:100%;"></label>
            <label style="display:block;font-size:11px;color:#8a8f99;">SFX <input type="range" id="ov-vsfx" min="0" max="1" step="0.05" value="0.6" style="width:100%;"></label>
          </div>
          <button class="ov-btn" data-act="quit" style="display:block;width:100%;margin-top:14px;">QUIT TO TITLE</button>
        </div>
      </div>
      <style>
        .ov-btn { background:#161a22;border:1px solid #1f242e;color:#e8e8e8;padding:10px;font-size:12px;letter-spacing:2px;cursor:pointer; }
        .ov-btn:hover { border-color:#c9a961;color:#c9a961; }
        .ov-seg { background:#161a22;border:1px solid #1f242e;color:#8a8f99;padding:5px 12px;font-size:11px;letter-spacing:1px;cursor:pointer; }
        .ov-seg:hover { border-color:#c9a961; }
        .ov-seg.ov-on { border-color:#c9a961;color:#c9a961;background:rgba(201,169,97,0.12); }
      </style>
    `;
    this.title = this.root.querySelector('#ov-title')!;
    this.pause = this.root.querySelector('#ov-pause')!;
    this._bind();
  }

  private _bind(): void {
    this.root.querySelector('#ov-start-free')!.addEventListener('click', () => {

      this.cb.onStart({ mode: 'free', difficulty: this.difficulty, laps: this.laps });
    });
    this.root.querySelector('#ov-start-race')!.addEventListener('click', () => {

      this.cb.onStart({ mode: 'race', difficulty: this.difficulty, laps: this.laps });
    });
    this.root.querySelectorAll('#ov-diffgroup .ov-seg').forEach((b) => {
      (b as HTMLElement).addEventListener('click', () => {
        this.difficulty = (b as HTMLElement).dataset.diff as AIDifficulty;
        this._refreshSegments();

      });
    });
    this.root.querySelectorAll('#ov-lapgroup .ov-seg').forEach((b) => {
      (b as HTMLElement).addEventListener('click', () => {
        this.laps = parseInt((b as HTMLElement).dataset.laps!, 10);
        this._refreshSegments();

      });
    });
    this._refreshSegments();
    // Phase 3: 車両システム画面を開く
    this.root.querySelector('#ov-garage')!.addEventListener('click', () => this.cb.onOpenGarage());
    this.root.querySelector('#ov-dealer')!.addEventListener('click', () => this.cb.onOpenDealer());
    this.root.querySelector('#ov-tuning')!.addEventListener('click', () => this.cb.onOpenTuning());
    // Phase 4: ゲームコンテンツ（チャレンジセンター）
    this.root.querySelector('#ov-open-license')!.addEventListener('click', () => this.cb.onOpenChallengeCenter('license'));
    this.root.querySelector('#ov-open-missions')!.addEventListener('click', () => this.cb.onOpenChallengeCenter('mission'));
    this.root.querySelector('#ov-open-trials')!.addEventListener('click', () => this.cb.onOpenChallengeCenter('trial'));
    this.root.querySelectorAll('.ov-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const act = (b as HTMLElement).dataset.act;
        if (act === 'resume') this.cb.onResume();
        if (act === 'restart') this.cb.onRestart();
        if (act === 'camera') this.cb.onToggleCamera();
        if (act === 'quit') this.cb.onQuit();
      });
    });
    this.root.querySelector('#ov-abs')!.addEventListener('change', (e) => this.cb.onToggleAbs((e.target as HTMLInputElement).checked));
    this.root.querySelector('#ov-tcs')!.addEventListener('change', (e) => this.cb.onToggleTcs((e.target as HTMLInputElement).checked));
    this.root.querySelector('#ov-auto')!.addEventListener('change', (e) => this.cb.onToggleAutoTrans((e.target as HTMLInputElement).checked));
    this.root.querySelector('#ov-vmaster')!.addEventListener('input', (e) => this.cb.onSetVolume('master', +(e.target as HTMLInputElement).value));
    this.root.querySelector('#ov-vengine')!.addEventListener('input', (e) => this.cb.onSetVolume('engine', +(e.target as HTMLInputElement).value));
    this.root.querySelector('#ov-vsfx')!.addEventListener('input', (e) => this.cb.onSetVolume('sfx', +(e.target as HTMLInputElement).value));
  }

  showTitle(): void { this.title.style.display = 'flex'; this.pause.style.display = 'none'; }
  hideTitle(): void { this.title.style.display = 'none'; }
  showPause(): void { this.pause.style.display = 'flex'; }
  hidePause(): void { this.pause.style.display = 'none'; }

  /** Phase 3: タイトル画面のクレジット・愛車・戦績表示を更新 */
  updateProfile(credits: number, carName: string, totalRaces: number, wins: number, progress?: string): void {
    const cr = this.root.querySelector('#ov-credits')! as HTMLElement;
    if (cr) cr.textContent = `CREDITS ¥${Math.round(credits).toLocaleString('en-US')}`;
    const ci = this.root.querySelector('#ov-carinfo')! as HTMLElement;
    if (ci) ci.textContent = `愛車: ${carName}`;
    const rc = this.root.querySelector('#ov-record')! as HTMLElement;
    if (rc) rc.textContent = `RACES ${totalRaces} · WINS ${wins}` + (progress ? ` · ${progress}` : '');
  }

  private _refreshSegments(): void {
    this.root.querySelectorAll('#ov-diffgroup .ov-seg').forEach((b) => {
      (b as HTMLElement).classList.toggle('ov-on', (b as HTMLElement).dataset.diff === this.difficulty);
    });
    this.root.querySelectorAll('#ov-lapgroup .ov-seg').forEach((b) => {
      (b as HTMLElement).classList.toggle('ov-on', parseInt((b as HTMLElement).dataset.laps!, 10) === this.laps);
    });
  }

}

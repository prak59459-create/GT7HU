/**
 * ui/GarageScreen.ts
 * 計画書 Phase 3: 車両システムUI（ガレージ / ディーラー / チューニングショップ）。
 *
 * 画面構成: 中央は透過（Game側の3Dショールーム＝Orbitカメラで実車を回転表示し、
 * それを妨げない）。左右に情報パネルを配置する GT風レイアウト。
 *  - ガレージ: 所有車リスト / スペック / 乗り込み・色・お気に入り・売却
 *  - ディーラー: 販売車両リスト / スペック / 購入
 *  - チューニング: 対象車選択 / 7カテゴリ×3段階の段階式パーツ導入
 *
 * すべての操作は GarageController（Game実装）経由でプロファイルを更新し、
 * 更新のたびに再描画（refresh）してクレジット・スペックを同期する。
 */
import { VEHICLES, getVehicleById, estimatePowerPs, type VehicleData } from '../vehicle/VehicleData';
import { TUNING_CATEGORIES, applyTuning, type TuningPart } from '../vehicle/Tuning';
import type { PlayerProfile, OwnedCar } from '../systems/Profile';

export type ShowroomMode = 'garage' | 'dealer' | 'tuning';

export interface GarageController {
  getProfile(): PlayerProfile;
  /** 車両購入（成功時クレジット消費・セーブ） */
  purchase(vehicleId: string): { ok: boolean; reason?: string };
  /** 所有車売却（60%還元。最後の1台は不可） */
  sellOwned(index: number): { ok: boolean; reason?: string; value?: number };
  setColor(index: number, color: string): void;
  toggleFavorite(index: number): void;
  /** 使用車両変更 */
  selectOwned(index: number): void;
  /** チューニングパーツ導入（段階順守りのみ） */
  buyTuning(index: number, categoryId: string, stage: number): { ok: boolean; reason?: string };
  /** 3Dショールームの表示車両更新 */
  preview(id: string, color: string): void;
  /** セーブ（色/お気に入り/選択など即時反映用） */
  save(): void;
  onBack(): void;
}

const fmt = (v: number): string => `¥${Math.round(v).toLocaleString('en-US')}`;

const MODE_TITLE: Record<ShowroomMode, string> = {
  garage: 'GARAGE',
  dealer: 'DEALER',
  tuning: 'TUNING SHOP'
};

export class GarageScreen {
  public root: HTMLElement;
  private ctrl: GarageController;
  private mode: ShowroomMode = 'garage';
  private selIndex = 0;          // garage: 所有車 / dealer: 販売車両 のインデックス
  private tuningIndex = 0;      // tuning: 対象の所有車インデックス
  private msgTimer = 0;

  constructor(parent: HTMLElement, ctrl: GarageController) {
    this.ctrl = ctrl;
    this.root = document.createElement('div');
    this.root.style.cssText = `position:fixed;inset:0;z-index:130;display:none;pointer-events:none;font-family:'Helvetica Neue',Arial,sans-serif;`;
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div id="gs-top" style="position:absolute;top:0;left:0;right:0;height:56px;background:linear-gradient(180deg,rgba(5,8,12,0.92),rgba(5,8,12,0.72));border-bottom:1px solid #1f242e;display:flex;align-items:center;padding:0 22px;gap:20px;pointer-events:auto;backdrop-filter:blur(8px);">
        <div id="gs-mode" style="font-size:16px;font-weight:200;letter-spacing:8px;color:#c9a961;min-width:180px;">GARAGE</div>
        <div id="gs-record" style="font-size:10px;letter-spacing:2px;color:#8a8f99;"></div>
        <div style="flex:1;"></div>
        <div id="gs-credits" style="font-size:15px;color:#e8e8e8;font-variant-numeric:tabular-nums;letter-spacing:1px;">CREDITS ¥0</div>
        <button id="gs-back" class="gs-btn" style="margin-left:18px;">◀ BACK</button>
      </div>

      <div id="gs-list" style="position:absolute;top:76px;left:22px;bottom:22px;width:308px;background:rgba(5,8,12,0.72);border:1px solid #1f242e;border-left:2px solid #c9a961;padding:14px 0 14px 14px;pointer-events:auto;backdrop-filter:blur(6px);display:flex;flex-direction:column;">
        <div id="gs-list-header" style="font-size:10px;letter-spacing:3px;color:#8a8f99;margin-bottom:10px;">MY CARS</div>
        <div id="gs-list-items" style="overflow-y:auto;flex:1;padding-right:8px;"></div>
      </div>

      <div id="gs-detail" style="position:absolute;top:76px;right:22px;bottom:22px;width:368px;background:rgba(5,8,12,0.72);border:1px solid #1f242e;border-right:2px solid #c9a961;padding:16px;pointer-events:auto;backdrop-filter:blur(6px);overflow-y:auto;"></div>

      <div id="gs-msg" style="position:absolute;bottom:26px;left:50%;transform:translateX(-50%);font-size:13px;letter-spacing:2px;color:#c9a961;background:rgba(5,8,12,0.8);padding:8px 22px;border:1px solid #2a2f3a;opacity:0;transition:opacity 0.3s;pointer-events:none;white-space:nowrap;"></div>

      <style>
        .gs-btn { background:#161a22;border:1px solid #2a2f3a;color:#e8e8e8;padding:7px 14px;font-size:11px;letter-spacing:1px;cursor:pointer;font-family:inherit; }
        .gs-btn:hover { border-color:#c9a961;color:#c9a961; }
        .gs-btn:disabled { opacity:0.35;cursor:not-allowed; }
        .gs-btn.gs-gold { background:linear-gradient(180deg,#c9a961,#a88a48);color:#000;border:none;font-weight:600; }
        .gs-btn.gs-gold:hover { filter:brightness(1.1); color:#000; }
        .gs-item { padding:10px 12px;border:1px solid #1f242e;margin-bottom:6px;cursor:pointer;background:rgba(22,26,34,0.5); }
        .gs-item:hover { border-color:#3a414e; }
        .gs-item.gs-sel { border-color:#c9a961;background:rgba(201,169,97,0.10); }
        .gs-item-name { font-size:14px;color:#e8e8e8;font-weight:600;letter-spacing:0.5px; }
        .gs-item-sub { font-size:10px;color:#8a8f99;margin-top:3px;letter-spacing:1px; }
        .gs-item-badge { display:inline-block;font-size:9px;color:#c9a961;border:1px solid #c9a961;padding:1px 6px;margin-left:6px;letter-spacing:1px; }
        .gs-d-maker { font-size:10px;letter-spacing:3px;color:#8a8f99; }
        .gs-d-model { font-size:24px;font-weight:300;color:#fff;letter-spacing:2px;margin-top:2px; }
        .gs-d-meta { font-size:10px;letter-spacing:2px;color:#c9a961;margin-top:4px; }
        .gs-d-specs { margin-top:14px;border-top:1px solid #1f242e;padding-top:10px; }
        .gs-d-specs div { display:flex;justify-content:space-between;font-size:11px;padding:5px 0;border-bottom:1px solid #141822;color:#8a8f99;letter-spacing:1px; }
        .gs-d-specs div b { color:#e8e8e8;font-weight:500;font-variant-numeric:tabular-nums; }
        .gs-d-desc { font-size:11px;color:#8a8f99;line-height:1.7;margin-top:12px; }
        .gs-d-price { margin-top:12px;font-size:16px;color:#c9a961;letter-spacing:1px;font-variant-numeric:tabular-nums; }
        .gs-actions { margin-top:16px;display:flex;flex-wrap:wrap;gap:8px; }
        .gs-swatch { display:inline-block;width:11px;height:11px;vertical-align:-1px;border:1px solid #666;margin-left:6px; }
        .gs-tcat { border:1px solid #1f242e;padding:10px 12px;margin-bottom:8px;background:rgba(22,26,34,0.4); }
        .gs-tcat-head { display:flex;justify-content:space-between;font-size:12px;color:#e8e8e8;letter-spacing:1px;margin-bottom:8px; }
        .gs-tcat-cur { font-size:10px;color:#c9a961;letter-spacing:1px; }
        .gs-tstages { display:flex;gap:6px;flex-wrap:wrap; }
        .gs-tb { flex:1;min-width:70px;background:#161a22;border:1px solid #1f242e;color:#8a8f99;padding:6px 4px;font-size:10px;cursor:pointer;text-align:center;line-height:1.5;font-family:inherit;letter-spacing:0.5px; }
        .gs-tb:hover { border-color:#3a414e; }
        .gs-tb.gs-on { border-color:#c9a961;color:#c9a961;background:rgba(201,169,97,0.12); }
        .gs-tb.gs-buy { border-color:#5a6472;color:#e8e8e8; }
        .gs-tb.gs-afford { border-color:#c9a961; }
        .gs-tb:disabled { opacity:0.30;cursor:not-allowed; }
        .gs-tb .gs-tprice { color:#8a8f99;font-size:9px; }
        #gs-list-items::-webkit-scrollbar, #gs-detail::-webkit-scrollbar { width:6px; }
        #gs-list-items::-webkit-scrollbar-thumb, #gs-detail::-webkit-scrollbar-thumb { background:#2a2f3a; }
      </style>
    `;
    this.root.querySelector('#gs-back')!.addEventListener('click', () => this.ctrl.onBack());
  }

  // ==== モード切替・表示 ====
  setMode(mode: ShowroomMode): void {
    this.mode = mode;
    const p = this.ctrl.getProfile();
    if (mode === 'garage') {
      const i = p.ownedCars.findIndex((o) => o.id === p.selectedId);
      this.selIndex = Math.max(0, i);
    } else if (mode === 'dealer') {
      this.selIndex = 0;
    } else {
      const i = p.ownedCars.findIndex((o) => o.id === p.selectedId);
      this.tuningIndex = Math.max(0, i);
    }
    this.root.style.display = 'block';
    this.refresh();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  /** 全体再描画（クレジット・リスト・詳細・ショールームプレビュー） */
  refresh(): void {
    const p = this.ctrl.getProfile();
    this.root.querySelector('#gs-mode')!.textContent = MODE_TITLE[this.mode];
    this.root.querySelector('#gs-credits')!.textContent = `CREDITS ${fmt(p.credits)}`;
    this.root.querySelector('#gs-record')!.textContent = `RACES ${p.totalRaces} · WINS ${p.wins}`;

    // インデックスのクランプ（売却等でリストが縮んだ後）
    if (this.mode === 'tuning') {
      this.tuningIndex = Math.min(this.tuningIndex, p.ownedCars.length - 1);
    } else if (this.mode === 'garage') {
      this.selIndex = Math.min(this.selIndex, p.ownedCars.length - 1);
    } else {
      this.selIndex = Math.min(this.selIndex, VEHICLES.length - 1);
    }

    if (this.mode === 'garage') this._renderGarage();
    else if (this.mode === 'dealer') this._renderDealer();
    else this._renderTuning();
  }

  private _message(text: string): void {
    const el = this.root.querySelector('#gs-msg')! as HTMLElement;
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { el.style.opacity = '0'; }, 2400);
  }

  // ==== ガレージ ====
  private _renderGarage(): void {
    const p = this.ctrl.getProfile();
    const header = this.root.querySelector('#gs-list-header')!;
    header.textContent = `MY CARS (${p.ownedCars.length})`;

    const items = this.root.querySelector('#gs-list-items')! as HTMLElement;
    items.innerHTML = p.ownedCars.map((oc, i) => {
      const v = getVehicleById(oc.id);
      if (!v) return '';
      const ps = estimatePowerPs(applyTuning(v.physics, oc.tuning));
      const sel = i === this.selIndex ? ' gs-sel' : '';
      const badge = p.selectedId === oc.id ? '<span class="gs-item-badge">使用中</span>' : '';
      return `<div class="gs-item${sel}" data-i="${i}">
        <div class="gs-item-name">${v.model}${oc.favorite ? ' <span style="color:#c9a961;">★</span>' : ''}${badge}</div>
        <div class="gs-item-sub">${v.manufacturer} · ${v.driveType} · ${ps}PS</div>
      </div>`;
    }).join('');
    items.querySelectorAll('.gs-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.selIndex = parseInt((el as HTMLElement).dataset.i!, 10);
        this.refresh();
      });
    });

    const oc = p.ownedCars[this.selIndex];
    const v = oc ? getVehicleById(oc.id) : undefined;
    const detail = this.root.querySelector('#gs-detail')! as HTMLElement;
    if (!oc || !v) {
      detail.innerHTML = '<div style="color:#8a8f99;font-size:12px;">車両がありません</div>';
      return;
    }
    const tuned = applyTuning(v.physics, oc.tuning);
    const basePs = estimatePowerPs(v.physics);
    const ps = estimatePowerPs(tuned);
    const tunedCount = Object.values(oc.tuning).filter((n) => n > 0).length;
    detail.innerHTML = `
      ${this._specHtml(v, basePs, ps, oc, tunedCount > 0)}
      <div class="gs-d-price">売却価値 ${fmt(this._sellValue(oc, v))}</div>
      <div class="gs-actions">
        ${p.selectedId !== oc.id ? `<button class="gs-btn gs-gold" id="ga-select" style="min-width:110px;">乗り込む SELECT</button>` : ''}
        <button class="gs-btn" id="ga-color">COLOR <span class="gs-swatch" style="background:${oc.color};"></span></button>
        <button class="gs-btn" id="ga-fav">${oc.favorite ? '★ お気に入り解除' : '☆ お気に入り'}</button>
        <button class="gs-btn" id="ga-tune">TUNING</button>
        <button class="gs-btn" id="ga-sell" ${p.ownedCars.length <= 1 ? 'disabled' : ''}>SELL</button>
      </div>
    `;
    const q = (id: string) => detail.querySelector(id);
    q('#ga-select')?.addEventListener('click', () => {
      this.ctrl.selectOwned(this.selIndex);
      this.ctrl.save();
      this._message(`${v.model} に乗り込みました`);
      this.refresh();
    });
    q('#ga-color')?.addEventListener('click', () => {
      const idx = v.colors.indexOf(oc.color);
      const next = v.colors[(idx + 1) % v.colors.length];
      this.ctrl.setColor(this.selIndex, next);
      this.ctrl.save();
      this.refresh();
    });
    q('#ga-fav')?.addEventListener('click', () => {
      this.ctrl.toggleFavorite(this.selIndex);
      this.ctrl.save();
      this.refresh();
    });
    q('#ga-tune')?.addEventListener('click', () => {
      this.tuningIndex = this.selIndex;
      this.mode = 'tuning';
      this.refresh();
    });
    q('#ga-sell')?.addEventListener('click', () => {
      const r = this.ctrl.sellOwned(this.selIndex);
      if (r.ok && r.value !== undefined) this._message(`${v.model} を売却 — ${fmt(r.value)} 獲得`);
      else if (!r.ok) this._message(r.reason ?? '売却できません');
      if (r.ok) { if (this.selIndex >= this.ctrl.getProfile().ownedCars.length) this.selIndex = 0; this.refresh(); }
    });

    this.ctrl.preview(oc.id, oc.color);
  }

  // ==== ディーラー ====
  private _renderDealer(): void {
    const p = this.ctrl.getProfile();
    this.root.querySelector('#gs-list-header')!.textContent = `SHOWROOM (${VEHICLES.length})`;

    const items = this.root.querySelector('#gs-list-items')! as HTMLElement;
    items.innerHTML = VEHICLES.map((v, i) => {
      const owned = p.ownedCars.some((o) => o.id === v.id);
      const ps = estimatePowerPs(v.physics);
      const sel = i === this.selIndex ? ' gs-sel' : '';
      return `<div class="gs-item${sel}" data-i="${i}">
        <div class="gs-item-name">${v.model}${owned ? '<span class="gs-item-badge">所有済</span>' : ''}</div>
        <div class="gs-item-sub">${v.manufacturer} · ${v.driveType} · ${ps}PS · ${fmt(v.price)}</div>
      </div>`;
    }).join('');
    items.querySelectorAll('.gs-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.selIndex = parseInt((el as HTMLElement).dataset.i!, 10);
        this.refresh();
      });
    });

    const v = VEHICLES[this.selIndex];
    const owned = p.ownedCars.some((o) => o.id === v.id);
    const affordable = p.credits >= v.price;
    const detail = this.root.querySelector('#gs-detail')! as HTMLElement;
    const ps = estimatePowerPs(v.physics);
    detail.innerHTML = `
      ${this._specHtml(v, ps, ps, null, false)}
      <div class="gs-d-price">価格 ${fmt(v.price)}</div>
      <div class="gs-actions">
        ${owned
          ? '<div style="font-size:12px;color:#c9a961;letter-spacing:2px;padding:8px 4px;">所有済み（GARAGEで選択可）</div>'
          : `<button class="gs-btn gs-gold" id="dl-buy" style="min-width:140px;" ${affordable ? '' : 'disabled'}>購入 PURCHASE</button>
             ${affordable ? '' : '<div style="font-size:11px;color:#c85050;margin-top:8px;letter-spacing:1px;">クレジット不足</div>'}`}
      </div>
    `;
    detail.querySelector('#dl-buy')?.addEventListener('click', () => {
      const r = this.ctrl.purchase(v.id);
      if (r.ok) this._message(`${v.model} を購入しました`);
      else this._message(r.reason ?? '購入できません');
      this.refresh();
    });

    this.ctrl.preview(v.id, v.defaultColor);
  }

  // ==== チューニング ====
  private _renderTuning(): void {
    const p = this.ctrl.getProfile();
    this.root.querySelector('#gs-list-header')!.textContent = 'TUNE TARGET';

    // 左: 対象車リスト（簡易）
    const items = this.root.querySelector('#gs-list-items')! as HTMLElement;
    items.innerHTML = p.ownedCars.map((oc, i) => {
      const v = getVehicleById(oc.id);
      if (!v) return '';
      const sel = i === this.tuningIndex ? ' gs-sel' : '';
      const n = Object.values(oc.tuning).filter((x) => x > 0).length;
      return `<div class="gs-item${sel}" data-i="${i}">
        <div class="gs-item-name">${v.model}</div>
        <div class="gs-item-sub">${v.manufacturer} · チューニング ${n}/${TUNING_CATEGORIES.length}</div>
      </div>`;
    }).join('');
    items.querySelectorAll('.gs-item').forEach((el) => {
      el.addEventListener('click', () => {
        this.tuningIndex = parseInt((el as HTMLElement).dataset.i!, 10);
        this.refresh();
      });
    });

    const oc = p.ownedCars[this.tuningIndex];
    const v = oc ? getVehicleById(oc.id) : undefined;
    const detail = this.root.querySelector('#gs-detail')! as HTMLElement;
    if (!oc || !v) {
      detail.innerHTML = '<div style="color:#8a8f99;font-size:12px;">車両がありません</div>';
      return;
    }

    const basePs = estimatePowerPs(v.physics);
    const curPs = estimatePowerPs(applyTuning(v.physics, oc.tuning));

    let html = `
      <div class="gs-d-maker">${v.manufacturer.toUpperCase()}</div>
      <div class="gs-d-model">${v.model}</div>
      <div class="gs-d-meta">${basePs}PS → <span style="color:#c9a961;">${curPs}PS</span> · ${applyTuning(v.physics, oc.tuning).mass.toFixed(0)}kg</div>
      <div class="gs-d-specs"><div><span>投資額</span><b>${fmt(oc.tuningSpent)}</b></div></div>
      <div style="height:12px;"></div>
    `;
    for (const cat of TUNING_CATEGORIES) {
      const cur = oc.tuning[cat.id] ?? 0;
      const curName = cur === 0 ? 'ストック' : cat.parts.find((pp) => pp.stage === cur)?.name ?? '';
      html += `<div class="gs-tcat">
        <div class="gs-tcat-head"><span>${cat.name}</span><span class="gs-tcat-cur">${curName}</span></div>
        <div class="gs-tstages">
          <button class="gs-tb ${cur === 0 ? 'gs-on' : ''}" data-cat="${cat.id}" data-st="0">STOCK</button>
          ${cat.parts.map((part) => this._tuningButton(cat.id, part, cur, p.credits)).join('')}
        </div>
      </div>`;
    }
    detail.innerHTML = html;

    // 全ステージボタン（導入・ストックへ戻す）
    detail.querySelectorAll('.gs-tb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = (btn as HTMLElement).dataset.cat!;
        const stage = parseInt((btn as HTMLElement).dataset.st!, 10);
        if (stage === 0) {
          // ストックへ戻す（返金なし）
          oc.tuning[catId] = 0;
          this.ctrl.save();
          this._message('ストックへ戻しました（返金なし）');
          this.refresh();
          return;
        }
        const r = this.ctrl.buyTuning(this.tuningIndex, catId, stage);
        if (r.ok) this._message('パーツを導入しました');
        else this._message(r.reason ?? '導入できません');
        this.refresh();
      });
    });

    this.ctrl.preview(oc.id, oc.color);
  }

  private _tuningButton(catId: string, part: TuningPart, cur: number, credits: number): string {
    const isOn = cur === part.stage;
    const isNext = part.stage === cur + 1;
    const afford = credits >= part.price;
    let cls = 'gs-tb';
    if (isOn) cls += ' gs-on';
    else if (isNext) { cls += ' gs-buy'; if (afford) cls += ' gs-afford'; }
    const disabled = !isOn && !isNext ? 'disabled' : (isNext && !afford ? 'disabled' : '');
    return `<button class="${cls}" data-cat="${catId}" data-st="${part.stage}" ${disabled}>
      ${part.stage} · ${part.name}<br><span class="gs-tprice">${fmt(part.price)} · ${part.desc}</span>
    </button>`;
  }

  // ==== 共通 ====
  private _specHtml(v: VehicleData, basePs: number, ps: number, oc: OwnedCar | null, tuned: boolean): string {
    const mass = oc && tuned ? applyTuning(v.physics, oc.tuning).mass : v.physics.mass;
    const kgPerPs = mass / Math.max(1, ps);
    return `
      <div class="gs-d-maker">${v.manufacturer.toUpperCase()}</div>
      <div class="gs-d-model">${v.model}</div>
      <div class="gs-d-meta">${v.year} · ${v.category.toUpperCase()} · ${v.driveType}</div>
      <div class="gs-d-specs">
        <div><span>最高出力</span><b>${basePs}${tuned && ps > basePs ? ` → <span style="color:#c9a961;">${ps}</span>` : ''} PS</b></div>
        <div><span>最大トルク</span><b>${Math.max(...v.physics.engine.torqueCurve.map((p) => p.torque)).toFixed(0)} Nm</b></div>
        <div><span>車両重量</span><b>${mass.toFixed(0)} kg</b></div>
        <div><span>パワーレシオ</span><b>${kgPerPs.toFixed(2)} kg/PS</b></div>
        <div><span>駆動方式</span><b>${v.driveType}</b></div>
        <div><span>ギア</span><b>${v.physics.transmission.gearRatios.length}速</b></div>
      </div>
      <div class="gs-d-desc">${v.description}</div>
    `;
  }

  private _sellValue(oc: OwnedCar, v: VehicleData): number {
    return Math.round((v.price + oc.tuningSpent) * 0.6);
  }
}

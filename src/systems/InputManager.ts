/**
 * systems/InputManager.ts
 * 計画書 §15.1: キーボード / ゲームコントローラー / ハンドルコントローラー対応。
 * - キーボード: WASD/Space/Shift/Ctrl + 視点切替・ポーズ・リセット等
 * - Gamepad API: アナログスティック + トリガー（RT/LT）+ ボタン
 * - ハンドル: Gamepad API 経由で基本対応（ステアリング軸 + ペダル）
 * キー割り当ては設定から変更可能。
 */
export interface KeyBindings {
  throttle: string; brake: string; left: string; right: string;
  handbrake: string; shiftUp: string; shiftDown: string;
  camera: string; reset: string; pause: string; hud: string;
}

export const DEFAULT_BINDINGS: KeyBindings = {
  throttle: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD',
  handbrake: 'Space', shiftUp: 'ShiftLeft', shiftDown: 'ControlLeft',
  camera: 'KeyC', reset: 'KeyR', pause: 'Escape', hud: 'KeyH'
};

type EdgeListener = (action: 'camera' | 'reset' | 'pause' | 'hud', code: string) => void;

export class InputManager {
  private keys: Record<string, boolean> = {};
  private keysOnce: Record<string, boolean> = {};
  private bindings: KeyBindings;
  private gamepad: Gamepad | null = null;
  private prevButtons: boolean[] = [];
  private edgeListeners: EdgeListener[] = [];

  constructor(bindings?: KeyBindings) {
    this.bindings = bindings ?? { ...DEFAULT_BINDINGS };
  }

  setBindings(b: Partial<KeyBindings>): void {
    this.bindings = { ...this.bindings, ...b };
  }

  startListening(): void {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('gamepadconnected', this._onGamepadConnected);
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }

  stopListening(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('gamepadconnected', this._onGamepadConnected);
    window.removeEventListener('gamepaddisconnected', this._onGamepadDisconnected);
  }

  onEdge(cb: EdgeListener): void { this.edgeListeners.push(cb); }

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (!this.keys[e.code]) this.keysOnce[e.code] = true;
    this.keys[e.code] = true;
    // エッジアクション通知
    const b = this.bindings;
    if (e.code === b.camera) this._emitEdge('camera', e.code);
    if (e.code === b.reset) this._emitEdge('reset', e.code);
    if (e.code === b.pause) this._emitEdge('pause', e.code);
    if (e.code === b.hud) this._emitEdge('hud', e.code);
    // ブラウザデフォルト抑制
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private _onGamepadConnected = (e: GamepadEvent): void => {
    this.gamepad = e.gamepad;
  };
  private _onGamepadDisconnected = (): void => { this.gamepad = null; };

  private _emitEdge(action: 'camera' | 'reset' | 'pause' | 'hud', code: string): void {
    for (const l of this.edgeListeners) l(action, code);
  }

  /** 毎フレーム呼ぶ：ゲームパッド状態更新 */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    this.gamepad = pads[0] ?? pads[1] ?? pads[2] ?? pads[3] ?? this.gamepad;
  }

  isPressed(code: string): boolean { return !!this.keys[code]; }
  isPressedOnce(code: string): boolean { return !!this.keysOnce[code]; }

  /** フレーム終了時に呼ぶ：1フレーム限定フラグをクリア */
  endFrame(): void { this.keysOnce = {}; }

  // --- 入力取得（VehicleController.RawInput 形式） ---
  getRawInput(): {
    throttleKey: boolean; brakeKey: boolean; steerKey: number;
    handbrakeKey: boolean; shiftUpEdge: boolean; shiftDownEdge: boolean;
    throttleAnalog: number | null; brakeAnalog: number | null; steerAnalog: number | null;
  } {
    const b = this.bindings;
    // ゲームパッド優先
    let throttleAnalog: number | null = null;
    let brakeAnalog: number | null = null;
    let steerAnalog: number | null = null;
    let gpShiftUp = false, gpShiftDown = false;
    if (this.gamepad) {
      const gp = this.gamepad;
      // ステアリング: 軸0（左スティックX）または ハンドルの回転軸
      const lx = gp.axes[0] ?? 0;
      if (Math.abs(lx) > 0.03) steerAnalog = lx;
      // トリガー: RT=buttons[7].value, LT=buttons[6].value（多くの標準パッド）
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.02) throttleAnalog = rt;
      if (lt > 0.02) brakeAnalog = lt;
      // シフト: A(0)=up, B(1)=down（Xbox）/ ✕(0)=up, ○(1)=down（PS）
      gpShiftUp = !!gp.buttons[0]?.pressed;
      gpShiftDown = !!gp.buttons[1]?.pressed;
    }

    return {
      throttleKey: !!this.keys[b.throttle],
      brakeKey: !!this.keys[b.brake],
      steerKey: (this.keys[b.left] ? -1 : 0) + (this.keys[b.right] ? 1 : 0),
      handbrakeKey: !!this.keys[b.handbrake],
      shiftUpEdge: !!this.keysOnce[b.shiftUp] || gpShiftUp,
      shiftDownEdge: !!this.keysOnce[b.shiftDown] || (this.gamepad ? !!this.gamepad.buttons[2]?.pressed : false),
      throttleAnalog,
      brakeAnalog,
      steerAnalog
    };
  }

  getGamepadCameraButtonEdge(): boolean {
    if (!this.gamepad) return false;
    // Y(3) ボタンでカメラ切替（エッジ）
    const pressed = !!this.gamepad.buttons[3]?.pressed;
    const was = this.prevButtons[3] ?? false;
    this.prevButtons[3] = pressed;
    return pressed && !was;
  }
}

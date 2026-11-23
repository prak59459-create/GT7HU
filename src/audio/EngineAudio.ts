/**
 * audio/EngineAudio.ts
 * 計画書 §13.1: 車両ごとに異なるエンジン音。回転数・スロットルに応じて音変化。
 * Web Audio API で合成（外部音源ファイル不使用 → file:// で動作）。
 *  - エンジン音: ノコギリ波×2 + ローパス + 排気ノイズ
 *  - タイヤスキール: バンドパスノイズ（スリップ率に連動）
 *  - 風切り: ローパスノイズ（速度に連動）
 *  - シフト / 衝突 / レブリミット / カウントダウン / スタート / ラップ完了
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private skidGain: GainNode | null = null;

  private started = false;
  private paused = false;
  private volumes = { master: 0.7, engine: 0.8, sfx: 0.6 };
  private idleRpm = 900;
  private redline = 7200;

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(this.ctx.destination);
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = this.volumes.engine * 0.4;
      this.engineGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volumes.sfx;
      this.sfxGain.connect(this.master);

      // 風切り・スキール用ノイズバッファ
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 1, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseSrc = this.ctx.createBufferSource();
      this.noiseSrc.buffer = buf;
      this.noiseSrc.loop = true;
      this.noiseGain = this.ctx.createGain();
      this.noiseGain.gain.value = 0.0;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0.0;
      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.value = 0.0;
      // 排気ノイズ → engineGain
      this.noiseSrc.connect(this.noiseGain);
      this.noiseGain.connect(this.engineGain);
      // 風切り → sfx
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 800;
      this.noiseSrc.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.sfxGain!);
      // スキール → sfx
      const skidFilter = this.ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 1400;
      skidFilter.Q.value = 6;
      this.noiseSrc.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.sfxGain!);
      this.noiseSrc.start();
    } catch (e) {
      console.warn('Audio init failed', e);
    }
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  startEngine(idleRpm: number, redline: number): void {
    if (!this.ctx || this.started) return;
    this.idleRpm = idleRpm;
    this.redline = redline;
    this.started = true;
    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = (idleRpm / 60) * 2;
    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = (idleRpm / 60) * 1;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineFilter.Q.value = 4;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain!);
    this.osc1.start();
    this.osc2.start();
  }

  /** 毎フレーム更新: rpm, throttle(0..1), speed(m/s), maxWheelSlip */
  updateEngine(rpm: number, throttle: number, speed: number, maxWheelSlip: number): void {
    if (!this.ctx || !this.started || this.paused) return;
    const t = this.ctx.currentTime;
    const baseFreq = Math.max(20, (rpm / 60) * 2);
    this.osc1?.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.osc2?.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.04);
    const cutoff = 350 + throttle * 1400 + (rpm / this.redline) * 900;
    this.engineFilter?.frequency.setTargetAtTime(cutoff, t, 0.05);
    // 排気ノイズ量
    this.noiseGain?.gain.setTargetAtTime(0.02 + throttle * 0.08 + (rpm / this.redline) * 0.05, t, 0.08);
    // 風切り
    this.windGain?.gain.setTargetAtTime(Math.min(0.12, speed * 0.002), t, 0.1);
    // スキール
    const skid = Math.max(0, Math.min(0.25, Math.abs(maxWheelSlip) - 0.15));
    this.skidGain?.gain.setTargetAtTime(skid * 1.2, t, 0.05);
  }

  stopEngine(): void {
    if (!this.started) return;
    this.started = false;
    try { this.osc1?.stop(); this.osc2?.stop(); this.noiseSrc?.stop(); } catch {}
    this.osc1 = null; this.osc2 = null; this.noiseSrc = null;
  }

  playSfx(type: 'shift' | 'collision' | 'limiter' | 'beep' | 'start' | 'lap' | 'finish' | 'click'): void {
    if (!this.ctx || this.paused) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.sfxGain!);
    switch (type) {
      case 'shift':
        o.type = 'square'; o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
        g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.start(t); o.stop(t + 0.2); break;
      case 'collision':
        o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t);
        o.frequency.exponentialRampToValueAtTime(25, t + 0.35);
        g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.start(t); o.stop(t + 0.5); break;
      case 'limiter':
        o.type = 'square'; o.frequency.value = 1200;
        g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        o.start(t); o.stop(t + 0.08); break;
      case 'beep':
        o.type = 'sine'; o.frequency.value = 700;
        g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.start(t); o.stop(t + 0.5); break;
      case 'start':
        o.type = 'sine'; o.frequency.setValueAtTime(450, t);
        o.frequency.exponentialRampToValueAtTime(1300, t + 0.5);
        g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.start(t); o.stop(t + 0.8); break;
      case 'lap':
        o.type = 'triangle'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.35); break;
      case 'finish':
        [523, 659, 784, 1047].forEach((f, i) => {
          const oo = this.ctx!.createOscillator(); const gg = this.ctx!.createGain();
          oo.type = 'triangle'; oo.frequency.value = f;
          const st = t + i * 0.15;
          gg.gain.setValueAtTime(0, st); gg.gain.linearRampToValueAtTime(0.3, st + 0.05);
          gg.gain.exponentialRampToValueAtTime(0.001, st + 0.4);
          oo.connect(gg); gg.connect(this.sfxGain!);
          oo.start(st); oo.stop(st + 0.5);
        });
        o.disconnect(); g.disconnect(); return;
      case 'click':
        o.type = 'sine'; o.frequency.value = 1200;
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        o.start(t); o.stop(t + 0.06); break;
    }
  }

  setVolume(type: 'master' | 'engine' | 'sfx', v: number): void {
    this.volumes[type] = v;
    if (!this.ctx) return;
    if (type === 'master' && this.master) this.master.gain.value = v;
    if (type === 'engine' && this.engineGain) this.engineGain.gain.value = v * 0.4;
    if (type === 'sfx' && this.sfxGain) this.sfxGain.gain.value = v;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (this.ctx) { p ? this.ctx.suspend() : this.ctx.resume(); }
  }

  dispose(): void {
    this.stopEngine();
    this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * core/Game.ts
 * 全システム統合。状態遷移: title → countdown → running → (paused) → finished。
 * GameLoop(120Hz固定) で物理を進め、描画は毎フレーム補間付きで実行。
 *
 * Phase 2: モード（free/race）導入。
 *  - free: Phase 1 と完全同一の挙動（自車1台・無制限周回・タイムアタック）。
 *  - race: AI対戦車5台＋グリッドスタート→周回数でフィニッシュ→リザルト。
 *    AI物理も同一 VehiclePhysics / 同一 120Hz タイムステップで更新。
 */
import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { EventBus } from './EventBus';
import { RendererManager } from '../rendering/RendererManager';
import { Lighting } from '../rendering/Lighting';
import { CameraManager, type CameraTarget } from '../rendering/CameraManager';
import { InputManager } from '../systems/InputManager';
import { Vehicle } from '../vehicle/Vehicle';
import { VehicleController, type ControlSettings } from '../vehicle/VehicleController';
import { TrackData } from '../tracks/TrackData';
import { TrackBuilder } from '../tracks/TrackBuilder';
import { LapManager } from '../race/LapManager';
import { RaceManager, type RaceSettings } from '../race/RaceManager';
import { RaceHUD, type MiniMapMarker, type RaceHUDRaceInfo } from '../ui/RaceHUD';
import { Overlays, type StartOptions } from '../ui/Overlays';
import { RaceResults } from '../ui/RaceResults';
import { EngineAudio } from '../audio/EngineAudio';
import { getVehicleById } from '../vehicle/VehicleData';
import type { VehicleControls } from '../physics/VehiclePhysics';
import type { TrackQueryResult } from '../tracks/TrackData';

type GameState = 'title' | 'countdown' | 'running' | 'paused' | 'finished';
type GameMode = 'free' | 'race';

export class Game {
  public renderer: RendererManager;
  public scene: THREE.Scene;
  public lighting: Lighting;
  public camera: CameraManager;
  public input: InputManager;
  public audio: EngineAudio;
  public bus = new EventBus();
  public loop: GameLoop;

  private track: TrackData;
  private trackBuilder: TrackBuilder;
  private vehicle: Vehicle | null = null;
  private controller: VehicleController | null = null;
  private controlSettings: ControlSettings;
  private lapManager: LapManager;
  private hud: RaceHUD;
  private overlays: Overlays;
  private results: RaceResults;

  private state: GameState = 'title';
  private mode: GameMode = 'free';
  private countdownT = 3.0;
  private totalLaps = 0; // 0 = 無制限（フリーラン）
  private prevControls: VehicleControls | null = null;

  // Phase 2 レース
  private race: RaceManager | null = null;
  private raceSettings: RaceSettings | null = null;
  private playerFinished = false;
  private finishWaitT = 0;
  private standingsTimer = 0;

  // 描画用補間状態
  private renderState: CameraTarget = {
    position: new THREE.Vector3(), yaw: 0, speed: 0, yawRate: 0, lateralG: 0, roll: 0
  };

  constructor(container: HTMLElement) {
    this.renderer = new RendererManager(container, 'high');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9bb8d9);
    this.scene.fog = new THREE.Fog(0x9bb8d9, 400, 1400);

    this.lighting = new Lighting(this.scene, this.renderer.renderer);
    this.camera = new CameraManager();
    this.input = new InputManager();
    this.audio = new EngineAudio();
    this.loop = new GameLoop(120);

    this.controlSettings = { abs: true, tcs: true, autoTransmission: true, steeringSensitivity: 1.0 };

    // コース
    this.track = new TrackData();
    this.trackBuilder = new TrackBuilder(this.track);
    this.trackBuilder.build(this.scene);

    this.lapManager = new LapManager(this.track, this.totalLaps);

    // HUD
    this.hud = new RaceHUD(container);

    // オーバーレイ（タイトル・ポーズ）
    this.overlays = new Overlays(container, {
      onStart: (opts: StartOptions) => this._startRun(opts),
      onResume: () => this._resume(),
      onRestart: () => this._restart(),
      onQuit: () => this._quitToTitle(),
      onToggleCamera: () => this.camera.cycleMode(),
      onToggleAbs: (v) => { this.controlSettings.abs = v; this.controller?.setSettings(this.controlSettings); },
      onToggleTcs: (v) => { this.controlSettings.tcs = v; this.controller?.setSettings(this.controlSettings); },
      onToggleAutoTrans: (v) => { this.controlSettings.autoTransmission = v; this.controller?.setSettings(this.controlSettings); },
      onSetVolume: (type, v) => this.audio.setVolume(type, v)
    });

    // リザルト画面（Phase 2）
    this.results = new RaceResults(container, {
      onRestart: () => this._restart(),
      onTitle: () => this._quitToTitle()
    });

    // 入力
    this.input.startListening();
    this.input.onEdge((action) => {
      if (action === 'pause') {
        if (this.state === 'running') this._pause();
        else if (this.state === 'paused') this._resume();
      }
      if (action === 'camera') this.camera.cycleMode();
      if (action === 'reset') this._resetVehicle();
      if (action === 'hud') this.hud.toggleVisible();
    });

    // ループ設定
    this.loop.onPhysics = (dt) => this._stepPhysics(dt);
    this.loop.onRender = (alpha, frameDt) => this._render(alpha, frameDt);

    window.addEventListener('resize', () => {
      this.camera.onResize();
    });
  }

  start(): void {
    this.overlays.showTitle();
    this.loop.start();
  }

  // --- ラン開始 ---
  private _startRun(opts: StartOptions): void {
    this.mode = opts.mode;
    this.playerFinished = false;
    this.finishWaitT = 0;
    this.results.hide();
    // 【バグ修正】ポーズ→QUIT TO TITLE→再開でループが一時停止のまま固まるのを防ぐ
    this.loop.resume();

    if (!this.vehicle) this._spawnVehicle();
    this.overlays.hideTitle();
    this.hud.setVisible(true);
    this.audio.init();
    this.audio.resume();
    this.audio.startEngine(this.vehicle!.physics.engine.idleRpm, this.vehicle!.physics.engine.redline);
    this.lapManager.reset();

    if (this.mode === 'race') {
      // Phase 2 レース: AI 5台＋規定周回
      this.totalLaps = opts.laps;
      this.raceSettings = { difficulty: opts.difficulty, totalLaps: opts.laps, playerVehicleId: 'aurora_rs2' };
      this.race = new RaceManager(this.scene, this.track, this.raceSettings, this.controlSettings);
      this.race.spawnGrid(this.vehicle!, this.lapManager);
      this.hud.setRaceInfo({ position: 6, totalCars: 6, gapAhead: null });
    } else {
      // Phase 1 フリーラン: 従来挙動（スタートライン上から無制限周回）
      this.totalLaps = 0;
      this.race = null;
      const startPos = this.track.startPos.clone();
      startPos.y = this.track.query(startPos.x, startPos.z).groundY;
      const startYaw = Math.atan2(this.track.startDir.x, this.track.startDir.z);
      this.vehicle!.reset(startPos, startYaw);
      this.lapManager.setProgressDirect(this.track.query(startPos.x, startPos.z).progress);
      this.hud.setRaceInfo(null);
    }

    this.countdownT = 3.0;
    this.state = 'countdown';
    this._showCountdown(3);
  }

  private _spawnVehicle(): void {
    const data = getVehicleById('aurora_rs2')!;
    this.vehicle = new Vehicle(data, data.defaultColor);
    this.vehicle.addToScene(this.scene);
    this.controller = new VehicleController(this.controlSettings);
  }

  private _restart(): void {
    this.overlays.hidePause();
    this.results.hide();
    this.playerFinished = false;
    this.finishWaitT = 0;
    // 【バグ修正】ポーズ/リザルトから再スタート時もループを確実に再開
    this.loop.resume();

    // レースモード時はAIごと作り直し
    if (this.race) {
      this.race.dispose();
      this.race = new RaceManager(this.scene, this.track, this.raceSettings!, this.controlSettings);
    }

    if (this.vehicle) {
      if (this.mode === 'race' && this.race) {
        this.race.spawnGrid(this.vehicle!, this.lapManager);
        this.hud.setRaceInfo({ position: 6, totalCars: 6, gapAhead: null });
      } else {
        const startPos = this.track.startPos.clone();
        startPos.y = this.track.query(startPos.x, startPos.z).groundY;
        const startYaw = Math.atan2(this.track.startDir.x, this.track.startDir.z);
        this.vehicle.reset(startPos, startYaw);
        this.lapManager.reset();
        this.lapManager.setProgressDirect(this.track.query(startPos.x, startPos.z).progress);
      }
    }
    this.countdownT = 3.0;
    this.state = 'countdown';
    this._showCountdown(3);
  }

  private _quitToTitle(): void {
    this.overlays.hidePause();
    this.results.hide();
    if (this.race) { this.race.dispose(); this.race = null; }
    this.audio.stopEngine();
    this.state = 'title';
    this.playerFinished = false;
    this.overlays.showTitle();
    this.hud.setVisible(false);
    this.hud.setRaceInfo(null);
    // タイトルでは描画を続けるため物理ループも再開（ポーズ残留を防ぐ）
    this.loop.resume();
  }

  private _pause(): void {
    this.state = 'paused';
    this.loop.pause();
    this.audio.setPaused(true);
    this.overlays.showPause();
  }

  private _resume(): void {
    this.overlays.hidePause();
    this.state = 'running';
    this.loop.resume();
    this.audio.setPaused(false);
  }

  private _resetVehicle(): void {
    if (!this.vehicle) return;
    // 最寄りのサンプル位置の少し先へ戻す（進行方向維持）※Phase 1 同一仕様
    const q = this.track.query(this.vehicle.physics.pos.x, this.vehicle.physics.pos.z);
    const sm = this.track.samples[q.nearestIndex];
    const next = this.track.samples[(q.nearestIndex + 2) % this.track.samples.length];
    const yaw = Math.atan2(next.tangent.x, next.tangent.z);
    const p = new THREE.Vector3(sm.position.x, sm.position.y, sm.position.z);
    this.vehicle.reset(p, yaw);
    this.lapManager.setProgressDirect(this.track.query(p.x, p.z).progress);
  }

  // --- 物理ステップ（120Hz） ---
  private _stepPhysics(dt: number): void {
    if (this.state !== 'countdown' && this.state !== 'running') return;
    if (!this.vehicle || !this.controller) return;

    this.input.poll();
    const raw = this.input.getRawInput();

    // カウントダウン中は入力抑制（ブレーキのみ）
    if (this.state === 'countdown') {
      raw.throttleKey = false; raw.throttleAnalog = null;
      raw.brakeKey = true; raw.brakeAnalog = 1;
      const prev = this.countdownT;
      this.countdownT -= dt;
      // カウントダウン表示（整数変化時に更新）
      if (Math.ceil(prev) !== Math.ceil(this.countdownT) && this.countdownT > 0) {
        this._showCountdown(Math.ceil(this.countdownT));
      }
      if (this.countdownT <= 0) {
        this.state = 'running';
        this.hud.showCenter('GO!', 1000);
        this.audio.playSfx('start');
      }
    }

    // ゲームパッドのカメラボタンエッジ
    if (this.input.getGamepadCameraButtonEdge()) this.camera.cycleMode();

    // プレイヤーフィニッシュ後は自動減速（オートブレーキ）
    if (this.playerFinished) {
      raw.throttleKey = false; raw.throttleAnalog = 0;
      raw.brakeKey = true; raw.brakeAnalog = 0.42;
      raw.steerKey = 0; raw.steerAnalog = 0;
      raw.handbrakeKey = false;
    }

    const controls: VehicleControls = this.controller.compute(dt, raw);
    this.prevControls = controls;

    // 物理（プレイヤー）
    const q: TrackQueryResult = this.track.query(this.vehicle.physics.pos.x, this.vehicle.physics.pos.z);
    const res = this.vehicle.updatePhysics(dt, controls, q);
    if (res.collided && res.impact > 4) {
      this.audio.playSfx('collision');
      this.camera.addShake(Math.min(0.5, res.impact * 0.03));
      this.bus.emit({ type: 'collision', impactSpeed: res.impact });
    }
    // シフト音
    if (controls.shiftUp || controls.shiftDown) this.audio.playSfx('shift');
    // レブリミット音
    if (this.vehicle.physics.limiter) this.audio.playSfx('limiter');

    // ラップ（プレイヤー）
    const lapRes = this.lapManager.update(dt, q.progress);
    if (lapRes.lapCompleted && lapRes.lapTime !== null) {
      this.audio.playSfx(lapRes.isBest ? 'lap' : 'beep');
      this.hud.showCenter(lapRes.isBest ? 'BEST LAP!' : `LAP ${this.lapManager.currentLap - 1}`, 1500);
      this.bus.emit({ type: 'lapComplete', lap: this.lapManager.currentLap - 1, lapTime: lapRes.lapTime, best: lapRes.isBest });
    }

    // Phase 2: レース（AI物理・順位・フィニッシュ）
    if (this.race) {
      if (this.state === 'countdown') {
        this.race.stepCountdown(dt);
      } else {
        const ev = this.race.step(dt);
        // プレイヤーフィニッシュ
        if (ev.playerFinished && !this.playerFinished) {
          this.playerFinished = true;
          const pos = this.race.playerCar?.position ?? 1;
          this.hud.showCenter(pos === 1 ? 'FINISH — P1!' : `FINISH — P${pos}`, 2600);
          this.audio.playSfx('finish');
        }
        // プレイヤー後の残車待機（最大45秒）
        if (this.playerFinished) {
          this.finishWaitT += dt;
          if (this.race.allFinished() || this.finishWaitT > 45) {
            this._showResults();
          }
        }
      }
    }

    // オーディオ更新
    const st = this.vehicle.getState();
    let maxSlip = 0;
    for (const sp of st.wheelSlip) maxSlip = Math.max(maxSlip, Math.abs(sp));
    this.audio.updateEngine(st.rpm, controls.throttle, st.speed, maxSlip);

    // 入力フレーム終了
    this.input.endFrame();
  }

  // --- リザルト表示 ---
  private _showResults(): void {
    if (!this.race || this.state === 'finished') return;
    this.state = 'finished';
    this.race.updateStandings();
    const rows = this.race.results();
    const playerPos = this.race.playerCar?.position ?? 1;
    this.results.show(rows, playerPos, this.race.settings.totalLaps, this.race.time);
    this.hud.setRaceInfo(null);
  }

  // --- 描画 ---
  private _render(_alpha: number, _frameDt: number): void {
    if (!this.vehicle) {
      // タイトル画面：カメラでコースを俯瞰
      const t = performance.now() * 0.0001;
      this.camera.camera.position.set(Math.cos(t) * 200, 80, Math.sin(t) * 200);
      this.camera.camera.lookAt(0, 0, 0);
    } else {
      const st = this.vehicle.getState();
      this.renderState.position.set(st.position.x, this.vehicle.physics.bodyY, st.position.z);
      this.renderState.yaw = st.yaw;
      this.renderState.speed = st.speed;
      this.renderState.yawRate = st.yawRate;
      this.renderState.lateralG = st.gLat;
      this.renderState.roll = st.roll;
      this.camera.setTarget(this.renderState);
      this.camera.update(_frameDt || 1 / 60, this.renderState);
      this.vehicle.syncMesh(_frameDt || 1 / 60);
      this.lighting.followTarget(this.renderState.position);

      // Phase 2: AI車両メッシュ同期・ミニマップマーカー
      const markers: MiniMapMarker[] = [];
      if (this.race) {
        for (const car of this.race.cars) {
          if (!car.isPlayer) {
            car.vehicle.syncMesh(_frameDt || 1 / 60);
            markers.push({
              x: car.vehicle.physics.pos.x,
              z: car.vehicle.physics.pos.z,
              yaw: car.vehicle.physics.yaw,
              color: car.vehicle.color,
              isPlayer: false
            });
          }
        }
        this.hud.setMarkers(markers);

        // 順位パネル（0.25s間隔で更新、フィニッシュ後は非表示）
        this.standingsTimer -= (_frameDt || 0);
        if (this.standingsTimer <= 0) {
          this.standingsTimer = 0.25;
          if (this.state === 'running' && !this.playerFinished) {
            const pc = this.race.playerCar;
            if (pc) {
              let gapAhead: number | null = null;
              if (pc.position > 1) {
                const ahead = this.race.cars.find((c) => c.position === pc.position - 1);
                if (ahead) gapAhead = this.race.gapSecondsTo(pc, ahead);
              }
              const info: RaceHUDRaceInfo = { position: pc.position, totalCars: this.race.cars.length, gapAhead };
              this.hud.setRaceInfo(info);
            }
          } else {
            this.hud.setRaceInfo(null);
          }
        }
      }

      // HUD
      this.hud.update(
        st, this.lapManager.currentLap, this.totalLaps,
        this.lapManager.currentLapTime, this.lapManager.bestLapTime,
        this.lapManager.lastLapTime, this.track,
        this.loop.fps, this.loop.physicsMs
      );
    }
    this.renderer.render(this.scene, this.camera.camera);
  }

  private _showCountdown(n: number): void {
    this.hud.showCenter(n > 0 ? n.toString() : 'GO!', 800);
    this.audio.playSfx('beep');
  }
}

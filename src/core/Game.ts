/**
 * core/Game.ts
 * 全システム統合。状態遷移: title → countdown → running → (paused) → finished。
 * GameLoop(120Hz固定) で物理を進め、描画は毎フレーム補間付きで実行。
 *
 * Phase 2: モード（free/race）導入。
 *  - free: Phase 1 と完全同一の挙動（自車1台・無制限周回・タイムアタック）。
 *  - race: AI対戦車5台＋グリッドスタート→周回数でフィニッシュ→リザルト。
 *    AI物理も同一 VehiclePhysics / 同一 120Hz タイムステップで更新。
 * Phase 4: チャレンジモード（license/mission/trial）追加。
 *  - ライセンスセンター・ミッション・タイムトライアル・ドリフトトライアル。
 *  - ChallengeRunner が種別ごとの成功/失敗・ドリフトスコアリングを評価。
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
import { GarageScreen, type GarageController, type ShowroomMode } from '../ui/GarageScreen';
import { EngineAudio } from '../audio/EngineAudio';
import { getVehicleById, type VehicleData } from '../vehicle/VehicleData';
import { applyTuning, TUNING_CATEGORIES } from '../vehicle/Tuning';
import { SaveSystem, computeRaceReward, applyChallengeResult, applyMissionResult, type PlayerProfile } from '../systems/Profile';
import { ChallengeRunner, type ChallengeEvent } from '../race/ChallengeRunner';
import { LICENSES, MISSIONS, medalFor, type ChallengeDef } from '../race/ChallengeDefs';
import { ChallengeCenter, type ChallengeTab } from '../ui/ChallengeCenter';
import type { VehicleControls } from '../physics/VehiclePhysics';
import type { TrackQueryResult } from '../tracks/TrackData';

type GameState = 'title' | 'countdown' | 'running' | 'paused' | 'finished' | 'garage' | 'dealer' | 'tuning' | 'challengeCenter';
type GameMode = 'free' | 'race' | 'challenge';

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

  // Phase 3: 車両システム（プロファイル・ショールーム）
  private profile: PlayerProfile;
  private garage: GarageScreen;
  private showroom: Vehicle | null = null;
  private showroomId = '';
  private showroomColor = '';
  private vehicleHidden = false;
  private spawnedKey = '';

  private state: GameState = 'title';
  private mode: GameMode = 'free';
  private countdownT = 3.0;
  private totalLaps = 0;
  private prevControls: VehicleControls | null = null;

  // Phase 2 レース
  private race: RaceManager | null = null;
  private raceSettings: RaceSettings | null = null;
  private playerFinished = false;
  private finishWaitT = 0;
  private standingsTimer = 0;

  // Phase 4: チャレンジ
  private challengeCenter!: ChallengeCenter;
  private activeChallenge: ChallengeDef | null = null;
  private runner: ChallengeRunner | null = null;
  private chalHudT = 0;
  private chalPanelOn = false;

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

    this.track = new TrackData();
    this.trackBuilder = new TrackBuilder(this.track);
    this.trackBuilder.build(this.scene);

    this.lapManager = new LapManager(this.track, this.totalLaps);

    this.hud = new RaceHUD(container);

    this.overlays = new Overlays(container, {
      onStart: (opts: StartOptions) => this._startRun(opts),
      onResume: () => this._resume(),
      onRestart: () => this._restart(),
      onQuit: () => this._quitToTitle(),
      onToggleCamera: () => this.camera.cycleMode(),
      onToggleAbs: (v) => { this.controlSettings.abs = v; this.controller?.setSettings(this.controlSettings); },
      onToggleTcs: (v) => { this.controlSettings.tcs = v; this.controller?.setSettings(this.controlSettings); },
      onToggleAutoTrans: (v) => { this.controlSettings.autoTransmission = v; this.controller?.setSettings(this.controlSettings); },
      onSetVolume: (type, v) => this.audio.setVolume(type, v),
      onOpenGarage: () => this._openGarage('garage'),
      onOpenDealer: () => this._openGarage('dealer'),
      onOpenTuning: () => this._openGarage('tuning'),
      onOpenChallengeCenter: (tab) => this._openChallengeCenter(tab)
    });

    this.results = new RaceResults(container, {
      onRestart: () => this._restart(),
      onTitle: () => this._quitToTitle()
    });

    this.profile = SaveSystem.load() ?? SaveSystem.createStarter();
    this.garage = new GarageScreen(container, this._makeGarageController());

    this.challengeCenter = new ChallengeCenter(container, {
      getProfile: () => this.profile,
      onStart: (def) => this._startChallenge(def),
      onBack: () => this._closeChallengeCenter()
    });

    this.input.startListening();
    this.input.onEdge((action) => {
      if (action === 'pause') {
        if (this.state === 'challengeCenter') { this._closeChallengeCenter(); return; }
        if (this.state === 'garage' || this.state === 'dealer' || this.state === 'tuning') { this._closeGarage(); return; }
        if (this.state === 'running') this._pause();
        else if (this.state === 'paused') this._resume();
        else if (this.state === 'finished') this._quitToTitle();
      }
      const inDrive = this.state === 'countdown' || this.state === 'running' || this.state === 'paused';
      if (inDrive && action === 'camera') this.camera.cycleMode();
      if (inDrive && action === 'reset') this._resetVehicle();
      if (inDrive && action === 'hud') this.hud.toggleVisible();
    });

    this.loop.onPhysics = (dt) => this._stepPhysics(dt);
    this.loop.onRender = (alpha, frameDt) => this._render(alpha, frameDt);

    window.addEventListener('resize', () => { this.camera.onResize(); });
  }

  start(): void {
    this.overlays.updateProfile(this.profile.credits, this._selectedCarName(), this.profile.totalRaces, this.profile.wins, this._progressText());
    this.overlays.showTitle();
    this.loop.start();
  }

  private _startRun(opts: StartOptions): void {
    this.mode = opts.mode;
    this.activeChallenge = null;
    this.runner = null;
    this.playerFinished = false;
    this.finishWaitT = 0;
    this.results.hide();
    this.loop.resume();
    if (!this.vehicle || this.spawnedKey !== this._playerCarKey()) this._spawnVehicle();
    if (this.vehicleHidden) { this.vehicle!.addToScene(this.scene); this.vehicleHidden = false; }
    this.overlays.hideTitle();
    this.hud.setVisible(true);
    this.audio.init();
    this.audio.resume();
    this.audio.startEngine(this.vehicle!.physics.engine.idleRpm, this.vehicle!.physics.engine.redline);
    this.lapManager.reset();
    if (this.mode === 'race') {
      this.totalLaps = opts.laps;
      this.raceSettings = { difficulty: opts.difficulty, totalLaps: opts.laps, playerVehicleId: this.profile.selectedId };
      this.race = new RaceManager(this.scene, this.track, this.raceSettings, this.controlSettings);
      this.race.spawnGrid(this.vehicle!, this.lapManager);
      this.hud.setRaceInfo({ position: this.race.cars.length, totalCars: this.race.cars.length, gapAhead: null });
    } else {
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

  private _startChallenge(def: ChallengeDef): void {
    this.mode = 'challenge';
    this.activeChallenge = def;
    this.runner = new ChallengeRunner(def);
    this.playerFinished = false;
    this.finishWaitT = 0;
    this.results.hide();
    this.overlays.hidePause();
    this.loop.resume();
    this.challengeCenter.hide();
    if (!this.vehicle || this.spawnedKey !== this._playerCarKey()) this._spawnVehicle();
    if (this.vehicleHidden) { this.vehicle!.addToScene(this.scene); this.vehicleHidden = false; }
    this.overlays.hideTitle();
    this.hud.setVisible(true);
    this.hud.setRaceInfo(null);
    this.audio.init();
    this.audio.resume();
    this.audio.startEngine(this.vehicle!.physics.engine.idleRpm, this.vehicle!.physics.engine.redline);
    this.lapManager.reset();
    if (this.race) { this.race.dispose(); this.race = null; }
    if (def.kind === 'race') {
      this.totalLaps = def.laps ?? 1;
      this.raceSettings = { difficulty: def.difficulty ?? 'normal', totalLaps: this.totalLaps, playerVehicleId: this.profile.selectedId, rivalCount: def.rivals ?? 5 };
      this.race = new RaceManager(this.scene, this.track, this.raceSettings, this.controlSettings);
      this.race.spawnGrid(this.vehicle!, this.lapManager);
      this.hud.setRaceInfo({ position: this.race.cars.length, totalCars: this.race.cars.length, gapAhead: null });
    } else if (def.kind === 'accel' || def.kind === 'brake') {
      this.totalLaps = 0;
      const sm = this.track.samples[(def.spawnIdx ?? 10) % this.track.samples.length];
      const p = new THREE.Vector3(sm.position.x, 0, sm.position.z);
      p.y = this.track.query(p.x, p.z).groundY;
      const yaw = Math.atan2(sm.tangent.x, sm.tangent.z);
      this.vehicle!.reset(p, yaw);
      this.lapManager.setProgressDirect(this.track.query(p.x, p.z).progress);
    } else {
      this.totalLaps = def.kind === 'timetrial' ? 0 : (def.laps ?? 0);
      const sm = this.track.samples[2];
      const aim = this.track.samples[10];
      const startPos = sm.position.clone();
      startPos.y = this.track.query(startPos.x, startPos.z).groundY;
      const startYaw = Math.atan2(aim.tangent.x, aim.tangent.z);
      this.vehicle!.reset(startPos, startYaw);
      this.lapManager.setProgressDirect(this.track.query(startPos.x, startPos.z).progress);
    }
    this.countdownT = 3.0;
    this.state = 'countdown';
    this._showCountdown(3);
  }

  private _spawnVehicle(): void {
    const oc = this.profile.ownedCars.find((o) => o.id === this.profile.selectedId) ?? this.profile.ownedCars[0];
    const base = getVehicleById(oc.id)!;
    const tunedData: VehicleData = { ...base, physics: applyTuning(base.physics, oc.tuning) };
    if (this.vehicle) { this.vehicle.removeFromScene(this.scene); this.vehicle.dispose(); this.vehicle = null; }
    this.vehicle = new Vehicle(tunedData, oc.color);
    this.vehicle.addToScene(this.scene);
    this.vehicleHidden = false;
    this.controller = new VehicleController(this.controlSettings);
    this.spawnedKey = this._playerCarKey();
  }

  private _playerCarKey(): string {
    const oc = this.profile.ownedCars.find((o) => o.id === this.profile.selectedId) ?? this.profile.ownedCars[0];
    return `${oc.id}|${oc.color}|${JSON.stringify(oc.tuning)}`;
  }

  private _selectedCarName(): string {
    const oc = this.profile.ownedCars.find((o) => o.id === this.profile.selectedId) ?? this.profile.ownedCars[0];
    const v = oc ? getVehicleById(oc.id) : undefined;
    return v ? `${v.manufacturer} ${v.model}` : '不明';
  }

  private _restart(): void {
    this.overlays.hidePause();
    this.results.hide();
    this.playerFinished = false;
    this.finishWaitT = 0;
    this.loop.resume();
    if (this.mode === 'challenge' && this.activeChallenge) { this._startChallenge(this.activeChallenge); return; }
    if (!this.vehicle || this.spawnedKey !== this._playerCarKey()) this._spawnVehicle();
    if (this.vehicleHidden) { this.vehicle!.addToScene(this.scene); this.vehicleHidden = false; }
    if (this.race) { this.race.dispose(); this.race = new RaceManager(this.scene, this.track, this.raceSettings!, this.controlSettings); }
    if (this.vehicle) {
      if (this.mode === 'race' && this.race) {
        this.race.spawnGrid(this.vehicle!, this.lapManager);
        this.hud.setRaceInfo({ position: this.race.cars.length, totalCars: this.race.cars.length, gapAhead: null });
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
    this.activeChallenge = null;
    this.runner = null;
    this.mode = 'free';
    this.hud.setChallengePanel(null);
    this.chalPanelOn = false;
    this.overlays.updateProfile(this.profile.credits, this._selectedCarName(), this.profile.totalRaces, this.profile.wins, this._progressText());
    this.overlays.showTitle();
    this.hud.setVisible(false);
    this.hud.setRaceInfo(null);
    this.loop.resume();
  }

  private _openGarage(mode: ShowroomMode): void {
    if (this.state !== 'title') return;
    this.state = mode;
    this.overlays.hideTitle();
    this.hud.setVisible(false);
    this.hud.setRaceInfo(null);
    if (this.vehicle && !this.vehicleHidden) { this.vehicle.removeFromScene(this.scene); this.vehicleHidden = true; }
    this.camera.setMode('orbit');
    this.garage.setMode(mode);
    this.audio.playSfx('beep');
  }

  private _closeGarage(): void {
    this.garage.hide();
    if (this.showroom) { this.showroom.removeFromScene(this.scene); this.showroom.dispose(); this.showroom = null; this.showroomId = ''; this.showroomColor = ''; }
    if (this.vehicle && this.vehicleHidden) { this.vehicle.addToScene(this.scene); this.vehicleHidden = false; }
    this.camera.setMode('chase');
    this.state = 'title';
    SaveSystem.save(this.profile);
    this.overlays.updateProfile(this.profile.credits, this._selectedCarName(), this.profile.totalRaces, this.profile.wins, this._progressText());
    this.overlays.showTitle();
  }

  private _setShowroom(id: string, color: string): void {
    if (this.showroom && this.showroomId === id && this.showroomColor === color) return;
    if (this.showroom) { this.showroom.removeFromScene(this.scene); this.showroom.dispose(); this.showroom = null; }
    const data = getVehicleById(id);
    if (!data) return;
    this.showroom = new Vehicle(data, color);
    this.showroom.addToScene(this.scene);
    const p = this.track.startPos.clone();
    const yaw = Math.atan2(this.track.startDir.x, this.track.startDir.z);
    this.showroom.reset(p, yaw);
    this.showroomId = id;
    this.showroomColor = color;
  }

  private _makeGarageController(): GarageController {
    const game = this;
    return {
      getProfile: () => game.profile,
      purchase: (vehicleId: string) => {
        const v = getVehicleById(vehicleId);
        if (!v) return { ok: false, reason: '車両データが見つかりません' };
        if (game.profile.ownedCars.some((o) => o.id === vehicleId)) return { ok: false, reason: '既に所有しています' };
        if (game.profile.credits < v.price) return { ok: false, reason: 'クレジットが不足しています' };
        game.profile.credits -= v.price;
        game.profile.ownedCars.push({ id: vehicleId, color: v.defaultColor, favorite: false, tuning: {}, tuningSpent: 0 });
        SaveSystem.save(game.profile);
        game.audio.playSfx('lap');
        return { ok: true };
      },
      sellOwned: (index: number) => {
        const oc = game.profile.ownedCars[index];
        if (!oc) return { ok: false, reason: '車両が見つかりません' };
        if (game.profile.ownedCars.length <= 1) return { ok: false, reason: '最後の1台は売却できません' };
        const v = getVehicleById(oc.id);
        const value = Math.round(((v?.price ?? 0) + oc.tuningSpent) * 0.6);
        game.profile.credits += value;
        game.profile.ownedCars.splice(index, 1);
        if (game.profile.selectedId === oc.id) game.profile.selectedId = game.profile.ownedCars[0].id;
        SaveSystem.save(game.profile);
        return { ok: true, value };
      },
      setColor: (index: number, color: string) => { const oc = game.profile.ownedCars[index]; if (oc) oc.color = color; },
      toggleFavorite: (index: number) => { const oc = game.profile.ownedCars[index]; if (oc) oc.favorite = !oc.favorite; },
      selectOwned: (index: number) => { const oc = game.profile.ownedCars[index]; if (oc) game.profile.selectedId = oc.id; },
      buyTuning: (index: number, categoryId: string, stage: number) => {
        const oc = game.profile.ownedCars[index];
        const cat = TUNING_CATEGORIES.find((c) => c.id === categoryId);
        const part = cat?.parts.find((p) => p.stage === stage);
        if (!oc || !cat || !part) return { ok: false, reason: 'パーツ情報が不正です' };
        const cur = oc.tuning[categoryId] ?? 0;
        if (cur >= stage) return { ok: false, reason: '既に導入済みです' };
        if (stage !== cur + 1) return { ok: false, reason: '前段階から順に導入してください' };
        if (game.profile.credits < part.price) return { ok: false, reason: 'クレジットが不足しています' };
        game.profile.credits -= part.price;
        oc.tuning[categoryId] = stage;
        oc.tuningSpent += part.price;
        SaveSystem.save(game.profile);
        game.audio.playSfx('shift');
        return { ok: true };
      },
      preview: (id: string, color: string) => game._setShowroom(id, color),
      save: () => SaveSystem.save(game.profile),
      onBack: () => game._closeGarage()
    };
  }

  private _pause(): void { this.state = 'paused'; this.loop.pause(); this.audio.setPaused(true); this.overlays.showPause(); }
  private _resume(): void { this.overlays.hidePause(); this.state = 'running'; this.loop.resume(); this.audio.setPaused(false); }

  private _resetVehicle(): void {
    if (!this.vehicle) return;
    const q = this.track.query(this.vehicle.physics.pos.x, this.vehicle.physics.pos.z);
    const sm = this.track.samples[q.nearestIndex];
    const next = this.track.samples[(q.nearestIndex + 2) % this.track.samples.length];
    const yaw = Math.atan2(next.tangent.x, next.tangent.z);
    const p = new THREE.Vector3(sm.position.x, sm.position.y, sm.position.z);
    this.vehicle.reset(p, yaw);
    this.lapManager.setProgressDirect(this.track.query(p.x, p.z).progress);
  }

  private _stepPhysics(dt: number): void {
    if (this.state !== 'countdown' && this.state !== 'running') return;
    if (!this.vehicle || !this.controller) return;
    this.input.poll();
    const raw = this.input.getRawInput();
    if (this.state === 'countdown') {
      raw.throttleKey = false; raw.throttleAnalog = null;
      raw.brakeKey = true; raw.brakeAnalog = 1;
      const prev = this.countdownT;
      this.countdownT -= dt;
      if (Math.ceil(prev) !== Math.ceil(this.countdownT) && this.countdownT > 0) this._showCountdown(Math.ceil(this.countdownT));
      if (this.countdownT <= 0) {
        this.state = 'running';
        if (this.mode === 'challenge' && this.runner) {
          const qg = this.track.query(this.vehicle!.physics.pos.x, this.vehicle!.physics.pos.z);
          this.runner.begin(qg.progress);
          this.lapManager.currentLapTime = 0;
          this.lapManager.sectorStartTime = 0;
        }
        this.hud.showCenter('GO!', 1000);
        this.audio.playSfx('start');
      }
    }
    if (this.input.getGamepadCameraButtonEdge()) this.camera.cycleMode();
    if (this.playerFinished) {
      raw.throttleKey = false; raw.throttleAnalog = 0;
      raw.brakeKey = true; raw.brakeAnalog = 0.42;
      raw.steerKey = 0; raw.steerAnalog = 0;
      raw.handbrakeKey = false;
    }
    const controls: VehicleControls = this.controller.compute(dt, raw);
    this.prevControls = controls;
    const q: TrackQueryResult = this.track.query(this.vehicle.physics.pos.x, this.vehicle.physics.pos.z);
    const res = this.vehicle.updatePhysics(dt, controls, q);
    if (res.collided && res.impact > 4) { this.audio.playSfx('collision'); this.camera.addShake(Math.min(0.5, res.impact * 0.03)); this.bus.emit({ type: 'collision', impactSpeed: res.impact }); }
    if (controls.shiftUp || controls.shiftDown) this.audio.playSfx('shift');
    if (this.vehicle.physics.limiter) this.audio.playSfx('limiter');
    const lapRes = this.lapManager.update(dt, q.progress);
    if (lapRes.lapCompleted && lapRes.lapTime !== null) {
      this.audio.playSfx(lapRes.isBest ? 'lap' : 'beep');
      this.hud.showCenter(lapRes.isBest ? 'BEST LAP!' : `LAP ${this.lapManager.currentLap - 1}`, 1500);
      this.bus.emit({ type: 'lapComplete', lap: this.lapManager.currentLap - 1, lapTime: lapRes.lapTime, best: lapRes.isBest });
    }
    if (this.race) {
      if (this.state === 'countdown') { this.race.stepCountdown(dt); }
      else {
        const ev = this.race.step(dt);
        if (ev.playerFinished && !this.playerFinished) {
          this.playerFinished = true;
          const pos = this.race.playerCar?.position ?? 1;
          this.hud.showCenter(pos === 1 ? 'FINISH — P1!' : `FINISH — P${pos}`, 2600);
          this.audio.playSfx('finish');
        }
        if (this.playerFinished && this.mode === 'race') {
          this.finishWaitT += dt;
          if (this.race.allFinished() || this.finishWaitT > 45) this._showResults();
        }
      }
    }
    const st = this.vehicle.getState();
    let maxSlip = 0;
    for (const sp of st.wheelSlip) maxSlip = Math.max(maxSlip, Math.abs(sp));
    this.audio.updateEngine(st.rpm, controls.throttle, st.speed, maxSlip);
    if (this.mode === 'challenge' && this.runner && this.state === 'running') {
      const ev = this.runner.step({ dt, state: st, query: q, lap: this.lapManager, lapResult: lapRes, collided: res.collided, race: this.race, playerFinished: this.playerFinished, vLong: this.vehicle.physics.vLong, vLat: this.vehicle.physics.vLat });
      if (ev.lap) this._onTrialLap(ev);
      if (ev.finished) this._challengeFinished(ev);
    }
    this.input.endFrame();
  }

  private _showResults(): void {
    if (!this.race || this.state === 'finished') return;
    this.state = 'finished';
    this.race.updateStandings();
    const rows = this.race.results();
    const playerPos = this.race.playerCar?.position ?? 1;
    const amount = computeRaceReward(playerPos, this.race.settings.totalLaps, this.race.settings.difficulty);
    this.profile.credits += amount;
    this.profile.totalRaces++;
    if (playerPos === 1) this.profile.wins++;
    SaveSystem.save(this.profile);
    const reward = { amount, balance: this.profile.credits };
    this.results.show(rows, playerPos, this.race.settings.totalLaps, this.race.time, reward);
    this.hud.setRaceInfo(null);
  }

  private _openChallengeCenter(tab: ChallengeTab): void {
    if (this.state !== 'title') return;
    this.state = 'challengeCenter';
    this.overlays.hideTitle();
    this.challengeCenter.show(tab);
    this.audio.playSfx('beep');
  }

  private _closeChallengeCenter(): void {
    this.challengeCenter.hide();
    this.state = 'title';
    SaveSystem.save(this.profile);
    this.overlays.updateProfile(this.profile.credits, this._selectedCarName(), this.profile.totalRaces, this.profile.wins, this._progressText());
    this.overlays.showTitle();
  }

  private _progressText(): string {
    let lic = 0;
    for (const d of LICENSES) if ((this.profile.licenses[d.id]?.medal ?? 0) >= 1) lic++;
    let mis = 0;
    for (const d of MISSIONS) if (this.profile.missions[d.id]?.done) mis++;
    return `LIC ${lic}/${LICENSES.length} · MIS ${mis}/${MISSIONS.length}`;
  }

  private _onTrialLap(ev: ChallengeEvent): void {
    const def = this.activeChallenge!;
    const lapInfo = ev.lap!;
    const r = applyChallengeResult(this.profile, def, lapInfo.time, lapInfo.medal);
    if (lapInfo.medal >= 1 && r.newMedal) {
      this.hud.showCenter(`${['', 'BRONZE', 'SILVER', 'GOLD'][lapInfo.medal]} TIME  ${lapInfo.time.toFixed(2)}s`, 2600);
      this.audio.playSfx('finish');
    } else if (r.newBest) {
      this.hud.showCenter(`NEW RECORD  ${lapInfo.time.toFixed(2)}s`, 2000);
      this.audio.playSfx('lap');
    }
  }

  private _challengeFinished(ev: ChallengeEvent): void {
    const def = this.activeChallenge!;
    this.state = 'finished';
    this.hud.setRaceInfo(null);
    const value = ev.value;
    const runCompleted = ev.pass;
    let medal = 0;
    if (runCompleted && value !== null) medal = medalFor(def, value);
    const goalMet = value !== null && (def.goalDir === 'less' ? value <= (def.goal ?? Number.POSITIVE_INFINITY) : value >= (def.goal ?? 0));
    const passed = def.category === 'mission' ? runCompleted && goalMet : medal >= 1;
    let reward: { amount: number; balance: number } | null = null;
    let message: string | undefined;
    let best: number | null = null;
    if (def.category === 'mission') {
      const r = applyMissionResult(this.profile, def, value, passed);
      reward = r.granted > 0 ? { amount: r.granted, balance: this.profile.credits } : null;
      if (r.firstClear) message = 'FIRST CLEAR!';
      medal = passed ? 1 : 0;
      best = this.profile.missions[def.id]?.best ?? null;
    } else {
      const v = value === null ? (def.goalDir === 'less' ? Number.POSITIVE_INFINITY : 0) : value;
      const r = applyChallengeResult(this.profile, def, v, medal);
      reward = r.granted > 0 ? { amount: r.granted, balance: this.profile.credits } : null;
      if (r.newBest) message = 'NEW RECORD!';
      if (def.id === 'trial_tt') best = this.profile.records.bestLap;
      else if (def.id === 'trial_drift') best = this.profile.records.driftBest || null;
      else best = this.profile.licenses[def.id]?.best ?? null;
    }
    const valueLabel = value === null ? (ev.reason ?? '') : this._challengeValueLabel(def, value);
    const medalTargets: Array<{ label: string; value: string; achieved: boolean }> = [];
    if (def.medals) {
      const names = ['BRONZE', 'SILVER', 'GOLD'];
      for (let i = 0; i < 3; i++) medalTargets.push({ label: names[i], value: this._fmtChallengeVal(def, def.medals[i]), achieved: medal >= i + 1 });
    } else {
      medalTargets.push({ label: 'GOAL', value: def.goal !== undefined ? this._fmtChallengeVal(def, def.goal) : '—', achieved: passed });
    }
    this.results.showChallenge({ code: def.code, title: def.title, pass: passed, medal, valueLabel, reason: ev.reason, medalTargets, reward, bestLabel: best !== null ? `BEST ${this._fmtChallengeVal(def, best)}` : undefined, message });
    this.audio.playSfx(passed ? 'finish' : 'beep');
  }

  private _challengeValueLabel(def: ChallengeDef, value: number): string {
    switch (def.kind) {
      case 'accel': return `0-100 km/h  ${value.toFixed(2)}s`;
      case 'brake': return `STOP  ${value.toFixed(1)}m before line`;
      case 'race': return `WIN MARGIN  +${value.toFixed(2)}s`;
      case 'topspeed': return `TOP SPEED  ${value.toFixed(0)} km/h`;
      case 'drift': return `SCORE  ${Math.round(value).toLocaleString('en-US')} PTS`;
      default: return `TIME  ${value.toFixed(2)}s`;
    }
  }

  private _fmtChallengeVal(def: ChallengeDef, v: number): string {
    return def.unit === 's' ? `${v.toFixed(v < 100 ? 2 : 1)}s` : `${Math.round(v).toLocaleString('en-US')} ${def.unit}`;
  }

  private _render(_alpha: number, _frameDt: number): void {
    if (this.state === 'garage' || this.state === 'dealer' || this.state === 'tuning') {
      if (this.showroom) {
        const p = this.track.startPos;
        this.renderState.position.set(p.x, this.showroom.physics.bodyY, p.z);
        this.renderState.speed = 0; this.renderState.yawRate = 0; this.renderState.lateralG = 0; this.renderState.roll = 0;
        this.camera.setTarget(this.renderState);
        this.camera.update(_frameDt || 1 / 60, this.renderState);
        this.showroom.syncMesh(_frameDt || 1 / 60);
        this.lighting.followTarget(this.renderState.position);
      }
      this.renderer.render(this.scene, this.camera.camera);
      return;
    }
    if (!this.vehicle) {
      const t = performance.now() * 0.0001;
      this.camera.camera.position.set(Math.cos(t) * 200, 80, Math.sin(t) * 200);
      this.camera.camera.lookAt(0, 0, 0);
    } else {
      const st = this.vehicle.getState();
      this.renderState.position.set(st.position.x, this.vehicle.physics.bodyY, st.position.z);
      this.renderState.yaw = st.yaw; this.renderState.speed = st.speed; this.renderState.yawRate = st.yawRate; this.renderState.lateralG = st.gLat; this.renderState.roll = st.roll;
      this.camera.setTarget(this.renderState);
      this.camera.update(_frameDt || 1 / 60, this.renderState);
      this.vehicle.syncMesh(_frameDt || 1 / 60);
      this.lighting.followTarget(this.renderState.position);
      const markers: MiniMapMarker[] = [];
      if (this.race) {
        for (const car of this.race.cars) {
          if (!car.isPlayer) {
            car.vehicle.syncMesh(_frameDt || 1 / 60);
            markers.push({ x: car.vehicle.physics.pos.x, z: car.vehicle.physics.pos.z, yaw: car.vehicle.physics.yaw, color: car.vehicle.color, isPlayer: false });
          }
        }
        this.hud.setMarkers(markers);
        this.standingsTimer -= (_frameDt || 0);
        if (this.standingsTimer <= 0) {
          this.standingsTimer = 0.25;
          if (this.state === 'running' && !this.playerFinished) {
            const pc = this.race.playerCar;
            if (pc) {
              let gapAhead: number | null = null;
              if (pc.position > 1) { const ahead = this.race.cars.find((c) => c.position === pc.position - 1); if (ahead) gapAhead = this.race.gapSecondsTo(pc, ahead); }
              const info: RaceHUDRaceInfo = { position: pc.position, totalCars: this.race.cars.length, gapAhead };
              this.hud.setRaceInfo(info);
            }
          } else { this.hud.setRaceInfo(null); }
        }
      }
      this.chalHudT -= (_frameDt || 0);
      if (this.chalHudT <= 0) {
        this.chalHudT = 0.1;
        if (this.mode === 'challenge' && this.runner && (this.state === 'countdown' || this.state === 'running' || this.state === 'finished')) {
          this.hud.setChallengePanel(this.runner.getHUD());
          this.chalPanelOn = true;
        } else if (this.chalPanelOn) { this.hud.setChallengePanel(null); this.chalPanelOn = false; }
      }
      this.hud.update(st, this.lapManager.currentLap, this.totalLaps, this.lapManager.currentLapTime, this.lapManager.bestLapTime, this.lapManager.lastLapTime, this.track, this.loop.fps, this.loop.physicsMs);
    }
    this.renderer.render(this.scene, this.camera.camera);
  }

  private _showCountdown(n: number): void {
    this.hud.showCenter(n > 0 ? n.toString() : 'GO!', 800);
    this.audio.playSfx('beep');
  }
}

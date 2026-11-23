/**
 * race/RaceManager.ts
 * 計画書 Phase 2: レース運営（AI対戦車込み）。
 *
 * - グリッドフォーメーション: スタートライン後方に前後7m間隔・左右千鳥で6台配置。
 *   プレイヤーは最後尾（P6）スタート。
 * - 順位: 進行スコア（スタートライン通過回数×コース長＋進行度）でリアルタイム算出。
 * - フィニッシュ: 規定周回数完了（セクター検証済みラップ）で確定。全車フィニッシュ or
 *   プレイヤーフィニッシュ後45秒でレース終了。
 * - AI物理はプレイヤーと同一の VehiclePhysics を同一タイムステップで更新（フェア）。
 * - 車同士の衝突物理は Phase 2 未実装（回避ステアのみ。次フェーズ候補）。
 */
import * as THREE from 'three';
import { Vehicle } from '../vehicle/Vehicle';
import { VehicleController, type ControlSettings, type RawInput } from '../vehicle/VehicleController';
import { AIDriver, type AIDifficulty, type AICarInfo } from './AIDriver';
import { LapManager } from './LapManager';
import { RIVAL_VEHICLES, getVehicleById, type VehicleData } from '../vehicle/VehicleData';
import type { TrackData } from '../tracks/TrackData';
import type { VehicleControls } from '../physics/VehiclePhysics';

export interface RaceSettings {
  difficulty: AIDifficulty;
  totalLaps: number;
  playerVehicleId: string;
  /** Phase 4: AI台数（デュエル用。既定 5 = Phase 2 と同一挙動） */
  rivalCount?: number;
}

export interface RivalEntrySpec {
  data: VehicleData;
  color: string;
  name: string;
  laneOffset: number;
  paceJitter: number;
}

/** AI5台の固定編成（架空ドライバー名・全員架空） */
const RIVAL_ROSTER: Array<{ vehicleId: string; colorIndex: number; name: string; laneOffset: number; paceJitter: number }> = [
  { vehicleId: 'vectra_sr', colorIndex: 0, name: 'K. VOSS',      laneOffset: -2.2, paceJitter: 0.028 },
  { vehicleId: 'kessel_gt', colorIndex: 0, name: 'M. HALVORSEN', laneOffset: 2.0, paceJitter: -0.022 },
  { vehicleId: 'noir_rz',   colorIndex: 1, name: 'R. TAKANASHI', laneOffset: -1.2, paceJitter: 0.012 },
  { vehicleId: 'vectra_sr', colorIndex: 1, name: 'J. LINDQVIST', laneOffset: 1.4, paceJitter: -0.014 },
  { vehicleId: 'kessel_gt', colorIndex: 1, name: 'S. BEAUMONT', laneOffset: -2.6, paceJitter: 0.006 }
];

export class RaceCar {
  public isPlayer: boolean;
  public name: string;
  public vehicle: Vehicle;
  public ai: AIDriver | null = null;
  public lap: LapManager;
  public gridPos: number;
  public finished = false;
  public finishTime: number | null = null;
  public position = 1;
  public progressScore = 0;
  public lastLapsCompleted = 0;
  constructor(isPlayer: boolean, name: string, vehicle: Vehicle, lap: LapManager, gridPos: number) {
    this.isPlayer = isPlayer; this.name = name; this.vehicle = vehicle; this.lap = lap; this.gridPos = gridPos;
  }
}

export class RaceManager {
  public cars: RaceCar[] = [];
  public playerCar: RaceCar | null = null;
  public time = 0;
  public finishedRace = false;
  /** プレイヤーフィニッシュ後の残り待機タイマー（全車フィニッシュ or タイムアウト） */
  public finishWaitT = 0;
  public playerFinishWaitActive = false;

  private scene: THREE.Scene;
  private track: TrackData;
  public settings: RaceSettings;
  private controlSettings: ControlSettings;

  constructor(scene: THREE.Scene, track: TrackData, settings: RaceSettings, controlSettings: ControlSettings) {
    this.scene = scene;
    this.track = track;
    this.settings = settings;
    this.controlSettings = controlSettings;
  }

  /** グリッド生成（プレイヤー車とそのLapManagerは Game 側のものを共用）
   *  Phase 4: rivalCount で AI 台数を可変（1=デュエル、5=従来の6台グリッド）。
   *  プレイヤーは常に最後尾グリッド。 */
  spawnGrid(playerVehicle: Vehicle, playerLap: LapManager): RaceCar[] {
    const N = this.track.samples.length;
    const segLen = this.track.totalLength / N;
    const rivalCount = Math.max(0, Math.min(5, this.settings.rivalCount ?? 5));

    // グリッドスロット: i=0が先頭。スタートラインから後方 d = 12 + i*7 m。
    // プレイヤーは最後尾（i=rivalCount）。
    const place = (i: number, lat: number): { pos: THREE.Vector3; yaw: number; progress: number } => {
      const d = 12 + i * 7;
      const distFromStart = this.track.totalLength - d; // ラップ進行で言う 0 から -d
      const idx = Math.floor((distFromStart / segLen)) % N;
      const sm = this.track.samples[idx];
      const p = new THREE.Vector3(sm.position.x + sm.normal.x * lat, 0, sm.position.z + sm.normal.z * lat);
      p.y = this.track.query(p.x, p.z).groundY;
      const yaw = Math.atan2(sm.tangent.x, sm.tangent.z);
      const progress = this.track.query(p.x, p.z).progress;
      return { pos: p, yaw, progress };
    };

    // プレイヤー（最後尾グリッド）
    const playerSlot = place(rivalCount, 1.8);
    playerVehicle.reset(playerSlot.pos, playerSlot.yaw);
    playerLap.reset();
    playerLap.totalLaps = this.settings.totalLaps;
    playerLap.setProgressDirect(playerSlot.progress);
    // ライン後方startは負の進行度で初期化（グリッド順位を正しく表現）
    playerLap.totalProgress = (playerSlot.progress / this.track.totalLength - 1) * this.track.totalLength;
    this.playerCar = new RaceCar(true, 'YOU', playerVehicle, playerLap, rivalCount + 1);
    this.playerCar.progressScore = playerLap.totalProgress;
    this.cars.push(this.playerCar);

    // AI（先頭グリッド）
    RIVAL_ROSTER.slice(0, rivalCount).forEach((r, i) => {
      const data = RIVAL_VEHICLES.find((v) => v.id === r.vehicleId) ?? getVehicleById('aurora_rs2')!;
      const color = data.colors[r.colorIndex % data.colors.length];
      const vehicle = new Vehicle(data, color);
      vehicle.addToScene(this.scene);
      const slot = place(i, (i % 2 === 0 ? -1 : 1) * 2.4);
      vehicle.reset(slot.pos, slot.yaw);
      const lap = new LapManager(this.track, this.settings.totalLaps);
      lap.setProgressDirect(slot.progress);
      lap.totalProgress = (slot.progress / this.track.totalLength - 1) * this.track.totalLength;
      const car = new RaceCar(false, r.name, vehicle, lap, i + 1);
      car.progressScore = lap.totalProgress;
      car.ai = new AIDriver(vehicle, new VehicleController(this.controlSettings), this.track, {
        difficulty: this.settings.difficulty,
        laneOffset: r.laneOffset,
        paceJitter: r.paceJitter
      });
      this.cars.push(car);
    });

    return this.cars;
  }

  /** カウントダウン中: AIをグリッドに保持（ラップ計時計はプレイヤーと同様に進める） */
  stepCountdown(dt: number): void {
    for (const car of this.cars) {
      if (car.isPlayer) continue;
      const ai = car.ai;
      if (!ai) continue;
      const q = this.track.query(car.vehicle.physics.pos.x, car.vehicle.physics.pos.z);
      const raw: RawInput = ai.gridHold();
      const ctrl = ai.controller.compute(dt, raw);
      car.vehicle.updatePhysics(dt, ctrl, q);
      car.lap.update(dt, q.progress);
      car.lap.accumulateProgress(q.progress);
      car.progressScore = car.lap.totalProgress;
    }
  }

  /**
   * レース物理ステップ（AIのみ。プレイヤーは Game 側で物理・ラップ更新済みの前提）。
   * @returns イベント情報
   */
  step(dt: number): { anyLapCompleted: boolean; playerFinished: boolean } {
    this.time += dt;
    let anyLapCompleted = false;

    // 進行情報をまとめる（回避用・前ステップ値）
    const infos: AICarInfo[] = this.cars.map((c) => ({
      progressScore: c.progressScore,
      x: c.vehicle.physics.pos.x,
      z: c.vehicle.physics.pos.z
    }));
    const playerScore = this.playerCar?.progressScore ?? 0;

    for (let ci = 0; ci < this.cars.length; ci++) {
      const car = this.cars[ci];
      if (car.isPlayer) continue; // プレイヤー物理・ラップは Game._stepPhysics で更新済み
      const v = car.vehicle.physics;
      const q = this.track.query(v.pos.x, v.pos.z);
      const ai = car.ai!;

      let raw: RawInput;
      if (car.finished) {
        raw = ai.coolDown();
      } else if (ai.consumeRecoveryRequest()) {
        // 復帰: 最寄りサンプルの少し先へ
        const sm = this.track.samples[q.nearestIndex];
        const next = this.track.samples[(q.nearestIndex + 2) % this.track.samples.length];
        const yaw = Math.atan2(next.tangent.x, next.tangent.z);
        v.reset(new THREE.Vector3(sm.position.x, sm.position.y, sm.position.z), yaw);
        car.lap.setProgressDirect(this.track.query(sm.position.x, sm.position.z).progress);
        raw = ai.compute(dt, q, this.time, car.progressScore, playerScore, infos);
      } else {
        raw = ai.compute(dt, q, this.time, car.progressScore, playerScore, infos);
      }
      const ctrl: VehicleControls = ai.controller.compute(dt, raw);
      car.vehicle.updatePhysics(dt, ctrl, q);

      // AIラップ進行
      const lapRes = car.lap.update(dt, q.progress);
      if (lapRes.lapCompleted) {
        car.lastLapsCompleted = car.lap.lapsCompleted;
        ai.onLap();
        anyLapCompleted = true;
      }
    }

    // 進行スコア（totalProgress: 折返しゴースト防止済み）・フィニッシュ判定
    // ※全車の現位置を再クエリして累積する（プレイヤーも含む。更新前のクエリ位置を
    //   使うとデルタが常に0になり順位が更新されないバグがあった）
    for (const car of this.cars) {
      const q = this.track.query(car.vehicle.physics.pos.x, car.vehicle.physics.pos.z);
      car.lap.accumulateProgress(q.progress);
      car.progressScore = car.lap.totalProgress;
      if (!car.finished && car.lap.lapsCompleted >= this.settings.totalLaps) {
        car.finished = true;
        car.finishTime = this.time;
      }
    }
    this.updateStandings();

    const playerFinished = !!(this.playerCar && this.playerCar.finished && !this.playerFinishWaitActive);
    return { anyLapCompleted, playerFinished };
  }

  /** 順位表更新（finished優先→進行スコア降順） */
  updateStandings(): void {
    const sorted = [...this.cars].sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? 0) - (b.finishTime ?? 0);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progressScore - a.progressScore;
    });
    sorted.forEach((c, i) => { c.position = i + 1; });
  }

  /** 前車とのタイムギャップ概算（秒） */
  gapSecondsTo(car: RaceCar, other: RaceCar): number {
    const dScore = other.progressScore - car.progressScore;
    const v = Math.max(4, Math.hypot(car.vehicle.physics.vLong, car.vehicle.physics.vLat));
    return dScore / v;
  }

  /** 全車フィニッシュ or 待機タイムアウト */
  allFinished(): boolean {
    return this.cars.every((c) => c.finished);
  }

  /** リザルト用の確定データ */
  results(): Array<{ pos: number; name: string; vehicle: string; isPlayer: boolean; time: number | null; gap: number | null; bestLap: number | null; finished: boolean }> {
    const sorted = [...this.cars].sort((a, b) => a.position - b.position);
    const winnerTime = sorted[0]?.finishTime ?? null;
    return sorted.map((c) => ({
      pos: c.position,
      name: c.name,
      vehicle: `${c.vehicle.data.manufacturer} ${c.vehicle.data.model}`,
      isPlayer: c.isPlayer,
      time: c.finishTime,
      gap: c.finishTime !== null && winnerTime !== null ? c.finishTime - winnerTime : null,
      bestLap: c.lap.bestLapTime,
      finished: c.finished
    }));
  }

  /** レース終了後処理（車両シーン除外・破棄） */
  dispose(): void {
    for (const car of this.cars) {
      if (!car.isPlayer) {
        car.vehicle.removeFromScene(this.scene);
        car.vehicle.dispose();
      }
    }
    this.cars = [];
    this.playerCar = null;
  }
}

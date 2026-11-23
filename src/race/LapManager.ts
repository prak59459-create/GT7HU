/**
 * race/LapManager.ts
 * 計画書 §9.1: 周回数・ラップタイム・ベストラップ・セクター通過バリデーション。
 *  - 進行度（トラック累積距離）のラップアリ検知で不正周回を除外
 *  - 3セクター通過を必須化（周回完了の妥当性保証）
 */
import type { TrackData } from '../tracks/TrackData';

export class LapManager {
  public totalLaps: number;
  public currentLap = 1;
  public lapsCompleted = 0;
  /** スタートライン通過回数（グリッドスタート時の順位計算用。セクター検証とは無関係） */
  public crossings = 0;
  /** 進行度の連続累積（m。ラップ判定とは独立、順位計算用。折返しは相殺される） */
  public totalProgress = 0;
  public currentLapTime = 0;
  public bestLapTime: number | null = null;
  public lastLapTime: number | null = null;
  public lapTimes: number[] = [];
  public sectorTimes: number[] = [];

  private progressPrev = 0;
  private sectorFlags = [false, false, false];
  /** セクター計測の基準時刻（Game がチャレンジ計測開始時にリセットするため公開） */
  public sectorStartTime = 0;
  private sectorFractions: number[];
  private trackLength: number;

  constructor(track: TrackData, totalLaps = 0) {
    this.totalLaps = totalLaps;
    this.sectorFractions = [0.33, 0.66, 1.0];
    this.trackLength = track.totalLength;
  }

  reset(): void {
    this.currentLap = 1; this.lapsCompleted = 0; this.crossings = 0; this.totalProgress = 0;
    this.currentLapTime = 0; this.bestLapTime = null; this.lastLapTime = null;
    this.lapTimes = []; this.sectorTimes = [];
    this.progressPrev = 0; this.sectorFlags = [false, false, false];
  }

  /**
   * 毎フレーム更新。progress = 累積距離（0..trackLength）。戻り値: ラップ完了情報
   */
  update(dt: number, progress: number): { lapCompleted: boolean; lapTime: number | null; isBest: boolean; sectorIndex: number; sectorTime: number | null } {
    this.currentLapTime += dt;
    let lapCompleted = false;
    let lapTime: number | null = null;
    let isBest = false;
    let sectorIndex = -1;
    let sectorTime: number | null = null;

    // セクター通過判定
    const ratio = progress / this.trackLength;
    for (let i = 0; i < 3; i++) {
      if (!this.sectorFlags[i] && ratio >= this.sectorFractions[i] && this.progressPrev < this.sectorFractions[i]) {
        // セクター跨ぎ通過（進行方向のみ）
        // 直前進捗 < 境界 <= 現進捗
      }
      if (!this.sectorFlags[i] && ratio >= this.sectorFractions[i] * 0.97 && ratio <= this.sectorFractions[i] * 1.03 && this.progressPrev > 0) {
        this.sectorFlags[i] = true;
        sectorIndex = i;
        sectorTime = this.currentLapTime - this.sectorStartTime;
        this.sectorStartTime = this.currentLapTime;
      }
    }

    // ラップ完了判定：進行度が 0.9→0.1 のように折り返した（スタートライン通過）
    if (this.progressPrev > 0.85 && ratio < 0.15) {
      this.crossings++;
      if (this.sectorFlags.every((f) => f)) {
        lapTime = this.currentLapTime;
        this.lapTimes.push(lapTime);
        this.lastLapTime = lapTime;
        if (this.bestLapTime === null || lapTime < this.bestLapTime) {
          this.bestLapTime = lapTime;
          isBest = true;
        }
        this.lapsCompleted++;
        this.currentLap++;
        this.currentLapTime = 0;
        this.sectorFlags = [false, false, false];
        this.sectorStartTime = 0;
        lapCompleted = true;
      }
    }

    this.progressPrev = ratio;
    return { lapCompleted, lapTime, isBest, sectorIndex, sectorTime };
  }

  /** 毎フレームの進行変化を加算（呼び出し側: update の後に呼ぶ）。折返し補正済み */
  accumulateProgress(progress: number): void {
    let d = progress - this.progressPrev * this.trackLength;
    if (d > this.trackLength / 2) d -= this.trackLength;
    else if (d < -this.trackLength / 2) d += this.trackLength;
    this.totalProgress += d;
  }

  setProgressDirect(progress: number): void {
    this.progressPrev = progress / this.trackLength;
  }
}

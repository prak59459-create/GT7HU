/**
 * core/EventBus.ts
 * ゲーム内システム間の疎結合通知。Phase 1 ではラップ完了・衝突・状態遷移に使用。
 */
export type GameEvent =
  | { type: 'lapComplete'; lap: number; lapTime: number; best: boolean }
  | { type: 'sectorComplete'; sector: number; sectorTime: number }
  | { type: 'collision'; impactSpeed: number }
  | { type: 'stateChanged'; from: string; to: string }
  | { type: 'raceFinished'; laps: number }
  | { type: 'countdown'; value: number }
  | { type: 'settingsChanged' };

type Handler = (e: GameEvent) => void;

export class EventBus {
  private handlers: Handler[] = [];

  on(h: Handler): void {
    this.handlers.push(h);
  }

  emit(e: GameEvent): void {
    for (const h of this.handlers) h(e);
  }
}

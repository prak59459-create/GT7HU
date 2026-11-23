/**
 * main.ts - エントリポイント
 * 計画書 §1.2/§2.1 に従い Vite + TypeScript + Three.js で起動。
 */
import { Game } from './core/Game';

const container = document.getElementById('app')!;

window.addEventListener('error', (e) => {
  console.error('[Game] Runtime error:', e.message, e.error?.stack);
});

const game = new Game(container);
game.start();
(window as any).game = game; // 開発/テスト用公開
console.log('[Project Racing Simulator] Phase 2 initialized (race mode + AI rivals).');

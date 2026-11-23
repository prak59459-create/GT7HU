import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// シングルファイルビルド: dist/index.html 1ファイルに JS/CSS を完全インライン化。
// file:// プロトコル（ダブルクリック起動）で動作するため、動的 import / Web Worker / WASM を使わない。
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});

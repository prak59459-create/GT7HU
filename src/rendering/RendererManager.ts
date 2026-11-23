/**
 * rendering/RendererManager.ts
 * Three.js レンダラの生成・品質設定・リサイズ管理。
 * 計画書 §2.2: PBR / トーンマッピング / アンチエイリアス。
 * WebGPU は将来フェーズで判定切り替え（Phase 1 は WebGL2 固定で安定動作）。
 */
import * as THREE from 'three';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export class RendererManager {
  public renderer: THREE.WebGLRenderer;
  public canvas: HTMLCanvasElement;

  constructor(container: HTMLElement, quality: QualityLevel = 'high') {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false
    });

    const dprCap = quality === 'ultra' ? 2 : quality === 'high' ? 1.75 : quality === 'medium' ? 1.25 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = quality === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

    window.addEventListener('resize', () => this._onResize());
  }

  private _onResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  get info(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}

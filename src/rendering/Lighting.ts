/**
 * rendering/Lighting.ts
 * 太陽光（キー）＋半球光（フィル）＋PMREM環境マップ（PBR反射用）。
 * 環境マップは three/examples に依存せず、プロシージャルなスタジオシーンから生成する。
 * 計画書 §2.2: HDR環境光 / 車体反射 / 動的シャドウ。
 */
import * as THREE from 'three';

export class Lighting {
  public group: THREE.Group;
  public sun: THREE.DirectionalLight;
  public hemi: THREE.HemisphereLight;
  public ambient: THREE.AmbientLight;
  public envMap: THREE.Texture | null = null;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // 半球光：空（上）と地面（下）の色補間
    this.hemi = new THREE.HemisphereLight(0x9bb8e0, 0x4a4030, 0.55);
    this.group.add(this.hemi);

    // 太陽光（指向性 + シャドウ）
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
    this.sun.position.set(120, 180, 80);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 600;
    const s = 80;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    // 環境光（微弱、影の黒潰れ防止）
    this.ambient = new THREE.AmbientLight(0x303840, 0.25);
    this.group.add(this.ambient);

    // プロシージャル環境マップ（クリアコート反射用）
    this._buildEnvironmentMap(renderer);
    scene.environment = this.envMap;
  }

  /** シャドウカメラを車両周辺に追従させる（高解像度シャドウを車体周辺に集中） */
  followTarget(pos: THREE.Vector3): void {
    this.sun.position.set(pos.x + 120, 180, pos.z + 80);
    this.sun.target.position.copy(pos);
  }

  private _buildEnvironmentMap(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    // スタジオライティング風の小シーン
    const studio = new THREE.Scene();
    // グラデーション空（球の内側）
    const skyGeo = new THREE.SphereGeometry(50, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: false,
      side: THREE.BackSide,
      fog: false
    });
    // 頂点カラーで上下グラデーション
    const colors: number[] = [];
    const top = new THREE.Color(0x88aacc);
    const bottom = new THREE.Color(0x202830);
    const posAttr = skyGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const t = (y / 50 + 1) * 0.5;
      const c = bottom.clone().lerp(top, t);
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    skyMat.vertexColors = true;
    studio.add(new THREE.Mesh(skyGeo, skyMat));

    // ライトカード（反射源となる明るい面）
    const cardMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const cardPositions: Array<[number, number, number, number, number, number]> = [
      [40, 30, 0, 30, 20, 0],
      [-40, 30, 0, 30, 20, 0],
      [0, 40, 40, 30, 20, 0],
      [0, 40, -40, 30, 20, 0]
    ];
    for (const [x, y, z, w, h] of cardPositions) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cardMat);
      card.position.set(x, y, z);
      card.lookAt(0, 0, 0);
      studio.add(card);
    }
    // 床（暗めの反射）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshBasicMaterial({ color: 0x303035, fog: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -10;
    studio.add(floor);

    const rt = pmrem.fromScene(studio, 0.04);
    this.envMap = rt.texture;
    pmrem.dispose();
    // スタジオのメモリ解放
    studio.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry?.dispose();
        (o.material as THREE.Material)?.dispose();
      }
    });
  }
}

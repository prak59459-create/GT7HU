/**
 * physics/TireModel.ts
 * 計画書 §5.4: Brush Model または Pacejka 系。Phase 1 は Pacejka "Magic Formula" 簡易実装。
 * - スリップ率 sx（縦）、スリップ角 α（横）を入力
 * - 縦・横それぞれの力を計算し、複合摩擦円でクランプ
 * - 接地荷重 Fz と摩擦係数 mu でスケール、負荷依存（マイナー）を考慮
 */
export interface TireParams {
  // 縦方向 Magic Formula
  Bx: number; Cx: number; Dx: number; Ex: number;
  // 横方向 Magic Formula
  By: number; Cy: number; Dy: number; Ey: number;
  // 摩擦円の形状（1.0=円、>1=縦方向に強い）
  combinedShape: number;
  // 負荷依存（mu の Fz 依存）
  loadSensitivity: number;
  referenceLoad: number;
}

export interface TireForce {
  fx: number;  // 縦方向力（前進+）
  fy: number;  // 横方向力（+X側）
}

export class TireModel {
  public params: TireParams;

  constructor(params?: Partial<TireParams>) {
    this.params = {
      // スポーツタイヤ相当の値（ピークすべり ~10-15%）
      Bx: 10.0, Cx: 1.65, Dx: 1.0, Ex: -0.5,
      By: 8.0,  Cy: 1.30, Dy: 1.0, Ey: -0.4,
      combinedShape: 1.0,
      loadSensitivity: -0.00006,
      referenceLoad: 3500,
      ...params
    };
  }

  /**
   * @param slipRatio  縦すべり率（wheelOmega*R - vLong)/max(|vLong|, threshold)。範囲 ±3
   * @param slipAngle  横すべり角（rad）
   * @param fz         接地荷重（N, >=0）
   * @param mu         路面摩擦係数倍率（乾燥=1.0, 濡れ=0.7 等）
   */
  compute(slipRatio: number, slipAngle: number, fz: number, mu: number): TireForce {
    if (fz <= 0) return { fx: 0, fy: 0 };

    // 負荷依存：接地荷重が大きいほど単位荷重あたりの摩擦は低下
    const loadScale = 1 + this.params.loadSensitivity * (fz - this.params.referenceLoad);
    const peakMu = Math.max(0.1, mu * loadScale);

    // 縦方向（純粋）
    const sx = THREE_clamp(slipRatio, -3, 3);
    const Dx = peakMu * fz * this.params.Dx;
    let fxPure = Dx * Math.sin(this.params.Cx * Math.atan(
      this.params.Bx * sx - this.params.Ex * (this.params.Bx * sx - Math.atan(this.params.Bx * sx))
    ));

    // 横方向（純粋）※復元力: α>0（右すべり）→ fy<0（左向き力）で車体を戻す
    const ay = THREE_clamp(slipAngle, -1.2, 1.2);
    const Dy = peakMu * fz * this.params.Dy;
    let fyPure = -Dy * Math.sin(this.params.Cy * Math.atan(
      this.params.By * ay - this.params.Ey * (this.params.By * ay - Math.atan(this.params.By * ay))
    ));

    // 複合摩擦（円/楕円クランプ）
    const shape = this.params.combinedShape;
    // 楕円: (fx/Dx)^shape + (fy/Dy)^shape <= 1
    const fxN = fxPure / (Dx + 1e-9);
    const fyN = fyPure / (Dy + 1e-9);
    const total = Math.pow(Math.abs(fxN), shape) + Math.pow(Math.abs(fyN), shape);
    if (total > 1) {
      const scale = Math.pow(total, -1 / shape);
      fxPure *= scale;
      fyPure *= scale;
    }

    return { fx: fxPure, fy: fyPure };
  }
}

function THREE_clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

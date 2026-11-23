/**
 * tracks/TrackCollision.ts
 * バリア衝突応答。Rapierはfile://環境（WASM制限）で使えないため、Phase 1 は
 * 路面クエリベースの境界判定＋反発で実装。剛体物理は Phase 2 以降で Rapier 統合予定。
 */
import type { TrackQueryResult } from './TrackData';

export interface CollisionResult {
  collided: boolean;
  correctedX: number;
  correctedZ: number;
  impactSpeed: number; // 横方向衝突成分の速度 m/s
}

/**
 * 横方向オフセットがバリア限界を超えた場合、車体を限界内に戻し、
 * 横方向速度成分を反発（係数 0.25）＋減衰する。
 */
export function resolveBarrier(
  x: number, z: number,
  lateralOffset: number,
  vLat: number, // 横方向速度（車体ローカル、+右）
  wallLimit: number
): CollisionResult {
  const abs = Math.abs(lateralOffset);
  if (abs <= wallLimit) {
    return { collided: false, correctedX: x, correctedZ: z, impactSpeed: 0 };
  }
  // バリアへのめり込み量
  const over = abs - wallLimit;
  const sign = Math.sign(lateralOffset);
  // 中心線方向に戻す（車体位置を横方向に -sign*over だけ移動）
  // ※呼び出し側は forward/right ベクトルで補正する。ここでは速度応答のみ返すのが安全。
  const impact = Math.abs(vLat);
  return {
    collided: true,
    correctedX: x, // 呼び出し側で右ベクトルを使って補正
    correctedZ: z,
    impactSpeed: impact
  };
}

/**
 * 視界(フォグ・オブ・ウォー)。design.md 4.1
 */
import { IFV, SUPPRESSION, TICKS_PER_SECOND, unitStats, VISION } from './config';
import { angleDiff, angleTo, dist } from './geometry';
import { insideConcealment, lineOfFire } from './terrain';
import { smokeBlocks } from './smoke';
import type { MapData, Side, SideVision, SimState, Unit } from './types';

const EXPOSURE_TICKS = Math.round(VISION.fireExposureSec * TICKS_PER_SECOND);

/** viewer が target を発見できる距離(viewer の視界距離に、茂みと発砲による暴露の倍率をかける) */
export function detectionRange(map: MapData, viewer: Unit, target: Unit): number {
  let r = unitStats(viewer.kind).sightRange;
  if (insideConcealment(map, target.pos)) r *= VISION.concealmentFactor;
  if (target.ticksSinceFired < EXPOSURE_TICKS) r *= VISION.fireExposureFactor;
  return r;
}

/**
 * viewer の視界(向いている方向の扇形・距離・視線)に target が入っているか。
 * 視線は建物と硬い遮蔽でさえぎられる(身を隠している遮蔽物の越しには見える)。茂みは視線を通す。
 */
export function sees(map: MapData, viewer: Unit, target: Unit): boolean {
  if (!viewer.alive || !target.alive) return false;
  // 乗車中の班は外が見えず、外からも見えない
  if (viewer.mountedIn !== null || target.mountedIn !== null) return false;
  const d = dist(viewer.pos, target.pos);
  if (d > detectionRange(map, viewer, target)) return false;
  let arc = unitStats(viewer.kind).sightArc;
  if (viewer.kind === 'ifv' && viewer.suppression >= SUPPRESSION.suppressed) {
    // ハッチを閉めている:視界が狭く、車体のすぐまわりが見えない(FM 23-25 6-3b)
    arc = IFV.buttonedArc;
    if (d < IFV.buttonedBlindRadius) return false;
  }
  if (angleDiff(viewer.facing, angleTo(viewer.pos, target.pos)) > arc / 2) return false;
  if (smokeBlocks(map, viewer.pos, target.pos)) return false;
  return lineOfFire(map, viewer.pos, target.pos);
}

function sideVision(state: SimState, side: Side, prev: SideVision | undefined): SideVision {
  const viewers = state.units.filter((u) => u.alive && u.side === side);
  const visible: string[] = [];
  const lastSeen = { ...(prev?.lastSeen ?? {}) };
  for (const e of state.units) {
    if (e.side === side) continue;
    if (!e.alive) {
      delete lastSeen[e.id];
      continue;
    }
    if (viewers.some((v) => sees(state.map, v, e))) {
      visible.push(e.id);
      lastSeen[e.id] = { pos: { ...e.pos }, tick: state.tick };
    }
  }
  return { visible, lastSeen };
}

/** 現在の位置から両陣営の視界を計算する(最終確認位置は前の視界から引き継ぐ) */
export function computeVision(state: SimState): Record<Side, SideVision> {
  return {
    blue: sideVision(state, 'blue', state.vision?.blue),
    red: sideVision(state, 'red', state.vision?.red),
  };
}

import { COVER } from './config';
import { angleDiff, angleTo, closestPointOnPolygon, dist, pointInPolygon, segmentHitsPolygon } from './geometry';
import type { MapData, TerrainFeature, Vec2 } from './types';

export type CoverKind = 'hard' | 'soft';

/** 位置 p が遮蔽物 f の「内側」にいるか(縁から occupyDistance 以内、かつ上に乗っていない) */
export function occupies(p: Vec2, f: TerrainFeature): boolean {
  if (f.kind !== 'hard' && f.kind !== 'soft') return false;
  if (pointInPolygon(p, f.poly)) return false;
  return dist(p, closestPointOnPolygon(p, f.poly)) <= COVER.occupyDistance;
}

/**
 * 遮蔽物 f が、p にいる者を「from から撃たれる」ときに守るか。design.md 4.3
 * 遮蔽の正面 = p から遮蔽物へ向かう方向。そこから ±60° 以内から撃たれたときだけ守る。
 */
export function protects(p: Vec2, f: TerrainFeature, from: Vec2): boolean {
  if (!occupies(p, f)) return false;
  const front = angleTo(p, closestPointOnPolygon(p, f.poly));
  return angleDiff(front, angleTo(p, from)) <= COVER.arc;
}

/** p にいる者が from から撃たれたとき、効いている一番強い遮蔽。なければ null */
export function effectiveCover(map: MapData, p: Vec2, from: Vec2): CoverKind | null {
  let best: CoverKind | null = null;
  for (const f of map.features) {
    if (f.kind !== 'hard' && f.kind !== 'soft') continue;
    if (!protects(p, f, from)) continue;
    if (f.kind === 'hard') return 'hard';
    best = 'soft';
  }
  return best;
}

/**
 * a から b への射線が通るか。
 * 建物と硬い遮蔽はさえぎる。ただし a か b が「内側にいる」遮蔽物は、その越しに撃てるのでさえぎらない。
 */
export function lineOfFire(map: MapData, a: Vec2, b: Vec2): boolean {
  for (const f of map.features) {
    if (f.kind === 'building') {
      if (segmentHitsPolygon(a, b, f.poly)) return false;
    } else if (f.kind === 'hard') {
      if (occupies(a, f) || occupies(b, f)) continue;
      if (segmentHitsPolygon(a, b, f.poly)) return false;
    }
  }
  return true;
}

/** 建物の中か(進入不可) */
export function insideBuilding(map: MapData, p: Vec2): boolean {
  return map.features.some((f) => f.kind === 'building' && pointInPolygon(p, f.poly));
}

/** 直線で歩いて建物にぶつからないか */
export function walkable(map: MapData, a: Vec2, b: Vec2): boolean {
  if (b.x < 0 || b.y < 0 || b.x > map.width || b.y > map.height) return false;
  return !map.features.some((f) => f.kind === 'building' && segmentHitsPolygon(a, b, f.poly));
}

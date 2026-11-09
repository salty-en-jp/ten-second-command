/**
 * 建物への進入。design.md 4.2・6.7
 * 建物1つを1つの陣地として扱う。中の班は「建物の中にいる」状態になり、位置は建物の中の点に置く。
 * 根拠:FM 90-10-1(1995)5-9・5-17・8章、FM 7-8(1992)Drill 6。
 */
import { BUILDING, COVER, TICKS_PER_SECOND } from './config';
import { add, angleDiff, angleTo, closestPointOnPolygon, dist, offsetPerimeterPoints, pointInPolygon, scale, sub, vec } from './geometry';
import type { MapData, TerrainFeature, Unit, Vec2 } from './types';

export const ENTER_TICKS = Math.round(BUILDING.enterSec * TICKS_PER_SECOND);
export const EXIT_TICKS = Math.round(BUILDING.exitSec * TICKS_PER_SECOND);
export const ASSAULT_TICKS = Math.round(BUILDING.assaultSec * TICKS_PER_SECOND);

export const isEnterable = (f: TerrainFeature): boolean => f.kind === 'building' && f.enterable === true;

/** p を中に含む、入れる建物(なければ null) */
export function buildingAt(map: MapData, p: Vec2): TerrainFeature | null {
  return map.features.find((f) => isEnterable(f) && pointInPolygon(p, f.poly)) ?? null;
}

export function buildingById(map: MapData, id: string | null | undefined): TerrainFeature | null {
  if (!id) return null;
  return map.features.find((f) => f.id === id && isEnterable(f)) ?? null;
}

function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** 1つの陣営が同時に入れる班の数 */
export function capacityOf(f: TerrainFeature): number {
  return area(f.poly) >= BUILDING.largeArea ? BUILDING.largeCapacity : BUILDING.capacity;
}

/** 入口:壁の外側で from に一番近い点 */
export function approachPoint(f: TerrainFeature, from: Vec2): Vec2 {
  let best = from;
  let bestD = Infinity;
  for (const q of offsetPerimeterPoints(f.poly, BUILDING.standoff, 1)) {
    const d = dist(from, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { ...best };
}

/** 中に入った班を置く点:from に一番近い壁から、建物の中心へ inset だけ入った点 */
export function insidePoint(f: TerrainFeature, from: Vec2): Vec2 {
  const c = scale(f.poly.reduce((acc, p) => add(acc, p), vec(0, 0)), 1 / f.poly.length);
  const w = closestPointOnPolygon(from, f.poly);
  const d = dist(w, c);
  if (d <= BUILDING.inset) return c;
  return add(w, scale(sub(c, w), BUILDING.inset / d));
}

/** 入口に立っているか */
export function atEntrance(f: TerrainFeature, p: Vec2): boolean {
  return !pointInPolygon(p, f.poly) && dist(p, closestPointOnPolygon(p, f.poly)) <= BUILDING.standoff + 0.3;
}

/**
 * 建物の中の班 t が from から小銃・機関砲で撃たれたときの被ダメージ係数(突破口が開くと、どの向きからも弱くなる)。
 * 同じ建物の中から撃たれたときは null(遮蔽なし。ふつうの係数を使う)。
 */
export function buildingDamageFactor(map: MapData, t: Unit, from: Vec2): number | null {
  const b = buildingById(map, t.inBuilding);
  if (!b || pointInPolygon(from, b.poly)) return null;
  if (b.breached) return BUILDING.breachedDamage;
  return angleDiff(t.facing, angleTo(t.pos, from)) <= COVER.arc ? BUILDING.frontDamage : BUILDING.flankDamage;
}

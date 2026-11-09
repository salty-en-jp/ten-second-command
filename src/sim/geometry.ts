import type { Vec2 } from './types';

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

/** 2つの角度の差の絶対値(0〜π) */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return { ...a };
  let t = dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  return add(a, scale(ab, t));
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 多角形の縁上で p に一番近い点 */
export function closestPointOnPolygon(p: Vec2, poly: Vec2[]): Vec2 {
  let best = poly[0]!;
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const c = closestPointOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    const d = dist(p, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** 線分 p1-p2 と線分 q1-q2 が交わるか(端点の接触も含む) */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  const qp = sub(q1, p1);
  if (denom === 0) return false; // 平行(重なりは無視してよい精度)
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** 線分 a-b が多角形を通るか(内部に端点がある場合も含む) */
export function segmentHitsPolygon(a: Vec2, b: Vec2, poly: Vec2[]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (segmentsIntersect(a, b, poly[i]!, poly[(i + 1) % poly.length]!)) return true;
  }
  return false;
}

/** 多角形の縁に沿って、外側へ offset だけ離れた点を spacing 間隔で並べる */
export function offsetPerimeterPoints(poly: Vec2[], offset: number, spacing: number): Vec2[] {
  // 重心から外向きを判定する(凸多角形前提)
  const c = scale(poly.reduce((acc, p) => add(acc, p), vec(0, 0)), 1 / poly.length);
  const pts: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const edge = sub(b, a);
    const l = len(edge);
    if (l === 0) continue;
    let n = vec(-edge.y / l, edge.x / l);
    const mid = scale(add(a, b), 0.5);
    if (dot(n, sub(mid, c)) < 0) n = scale(n, -1);
    const count = Math.max(1, Math.round(l / spacing));
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      pts.push(add(add(a, scale(edge, t)), scale(n, offset)));
    }
  }
  return pts;
}

/** 中心・幅・奥行き・向きから長方形の多角形を作る(ステージ作成用) */
export function rect(cx: number, cy: number, w: number, h: number, angle = 0): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = w / 2;
  const hh = h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => vec(cx + x! * c - y! * s, cy + x! * s + y! * c));
}

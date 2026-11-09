/**
 * 煙幕。design.md 4.1・6.1・6.3
 * - 煙は円。煙の円を通る視線(煙の中から・煙の中への視線を含む)は通らない。弾は通す
 * - 発煙手榴弾:射撃班が 30 m 先まで投げ、2 秒後に半径 8 m の煙が 30 秒
 * - 迫撃砲の発煙弾:着弾と同時に半径 10 m の煙が 20 秒
 */
import { SMOKE, TICKS_PER_SECOND } from './config';
import { closestPointOnSegment, dist } from './geometry';
import type { MapData, SimState, SmokeCloud, Unit, Vec2 } from './types';

/** a から b への視線が、立っている煙にさえぎられるか */
export function smokeBlocks(map: MapData, a: Vec2, b: Vec2): boolean {
  const ss = map.smokes;
  if (!ss || ss.length === 0) return false;
  return ss.some((c) => dist(closestPointOnSegment(c.pos, a, b), c.pos) < c.r);
}

/** 発煙手榴弾の命令を、投げるティックつきの順番待ちに直す */
export function queueThrows(u: Unit, nowTick: number): void {
  u.smokeQueue = (u.orders.smokeThrows ?? [])
    .map((m, i) => ({ target: { ...m.target }, tick: nowTick + Math.round(m.atSec * TICKS_PER_SECOND), i }))
    .sort((a, b) => a.tick - b.tick || a.i - b.i)
    .map(({ target, tick }) => ({ target, tick }));
}

/** 投げる時刻が来た発煙手榴弾を投げる。届かない地点への命令は捨てる(手榴弾は減らない)。釘付けでは投げない */
export function tryThrow(u: Unit, nextTick: number, pinned: boolean): SmokeCloud | null {
  if (pinned) return null;
  while (u.smokeQueue.length > 0 && u.smokeQueue[0]!.tick <= nextTick) {
    const m = u.smokeQueue.shift()!;
    if (u.smokeGrenades <= 0) return null;
    if (dist(u.pos, m.target) > SMOKE.grenade.throwRange) continue;
    u.smokeGrenades--;
    const start = nextTick + Math.round(SMOKE.grenade.delaySec * TICKS_PER_SECOND);
    return {
      id: `g-${u.id}-${nextTick}`,
      pos: { ...m.target },
      r: SMOKE.grenade.radius,
      startTick: start,
      endTick: start + Math.round(SMOKE.grenade.durationSec * TICKS_PER_SECOND),
    };
  }
  return null;
}

/** 迫撃砲の発煙弾が着弾したときの煙 */
export function mortarSmoke(at: Vec2, tick: number, id: number): SmokeCloud {
  return { id: `m-${id}`, pos: { ...at }, r: SMOKE.mortar.radius, startTick: tick, endTick: tick + Math.round(SMOKE.mortar.durationSec * TICKS_PER_SECOND) };
}

/** 消えた煙を取り除き、いま立っている煙を地図(視線の判定)に反映する */
export function updateSmokes(s: SimState): void {
  const live = s.smokes.filter((c) => c.endTick > s.tick);
  if (live.length !== s.smokes.length) s.smokes = live;
  const active = live.filter((c) => c.startTick <= s.tick).map((c) => ({ pos: c.pos, r: c.r }));
  const before = s.map.smokes ?? [];
  if (active.length !== before.length || active.some((c, i) => c.pos !== before[i]!.pos)) s.map = { ...s.map, smokes: active };
}

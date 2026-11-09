/** 煙幕(発煙手榴弾・迫撃砲の発煙弾)のテスト */
import { describe, expect, it } from 'vitest';
import {
  createState,
  DEG,
  issueOrders,
  makeFireteam,
  makeMortar,
  MORTAR,
  SMOKE,
  step,
  type MapData,
  type Orders,
  type SimState,
} from '../src/sim';
import { seconds, unit } from './helpers';

const open: MapData = { width: 400, height: 400, features: [] };
const N = 90 * DEG;
const S = -90 * DEG;
const hold = { fire: 'hold' as const, policy: 'hold' as const };
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'hold', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
function run(s: SimState, ticks: number) {
  let c = s;
  for (let i = 0; i < ticks; i++) c = step(c);
  return c;
}
function until(s: SimState, max: number, cond: (s: SimState) => boolean) {
  let c = s;
  for (let i = 1; i <= max; i++) {
    c = step(c);
    if (cond(c)) return { s: c, ticks: i };
  }
  return { s: c, ticks: null as number | null };
}

describe('発煙手榴弾', () => {
  // 青の班(200,100)と赤の班(200,180)が向かい合っている(80 m、互いに見えている)
  const facing = () =>
    createState(open, [makeFireteam('b', 'blue', { x: 200, y: 100 }, N, hold), makeFireteam('r', 'red', { x: 200, y: 180 }, S, hold)]);

  it('射撃班は2個持つ。投げて2秒後に煙が立ち、視線をさえぎる。30秒で消える', () => {
    const s0 = facing();
    expect(unit(s0, 'b').smokeGrenades).toBe(SMOKE.grenade.perTeam);
    expect(s0.vision.blue.visible).toContain('r');
    const s1 = issueOrders(s0, { b: O({ smokeThrows: [{ target: { x: 200, y: 125 }, atSec: 0 }] }) });
    const up = until(s1, seconds(5), (x) => (x.map.smokes ?? []).length > 0);
    expect(up.ticks).toBe(seconds(SMOKE.grenade.delaySec) + 1);
    expect(unit(up.s, 'b').smokeGrenades).toBe(SMOKE.grenade.perTeam - 1);
    expect(up.s.vision.blue.visible).not.toContain('r');
    expect(up.s.vision.red.visible).not.toContain('b');
    const gone = until(up.s, seconds(40), (x) => (x.map.smokes ?? []).length === 0);
    expect(gone.ticks).toBe(seconds(SMOKE.grenade.durationSec));
    expect(gone.s.vision.blue.visible).toContain('r');
  });

  it('30 m より遠くには投げない(手榴弾は減らない)', () => {
    const s1 = issueOrders(facing(), { b: O({ smokeThrows: [{ target: { x: 200, y: 140 }, atSec: 0 }] }) });
    const s = run(s1, seconds(5));
    expect(s.smokes.length).toBe(0);
    expect(unit(s, 'b').smokeGrenades).toBe(SMOKE.grenade.perTeam);
  });

  it('煙の向こうの敵は狙って撃てない(撃ってきた敵への撃ち返しも)', () => {
    // 撃ち合いの最中に、間に煙を張る
    const s0 = createState(open, [
      makeFireteam('b', 'blue', { x: 200, y: 100 }, N, { fire: 'free', policy: 'hold' }),
      makeFireteam('r', 'red', { x: 200, y: 180 }, S, { fire: 'free', policy: 'hold' }),
    ]);
    const fighting = run(s0, seconds(3));
    expect(unit(fighting, 'r').shot?.targetId).toBe('b');
    const s1 = issueOrders(fighting, { b: O({ fire: 'free', smokeThrows: [{ target: { x: 200, y: 125 }, atSec: 0 }] }) });
    const s = run(s1, seconds(4));
    expect(unit(s, 'r').shot?.targetId ?? null).toBeNull();
    expect(unit(s, 'b').shot?.targetId ?? null).toBeNull();
  });
});

describe('迫撃砲の発煙弾', () => {
  it('8発のうち2発まで。着弾と同時に半径 10 m の煙が立ち、ダメージはなく制圧値だけが上がる', () => {
    const target = { x: 200, y: 200 };
    const s0 = createState(open, [
      makeMortar('m', 'blue', { x: 200, y: 50 }, N, hold),
      makeFireteam('r', 'red', { x: 200, y: 212 }, N, hold), // 観測なしで 12 m 遠くへずれた着弾点に立っている
    ]);
    const s1 = issueOrders(s0, {
      m: O({ deploy: true, fireMissions: [0, 0, 0].map(() => ({ target, atSec: 0, kind: 'smoke' as const })) }),
    });
    const landed = until(s1, seconds(20), (x) => x.smokes.length > 0);
    expect(landed.ticks).not.toBeNull();
    expect(landed.s.smokes[0]!.r).toBe(SMOKE.mortar.radius);
    expect(unit(landed.s, 'r').hp).toBe(100);
    expect(unit(landed.s, 'r').suppression).toBeGreaterThan(0);
    const end = run(landed.s, seconds(15));
    expect(unit(end, 'm').smokeRounds).toBe(0);
    expect(unit(end, 'm').rounds).toBe(MORTAR.rounds - SMOKE.mortar.maxRounds); // 3発目の発煙弾は撃たない
  });
});

/** 迫撃砲班(design.md 6.3)のテスト */
import { describe, expect, it } from 'vitest';
import {
  createState,
  DEG,
  issueOrders,
  makeFireteam,
  makeMortar,
  MORTAR,
  rect,
  step,
  type MapData,
  type Orders,
  type SimState,
} from '../src/sim';
import { seconds, unit } from './helpers';

const open: MapData = { width: 400, height: 400, features: [] };
const NORTH = 90 * DEG;
const SOUTH = -90 * DEG;
const hold = { fire: 'hold' as const, policy: 'hold' as const };
const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'hold', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
function run(s: SimState, ticks: number) {
  let cur = s;
  for (let i = 0; i < ticks; i++) cur = step(cur);
  return cur;
}
function until(s: SimState, max: number, cond: (s: SimState) => boolean) {
  let cur = s;
  for (let i = 1; i <= max; i++) {
    cur = step(cur);
    if (cond(cur)) return { s: cur, ticks: i };
  }
  return { s: cur, ticks: null as number | null };
}

/** 南に迫撃砲、150 m 北に敵の射撃班(北を向いていて気づかない) */
const setup = (enemyPos = { x: 200, y: 200 }, map: MapData = open, observer = false) =>
  createState(map, [
    makeMortar('m1', 'blue', { x: 200, y: 50 }, NORTH, hold),
    makeFireteam('r1', 'red', enemyPos, NORTH, hold),
    ...(observer ? [makeFireteam('obs', 'blue', { x: 200, y: 120 }, NORTH, hold)] : []),
  ]);

describe('迫撃砲', () => {
  it('展開していないと撃てない。展開に 4 秒、発射から着弾まで 4 秒', () => {
    const s0 = setup();
    // 展開せずに撃とうとしても撃たない
    const noDeploy = run(issueOrders(s0, { m1: O({ fireMissions: [{ target: { x: 200, y: 200 }, atSec: 0 }] }) }), seconds(10));
    expect(noDeploy.shells.length + noDeploy.impacts.length).toBe(0);
    expect(unit(noDeploy, 'm1').rounds).toBe(MORTAR.rounds);

    const s1 = issueOrders(s0, { m1: O({ deploy: true, fireMissions: [{ target: { x: 200, y: 200 }, atSec: 0 }] }) });
    const fired = until(s1, seconds(10), (x) => x.shells.length > 0);
    expect(fired.ticks).toBe(seconds(MORTAR.deploySec) + 1);
    const landed = until(fired.s, seconds(10), (x) => x.impacts.length > 0);
    expect(landed.ticks).toBe(seconds(MORTAR.flightSec));
  });

  it('展開中は動けない。動くには撤収(3 秒)が必要', () => {
    let s = run(issueOrders(setup(), { m1: O({ deploy: true }) }), seconds(5));
    expect(unit(s, 'm1').mortarState).toBe('deployed');
    s = issueOrders(s, { m1: O({ route: [{ pos: { x: 100, y: 50 }, waitSec: 0 }] }) });
    const moved = until(s, seconds(10), (x) => unit(x, 'm1').pos.x < 200);
    expect(moved.ticks).toBe(seconds(MORTAR.packSec) + 1);
  });

  it('観測されていない初弾は遠くへずれる。着弾を味方が見ていれば、次からは正確に落ちる', () => {
    const target = { x: 200, y: 200 };
    const s1 = issueOrders(setup(target, open, true), {
      m1: O({ deploy: true, fireMissions: [{ target, atSec: 0 }, { target, atSec: 10 }] }),
    });
    const first = until(s1, seconds(20), (x) => x.impacts.length > 0);
    expect(first.s.impacts[0]!.pos.y).toBeCloseTo(200 + MORTAR.unobservedError);
    const second = until(first.s, seconds(20), (x) => x.impacts.some((im) => im.tick > first.s.tick + seconds(1)));
    const im = second.s.impacts.at(-1)!;
    expect(im.pos.x).toBeCloseTo(200);
    expect(im.pos.y).toBeCloseTo(200);
  });

  it('誰も見ていなければ、何発撃ってもずれたまま', () => {
    const target = { x: 200, y: 200 };
    const s1 = issueOrders(setup(target), { m1: O({ deploy: true, fireMissions: [{ target, atSec: 0 }, { target, atSec: 10 }] }) });
    const s = run(s1, seconds(20));
    expect(unit(s, 'm1').rounds).toBe(MORTAR.rounds - 2);
    expect(unit(s, 'm1').adjustedAim).toBeNull();
  });

  it('直撃は耐久 −60。半径 8 m で 0 へ減る。半径 15 m で制圧値 +40', () => {
    // 修正済み(観測あり)として撃つため、観測役を置いて2発目を見る
    const target = { x: 200, y: 200 };
    const s1 = issueOrders(setup({ x: 200, y: 196 }, open, true), {
      m1: O({ deploy: true, fireMissions: [{ target: { x: 300, y: 300 }, atSec: 0 }, { target, atSec: 0 }] }),
    });
    // 1発目は別の場所、2発目は観測なしで (200, 212) に落ちる → 敵は 16 m 先で無傷
    const s = run(s1, seconds(15));
    const r1 = unit(s, 'r1');
    expect(r1.hp).toBe(100);
  });

  it('伏せていると ×0.5、遮蔽の内側なら(向きに関係なく)×0.3', () => {
    // 敵(200, 204)のすぐ北に石垣。敵は石垣の南側(着弾点の側)にいる
    const wall: MapData = { width: 400, height: 400, features: [{ id: 'w', kind: 'hard', poly: rect(200, 205.5, 20, 1) }] };
    const hitAt = (map: MapData, enemy: { x: number; y: number }) => {
      // 観測なし:狙いは (200, 188)、実際の着弾は (200, 200)
      const s1 = issueOrders(setup(enemy, map), { m1: O({ deploy: true, fireMissions: [{ target: { x: 200, y: 188 }, atSec: 0 }] }) });
      return 100 - unit(run(s1, seconds(10)), 'r1').hp;
    };
    // 開けた場所で立っている敵は、0.5 秒前の予兆で伏せる → ×0.5
    expect(hitAt(open, { x: 200, y: 204 })).toBeCloseTo(MORTAR.centerDamage * (1 - 4 / 8) * MORTAR.proneFactor, 5);
    // 遮蔽の内側なら、着弾が遮蔽の手前(どの向き)でも ×0.3(伏せの ×0.5 とは重ねない)
    expect(hitAt(wall, { x: 200, y: 204 })).toBeCloseTo(MORTAR.centerDamage * (1 - 4 / 8) * MORTAR.coverFactor, 5);
  });

  it('射程外(50 m 未満・400 m 超)の命令は撃たない', () => {
    const s1 = issueOrders(setup(), {
      // 20 m 先(近すぎる)と、約 402 m 先(遠すぎる)
      m1: O({ deploy: true, fireMissions: [{ target: { x: 200, y: 70 }, atSec: 0 }, { target: { x: 399, y: 399 }, atSec: 0 }] }),
    });
    const s = run(s1, seconds(15));
    expect(unit(s, 'm1').rounds).toBe(MORTAR.rounds);
  });

  it('弾は 8 発まで。連続発射は 2 秒おき', () => {
    const target = { x: 200, y: 300 };
    const missions = Array.from({ length: 10 }, () => ({ target, atSec: 0 }));
    let s = issueOrders(setup({ x: 50, y: 350 }), { m1: O({ deploy: true, fireMissions: missions }) });
    const firedTicks: number[] = [];
    for (let i = 0; i < seconds(30); i++) {
      const before = unit(s, 'm1').rounds;
      s = step(s);
      if (unit(s, 'm1').rounds < before) firedTicks.push(s.tick);
    }
    expect(firedTicks.length).toBe(MORTAR.rounds);
    for (let i = 1; i < firedTicks.length; i++) expect(firedTicks[i]! - firedTicks[i - 1]!).toBe(seconds(MORTAR.intervalSec));
  });

  it('着弾の 0.5 秒前に、近く(15 m 以内)の歩兵は伏せて止まる', () => {
    // 敵は西から東へ歩いていて、着弾のころに着弾点(200, 200)の近くを通る
    const s1 = issueOrders(setup({ x: 180, y: 200 }), {
      m1: O({ deploy: true, fireMissions: [{ target: { x: 200, y: 188 }, atSec: 0 }] }),
      r1: O({ route: [{ pos: { x: 260, y: 200 }, waitSec: 0 }] }),
    });
    const warned = until(s1, seconds(15), (x) => unit(x, 'r1').prone);
    expect(warned.ticks).not.toBeNull();
    const x0 = unit(warned.s, 'r1').pos.x;
    const after = until(warned.s, seconds(2), (x) => x.impacts.length > 0);
    expect(after.ticks).toBe(seconds(MORTAR.warningSec));
    expect(unit(after.s, 'r1').pos.x).toBe(x0); // 伏せている間は動かない
  });
});

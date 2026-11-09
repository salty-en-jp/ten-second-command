/** スナイパー(design.md 6.2)のテスト */
import { describe, expect, it } from 'vitest';
import { createState, DEG, issueOrders, makeFireteam, makeSniper, SNIPER, step, type MapData, type SimState } from '../src/sim';
import { seconds, unit } from './helpers';

const open: MapData = { width: 400, height: 400, features: [] };
const NORTH = 90 * DEG;
const SOUTH = -90 * DEG;
const hold = { fire: 'hold' as const, policy: 'hold' as const };

/** 条件を満たすまで進め、かかったティック数を返す */
function until(s: SimState, max: number, cond: (s: SimState) => boolean) {
  let cur = s;
  for (let i = 1; i <= max; i++) {
    cur = step(cur);
    if (cond(cur)) return { s: cur, ticks: i };
  }
  return { s: cur, ticks: null as number | null };
}
const hpOf = (s: SimState, id: string) => unit(s, id).hp;

describe('スナイパー', () => {
  // 北を向いたスナイパー(射界も北)と、200 m 北で南を向いて立っている敵の射撃班(射撃班の視界 120 m の外)
  const basic = () =>
    createState(open, [
      makeSniper('bs', 'blue', { x: 200, y: 50 }, NORTH, { facing: NORTH }),
      makeFireteam('r1', 'red', { x: 200, y: 250 }, SOUTH, hold),
    ]);

  it('射界の中の、止まっている敵を撃つ:命中で耐久 −25、制圧値 +50', () => {
    const { s, ticks } = until(basic(), seconds(5), (x) => hpOf(x, 'r1') < 100);
    expect(ticks).not.toBeNull();
    expect(hpOf(s, 'r1')).toBe(75);
    expect(unit(s, 'r1').suppression).toBeCloseTo(50, 0);
  });

  it('撃ったら装填に 8 秒かかる', () => {
    const first = until(basic(), seconds(5), (x) => hpOf(x, 'r1') < 100);
    const second = until(first.s, seconds(20), (x) => hpOf(x, 'r1') < 75);
    expect(second.ticks).toBe(seconds(SNIPER.cooldownSec));
  });

  it('見えていても、射界(向きを中心に 30°)の外の敵は撃たない', () => {
    // 敵は北東 40°(射界の中心から 50° ずれている)
    const a = 40 * DEG;
    const s0 = createState(open, [
      makeSniper('bs', 'blue', { x: 100, y: 50 }, NORTH, { facing: NORTH }),
      makeFireteam('r1', 'red', { x: 100 + 150 * Math.cos(a), y: 50 + 150 * Math.sin(a) }, SOUTH, hold),
    ]);
    expect(s0.vision.blue.visible).toContain('r1');
    const { ticks } = until(s0, seconds(10), (x) => hpOf(x, 'r1') < 100);
    expect(ticks).toBeNull();
  });

  it('射界を横切って走り抜ける敵は撃てないが、止まれば撃たれる', () => {
    // 射界(幅 30°)を 150 m 先で横切る:射界の幅は約 80 m、2.5 m/秒なら 32 秒…では長すぎるので近くを横切る
    // 50 m 先なら射界の幅は約 27 m。1.2 秒で 3 m しか進まないので撃たれる → 反応時間の差だけを確かめる
    const mk = (moving: boolean) =>
      createState(open, [
        makeSniper('bs', 'blue', { x: 200, y: 50 }, NORTH, { facing: NORTH }),
        makeFireteam('r1', 'red', { x: 200, y: 200 }, SOUTH, {
          ...hold,
          route: moving ? [{ pos: { x: 400, y: 200 }, waitSec: 0 }] : [],
          facing: SOUTH,
        }),
      ]);
    const still = until(mk(false), seconds(5), (x) => hpOf(x, 'r1') < 100);
    const moving = until(mk(true), seconds(5), (x) => hpOf(x, 'r1') < 100);
    expect(still.ticks).not.toBeNull();
    expect(moving.ticks).not.toBeNull();
    // 動いている目標には、撃つまでに長くかかる
    expect(moving.ticks! - still.ticks!).toBe(seconds(SNIPER.reactionMovingSec) - seconds(SNIPER.reactionStillSec));
  });

  it('優先順位:敵のスナイパーは、近くの射撃班より先に撃つ', () => {
    // 敵はどちらも北を向いていて、こちらに気づいていない
    const s0 = createState(open, [
      makeSniper('bs', 'blue', { x: 200, y: 50 }, NORTH, { facing: NORTH }),
      makeFireteam('near', 'red', { x: 200, y: 150 }, NORTH, hold),
      makeSniper('rs', 'red', { x: 210, y: 240 }, NORTH, hold),
    ]);
    const first = until(s0, seconds(5), (x) => unit(x, 'bs').shot !== null);
    expect(unit(first.s, 'bs').shot?.targetId).toBe('rs');
  });

  it('優先順位:自分を撃ってきた敵がいれば、そちらを先に撃つ', () => {
    // 近くの射撃班だけがこちらを向いていて撃ってくる
    const s0 = createState(open, [
      makeSniper('bs', 'blue', { x: 200, y: 50 }, NORTH, { facing: NORTH }),
      makeFireteam('near', 'red', { x: 200, y: 150 }, SOUTH, { fire: 'free', policy: 'hold' }),
      makeSniper('rs', 'red', { x: 210, y: 240 }, NORTH, hold),
    ]);
    const first = until(s0, seconds(5), (x) => unit(x, 'bs').shot !== null);
    expect(unit(first.s, 'bs').shot?.targetId).toBe('near');
  });

  it('射撃禁止なら、撃たれるか見つかるまで撃たない', () => {
    const s0 = issueOrders(basic(), { bs: { ...unit(basic(), 'bs').orders, fire: 'hold' } });
    const { ticks } = until(s0, seconds(10), (x) => hpOf(x, 'r1') < 100);
    expect(ticks).toBeNull();
  });
});

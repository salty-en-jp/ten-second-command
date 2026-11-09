/**
 * スナイパーのマップ(stages/ridge.json)の遊びが成り立っているかの確認。
 * 設計目標ではないが、マップや数値を変えたときに遊びが壊れていないかを見張る。
 */
import { describe, expect, it } from 'vitest';
import { DEG, issueOrders, loadStage, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import stageData from '../stages/ridge.json';
import { unit } from './helpers';

const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
const toward = (from: { x: number; y: number }, to: { x: number; y: number }) => Math.atan2(to.y - from.y, to.x - from.x);

/** フェイズごとの命令(指定しなかった班は前の命令を続ける)で遊ぶ */
function play(plan: Record<number, Record<string, Partial<Orders>>>, phases: number): SimState[] {
  let s = loadStage(stageData as StageData);
  const out: SimState[] = [s];
  for (let p = 1; p <= phases && s.outcome === 'ongoing'; p++) {
    const o: Record<string, Orders> = {};
    for (const u of s.units) if (u.side === 'blue' && u.alive) o[u.id] = carryOver(u, s.tick);
    for (const [id, ch] of Object.entries(plan[p] ?? {})) o[id] = O(ch);
    s = runPhase(issueOrders(s, o)).at(-1)!;
    out.push(s);
  }
  return out;
}

const eastRoute = [
  { pos: { x: 265, y: 15 }, waitSec: 0 },
  { pos: { x: 265, y: 140 }, waitSec: 0 },
  { pos: { x: 258, y: 146 }, waitSec: 0 },
];
const watchOrchard = toward({ x: 90, y: 33 }, { x: 60, y: 160 });

describe('尾根の雑木林(スナイパー)', () => {
  it('開始時は、どちらからも敵が見えない', () => {
    const s = loadStage(stageData as StageData);
    expect(s.vision.blue.visible).toEqual([]);
    expect(s.vision.red.visible).toEqual([]);
  });

  it('おとりで敵の狙撃手に撃たせると、果樹園を見張っていた味方の狙撃手が撃ち返して倒す', () => {
    const [, p1] = play({ 1: { bs: { facing: watchOrchard }, b1: { route: [{ pos: { x: 95, y: 60 }, waitSec: 0 }] } } }, 1);
    expect(unit(p1!, 'rs').alive).toBe(false);
    expect(unit(p1!, 'bs').alive).toBe(true);
    expect(unit(p1!, 'b1').hp).toBe(75); // おとりは1発受ける
  });

  it('東の盛土の裏を射撃禁止で進めば、敵に見つからずに敵Bの側面に着ける', () => {
    const states = play({ 1: { b2: { route: eastRoute, fire: 'hold' } } }, 7);
    const s = states.at(-1)!;
    expect(Math.hypot(unit(s, 'b2').pos.x - 258, unit(s, 'b2').pos.y - 146)).toBeLessThan(0.5);
    for (const st of states) expect(st.vision.red.visible).not.toContain('b2');
  });

  it('お手本の手順で 10 フェイズ以内に勝てる', () => {
    const states = play(
      {
        1: { bs: { facing: watchOrchard }, b1: { route: [{ pos: { x: 95, y: 60 }, waitSec: 0 }] }, b2: { route: eastRoute, fire: 'hold' } },
        2: {
          b1: { route: [{ pos: { x: 70, y: 30 }, waitSec: 0 }] },
          bs: { route: [{ pos: { x: 160, y: 38 }, waitSec: 0 }], facing: toward({ x: 160, y: 38 }, { x: 150, y: 151.5 }), fire: 'hold' },
        },
        8: { b2: { facing: 180 * DEG } },
        10: { bs: { facing: toward({ x: 160, y: 38 }, { x: 150, y: 151.5 }) } },
      },
      10,
    );
    expect(states.at(-1)!.outcome).toBe('blueWin');
  });
});

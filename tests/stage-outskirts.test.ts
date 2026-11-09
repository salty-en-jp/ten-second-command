/**
 * ミッション5「小村の外れ」(敵の性格 3 通り)の遊びが成り立っているかの確認。
 * 設計目標ではないが、AI やマップを変えたときに遊びが壊れていないかを見張る。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import a from '../stages/outskirts-a.json';
import b from '../stages/outskirts-b.json';
import c from '../stages/outskirts-c.json';
import { unit } from './helpers';

const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
function play(data: StageData, plan: Record<number, Record<string, Partial<Orders>>>, phases: number): SimState[] {
  let s = loadStage(data);
  const out: SimState[] = [s];
  for (let p = 1; p <= phases && s.outcome === 'ongoing'; p++) {
    s = planAi(s, data);
    const o: Record<string, Orders> = {};
    for (const u of s.units) if (u.side === 'blue' && u.alive) o[u.id] = carryOver(u, s.tick);
    for (const [id, ch] of Object.entries(plan[p] ?? {})) o[id] = O(ch);
    s = runPhase(issueOrders(s, o)).at(-1)!;
    out.push(s);
  }
  return out;
}
const east = (x0: number) => [
  { pos: { x: x0, y: 22 }, waitSec: 0 },
  { pos: { x: 282, y: 22 }, waitSec: 0 },
  { pos: { x: 282, y: 100 }, waitSec: 0 },
];

describe('小村の外れ A(待ち伏せ型)', () => {
  it('正面から牧草地を進むと、待ち伏せで2班とも倒される', () => {
    const states = play(a as StageData, { 1: { b1: { route: [{ pos: { x: 110, y: 85 }, waitSec: 0 }], policy: 'advance' }, b2: { route: [{ pos: { x: 190, y: 85 }, waitSec: 0 }], policy: 'advance' } } }, 6);
    const s = states.at(-1)!;
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('東の盛土の裏から沈み道に入れば、待ち伏せの敵を横から倒せる。押された敵は次の陣地へ下がる', () => {
    const states = play(
      a as StageData,
      {
        1: { b1: { route: east(110), fire: 'hold' }, b2: { route: east(190), fire: 'hold' } },
        9: {
          b1: { route: [{ pos: { x: 262, y: 98 }, waitSec: 0 }, { pos: { x: 242, y: 97 }, waitSec: 0 }], facing: Math.PI },
          b2: { route: [{ pos: { x: 262, y: 95 }, waitSec: 0 }, { pos: { x: 244, y: 94 }, waitSec: 0 }], facing: Math.PI },
        },
      },
      16,
    );
    const s = states.at(-1)!;
    expect(unit(s, 'r2').alive).toBe(false);
    expect(unit(s, 'r3').alive).toBe(false);
    expect(unit(s, 'b1').alive).toBe(true);
    expect(s.ai!.posIndex.r1).toBeGreaterThan(0); // 敵Aは下がった
  });
});

describe('小村の外れ B(突撃型)', () => {
  const inPits = {
    1: {
      b1: { route: [{ pos: { x: 110, y: 31.5 }, waitSec: 0 }], facing: Math.PI / 2 },
      b2: { route: [{ pos: { x: 190, y: 31.5 }, waitSec: 0 }], facing: Math.PI / 2 },
      m1: { fire: 'hold' as const },
    },
  };
  it('林の縁の射撃壕に入って待ち構えれば、攻めてくる敵を退けて勝てる', () => {
    expect(play(b as StageData, inPits, 12).at(-1)!.outcome).toBe('blueWin');
  });
  it('敵は「一方が抑え、一方が回り込む」:抑え役が火力を集中し、回り込み役は回り込み点へ向かう', () => {
    const states = play(b as StageData, inPits, 3);
    const s = states.at(-1)!;
    const reds = s.units.filter((u) => u.side === 'red' && u.alive);
    expect(reds.some((u) => s.ai!.flanking[u.id])).toBe(true);
  });
  it('(比較)林の奥で何もしないと、防衛線を突破されるか全滅して負ける', () => {
    const s = play(b as StageData, { 1: { b1: { route: [{ pos: { x: 110, y: 16 }, waitSec: 0 }] }, b2: { route: [{ pos: { x: 190, y: 16 }, waitSec: 0 }] } } }, 16).at(-1)!;
    expect(s.outcome).toBe('redWin');
  });
});

describe('小村の外れ C(防御型)', () => {
  const both = {
    1: {
      b1: { route: [{ pos: { x: 20, y: 22 }, waitSec: 0 }, { pos: { x: 20, y: 160 }, waitSec: 0 }], fire: 'hold' as const },
      b2: { route: [{ pos: { x: 282, y: 22 }, waitSec: 0 }, { pos: { x: 282, y: 160 }, waitSec: 0 }], fire: 'hold' as const },
    },
    8: {
      b1: { route: [{ pos: { x: 60, y: 160 }, waitSec: 0 }], facing: 0 },
      b2: { route: [{ pos: { x: 240, y: 160 }, waitSec: 0 }], facing: Math.PI },
    },
  };
  it('西と東の二方向から同時に攻めれば勝てる', () => {
    expect(play(c as StageData, both, 14).at(-1)!.outcome).toBe('blueWin');
  });
  it('(比較)正面から進むと、石垣の3班に撃ち負ける', () => {
    const s = play(c as StageData, { 1: { b1: { route: [{ pos: { x: 110, y: 85 }, waitSec: 0 }] }, b2: { route: [{ pos: { x: 190, y: 85 }, waitSec: 0 }] } } }, 6).at(-1)!;
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });
});

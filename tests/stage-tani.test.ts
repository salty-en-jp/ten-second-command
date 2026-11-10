/**
 * ミッション9「谷の集落(待ち伏せ・配置あり)」:家々にひそむ待ち伏せ型の敵を攻める。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/tani.json';
import { unit } from './helpers';

const data = st as StageData;
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
const P = (x: number, y: number) => ({ pos: { x, y }, waitSec: 0 });
const D = (deg: number) => (deg * Math.PI) / 180;
function play(plan: Record<number, Record<string, Partial<Orders>>>, phases: number): SimState {
  let s = loadStage(data);
  for (let p = 1; p <= phases && s.outcome === 'ongoing'; p++) {
    s = planAi(s, data);
    const o: Record<string, Orders> = {};
    for (const u of s.units) if (u.side === 'blue' && u.alive) o[u.id] = carryOver(u, s.tick);
    for (const [id, ch] of Object.entries(plan[p] ?? {})) o[id] = O(ch);
    s = runPhase(issueOrders(s, o)).at(-1)!;
  }
  return s;
}

describe('谷の集落(待ち伏せ・配置あり)', () => {
  it('敵は家の中にいて、配置エリアからは互いに見えない', () => {
    const s = loadStage(data);
    expect(['r1', 'r2', 'r3'].every((id) => unit(s, id).inBuilding !== null)).toBe(true);
    expect(s.vision.blue.visible).toEqual([]);
    expect(s.vision.red.visible).toEqual([]);
  });

  it('(比較)家の間の通りを正面から進むと、2班とも倒される', () => {
    const s = play({ 1: { b1: { route: [P(120, 180)], policy: 'advance' }, b2: { route: [P(180, 180)], policy: 'advance' }, v1: { route: [P(150, 170)], policy: 'advance' } } }, 10);
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('狙撃手で家の中の敵を見つけ、IFV は土手から撃ち、射撃班は両脇から回り込めば、目標フェイズ以内に勝てる', () => {
    const s = play(
      {
        1: {
          bs: { route: [P(135, 93.5)], facing: D(115), fire: 'hold' },
          v1: { route: [P(150, 93.5)], facing: D(49), fire: 'hold' },
          b1: { route: [P(40, 25), P(40, 140)], fire: 'hold' },
          b2: { route: [P(270, 25), P(270, 150)], fire: 'hold' },
        },
        4: { bs: { facing: D(115), fire: 'free' }, v1: { facing: D(49), fire: 'free' } },
        6: { b1: { route: [P(30, 200), P(60, 248)], policy: 'advance' }, b2: { route: [P(270, 200), P(250, 248)], policy: 'advance' }, v1: { route: [P(150, 170)], facing: D(90) } },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
  });
});

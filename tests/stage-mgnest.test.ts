/**
 * ミッション12「機関銃陣地(配置あり)」:敵の機関銃の射界の外から攻める。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/mgnest.json';
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

describe('機関銃陣地(配置あり)', () => {
  it('敵の機関銃は陣地で据え付け、射界を陣地の正面(南)に向ける', () => {
    const s = runPhase(planAi(loadStage(data), data), 100).at(-1)!;
    const g = unit(s, 'rg');
    expect(g.mortarState).toBe('deployed');
    expect(g.orders.facing).toBeCloseTo(D(-90), 5);
  });

  it('(比較)射界の中の牧草地を正面から進むと、2班とも倒される', () => {
    const s = play({ 1: { b1: { route: [P(110, 150)], policy: 'advance' }, b2: { route: [P(190, 150)], policy: 'advance' } } }, data.par!);
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('林と果樹園(射界の外)を通って近づき、左右から同時に回り込めば、目標フェイズ以内に勝てる', () => {
    const s = play(
      {
        1: { b1: { route: [P(35, 30), P(40, 160)], fire: 'hold' }, b2: { route: [P(265, 30), P(260, 160)], fire: 'hold' }, m1: { deploy: true, fire: 'hold' }, bs: { fire: 'hold' } },
        7: {
          b1: { route: [P(78, 172)], fire: 'free', policy: 'advance', facing: D(0) },
          b2: { route: [P(222, 172)], fire: 'free', policy: 'advance', facing: D(180) },
          m1: { deploy: true, fire: 'hold', fireMissions: [{ target: { x: 150, y: 168 }, atSec: 0, kind: 'smoke' }] },
        },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
  });
});

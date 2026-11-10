/**
 * ミッション11「丘の上の機関銃(配置あり)」:機関銃で抑え、射撃班で回り込む(射撃と機動)。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/sentai.json';
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

describe('丘の上の機関銃(配置あり)', () => {
  it('(比較)機関銃を使わずに射撃班だけで正面から進むと、2班とも倒される', () => {
    const s = play({ 1: { b1: { route: [P(120, 170)], policy: 'advance' }, b2: { route: [P(170, 170)], policy: 'advance' }, g1: { fire: 'hold' } } }, data.par!);
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('機関銃を土手に据え付けて石垣を抑え、射撃班が西の林から横へ回れば、目標フェイズ以内に勝てる', () => {
    const s = play(
      {
        1: { g1: { route: [P(150, 44.5)], deploy: true, facing: D(90), fire: 'hold' }, b1: { route: [P(35, 30), P(35, 175)], fire: 'hold' }, b2: { route: [P(45, 30), P(45, 165)], fire: 'hold' } },
        3: { g1: { deploy: true, facing: D(90), fire: 'free' } },
        5: { b1: { route: [P(80, 192)], fire: 'free', policy: 'advance', facing: D(0) }, b2: { route: [P(80, 180)], fire: 'free', policy: 'advance', facing: D(10) } },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
    expect(unit(s, 'g1').mortarState).toBe('deployed');
  });
});

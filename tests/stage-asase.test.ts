/**
 * ミッション10「浅瀬の渡り(守る・配置あり)」:敵の IFV と歩兵の突撃を受け止める。
 */
import { describe, expect, it } from 'vitest';
import { applyAi, issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/asase.json';
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

describe('浅瀬の渡り(守る・配置あり)', () => {
  it('突撃型の IFV は回り込まず、歩兵より後ろにいる間は進まない', () => {
    const s0 = loadStage(data);
    // 出発時は歩兵と横並びなので、歩兵が 20 m 先へ出るまで待つ
    expect(unit(applyAi(s0, data.ai!), 'rv').orders.route).toEqual([]);
    // 歩兵が前に出たら、道を進む
    unit(s0, 'r1').pos = { x: 90, y: 250 };
    unit(s0, 'r3').pos = { x: 210, y: 250 };
    expect(unit(applyAi(s0, data.ai!), 'rv').orders.route.length).toBeGreaterThan(0);
    // 敵を見つけたら止まって撃つ(回り込み役にならない)
    const s2 = loadStage(data);
    s2.vision.red.visible = ['b1'];
    const o = unit(applyAi(s2, data.ai!), 'rv').orders;
    expect(o.route).toEqual([]);
    expect(o.policy).toBe('hold');
  });

  it('(比較)農場で守っているだけでは、遠くの IFV を倒せず勝てない', () => {
    const s = play({ 1: { m1: { deploy: true } } }, data.par!);
    expect(s.outcome).not.toBe('blueWin');
  });

  it('待機射撃で歩兵を抑え、対戦車火器の2班が生け垣を通って IFV の横から撃てば、目標フェイズ以内に勝てる', () => {
    const s = play(
      {
        1: {
          m1: { deploy: true, onCall: [{ target: { x: 90, y: 175 }, rounds: 3 }, { target: { x: 210, y: 175 }, rounds: 3 }] },
          b1: { route: [P(32, 120), P(32, 250)], fire: 'hold', facing: D(0) },
          b2: { route: [P(268, 120), P(268, 250)], fire: 'hold', facing: D(180) },
          b3: { enterId: 'houseE', facing: D(90), fire: 'hold' },
        },
        8: { b1: { route: [P(110, 255)], facing: D(0), fire: 'hold' }, b2: { route: [P(205, 255)], facing: D(180), fire: 'hold' } },
        10: { b1: { facing: D(0), fire: 'free', focusTargetId: 'rv' }, b2: { facing: D(180), fire: 'free', focusTargetId: 'rv' } },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
  });
});

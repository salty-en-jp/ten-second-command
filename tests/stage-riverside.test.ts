/**
 * ミッション7「川沿いの村(建物)」:建物にこもる敵への攻め方で勝敗が分かれるかの確認。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/riverside.json';
import { unit } from './helpers';

const data = st as StageData;
const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
const P = (x: number, y: number) => ({ pos: { x, y }, waitSec: 0 });
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

describe('川沿いの村(建物)', () => {
  it('敵の2班は最初から家の中にいて、出発地点からは見えない', () => {
    const s = loadStage(data);
    expect(unit(s, 'r1').inBuilding).toBe('houseW');
    expect(unit(s, 'r2').inBuilding).toBe('houseE');
    expect(s.vision.blue.visible).toEqual([]);
  });

  it('(比較)正面の開けた地面を進むと、2班とも倒される', () => {
    const s = play({ 1: { b1: { route: [P(75, 100)] }, b2: { route: [P(225, 100)] }, v1: { route: [P(150, 70)] } } }, 8);
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('(比較)IFV だけで村の真ん中へ出ると、家の対戦車火器に横から撃たれて撃破される', () => {
    const s = play(
      { 1: { v1: { route: [P(150, 60)] }, b1: { fire: 'hold' }, b2: { fire: 'hold' }, m1: { fire: 'hold' } }, 3: { v1: { route: [P(150, 93.5)], facing: Math.PI / 2 } } },
      6,
    );
    expect(unit(s, 'v1').alive).toBe(false);
  });

  it('果樹園を通って空き家に入り、IFV は対戦車火器の届かない遠くから撃てば、目標フェイズ以内に勝てる', () => {
    const f1 = Math.atan2(115 - 83, 75 - 38);
    const s = play(
      {
        1: {
          b1: { route: [P(40, 20), P(38, 79)], enterId: 'houseSW', fire: 'hold', facing: f1 },
          b2: { route: [P(30, 20), P(50, 74)], fire: 'hold', facing: f1 },
          v1: { route: [P(230, 12)], fire: 'hold', facing: Math.PI / 2 },
          m1: { deploy: true, fire: 'hold' },
        },
        5: {
          b1: { enterId: 'houseSW', fire: 'free', facing: f1 },
          b2: { fire: 'free', facing: f1 },
          v1: { fire: 'free', facing: Math.PI / 2, focusTargetId: 'r1' },
        },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
    expect(unit(s, 'b1').inBuilding).toBe('houseSW');
  });
});

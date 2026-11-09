/**
 * ミッション6「十字路の村(配置あり)」:配置の選び方で勝敗が分かれるかの確認。
 */
import { describe, expect, it } from 'vitest';
import { deployUnit, issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/crossroads.json';
import { unit } from './helpers';

const data = st as StageData;
const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
function play(deploy: Record<string, { x: number; y: number }>, plan: Record<number, Record<string, Partial<Orders>>>, phases: number): SimState[] {
  let s = loadStage(data);
  for (const [id, p] of Object.entries(deploy)) s = deployUnit(s, data.deployZone!, id, p);
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

describe('十字路の村(配置あり)', () => {
  it('配置フェイズがあり、配置エリアは敵の視界の外', () => {
    const s = loadStage(data);
    expect(data.deployment).toBe(true);
    expect(s.vision.red.visible).toEqual([]);
  });

  it('(比較)最初の配置のまま正面から進むと、2班とも倒される', () => {
    const s = play({}, { 1: { b1: { route: [{ pos: { x: 120, y: 75 }, waitSec: 0 }] }, b2: { route: [{ pos: { x: 180, y: 75 }, waitSec: 0 }] } } }, 6).at(-1)!;
    expect(unit(s, 'b1').alive || unit(s, 'b2').alive).toBe(false);
  });

  it('2班を東の端に配置して生け垣の中を進み、迫撃砲で抑えながら横から撃てば、目標フェイズ以内に勝てる', () => {
    const states = play(
      { b1: { x: 245, y: 20 }, b2: { x: 245, y: 24 }, bs: { x: 200, y: 20 }, m1: { x: 200, y: 8 } },
      {
        1: {
          b1: { route: [{ pos: { x: 245, y: 138 }, waitSec: 0 }], fire: 'hold' },
          b2: { route: [{ pos: { x: 245, y: 132 }, waitSec: 0 }], fire: 'hold' },
          bs: { fire: 'hold' },
          m1: { fire: 'hold', deploy: true },
        },
        // 生け垣から出て東の石垣へ回り込むと同時に、迫撃砲で敵Aを抑える
        6: {
          b1: { route: [{ pos: { x: 201.6, y: 158 }, waitSec: 0 }], facing: Math.PI },
          b2: { route: [{ pos: { x: 201.6, y: 170 }, waitSec: 0 }], facing: Math.PI },
          m1: { fire: 'hold', deploy: true, fireMissions: [0, 2, 4, 6, 8].map((atSec) => ({ target: { x: 160, y: 148.5 }, atSec })) },
        },
        8: { m1: { fire: 'hold', deploy: true, fireMissions: [0, 2, 4].map((atSec) => ({ target: { x: 135, y: 148.5 }, atSec })) } },
      },
      data.par!,
    );
    expect(states.at(-1)!.outcome).toBe('blueWin');
  });
});

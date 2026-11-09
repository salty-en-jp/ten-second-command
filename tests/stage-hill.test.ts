/**
 * 迫撃砲のマップ(stages/hill.json)の遊びが成り立っているかの確認。
 * 設計目標ではないが、マップや数値を変えたときに遊びが壊れていないかを見張る。
 */
import { describe, expect, it } from 'vitest';
import { DEG, issueOrders, loadStage, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import stageData from '../stages/hill.json';
import { unit } from './helpers';

const N = 90 * DEG;
const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
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
const fm = (t: { x: number; y: number }, times: number[]) => times.map((atSec) => ({ target: t, atSec }));
const toHedges = {
  b1: { route: [{ pos: { x: 95, y: 28 }, waitSec: 0 }, { pos: { x: 95, y: 85 }, waitSec: 0 }], fire: 'hold' as const, facing: N },
  b2: { route: [{ pos: { x: 205, y: 28 }, waitSec: 0 }, { pos: { x: 205, y: 85 }, waitSec: 0 }], fire: 'hold' as const, facing: N },
};

describe('丘の裏の砲座(迫撃砲)', () => {
  it('開始時は、どちらからも敵が見えない', () => {
    const s = loadStage(stageData as StageData);
    expect(s.vision.blue.visible).toEqual([]);
    expect(s.vision.red.visible).toEqual([]);
  });

  it('生け垣の中を進めば、見つからずに前の生け垣まで行けて、敵が見える', () => {
    const states = play({ 1: toHedges }, 3);
    for (const st of states) expect(st.vision.red.visible).toEqual([]);
    expect(states.at(-1)!.vision.blue.visible).toEqual(['r1', 'r2']);
  });

  it('観測があれば迫撃砲は2発目から正確に落ち、土塁の敵を制圧できる', () => {
    const states = play({ 1: { ...toHedges, m1: { deploy: true } }, 3: { m1: { deploy: true, fireMissions: fm({ x: 115, y: 152 }, [0, 2, 4, 6, 8]) } } }, 3);
    const s = states.at(-1)!;
    expect(unit(s, 'm1').adjustedAim).not.toBeNull();
    expect(unit(s, 'r1').suppression).toBeGreaterThanOrEqual(30);
  });

  it('お手本の手順で 8 フェイズ以内に勝てる', () => {
    const states = play(
      {
        1: { ...toHedges, m1: { deploy: true } },
        3: { m1: { deploy: true, fireMissions: fm({ x: 115, y: 152 }, [0, 2, 4, 6, 8]) } },
        4: { m1: { deploy: true, fireMissions: fm({ x: 115, y: 152 }, [0, 2, 4]) } },
        5: { b1: { facing: N }, b2: { facing: N } },
      },
      8,
    );
    expect(states.at(-1)!.outcome).toBe('blueWin');
  });
});

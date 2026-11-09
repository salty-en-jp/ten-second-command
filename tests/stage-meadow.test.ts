/**
 * IFV のマップ(stages/meadow.json)の遊びが成り立っているかの確認。
 * 設計目標ではないが、マップや数値を変えたときに遊びが壊れていないかを見張る。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import stageData from '../stages/meadow.json';
import { unit } from './helpers';

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
const toOrchard = (x0: number, y1: number) => [
  { pos: { x: x0, y: 20 }, waitSec: 0 },
  { pos: { x: 48, y: 20 }, waitSec: 0 },
  { pos: { x: 48, y: 150 }, waitSec: 0 },
  { pos: { x: 78, y: y1 }, waitSec: 0 },
];
const flank = {
  1: { bv: { dismount: true, fire: 'hold' as const }, b1: { route: toOrchard(110, 160), fire: 'hold' as const } },
  2: { b2: { route: toOrchard(150, 166).slice(1), fire: 'hold' as const } },
};

describe('牧草地の装甲車(IFV)', () => {
  it('開始時、味方は林の中にいて敵から見えない。第2班は IFV に乗っている', () => {
    const s = loadStage(stageData as StageData);
    expect(s.vision.red.visible).toEqual([]);
    expect(unit(s, 'b2').mountedIn).toBe('bv');
  });

  it('下車して西の沈み道を進めば、敵に見つからずに果樹園まで行ける', () => {
    const states = play(flank, 11);
    for (const st of states) expect(st.vision.red.visible).toEqual([]);
    expect(unit(states.at(-1)!, 'b1').mountedIn).toBeNull();
    expect(unit(states.at(-1)!, 'b2').mountedIn).toBeNull();
  });

  it('お手本:2班そろって果樹園から敵 IFV の側面に対戦車火器を撃てば、IFV を撃破して勝てる', () => {
    const states = play({ ...flank, 12: { b1: { fire: 'free' }, b2: { fire: 'free' } } }, 14);
    expect(unit(states[12]!, 'rv').alive).toBe(false);
    expect(states.at(-1)!.outcome).toBe('blueWin');
  });

  it('(比較)IFV で正面から出ても、敵 IFV は倒せない', () => {
    const states = play({ 1: { bv: { route: [{ pos: { x: 150, y: 110 }, waitSec: 0 }] } } }, 4);
    expect(unit(states.at(-1)!, 'rv').alive).toBe(true);
  });
});

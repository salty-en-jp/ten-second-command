/**
 * MVP マップ(stages/mvp.json)が「抑えて、見えない道で回り込むと決まる」マップになっているかの確認。
 * 設計目標ではないが、マップや数値を変えたときに遊びが壊れていないかを見張る。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import stageData from '../stages/mvp.json';
import { unit } from './helpers';

const O = (o: Partial<Orders>): Orders => ({
  route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o,
});
const phase = (s: SimState) => runPhase(s).at(-1)!;

describe('MVP マップ', () => {
  it('西の沈み道を射撃禁止で進めば、敵に見つからずに側面の瓦礫まで行ける', () => {
    let s = issueOrders(loadStage(stageData as StageData), {
      b2: O({ route: [{ pos: { x: 36, y: 108 }, waitSec: 0 }, { pos: { x: 61.2, y: 106 }, waitSec: 0 }], fire: 'hold' }),
    });
    for (let i = 0; i < 4; i++) s = phase(s);
    const b2 = unit(s, 'b2');
    expect(Math.hypot(b2.pos.x - 61.2, b2.pos.y - 106)).toBeLessThan(0.5);
    expect(b2.hp).toBe(100);
    expect(unit(s, 'r1').activity).toBe('route'); // 敵は気づいていない
  });

  it('側面の瓦礫から撃てば、石垣の敵は2フェイズ以内に倒れ、こちらはほぼ無傷', () => {
    let s = issueOrders(loadStage(stageData as StageData), {
      b2: O({ route: [{ pos: { x: 36, y: 108 }, waitSec: 0 }, { pos: { x: 61.2, y: 106 }, waitSec: 0 }], fire: 'hold' }),
    });
    for (let i = 0; i < 4; i++) s = phase(s);
    s = issueOrders(s, { b2: O({ facing: 0 }), b1: O({ route: [{ pos: { x: 100, y: 37.8 }, waitSec: 0 }], focusTargetId: 'r1' }) });
    s = phase(phase(s));
    expect(unit(s, 'r1').alive).toBe(false);
    expect(unit(s, 'b2').hp).toBeGreaterThan(90);
  });

  it('(比較)正面から撃ち合うだけでは、2フェイズたっても石垣の敵は倒れない', () => {
    let s = issueOrders(loadStage(stageData as StageData), {
      b1: O({ route: [{ pos: { x: 100, y: 37.8 }, waitSec: 0 }], focusTargetId: 'r1' }),
    });
    s = phase(phase(s));
    expect(unit(s, 'r1').alive).toBe(true);
  });
});

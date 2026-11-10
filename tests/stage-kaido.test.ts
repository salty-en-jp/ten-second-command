/**
 * ミッション8「街道の集落(守る・配置あり)」:家にこもって突撃型を迎え撃つ。
 */
import { describe, expect, it } from 'vitest';
import { canDeployAt, deployUnit, issueOrders, loadStage, planAi, runPhase, type Orders, type SimState, type StageData } from '../src/sim';
import { carryOver } from '../src/ui/orders';
import st from '../stages/kaido.json';
import { unit } from './helpers';

const data = st as StageData;
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
const P = (x: number, y: number) => ({ pos: { x, y }, waitSec: 0 });
function play(plan: Record<number, Record<string, Partial<Orders>>>, phases: number, start = loadStage(data)): SimState {
  let s = start;
  for (let p = 1; p <= phases && s.outcome === 'ongoing'; p++) {
    s = planAi(s, data);
    const o: Record<string, Orders> = {};
    for (const u of s.units) if (u.side === 'blue' && u.alive) o[u.id] = carryOver(u, s.tick);
    for (const [id, ch] of Object.entries(plan[p] ?? {})) o[id] = O(ch);
    s = runPhase(issueOrders(s, o)).at(-1)!;
  }
  return s;
}

describe('街道の集落(守る・配置あり)', () => {
  it('射撃班は最初から家の中にいる。敵は麦畑の中で見えない', () => {
    const s = loadStage(data);
    expect(['b1', 'b2', 'b3'].map((id) => unit(s, id).inBuilding)).toEqual(['houseW', 'houseC', 'houseE']);
    expect(s.vision.blue.visible).toEqual([]);
  });

  it('配置フェイズでは、射撃班を入れる家の中に置ける(1軒に1班)。迫撃砲班は置けない', () => {
    const s = loadStage(data);
    const zone = data.deployZone!;
    expect(canDeployAt(s, zone, { x: 70, y: 62 }, unit(s, 'b2'))).toBe(false); // 西の家には第1班がいる
    const moved = deployUnit(s, zone, 'b1', { x: 70, y: 40 });
    expect(unit(moved, 'b1').inBuilding).toBeNull();
    const back = deployUnit(moved, zone, 'b1', { x: 70, y: 62 });
    expect(unit(back, 'b1').inBuilding).toBe('houseW');
    expect(canDeployAt(s, zone, { x: 70, y: 62 }, unit(s, 'm1'))).toBe(false);
  });

  it('(比較)家から出て裏で待つと、防衛線を突破される', () => {
    const s = play({ 1: { b1: { route: [P(70, 50)] }, b2: { route: [P(150, 58)] }, b3: { route: [P(230, 50)] } } }, 12);
    expect(s.outcome).toBe('redWin');
  });

  it('家にこもって迫撃砲で用水路の敵を抑えれば、目標フェイズ以内に勝てる', () => {
    const D = (deg: number) => (deg * Math.PI) / 180;
    const s = play(
      {
        1: { b1: { enterId: 'houseW', facing: D(135) }, b2: { enterId: 'houseC', facing: D(90) }, b3: { enterId: 'houseE', facing: D(45) }, m1: { deploy: true } },
        3: { m1: { deploy: true, fireMissions: [0, 2, 4, 6, 8].map((atSec) => ({ target: { x: 150, y: 120 }, atSec })) } },
      },
      data.par!,
    );
    expect(s.outcome).toBe('blueWin');
  });
});

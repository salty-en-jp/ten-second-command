/** 機関銃チームのテスト。design.md 6.8 */
import { describe, expect, it } from 'vitest';
import { createState, DEG, makeFireteam, makeUnit, MG, rect, step, type Orders } from '../src/sim';
import { seconds, unit } from './helpers';

const N = 90 * DEG;
const S = -90 * DEG;
const O = (o: Partial<Orders>): Partial<Orders> => ({ fire: 'free', policy: 'hold', ...o });
const run = (s: ReturnType<typeof createState>, ticks: number) => {
  let c = s;
  for (let i = 0; i < ticks; i++) c = step(c);
  return c;
};
const open = { width: 400, height: 400, features: [] };

describe('機関銃チーム', () => {
  it('据え付けに 3 秒、動き出すには片付けに 2 秒', () => {
    const g = makeUnit('mg', 'g1', 'blue', { x: 100, y: 100 }, N, O({ deploy: true }));
    let s = createState(open, [g]);
    s = run(s, seconds(MG.setupSec) - 1);
    expect(unit(s, 'g1').mortarState).toBe('deploying');
    s = run(s, 2);
    expect(unit(s, 'g1').mortarState).toBe('deployed');
  });

  it('据え付けると遠く(150 m 先も減衰なし)まで撃てる。据え付けないと射撃班の半分', () => {
    const fight = (deployed: boolean) => {
      const g = makeUnit('mg', 'g1', 'blue', { x: 100, y: 50 }, N, O({ deploy: deployed, facing: N }));
      if (deployed) g.mortarState = 'deployed';
      const r = makeFireteam('r', 'red', { x: 100, y: 190 }, S, O({ fire: 'hold' }));
      r.ticksSinceFired = 0; // 見えている
      const s0 = createState(open, [g, r]);
      s0.vision.blue.visible = ['r'];
      return 100 - unit(run(s0, seconds(1)), 'r').hp;
    };
    const set = fight(true);
    expect(set).toBeCloseTo(MG.firepower * 0.6 * (19 / 20), 0); // 140 m・伏せていない…立っている目標(×1)…1秒弱
    expect(fight(false)).toBeLessThan(set * 0.5);
  });

  it('据え付けると扇形(60°)の外の敵は撃たない。外から撃たれたら 2 秒かけて据え直す', () => {
    const g = makeUnit('mg', 'g1', 'blue', { x: 100, y: 100 }, N, O({ deploy: true, facing: N }));
    g.mortarState = 'deployed';
    const r = makeFireteam('r', 'red', { x: 170, y: 100 }, 180 * DEG, O({ fire: 'free' })); // 真東(扇形の外)
    let s = createState(open, [g, r]);
    s.vision.blue.visible = ['r'];
    s.vision.red.visible = ['g1'];
    s = run(s, seconds(1));
    expect(unit(s, 'g1').shot).toBeNull();
    expect(unit(s, 'g1').reaimFacing).not.toBeNull();
    s = run(s, seconds(MG.reaimSec) + 2);
    expect(Math.abs(unit(s, 'g1').orders.facing!)).toBeLessThan(0.1); // 東を向いた
    expect(unit(s, 'g1').shot?.targetId).toBe('r');
  });

  it('撃ったあと 4 秒は見つかりやすい', () => {
    const g = makeUnit('mg', 'g1', 'blue', { x: 100, y: 100 }, N, O({}));
    g.ticksSinceFired = seconds(3);
    const r = makeFireteam('r', 'red', { x: 100, y: 330 }, S, O({ fire: 'hold' })); // 230 m:ふつうは見えない
    expect(createState(open, [g, r]).vision.red.visible).toContain('g1');
  });
});

describe('設計目標6〜8:機関銃', () => {
  const walls = {
    width: 200,
    height: 150,
    features: [
      { id: 'south', kind: 'hard' as const, poly: rect(100, 40, 40, 1) },
      { id: 'north', kind: 'hard' as const, poly: rect(100, 100, 40, 1) },
    ],
  };
  const mgBehindSouth = () => {
    const g = makeUnit('mg', 'g1', 'blue', { x: 100, y: 39 }, N, O({ deploy: true, facing: N }));
    g.mortarState = 'deployed';
    return g;
  };

  it('6:機関銃と射撃班が互いに硬い遮蔽の内側で正面から撃ち合っても、60 秒以内にはどちらも全滅しない', () => {
    const s = run(createState(walls, [mgBehindSouth(), makeFireteam('r', 'red', { x: 100, y: 101 }, S, O({}))]), seconds(60));
    expect(unit(s, 'g1').alive && unit(s, 'r').alive).toBe(true);
  });

  it('7:機関銃1つで、遮蔽の内側の射撃班を 2〜4 秒で制圧状態にできる', () => {
    const r = makeFireteam('r', 'red', { x: 100, y: 101 }, S, O({ fire: 'hold' }));
    let s = createState(walls, [mgBehindSouth(), r]);
    s.vision.blue.visible = ['r'];
    let t = 0;
    while (unit(s, 'r').suppression < 70 && t < seconds(10)) {
      s = step(s);
      t++;
    }
    expect(t).toBeGreaterThanOrEqual(seconds(2));
    expect(t).toBeLessThanOrEqual(seconds(4));
  });

  it('8:扇形の外(横)から射撃班に撃たれた機関銃は、30 秒以内に全滅する', () => {
    const r = makeFireteam('r', 'red', { x: 160, y: 39 }, 180 * DEG, O({})); // 真東の開けた地面
    const s0 = createState(walls, [mgBehindSouth(), r]);
    s0.vision.red.visible = ['g1'];
    let s = s0;
    let t = 0;
    while (unit(s, 'g1').alive && t < seconds(30)) {
      s = step(s);
      t++;
    }
    expect(unit(s, 'g1').alive).toBe(false);
  });
});

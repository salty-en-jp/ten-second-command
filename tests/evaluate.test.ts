/** ステージ評価のテスト */
import { describe, expect, it } from 'vitest';
import { createState, evaluate, makeFireteam, type SimState } from '../src/sim';

const start = createState({ width: 100, height: 100, features: [] }, [
  makeFireteam('b1', 'blue', { x: 10, y: 10 }, 0),
  makeFireteam('b2', 'blue', { x: 20, y: 10 }, 0),
  makeFireteam('r1', 'red', { x: 50, y: 90 }, 0),
]);
const end = (outcome: SimState['outcome'], b1hp: number, b2hp: number): SimState => ({
  ...start,
  outcome,
  units: start.units.map((u) =>
    u.id === 'b1' ? { ...u, hp: b1hp, alive: b1hp > 0 } : u.id === 'b2' ? { ...u, hp: b2hp, alive: b2hp > 0 } : { ...u, hp: 0, alive: false },
  ),
});

describe('ステージ評価', () => {
  it('負けたら星なし', () => {
    expect(evaluate(start, end('redWin', 0, 0), 5, 10).stars).toBe(0);
  });
  it('目標フェイズを超えて勝てば ★1', () => {
    expect(evaluate(start, end('blueWin', 100, 100), 11, 10).stars).toBe(1);
  });
  it('目標フェイズ以内でも、班が全滅していれば ★2', () => {
    const e = evaluate(start, end('blueWin', 100, 0), 10, 10);
    expect(e.stars).toBe(2);
    expect(e.destroyed).toEqual(['b2']);
  });
  it('目標フェイズ以内で、失った耐久が3割を超えれば ★2', () => {
    expect(evaluate(start, end('blueWin', 60, 70), 8, 10).stars).toBe(2); // 失ったのは 35%
  });
  it('目標フェイズ以内で、全滅なし・失った耐久3割以下なら ★3', () => {
    const e = evaluate(start, end('blueWin', 80, 60), 8, 10); // 失ったのは 30%
    expect(e.stars).toBe(3);
    expect(e.lossRatio).toBeCloseTo(0.3);
  });
});

describe('難易度:やさしい', () => {
  it('味方が受ける被害と制圧値が ×0.75 になる', async () => {
    const { createState, makeFireteam, step, DEG, DIFFICULTY } = await import('../src/sim');
    const mk = (easy: boolean) => {
      const s = createState({ width: 200, height: 200, features: [] }, [
        makeFireteam('b', 'blue', { x: 100, y: 50 }, 90 * DEG, { fire: 'hold' }),
        makeFireteam('r', 'red', { x: 100, y: 120 }, -90 * DEG, { fire: 'free' }),
      ]);
      if (easy) s.incoming = { blue: DIFFICULTY.easy.incoming };
      let c = s;
      for (let i = 0; i < 20; i++) c = step(c);
      return c.units.find((u) => u.id === 'b')!;
    };
    const n = mk(false);
    const e = mk(true);
    expect(100 - e.hp).toBeCloseTo((100 - n.hp) * 0.75, 5);
    expect(e.suppression).toBeCloseTo(n.suppression * 0.75, 0);
  });
});

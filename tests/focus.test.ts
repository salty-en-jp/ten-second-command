import { describe, expect, it } from 'vitest';
import { issueOrders } from '../src/sim';
import { blue, northBehindWall, red, runTicks, scenario, seconds, southBehindWall, unit } from './helpers';

describe('火力の集中(オプション命令)', () => {
  const start = () =>
    scenario([
      blue('b1', southBehindWall(90)),
      blue('b2', southBehindWall(110)),
      red('r1', northBehindWall(90)),
      red('r2', northBehindWall(110)),
    ]);

  it('指定しなければ、それぞれ一番近い敵を撃つ', () => {
    const s = runTicks(start(), seconds(2));
    expect(unit(s, 'b1').shot?.targetId).toBe('r1');
    expect(unit(s, 'b2').shot?.targetId).toBe('r2');
  });

  it('指定すれば、2班で同じ敵を撃つ', () => {
    const s0 = start();
    const b2 = unit(s0, 'b2');
    const s = runTicks(issueOrders(s0, { b2: { ...b2.orders, focusTargetId: 'r1' } }), seconds(2));
    expect(unit(s, 'b1').shot?.targetId).toBe('r1');
    expect(unit(s, 'b2').shot?.targetId).toBe('r1');
  });

  it('指定した敵が倒れたら、一番近い敵に切り替える', () => {
    const s0 = start();
    const b2 = unit(s0, 'b2');
    let s = issueOrders(s0, { b2: { ...b2.orders, focusTargetId: 'r1' } });
    s = { ...s, units: s.units.map((u) => (u.id === 'r1' ? { ...u, alive: false, hp: 0 } : u)) };
    s = runTicks(s, seconds(2));
    expect(unit(s, 'b2').shot?.targetId).toBe('r2');
  });
});

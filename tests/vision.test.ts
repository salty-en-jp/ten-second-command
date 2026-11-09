/** 視界ルール(design.md 4.1)のテスト */
import { describe, expect, it } from 'vitest';
import { FIRETEAM, rect, runPhase, sees, step, type MapData } from '../src/sim';
import { blue, NORTH, red, runTicks, scenario, seconds, SOUTH, unit } from './helpers';

const open: MapData = { width: 300, height: 300, features: [] };
const withBush: MapData = { width: 300, height: 300, features: [{ id: 'bush', kind: 'concealment', poly: rect(100, 200, 20, 20) }] };
const withBuilding: MapData = { width: 300, height: 300, features: [{ id: 'house', kind: 'building', poly: rect(100, 150, 20, 10) }] };
const holdFire = { fire: 'hold' as const, policy: 'hold' as const };

describe('視界', () => {
  it('向いている方向の扇形(120°)・視界距離の中にいる敵だけが見える', () => {
    const s = scenario([blue('b1', { x: 100, y: 100 }, NORTH, holdFire), red('r1', { x: 100, y: 100 + FIRETEAM.sightRange - 1 }, SOUTH, holdFire)], open);
    expect(s.vision.blue.visible).toContain('r1');
    const far = scenario([blue('b1', { x: 100, y: 100 }, NORTH, holdFire), red('r1', { x: 100, y: 100 + FIRETEAM.sightRange + 1 }, SOUTH, holdFire)], open);
    expect(far.vision.blue.visible).not.toContain('r1');
    // 真横(90°)は扇形の外
    const side = scenario([blue('b1', { x: 100, y: 100 }, NORTH, holdFire), red('r1', { x: 150, y: 100 }, SOUTH, holdFire)], open);
    expect(side.vision.blue.visible).not.toContain('r1');
  });

  it('建物は視線をさえぎる', () => {
    const s = scenario([blue('b1', { x: 100, y: 100 }, NORTH, holdFire), red('r1', { x: 100, y: 200 }, SOUTH, holdFire)], withBuilding);
    expect(s.vision.blue.visible).not.toContain('r1');
  });

  it('茂みの中の敵は、発見距離が半分になる', () => {
    const at = (d: number) =>
      scenario([blue('b1', { x: 100, y: 200 - d }, NORTH, holdFire), red('r1', { x: 100, y: 200 }, SOUTH, holdFire)], withBush).vision.blue.visible;
    expect(at(FIRETEAM.sightRange / 2 - 1)).toContain('r1');
    expect(at(FIRETEAM.sightRange / 2 + 1)).not.toContain('r1');
  });

  it('発砲したユニットは、その後 2 秒間は発見距離が 2 倍になる', () => {
    // 茂みの中(発見距離 60 m)から 100 m 先を撃つ。撃っている間は 120 m まで見える
    const s0 = scenario(
      [blue('b1', { x: 100, y: 100 }, NORTH, holdFire), red('r1', { x: 100, y: 200 }, SOUTH, { fire: 'free', policy: 'hold' }), blue('b2', { x: 100, y: 120 }, NORTH, holdFire)],
      withBush,
    );
    expect(s0.vision.blue.visible).not.toContain('r1');
    const firing = runTicks(s0, seconds(3));
    expect(unit(firing, 'r1').shot).not.toBeNull();
    expect(firing.vision.blue.visible).toContain('r1');
  });

  it('見えなくなった敵は、最後に見えた位置と時刻が残る', () => {
    // 味方が西へ歩いて、建物の陰で敵が見えなくなる(敵は北を向いていて味方に気づかない)
    const s0 = scenario(
      [
        blue('b1', { x: 160, y: 100 }, NORTH, { ...holdFire, facing: NORTH, route: [{ pos: { x: 100, y: 100 }, waitSec: 0 }] }),
        red('r1', { x: 100, y: 170 }, NORTH, holdFire),
      ],
      withBuilding,
    );
    expect(s0.vision.blue.visible).toContain('r1');
    const end = runPhase(runPhase(runPhase(s0).at(-1)!).at(-1)!).at(-1)!;
    expect(unit(end, 'b1').pos.x).toBeCloseTo(100);
    expect(end.vision.blue.visible).not.toContain('r1');
    const ls = end.vision.blue.lastSeen.r1!;
    expect(ls).toBeDefined();
    expect(ls.pos).toEqual(unit(end, 'r1').pos);
    expect(ls.tick).toBeGreaterThan(0);
    expect(ls.tick).toBeLessThan(end.tick);
  });

  it('見えていない敵は撃てない(射撃禁止で隠れている敵を、近くにいるだけで撃たない)', () => {
    const s0 = scenario(
      [blue('b1', { x: 100, y: 100 }, NORTH, { fire: 'free', policy: 'hold' }), red('r1', { x: 100, y: 200 }, SOUTH, holdFire)],
      withBuilding,
    );
    let s = s0;
    for (let i = 0; i < seconds(5); i++) s = step(s);
    expect(unit(s, 'b1').shot).toBeNull();
  });

  it('sees は生きているユニット同士だけ', () => {
    const s = scenario([blue('b1', { x: 100, y: 100 }), red('r1', { x: 100, y: 150 })], open);
    const dead = { ...unit(s, 'r1'), alive: false };
    expect(sees(open, unit(s, 'b1'), dead)).toBe(false);
  });
});

/** 建物への進入のテスト。design.md 6.7 */
import { describe, expect, it } from 'vitest';
import {
  BUILDING,
  buildingDamageFactor,
  createState,
  DEG,
  issueOrders,
  makeFireteam,
  makeIfv,
  makeMortar,
  MORTAR,
  pointInPolygon,
  rect,
  step,
  WALL,
  type MapData,
  type Orders,
  type SimState,
} from '../src/sim';
import { seconds, unit } from './helpers';

const N = 90 * DEG;
const S = -90 * DEG;
const W = 180 * DEG;
const E = 0;
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
// 家:中心 (200,150)、東西 14 m × 南北 10 m(南の壁 y=145)。入れない納屋:(100,150)
const town: MapData = {
  width: 400,
  height: 300,
  features: [
    { id: 'house', kind: 'building', enterable: true, poly: rect(200, 150, 14, 10) },
    { id: 'barn', kind: 'building', poly: rect(100, 150, 14, 10) },
  ],
};
const run = (s: SimState, ticks: number) => {
  let c = s;
  for (let i = 0; i < ticks; i++) c = step(c);
  return c;
};
const until = (s: SimState, max: number, cond: (s: SimState) => boolean) => {
  let c = s;
  for (let i = 1; i <= max; i++) {
    c = step(c);
    if (cond(c)) return { s: c, ticks: i };
  }
  return { s: c, ticks: null as number | null };
};
const house = town.features[0]!;
/** 家の中に赤の班を置いた状態 */
const occupied = (more: Parameters<typeof createState>[1], facing = S) => {
  const r = makeFireteam('r', 'red', { x: 200, y: 147 }, facing, O({ fire: 'free' }));
  r.inBuilding = 'house';
  return createState(town, [r, ...more]);
};

describe('入る・出る', () => {
  it('誰もいない建物には、入口に着いてから 3 秒で入る。中の点に置かれる', () => {
    const s0 = createState(town, [makeFireteam('b', 'blue', { x: 200, y: 130 }, N, O({ fire: 'hold' }))]);
    const s1 = issueOrders(s0, { b: O({ route: [{ pos: { x: 200, y: 144 }, waitSec: 0 }], enterId: 'house' }) });
    const at = until(s1, seconds(20), (x) => x.units[0]!.pos.y >= 144 - 1e-6);
    const inside = until(at.s, seconds(10), (x) => unit(x, 'b').inBuilding === 'house');
    // 着いたティックから数え始める
    expect(inside.ticks).toBe(seconds(BUILDING.enterSec) - 1);
    expect(pointInPolygon(unit(inside.s, 'b').pos, house.poly)).toBe(true);
  });

  it('中の班に経路を出すと、2 秒で行き先に近い壁から出て歩く', () => {
    const b = makeFireteam('b', 'blue', { x: 200, y: 147 }, N, O({ fire: 'hold' }));
    b.inBuilding = 'house';
    const s1 = issueOrders(createState(town, [b]), { b: O({ route: [{ pos: { x: 230, y: 150 }, waitSec: 0 }] }) });
    const out = until(s1, seconds(10), (x) => unit(x, 'b').inBuilding === null);
    expect(out.ticks).toBe(seconds(BUILDING.exitSec));
    expect(unit(out.s, 'b').pos.x).toBeGreaterThan(207); // 東の壁から出た
    const end = run(out.s, seconds(10));
    expect(unit(end, 'b').pos.x).toBeCloseTo(230, 1);
  });

  it('小さい建物には1つの陣営から1班しか入れない', () => {
    const a = makeFireteam('a', 'blue', { x: 200, y: 147 }, N, O({ fire: 'hold' }));
    a.inBuilding = 'house';
    const s0 = createState(town, [a, makeFireteam('b', 'blue', { x: 200, y: 144 }, N, O({ fire: 'hold', enterId: 'house' }))]);
    expect(unit(run(s0, seconds(6)), 'b').inBuilding).toBeNull();
  });

  it('入れない建物には入れない', () => {
    const s0 = createState(town, [makeFireteam('b', 'blue', { x: 100, y: 144 }, N, O({ fire: 'hold', enterId: 'barn' }))]);
    expect(unit(run(s0, seconds(6)), 'b').inBuilding).toBeNull();
  });
});

describe('中にいる班', () => {
  it('発見距離が半分になる(撃てば打ち消す)', () => {
    // 青は南 80 m:ふつうなら見える(120 m)が、建物の中の赤は 60 m まで近づかないと見えない
    const s0 = occupied([makeFireteam('b', 'blue', { x: 200, y: 67 }, N, O({ fire: 'hold' }))]);
    const r = unit(s0, 'r');
    r.orders = O({ fire: 'hold' });
    expect(createState(town, s0.units).vision.blue.visible).not.toContain('r');
    const near = occupied([makeFireteam('b', 'blue', { x: 200, y: 92 }, N, O({ fire: 'hold' }))]);
    expect(near.vision.blue.visible).toContain('r');
  });

  it('建物の中から外が見えて撃てる(建物は自分の視線をさえぎらない)', () => {
    const s0 = occupied([makeFireteam('b', 'blue', { x: 200, y: 100 }, N, O({ fire: 'hold' }))]);
    expect(s0.vision.red.visible).toContain('b');
  });

  it('向いている方向(±60°)から撃たれると被害は ×0.2、横・後ろからは ×0.5、同じ建物の中からは遮蔽なし', () => {
    const s0 = occupied([], S);
    const r = unit(s0, 'r');
    expect(buildingDamageFactor(town, r, { x: 200, y: 100 })).toBe(BUILDING.frontDamage);
    expect(buildingDamageFactor(town, r, { x: 260, y: 147 })).toBe(BUILDING.flankDamage);
    expect(buildingDamageFactor(town, r, { x: 200, y: 200 })).toBe(BUILDING.flankDamage);
    expect(buildingDamageFactor(town, r, { x: 203, y: 150 })).toBeNull();
  });

  it('撃たれると撃ってきた方へ向き直るので、1方向からだけなら ×0.2 で守られ続ける', () => {
    const s0 = occupied([makeFireteam('b', 'blue', { x: 230, y: 147 }, W, O({ fire: 'free' }))], S);
    unit(s0, 'r').ticksSinceFired = 0;
    s0.vision.blue.visible = ['r'];
    const end = run(s0, seconds(10));
    const r = unit(end, 'r');
    expect(Math.abs(Math.cos(r.facing - E))).toBeGreaterThan(0.9); // 東を向いた
    expect(r.alive).toBe(true);
  });
});

describe('突入', () => {
  it('敵のいる建物へは 3 秒で突入し、入った瞬間に中の敵へ手榴弾の被害', () => {
    const s0 = occupied([makeFireteam('b', 'blue', { x: 200, y: 144 }, N, O({ fire: 'hold', enterId: 'house' }))], N);
    unit(s0, 'r').orders = O({ fire: 'hold', facing: N });
    const inside = until(s0, seconds(10), (x) => unit(x, 'b').inBuilding === 'house');
    expect(inside.ticks).toBe(seconds(BUILDING.assaultSec));
    expect(100 - unit(inside.s, 'r').hp).toBeCloseTo(BUILDING.grenadeDamage, 5);
    expect(unit(inside.s, 'r').suppression).toBeGreaterThanOrEqual(BUILDING.grenadeSuppression - 1);
  });
});

describe('建物への攻撃', () => {
  it('IFV の機関砲で 12 秒撃たれると突破口が開き、中の班が被害を受ける。建物は崩れない', () => {
    const v = makeIfv('v', 'blue', { x: 200, y: 100 }, N, O({ fire: 'free' }));
    const s0 = occupied([v], S);
    unit(s0, 'r').orders = O({ fire: 'hold', facing: S });
    s0.vision.blue.visible = ['r'];
    unit(s0, 'r').ticksSinceFired = 0;
    const br = until(s0, seconds(20), (x) => x.map.features.find((f) => f.id === 'house')!.breached === true);
    expect(br.ticks).not.toBeNull();
    expect(br.ticks!).toBeLessThanOrEqual(seconds(WALL.collapseSec) + 2);
    expect(br.s.map.features.find((f) => f.id === 'house')!.kind).toBe('building');
    const r = unit(br.s, 'r');
    expect(r.alive).toBe(true);
    expect(buildingDamageFactor(br.s.map, r, { x: 200, y: 100 })).toBe(BUILDING.breachedDamage);
  });

  it('迫撃砲は屋根を抜けない:中の班への被害は ×0.1、制圧値はそのまま', () => {
    const m = makeMortar('m', 'blue', { x: 200, y: 0 }, N, O({ deploy: true, fireMissions: [{ target: { x: 200, y: 147 }, atSec: 0 }] }));
    m.mortarState = 'deployed';
    m.adjustedAim = { x: 200, y: 147 };
    let s = issueOrders(occupied([m]), { m: m.orders });
    unit(s, 'r').orders = O({ fire: 'hold' });
    s = run(s, seconds(MORTAR.flightSec) + 2);
    const r = unit(s, 'r');
    expect(100 - r.hp).toBeCloseTo(MORTAR.centerDamage * BUILDING.mortarFactor, 0);
    expect(r.suppression).toBeGreaterThan(MORTAR.suppression - 5);
  });

  it('軽対戦車火器は建物の中の班も撃てる', () => {
    const b = makeFireteam('b', 'blue', { x: 200, y: 100 }, N, O({ fire: 'free' }));
    b.atRounds = 1;
    const s0 = occupied([b], N);
    unit(s0, 'r').orders = O({ fire: 'hold', facing: N });
    unit(s0, 'r').ticksSinceFired = 0;
    s0.vision.blue.visible = ['r'];
    const fired = until(s0, seconds(6), (x) => unit(x, 'b').atRounds === 0);
    expect(fired.ticks).not.toBeNull();
  });
});

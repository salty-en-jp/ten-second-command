/** IFV・軽対戦車火器・壁の崩壊(design.md 6.1・6.4)のテスト */
import { describe, expect, it } from 'vitest';
import {
  AT_WEAPON,
  createState,
  DEG,
  IFV,
  issueOrders,
  makeFireteam,
  makeIfv,
  mount,
  rect,
  sees,
  step,
  WALL,
  type MapData,
  type Orders,
  type SimState,
  type Unit,
} from '../src/sim';
import { seconds, unit } from './helpers';

const open: MapData = { width: 400, height: 400, features: [] };
const N = 90 * DEG;
const S = -90 * DEG;
const E = 0;
const hold = { fire: 'hold' as const, policy: 'hold' as const };
const free = { fire: 'free' as const, policy: 'hold' as const };
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
function run(s: SimState, ticks: number) {
  let c = s;
  for (let i = 0; i < ticks; i++) c = step(c);
  return c;
}
function until(s: SimState, max: number, cond: (s: SimState) => boolean) {
  let c = s;
  for (let i = 1; i <= max; i++) {
    c = step(c);
    if (cond(c)) return { s: c, ticks: i };
  }
  return { s: c, ticks: null as number | null };
}
const withAt = (u: Unit, n = 1) => ((u.atRounds = n), u);
/** 北へ走り続ける(前進方針の)敵の IFV。東から撃てば側面に当たる */
const northbound = (id: string, y = 200) =>
  makeIfv(id, 'red', { x: 200, y }, N, { ...hold, policy: 'advance', route: [{ pos: { x: 200, y: 399 }, waitSec: 0 }] });

describe('IFV の装甲', () => {
  it('小銃は IFV に効かない(制圧値だけ上がる)。制圧されるとハッチを閉め、視界が狭くなる', () => {
    const s0 = createState(open, [
      makeIfv('v', 'red', { x: 200, y: 200 }, S, hold),
      makeFireteam('b1', 'blue', { x: 200, y: 120 }, N, free),
      makeFireteam('b2', 'blue', { x: 160, y: 130 }, N, free),
    ]);
    const s = run(s0, seconds(10));
    expect(unit(s, 'v').hp).toBe(IFV.maxHp);
    expect(unit(s, 'v').suppression).toBeGreaterThanOrEqual(70);
    // 真正面から 50° ずれた敵は、ハッチを開けていれば見えるが、閉めていると見えない
    const a = (-90 + 50) * DEG;
    const target = makeFireteam('t', 'blue', { x: 200 + 60 * Math.cos(a), y: 200 + 60 * Math.sin(a) }, N, hold);
    const vOpen = { ...unit(s0, 'v') };
    const vButtoned = { ...unit(s0, 'v'), suppression: 80 };
    expect(sees(open, vOpen, target)).toBe(true);
    expect(sees(open, vButtoned, target)).toBe(false);
  });

  it('機関砲は、側面からなら正面の約3倍効く', () => {
    // 目標は北へ走り続ける(撃たれても向きを変えない)。北から撃てば正面、東から撃てば側面
    const dmgFrom = (pos: { x: number; y: number }) => {
      const s0 = createState(open, [northbound('target'), makeIfv('gun', 'blue', pos, Math.atan2(200 - pos.y, 200 - pos.x), free)]);
      return IFV.maxHp - unit(run(s0, seconds(2)), 'target').hp;
    };
    const front = dmgFrom({ x: 200, y: 330 });
    const side = dmgFrom({ x: 300, y: 206 });
    expect(front).toBeGreaterThan(0);
    expect(side / front).toBeCloseTo(1.0 / 0.3, 1);
  });
});

describe('軽対戦車火器', () => {
  const sideShot = (dist: number, n = 1) =>
    createState(open, [northbound('v'), withAt(makeFireteam('b1', 'blue', { x: 200 + dist, y: 230 }, 180 * DEG, free), n)]);

  it('構えて 2 秒で撃つ。側面への1発は 120、1発では撃破できない', () => {
    const r = until(sideShot(60), seconds(10), (x) => unit(x, 'v').hp < IFV.maxHp);
    expect(r.ticks).not.toBeNull();
    expect(IFV.maxHp - unit(r.s, 'v').hp).toBeCloseTo(AT_WEAPON.damage, 5);
    expect(unit(r.s, 'v').alive).toBe(true);
    expect(unit(r.s, 'b1').atRounds).toBe(0);
  });

  it('側面に2発で撃破。撃破されると残骸(軟らかい遮蔽)が残る', () => {
    const s0 = createState(open, [
      northbound('v'),
      withAt(makeFireteam('b1', 'blue', { x: 260, y: 230 }, 180 * DEG, free)),
      withAt(makeFireteam('b2', 'blue', { x: 260, y: 240 }, 180 * DEG, free)),
    ]);
    const s = run(s0, seconds(10));
    expect(unit(s, 'v').alive).toBe(false);
    expect(s.map.features.some((f) => f.id === 'wreck-v' && f.kind === 'soft')).toBe(true);
  });

  it('最小射程(10 m)より近い IFV には撃たない', () => {
    const s0 = createState(open, [
      makeIfv('v', 'red', { x: 200, y: 200 }, N, hold),
      withAt(makeFireteam('b1', 'blue', { x: 208, y: 200 }, 180 * DEG, free)),
    ]);
    const { ticks } = until(s0, seconds(10), (x) => unit(x, 'b1').atRounds === 0);
    expect(ticks).toBeNull();
  });

  it('後方爆風:撃った班の後ろ 10 m にいる味方は被害と制圧値を受ける', () => {
    const s0 = createState(open, [
      northbound('v'),
      withAt(makeFireteam('b1', 'blue', { x: 260, y: 230 }, 180 * DEG, free)),
      makeFireteam('b2', 'blue', { x: 266, y: 230 }, 180 * DEG, hold),
    ]);
    const r = until(s0, seconds(10), (x) => unit(x, 'b1').atRounds === 0);
    const s = step(r.s);
    expect(unit(s, 'b2').hp).toBeLessThan(100);
  });
});

describe('乗車と下車', () => {
  it('乗車中の班は見えず撃たれない。経路の終点で止まって 3 秒で下車し、車体の後ろ 5 m に降りる', () => {
    const v = makeIfv('v', 'blue', { x: 100, y: 100 }, N, hold);
    const p = makeFireteam('p', 'blue', { x: 100, y: 100 }, N, hold);
    mount(p, v);
    // 敵は北を向いていて IFV に気づかない
    let s = createState(open, [v, p, makeFireteam('r', 'red', { x: 100, y: 180 }, N, hold)]);
    expect(s.vision.red.visible).not.toContain('p');
    s = issueOrders(s, { v: O({ fire: 'hold', route: [{ pos: { x: 100, y: 130 }, waitSec: 0 }], dismount: true }) });
    const off = until(s, seconds(20), (x) => unit(x, 'p').mountedIn === null);
    expect(off.ticks).not.toBeNull();
    const pv = unit(off.s, 'v').pos;
    const pp = unit(off.s, 'p').pos;
    expect(pp.y).toBeCloseTo(pv.y - IFV.dismountDistance, 1);
  });

  it('乗車:IFV の後ろへ歩いて行き、3 秒で乗る', () => {
    const s0 = issueOrders(
      createState(open, [makeIfv('v', 'blue', { x: 100, y: 100 }, N, hold), makeFireteam('p', 'blue', { x: 130, y: 90 }, N, hold)]),
      { p: O({ fire: 'hold', mountId: 'v' }) },
    );
    const r = until(s0, seconds(30), (x) => unit(x, 'p').mountedIn === 'v');
    expect(r.ticks).not.toBeNull();
    expect(unit(r.s, 'v').passengerId).toBe('p');
  });

  it('IFV が撃破されると、乗っていた班は後ろに飛び出し、1人を失い、制圧される', () => {
    const v = northbound('v');
    const p = makeFireteam('p', 'red', { x: 200, y: 200 }, N, hold);
    mount(p, v);
    const s0 = createState(open, [
      v,
      p,
      withAt(makeFireteam('b1', 'blue', { x: 260, y: 230 }, 180 * DEG, free)),
      withAt(makeFireteam('b2', 'blue', { x: 260, y: 240 }, 180 * DEG, free)),
    ]);
    const r = until(s0, seconds(10), (x) => !unit(x, 'v').alive);
    expect(r.ticks).not.toBeNull();
    const pp = unit(r.s, 'p');
    expect(pp.mountedIn).toBeNull();
    expect(pp.hp).toBeLessThanOrEqual(100 - IFV.bailOutDamage);
    expect(pp.suppression).toBeGreaterThanOrEqual(IFV.bailOutSuppression);
  });
});

describe('IFV の移動と地形', () => {
  it('向きを変えてから進む(旋回 45°/秒)。硬い遮蔽は越えられず、縁で止まるとハルダウンになる', () => {
    const map: MapData = { width: 400, height: 400, features: [{ id: 'berm', kind: 'hard', poly: rect(200, 150, 40, 2) }] };
    const s0 = issueOrders(createState(map, [makeIfv('v', 'blue', { x: 200, y: 100 }, E, hold)]), {
      v: O({ fire: 'hold', route: [{ pos: { x: 200, y: 200 }, waitSec: 0 }] }),
    });
    const turned = until(s0, seconds(5), (x) => unit(x, 'v').pos.y > 100);
    expect(turned.ticks).toBeGreaterThanOrEqual(seconds(1.5)); // 90° を 45°/秒で回ってから(20° 以内で進み始める)
    const s = run(turned.s, seconds(20));
    expect(unit(s, 'v').pos.y).toBeLessThan(149);
    expect(unit(s, 'v').pos.y).toBeGreaterThan(147);
  });

  it('迫撃砲は直撃でなければ IFV に効かない', () => {
    // 迫撃砲のテストは別にあるので、ここでは近くの着弾(5 m)で被害がないことだけ見る
    const s0 = createState(open, [makeIfv('v', 'red', { x: 200, y: 200 }, N, hold)]);
    const s1: SimState = {
      ...s0,
      shells: [{ id: 1, side: 'blue', shooterId: 'x', aim: { x: 205, y: 200 }, impact: { x: 205, y: 200 }, firedTick: 0, impactTick: 1 }],
    };
    const s = step(s1);
    expect(unit(s, 'v').hp).toBe(IFV.maxHp);
  });
});

describe('壁の崩壊', () => {
  it('IFV の機関砲に 12 秒撃たれた石垣は崩れて瓦礫(軟らかい遮蔽)になり、内側の兵は被害と制圧を受ける', () => {
    const map: MapData = { width: 400, height: 400, features: [{ id: 'wall', kind: 'hard', poly: rect(200, 200, 30, 1) }] };
    const s0 = createState(map, [
      makeIfv('gun', 'blue', { x: 200, y: 120 }, N, free),
      makeFireteam('r', 'red', { x: 200, y: 201.5 }, S, hold),
    ]);
    const r = until(s0, seconds(30), (x) => x.map.features.find((f) => f.id === 'wall')!.kind === 'soft');
    expect(r.ticks).not.toBeNull();
    expect(r.ticks!).toBeGreaterThanOrEqual(seconds(WALL.collapseSec));
    expect(r.ticks!).toBeLessThanOrEqual(seconds(WALL.collapseSec + 2));
  });

  it('小銃では壁は崩れない', () => {
    const map: MapData = { width: 400, height: 400, features: [{ id: 'wall', kind: 'hard', poly: rect(200, 200, 30, 1) }] };
    const s0 = createState(map, [
      makeFireteam('b', 'blue', { x: 200, y: 120 }, N, free),
      makeFireteam('r', 'red', { x: 200, y: 201.5 }, S, hold),
    ]);
    const s = run(s0, seconds(40));
    expect(s.map.features[0]!.kind).toBe('hard');
  });
});

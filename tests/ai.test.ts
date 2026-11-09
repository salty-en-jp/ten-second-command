/** 敵 AI(design.md 6.6)と、射撃開始線・防衛線のテスト */
import { describe, expect, it } from 'vitest';
import {
  applyAi,
  createState,
  DEG,
  issueOrders,
  makeFireteam,
  rect,
  step,
  type AiPlan,
  type MapData,
  type Orders,
  type SimState,
} from '../src/sim';
import { seconds, unit } from './helpers';

const open: MapData = { width: 400, height: 400, features: [] };
const N = 90 * DEG;
const S = -90 * DEG;
const hold = { fire: 'hold' as const, policy: 'hold' as const };
const O = (o: Partial<Orders>): Orders => ({ route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null, ...o });
function run(s: SimState, ticks: number) {
  let c = s;
  for (let i = 0; i < ticks; i++) c = step(c);
  return c;
}

describe('射撃開始線(待ち伏せ)', () => {
  it('射撃禁止でも、見えている敵が射撃開始線(60 m)に入ったら撃ち始める。それまでは撃たない', () => {
    const mk = (y: number) =>
      createState(open, [
        makeFireteam('r', 'red', { x: 200, y: 300 }, S, { ...hold, openFireRange: 60 }),
        makeFireteam('b', 'blue', { x: 200, y }, S, hold), // 南を向いていて敵に気づかない
      ]);
    expect(unit(run(mk(220), seconds(3)), 'r').shot).toBeNull(); // 80 m
    expect(unit(run(mk(245), seconds(3)), 'r').shot).not.toBeNull(); // 55 m
  });
});

describe('防衛線', () => {
  it('攻める側のユニットが防衛線を越えたら、守る側の負け', () => {
    const s0 = issueOrders(
      createState(open, [makeFireteam('r', 'red', { x: 200, y: 30 }, S, hold), makeFireteam('b', 'blue', { x: 20, y: 380 }, N, hold)]),
      { r: O({ fire: 'hold', route: [{ pos: { x: 200, y: 0 }, waitSec: 0 }] }) },
    );
    s0.defenseLine = { defender: 'blue', y: 10 };
    const s = run(s0, seconds(10));
    expect(s.outcome).toBe('redWin');
  });
});

describe('敵 AI', () => {
  it('公平さ:見えていないプレイヤーの班がどこにいても、AI の命令は同じ', () => {
    const plan: AiPlan = { personality: 'assault', side: 'red', advanceRoutes: { r: [{ x: 200, y: 50 }] }, flankPoints: [{ x: 50, y: 200 }] };
    const mk = (bx: number) => createState(open, [makeFireteam('r', 'red', { x: 200, y: 380 }, S, hold), makeFireteam('b', 'blue', { x: bx, y: 20 }, N, hold)]);
    const a = applyAi(mk(50), plan);
    const b = applyAi(mk(350), plan);
    expect(JSON.stringify(unit(a, 'r').orders)).toBe(JSON.stringify(unit(b, 'r').orders));
  });

  it('待ち伏せ型:最初は射撃禁止と射撃開始線で待つ。2人を失ったら次の陣地へ下がる', () => {
    const plan: AiPlan = {
      personality: 'ambush',
      side: 'red',
      positions: { r: [{ x: 200, y: 300, facingDeg: -90 }, { x: 200, y: 360, facingDeg: -90 }] },
    };
    const s0 = createState(open, [makeFireteam('r', 'red', { x: 200, y: 300 }, S, hold), makeFireteam('b', 'blue', { x: 200, y: 20 }, N, hold)]);
    const a = applyAi(s0, plan);
    expect(unit(a, 'r').orders.fire).toBe('hold');
    expect(unit(a, 'r').orders.openFireRange).toBe(60);
    const hurt = { ...s0, units: s0.units.map((u) => (u.id === 'r' ? { ...u, hp: 50 } : u)) };
    const b = applyAi(hurt, plan);
    expect(unit(b, 'r').orders.policy).toBe('withdraw');
    expect(unit(b, 'r').orders.route[0]!.pos).toEqual({ x: 200, y: 360 });
    expect(b.ai!.posIndex.r).toBe(1);
  });

  it('突撃型:敵を見つけたら、射線の通る一番近い班が抑え、残りは敵から見えない回り込み点へ向かう', () => {
    const map: MapData = { width: 400, height: 400, features: [{ id: 'house', kind: 'building', poly: rect(120, 200, 20, 40) }] };
    const plan: AiPlan = {
      personality: 'assault',
      side: 'red',
      advanceRoutes: {},
      flankPoints: [{ x: 300, y: 150 }, { x: 100, y: 200 }],
    };
    // 青の班(200, 100)は赤の両方から見えている。回り込み点 (100,200) は家の陰で、(300,150) は見えている
    const s0 = createState(map, [
      makeFireteam('r1', 'red', { x: 200, y: 200 }, S, hold),
      makeFireteam('r2', 'red', { x: 160, y: 260 }, S, hold),
      makeFireteam('b', 'blue', { x: 200, y: 100 }, N, hold),
    ]);
    expect(s0.vision.red.visible).toContain('b');
    const a = applyAi(s0, plan);
    expect(unit(a, 'r1').orders.focusTargetId).toBe('b');
    expect(unit(a, 'r1').orders.route).toEqual([]);
    expect(unit(a, 'r2').orders.route[0]!.pos).toEqual({ x: 100, y: 200 });
  });

  it('防御型:敵が遮蔽の効かない向きにいれば、その向きに正面が向いた近くの陣地へ移る', () => {
    // 石垣が2つ:南向きの陣地(南の石垣)と、東向きの陣地(東の石垣)
    const map: MapData = {
      width: 400,
      height: 400,
      features: [
        { id: 'wallS', kind: 'hard', poly: rect(200, 199, 20, 1) },
        { id: 'wallE', kind: 'hard', poly: rect(212, 210, 1, 20) },
      ],
    };
    const plan: AiPlan = {
      personality: 'defense',
      side: 'red',
      positions: { r: [{ x: 200, y: 200.5, facingDeg: -90 }, { x: 210.5, y: 210, facingDeg: 0 }] },
    };
    // 敵(青)は東から来た
    const s0 = createState(map, [makeFireteam('r', 'red', { x: 200, y: 200.5 }, 0, hold), makeFireteam('b', 'blue', { x: 300, y: 210 }, 180 * DEG, hold)]);
    // 敵を東で見かけたことにする(最終確認位置)
    s0.vision = { ...s0.vision, red: { visible: [], lastSeen: { b: { pos: { x: 300, y: 210 }, tick: 0 } } } };
    const a = applyAi(s0, plan);
    expect(unit(a, 'r').orders.route[0]!.pos).toEqual({ x: 210.5, y: 210 });
  });
});

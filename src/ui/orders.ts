import type { Orders, SimState, Unit } from '../sim';

export const UNIT_LABEL: Record<string, string> = { b1: '第1班', b2: '第2班', r1: '敵A', r2: '敵B' };
export const label = (u: { id: string }) => UNIT_LABEL[u.id] ?? u.id;

export function cloneOrders(o: Orders): Orders {
  return {
    ...o,
    route: o.route.map((w) => ({ pos: { ...w.pos }, waitSec: w.waitSec })),
    withdrawRoute: o.withdrawRoute.map((p) => ({ ...p })),
  };
}

/**
 * 次の計画フェイズの下書き:前の命令を引き継ぎ、経路はまだ通っていない部分だけ残す。
 */
export function carryOver(u: Unit): Orders {
  const o = cloneOrders(u.orders);
  o.route = o.route.slice(u.routeIndex);
  // 待機の途中なら、残りの待ち時間だけ残す
  const first = o.route[0];
  if (first && u.waitTicksLeft >= 0) o.route[0] = { pos: first.pos, waitSec: Math.ceil(u.waitTicksLeft / 20) };
  o.withdrawRoute = o.withdrawRoute.slice(u.withdrawIndex);
  return o;
}

export function draftsFor(state: SimState): Record<string, Orders> {
  const d: Record<string, Orders> = {};
  for (const u of state.units) if (u.side === 'blue' && u.alive) d[u.id] = carryOver(u);
  return d;
}

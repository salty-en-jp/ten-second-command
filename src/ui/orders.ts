import type { Orders, SimState, Unit, UnitKind } from '../sim';

/** 画面に出す部隊名(ステージデータの name から設定する) */
const UNIT_LABEL: Record<string, string> = {};
export function setLabels(units: Array<{ id: string; name?: string }>) {
  for (const k of Object.keys(UNIT_LABEL)) delete UNIT_LABEL[k];
  for (const u of units) if (u.name) UNIT_LABEL[u.id] = u.name;
}
export const label = (u: { id: string }) => UNIT_LABEL[u.id] ?? u.id;
export function addLabel(id: string, name: string) {
  UNIT_LABEL[id] = name;
}
/** 編成で買った部隊の名前(id の番号から) */
export function defaultName(kind: UnitKind, id: string): string {
  const n = id.replace(/^\D+/, '') || '1';
  return kind === 'fireteam' ? `第${n}班` : kind === 'sniper' ? `狙撃手${n === '1' ? '' : n}` : kind === 'mortar' ? `迫撃砲班${n === '1' ? '' : n}` : `IFV${n === '1' ? '' : n}`;
}

export function cloneOrders(o: Orders): Orders {
  return {
    ...o,
    route: o.route.map((w) => ({ pos: { ...w.pos }, waitSec: w.waitSec })),
    withdrawRoute: o.withdrawRoute.map((p) => ({ ...p })),
    fireMissions: (o.fireMissions ?? []).map((m) => ({ target: { ...m.target }, atSec: m.atSec, kind: m.kind })),
    smokeThrows: (o.smokeThrows ?? []).map((m) => ({ target: { ...m.target }, atSec: m.atSec })),
  };
}

/**
 * 次の計画フェイズの下書き:前の命令を引き継ぎ、経路はまだ通っていない部分だけ残す。
 */
export function carryOver(u: Unit, nowTick = 0): Orders {
  const o = cloneOrders(u.orders);
  o.route = o.route.slice(u.routeIndex);
  // 待機の途中なら、残りの待ち時間だけ残す
  const first = o.route[0];
  if (first && u.waitTicksLeft >= 0) o.route[0] = { pos: first.pos, waitSec: Math.ceil(u.waitTicksLeft / 20) };
  o.withdrawRoute = o.withdrawRoute.slice(u.withdrawIndex);
  // 迫撃砲:まだ撃っていない射撃命令だけ残す(発射時刻は次のフェイズの開始からの秒数に直す)
  o.fireMissions = u.missionQueue.map((m) => ({ target: { ...m.target }, atSec: Math.max(0, Math.round((m.tick - nowTick) / 20)), kind: m.kind }));
  o.smokeThrows = u.smokeQueue.map((m) => ({ target: { ...m.target }, atSec: Math.max(0, Math.round((m.tick - nowTick) / 20)) }));
  return o;
}

export function draftsFor(state: SimState): Record<string, Orders> {
  const d: Record<string, Orders> = {};
  for (const u of state.units) if (u.side === 'blue' && u.alive) d[u.id] = carryOver(u, state.tick);
  return d;
}

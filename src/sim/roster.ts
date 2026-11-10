/**
 * 編成(編成ポイント制)。design.md 3章
 * 配置フェイズのあるミッションでは、持ち点の中で、ミッションが決めた兵科の部隊を好きな数だけ買う(数の上限なし)。
 * 射撃班には軽対戦車火器(1発)を付けられる。余った点数は評価に使わない。
 */
import { DEPLOY_COST } from './config';
import { cloneState } from './step';
import { computeVision } from './vision';
import { makeUnit } from './units';
import type { DeployZone } from './deploy';
import { canDeployAt } from './deploy';
import { dist } from './geometry';
import type { SimState, Unit, UnitKind, Vec2 } from './types';

/** 1つの部隊の点数 */
export function unitCost(u: Pick<Unit, 'kind'>, at: boolean): number {
  return DEPLOY_COST[u.kind] + (u.kind === 'fireteam' && at ? DEPLOY_COST.at : 0);
}

/** 味方の部隊の合計点数 */
export function armyCost(state: SimState): number {
  return state.units.filter((u) => u.side === 'blue').reduce((a, u) => a + unitCost(u, u.atRounds > 0), 0);
}

/** この編成で出撃できるか:持ち点以内で、少なくとも1部隊 */
export function armyValid(state: SimState, budget: number): boolean {
  return state.units.some((u) => u.side === 'blue') && armyCost(state) <= budget;
}

const PREFIX: Record<UnitKind, string> = { fireteam: 'b', sniper: 'bs', mortar: 'm', ifv: 'v', mg: 'g' };

/** 新しく買う部隊の id(兵科ごとの番号。狙撃手の1人目は "bs") */
export function nextUnitId(state: SimState, kind: UnitKind): string {
  const used = new Set(state.units.map((u) => u.id));
  for (let n = 1; ; n++) {
    const id = kind === 'sniper' && n === 1 ? 'bs' : `${PREFIX[kind]}${n}`;
    if (!used.has(id)) return id;
  }
}

/** 配置エリアの中で、ほかの部隊から 12 m 以上離れた置ける場所(南の端の中央から順に探す) */
function freeSpot(state: SimState, zone: DeployZone, unit: Unit): Vec2 | null {
  const cx = zone.x + zone.w / 2;
  for (let dy = 2; dy <= zone.h; dy += 4) {
    for (let k = 0; k <= zone.w / 15; k++) {
      for (const sgn of [1, -1]) {
        const p = { x: cx + sgn * k * 15, y: zone.y + dy };
        if (!canDeployAt(state, zone, p, unit)) continue;
        if (state.units.some((u) => u.side === 'blue' && u.mountedIn === null && dist(u.pos, p) < 12)) continue;
        return p;
      }
    }
  }
  return null;
}

function finish(s: SimState): SimState {
  s.units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  s.vision = { blue: { visible: [], lastSeen: {} }, red: { visible: [], lastSeen: {} } };
  s.vision = computeVision(s);
  return s;
}

/** 部隊を1つ買って、配置エリアの空いている場所に置く。置ける場所がなければ null */
export function buyUnit(state: SimState, kind: UnitKind, zone: DeployZone): { state: SimState; id: string } | null {
  const id = nextUnitId(state, kind);
  const u = makeUnit(kind, id, 'blue', { x: 0, y: 0 }, Math.PI / 2);
  const p = freeSpot(state, zone, u);
  if (!p) return null;
  u.pos = p;
  const s = cloneState(state);
  s.units = [...s.units, u];
  return { state: finish(s), id };
}

/** 部隊を外す。IFV を外すと乗っていた班は降りる。乗っている班を外すと IFV は空になる */
export function sellUnit(state: SimState, id: string): SimState {
  const s = cloneState(state);
  s.units = s.units.filter((u) => u.id !== id);
  for (const u of s.units) {
    if (u.mountedIn === id) u.mountedIn = null;
    if (u.passengerId === id) u.passengerId = null;
  }
  return finish(s);
}

/** 射撃班の軽対戦車火器(1発)を付ける・外す */
export function setAt(state: SimState, id: string, on: boolean): SimState {
  const s = cloneState(state);
  for (const u of s.units) if (u.id === id && u.kind === 'fireteam') u.atRounds = on ? 1 : 0;
  return s;
}

/** 配置フェイズ:射撃班を IFV に乗せる(空いている IFV だけ) */
export function boardInDeployment(state: SimState, teamId: string, ifvId: string): SimState {
  const t = state.units.find((u) => u.id === teamId);
  const v = state.units.find((u) => u.id === ifvId);
  if (!t || !v || t.kind !== 'fireteam' || v.kind !== 'ifv' || v.passengerId !== null || t.mountedIn !== null) return state;
  const s = cloneState(state);
  const st = s.units.find((u) => u.id === teamId)!;
  const sv = s.units.find((u) => u.id === ifvId)!;
  st.mountedIn = ifvId;
  st.inBuilding = null;
  st.pos = { ...sv.pos };
  sv.passengerId = teamId;
  return finish(s);
}

/** 配置フェイズ:IFV から降ろして、配置エリアの空いている場所に置く */
export function leaveInDeployment(state: SimState, teamId: string, zone: DeployZone): SimState {
  const t = state.units.find((u) => u.id === teamId);
  if (!t || t.mountedIn === null) return state;
  const s = cloneState(state);
  const st = s.units.find((u) => u.id === teamId)!;
  const v = s.units.find((u) => u.id === st.mountedIn);
  st.mountedIn = null;
  if (v) v.passengerId = null;
  const p = freeSpot(s, zone, st);
  if (p) st.pos = p;
  return finish(s);
}

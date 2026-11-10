/**
 * 編成(編成ポイント制)。design.md 3章
 * 配置フェイズのあるミッションでは、ステージに書かれた部隊(控えを含む)から、持ち点の中で連れていく部隊を選ぶ。
 * 射撃班には軽対戦車火器(1発)を付けられる。余った点数は評価に使わない。
 */
import { DEPLOY_COST } from './config';
import { cloneState } from './step';
import { computeVision } from './vision';
import type { SimState, Unit } from './types';

/** 部隊ごとの選択:連れていくか、(射撃班なら)対戦車火器を持たせるか */
export type RosterChoice = Record<string, { take: boolean; at: boolean }>;

/** 1つの部隊の点数 */
export function unitCost(u: Pick<Unit, 'kind'>, at: boolean): number {
  return DEPLOY_COST[u.kind] + (u.kind === 'fireteam' && at ? DEPLOY_COST.at : 0);
}

/** 選んだ部隊の合計点数 */
export function rosterCost(state: SimState, choice: RosterChoice): number {
  let sum = 0;
  for (const u of state.units) {
    const c = choice[u.id];
    if (u.side === 'blue' && c?.take) sum += unitCost(u, c.at);
  }
  return sum;
}

/** この編成で出撃できるか:持ち点以内で、少なくとも1部隊 */
export function rosterValid(state: SimState, choice: RosterChoice, budget: number): boolean {
  const taken = state.units.filter((u) => u.side === 'blue' && choice[u.id]?.take);
  return taken.length > 0 && rosterCost(state, choice) <= budget;
}

/**
 * 選んだ部隊だけを残した状態を返す。
 * - 連れていかない味方は取り除く
 * - 射撃班の対戦車火器は、選んだときだけ1発
 * - 乗せていた IFV を連れていかなければ、班はその場で降りている。班を連れていかなければ IFV は空で出る
 */
export function applyRoster(state: SimState, choice: RosterChoice): SimState {
  const s = cloneState(state);
  const taken = (u: Unit) => u.side !== 'blue' || choice[u.id]?.take === true;
  s.units = s.units.filter(taken);
  for (const u of s.units) {
    if (u.side !== 'blue') continue;
    if (u.kind === 'fireteam') u.atRounds = choice[u.id]?.at ? 1 : 0;
    if (u.mountedIn !== null && !s.units.some((v) => v.id === u.mountedIn)) u.mountedIn = null;
    if (u.passengerId !== null && !s.units.some((p) => p.id === u.passengerId)) u.passengerId = null;
  }
  // 乗っている班は車両と同じ位置
  for (const u of s.units) {
    const v = u.mountedIn !== null ? s.units.find((x) => x.id === u.mountedIn) : undefined;
    if (v) u.pos = { ...v.pos };
  }
  s.vision = { blue: { visible: [], lastSeen: {} }, red: { visible: [], lastSeen: {} } };
  s.vision = computeVision(s);
  return s;
}

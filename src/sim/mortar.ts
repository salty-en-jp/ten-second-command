/**
 * 迫撃砲班。design.md 6.3
 * - 撃つには展開(4秒)が必要。移動するには撤収(3秒)が必要
 * - 射撃は「着弾位置」と「フェイズ内の発射時刻」で命令する。発射から着弾まで4秒
 * - 着弾を味方が見ていれば、その付近への次の射撃は正確。見ていなければ遠くへずれる
 */
import { BUILDING, MORTAR, TICKS_PER_SECOND } from './config';
import { dist } from './geometry';
import { lineOfFire, occupies } from './terrain';
import { unitStats } from './config';
import { angleDiff, angleTo } from './geometry';
import type { MapData, Side, SimState, Unit, Vec2 } from './types';
import { smokeBlocks } from './smoke';

const DEPLOY_TICKS = Math.round(MORTAR.deploySec * TICKS_PER_SECOND);
const PACK_TICKS = Math.round(MORTAR.packSec * TICKS_PER_SECOND);
const FLIGHT_TICKS = Math.round(MORTAR.flightSec * TICKS_PER_SECOND);
const INTERVAL_TICKS = Math.round(MORTAR.intervalSec * TICKS_PER_SECOND);
export const WARNING_TICKS = Math.round(MORTAR.warningSec * TICKS_PER_SECOND);

/** 射撃命令を、撃つティックつきの順番待ちに直す(issueOrders から呼ぶ) */
export function queueMissions(u: Unit, nowTick: number): void {
  const ms = u.orders.fireMissions ?? [];
  u.missionQueue = ms
    .map((m, i) => ({ target: { ...m.target }, tick: nowTick + Math.round(m.atSec * TICKS_PER_SECOND), i, kind: m.kind }))
    .sort((a, b) => a.tick - b.tick || a.i - b.i)
    .map(({ target, tick, kind }) => ({ target, tick, kind }));
}

/** 移動しようとしているか(まだ経路が残っている、退避中、離脱中) */
function wantsToMove(u: Unit): boolean {
  if (u.activity === 'seekingCover') return true;
  if (u.activity === 'withdrawing') return u.withdrawIndex < u.orders.withdrawRoute.length;
  if (u.activity === 'route' || u.activity === 'reacting' || u.activity === 'advancing') {
    return u.routeIndex < u.orders.route.length;
  }
  return false;
}

/** 展開・撤収を進める。移動できる(収納済み)なら true */
export function updateMortarState(u: Unit): boolean {
  if (u.mortarTicks > 0) {
    u.mortarTicks--;
    if (u.mortarTicks === 0) u.mortarState = u.mortarState === 'deploying' ? 'deployed' : 'packed';
  }
  const move = wantsToMove(u);
  if (move && u.mortarState === 'deployed') {
    u.mortarState = 'packing';
    u.mortarTicks = PACK_TICKS;
  } else if (!move && u.orders.deploy && u.mortarState === 'packed') {
    u.mortarState = 'deploying';
    u.mortarTicks = DEPLOY_TICKS;
  }
  return u.mortarState === 'packed';
}

/** 地点 p を、その陣営の誰かが見ているか(視界の扇形・距離・視線) */
export function pointObserved(state: SimState, side: Side, p: Vec2): boolean {
  return state.units.some((v) => {
    if (!v.alive || v.side !== side) return false;
    const st = unitStats(v.kind);
    if (dist(v.pos, p) > st.sightRange) return false;
    if (angleDiff(v.facing, angleTo(v.pos, p)) > st.sightArc / 2) return false;
    return lineOfFire(state.map, v.pos, p) && !smokeBlocks(state.map, v.pos, p);
  });
}

/**
 * 発射時刻が来た射撃命令を撃つ。撃ったら弾を返す。
 * 展開していない・釘付け・弾切れ・間隔待ちのときは撃たない(命令は残る)。射程外の命令は捨てる。
 */
export function tryFire(u: Unit, nextTick: number, map: MapData, shellId: number, pinned: boolean) {
  if (u.cooldownTicks > 0) u.cooldownTicks--;
  if (u.mortarState !== 'deployed' || pinned || u.rounds <= 0 || u.cooldownTicks > 0) return null;
  while (u.missionQueue.length > 0) {
    const m = u.missionQueue[0]!;
    if (m.tick > nextTick) return null;
    u.missionQueue.shift();
    const d = dist(u.pos, m.target);
    if (d < MORTAR.minRange || d > MORTAR.maxRange) continue; // 射程外
    const smoke = m.kind === 'smoke';
    if (smoke && u.smokeRounds <= 0) continue; // 発煙弾が残っていない
    const observed = u.adjustedAim !== null && dist(u.adjustedAim, m.target) <= MORTAR.adjustRadius;
    let impact = { ...m.target };
    if (!observed) {
      // 観測されていない:迫撃砲から見て遠くへずれる
      impact = {
        x: m.target.x + ((m.target.x - u.pos.x) / d) * MORTAR.unobservedError,
        y: m.target.y + ((m.target.y - u.pos.y) / d) * MORTAR.unobservedError,
      };
      impact.x = Math.max(0, Math.min(map.width, impact.x));
      impact.y = Math.max(0, Math.min(map.height, impact.y));
    }
    u.rounds--;
    if (smoke) u.smokeRounds--;
    u.cooldownTicks = INTERVAL_TICKS;
    u.lastFire = { tick: nextTick, point: { ...m.target } };
    return {
      id: shellId,
      side: u.side,
      shooterId: u.id,
      aim: { ...m.target },
      impact,
      firedTick: nextTick,
      impactTick: nextTick + FLIGHT_TICKS,
      kind: smoke ? ('smoke' as const) : ('he' as const),
    };
  }
  return null;
}

/** p にいる者が、どれかの遮蔽物の内側にいるか(迫撃砲は上から落ちるので向きは問わない) */
export function inAnyCover(map: MapData, p: Vec2): boolean {
  return map.features.some((f) => occupies(p, f));
}

/** 着弾したときの、ある目標への被害と制圧値 */
export function blastEffect(map: MapData, target: Unit, at: Vec2): { damage: number; suppression: number } | null {
  const d = dist(target.pos, at);
  if (d > MORTAR.suppressRadius) return null;
  // 建物の中:迫撃砲はほとんどの屋根を抜けない(FM 90-10-1 8-9)。制圧値はそのまま
  if (target.inBuilding !== null) {
    const damage = d < MORTAR.lethalRadius ? MORTAR.centerDamage * (1 - d / MORTAR.lethalRadius) * BUILDING.mortarFactor : 0;
    return { damage, suppression: MORTAR.suppression };
  }
  const cover = inAnyCover(map, target.pos);
  const f = cover ? MORTAR.coverFactor : target.prone ? MORTAR.proneFactor : 1;
  const damage = d < MORTAR.lethalRadius ? MORTAR.centerDamage * (1 - d / MORTAR.lethalRadius) * f : 0;
  const suppression = MORTAR.suppression * (cover ? 0.8 : 1);
  return { damage, suppression };
}

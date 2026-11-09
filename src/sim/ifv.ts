/**
 * 歩兵戦闘車(IFV)と軽対戦車火器。design.md 6.1・6.4
 * - IFV は車体の向きを持ち、旋回してから進む。後ろへ近いところへは後退する
 * - 建物と硬い遮蔽は越えられない(縁で止まれば、そのままハルダウンになる)。茂み・軟らかい遮蔽は遅くなる
 * - 射撃班を1つ乗せて運ぶ。乗車中の班は撃てず、撃たれない
 * - 装甲は当たった面(正面・側面・背面)で効き方が変わる。小銃は効かない
 */
import { AT_WEAPON, ARRIVE_EPSILON, IFV, IFV_ARMOR, TICKS_PER_SECOND } from './config';
import { angleDiff, angleTo, dist, pointInPolygon, rect, segmentHitsPolygon } from './geometry';
import { effectiveCover, lineOfFire } from './terrain';
import { smokeBlocks } from './smoke';
import type { MapData, SimState, Unit, Vec2 } from './types';

const MOUNT_TICKS = Math.round(IFV.mountSec * TICKS_PER_SECOND);
const AT_AIM_TICKS = Math.round(AT_WEAPON.aimSec * TICKS_PER_SECOND);

/** 角度を -π〜π に */
function wrap(a: number): number {
  let d = a % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** IFV が通れるか(建物・硬い遮蔽は通れない、地図の外も不可) */
export function ifvPassable(map: MapData, a: Vec2, b: Vec2): boolean {
  if (b.x < 0 || b.y < 0 || b.x > map.width || b.y > map.height) return false;
  return !map.features.some((f) => (f.kind === 'building' || f.kind === 'hard') && segmentHitsPolygon(a, b, f.poly));
}

function rough(map: MapData, p: Vec2): boolean {
  return map.features.some((f) => (f.kind === 'soft' || f.kind === 'concealment') && pointInPolygon(p, f.poly));
}

/** 向きを target 方向へ旋回速度の範囲で回す。向き終わったら true */
export function turnToward(u: Unit, desired: number): boolean {
  const step = IFV.turnRate / TICKS_PER_SECOND;
  const d = wrap(desired - u.facing);
  if (Math.abs(d) <= step) {
    u.facing = desired;
    return true;
  }
  u.facing = wrap(u.facing + Math.sign(d) * step);
  return false;
}

/** IFV を target へ1ティック動かす。着いたら true */
export function ifvMoveToward(map: MapData, u: Unit, target: Vec2): boolean {
  const d = dist(u.pos, target);
  if (d <= ARRIVE_EPSILON) return true;
  const heading = angleTo(u.pos, target);
  // 真後ろに近くて近い場所へは後退する
  const reverse = angleDiff(u.facing, heading) > (135 * Math.PI) / 180 && d < 30;
  const aligned = turnToward(u, reverse ? wrap(heading + Math.PI) : heading);
  if (!aligned && angleDiff(u.facing, reverse ? wrap(heading + Math.PI) : heading) > (20 * Math.PI) / 180) return false;
  const speed = (reverse ? IFV.reverseSpeed : IFV.speed) * (rough(map, u.pos) ? IFV.roughFactor : 1);
  const len = speed / TICKS_PER_SECOND;
  const next = d <= len ? { ...target } : { x: u.pos.x + ((target.x - u.pos.x) / d) * len, y: u.pos.y + ((target.y - u.pos.y) / d) * len };
  if (!ifvPassable(map, u.pos, next)) return false;
  u.pos = next;
  u.moved = true;
  return d <= len;
}

/** 経路をたどる(待機を含む) */
export function ifvFollowRoute(map: MapData, u: Unit): void {
  const wp = u.orders.route[u.routeIndex];
  if (!wp) return;
  if (u.waitTicksLeft < 0 && ifvMoveToward(map, u, wp.pos)) u.waitTicksLeft = Math.round(wp.waitSec * TICKS_PER_SECOND);
  if (u.waitTicksLeft >= 0) {
    if (u.waitTicksLeft === 0) {
      u.routeIndex++;
      u.waitTicksLeft = -1;
    } else u.waitTicksLeft--;
  }
}

export function ifvFollowWithdraw(map: MapData, u: Unit): void {
  const p = u.orders.withdrawRoute[u.withdrawIndex];
  if (!p) return;
  if (ifvMoveToward(map, u, p)) u.withdrawIndex++;
}

/** 当たった面:攻撃してきた位置が、車体の向きから ±45° なら正面、反対側 ±45° なら背面、それ以外は側面 */
export function armorFace(ifv: Unit, from: Vec2): 'front' | 'side' | 'rear' {
  const a = angleDiff(ifv.facing, angleTo(ifv.pos, from));
  if (a <= Math.PI / 4) return 'front';
  if (a >= (3 * Math.PI) / 4) return 'rear';
  return 'side';
}

/** IFV への被ダメージ係数(装甲の面と、正面が硬い遮蔽に守られていればハルダウンの ×0.2) */
export function ifvDamageFactor(map: MapData, ifv: Unit, from: Vec2, weapon: keyof typeof IFV_ARMOR): number {
  const f = IFV_ARMOR[weapon][armorFace(ifv, from)];
  const hullDown = weapon !== 'mortarDirect' && effectiveCover(map, ifv.pos, from) === 'hard' ? 0.2 : 1;
  return f * hullDown;
}

/** 車体の後ろの位置 */
export function behind(ifv: Unit, distance: number): Vec2 {
  return { x: ifv.pos.x - Math.cos(ifv.facing) * distance, y: ifv.pos.y - Math.sin(ifv.facing) * distance };
}

/**
 * 乗車:mountId を命じられた射撃班は IFV の後ろへ歩き、IFV が止まっていて空いていれば 3 秒で乗る。
 * 歩く処理は呼び出し側(歩兵の移動)に任せ、ここでは目標地点を返す。乗り終えたら null。
 */
export function mountStep(u: Unit, ifv: Unit | undefined): Vec2 | null {
  if (!ifv || !ifv.alive || ifv.kind !== 'ifv' || ifv.side !== u.side || (ifv.passengerId !== null && ifv.passengerId !== u.id)) {
    u.mountTicks = 0;
    return null;
  }
  const spot = behind(ifv, IFV.dismountDistance - 1);
  if (dist(u.pos, spot) > 2 || ifv.moved) {
    u.mountTicks = 0;
    return spot;
  }
  if (++u.mountTicks >= MOUNT_TICKS) {
    u.mountTicks = 0;
    u.mountedIn = ifv.id;
    u.pos = { ...ifv.pos };
    ifv.passengerId = u.id;
    u.orders = { ...u.orders, mountId: null, route: [] };
    u.routeIndex = 0;
    u.activity = 'route';
    u.prone = false;
    return null;
  }
  return spot;
}

/** 下車:IFV が止まっていれば 3 秒で、乗っている班を車体の後ろに降ろす */
export function dismountStep(ifv: Unit, passenger: Unit | undefined, map: MapData): void {
  if (!passenger) return;
  const routeDone = ifv.routeIndex >= ifv.orders.route.length;
  if (!ifv.orders.dismount || !routeDone || ifv.moved) {
    ifv.mountTicks = 0;
    return;
  }
  if (++ifv.mountTicks < MOUNT_TICKS) return;
  ifv.mountTicks = 0;
  unload(ifv, passenger, map);
}

function unload(ifv: Unit, passenger: Unit, map: MapData) {
  let p = behind(ifv, IFV.dismountDistance);
  if (!lineOfFire(map, ifv.pos, p)) p = { ...ifv.pos };
  passenger.mountedIn = null;
  passenger.pos = { x: Math.max(0, Math.min(map.width, p.x)), y: Math.max(0, Math.min(map.height, p.y)) };
  passenger.facing = ifv.facing;
  passenger.activity = 'route';
  passenger.routeIndex = 0;
  passenger.waitTicksLeft = -1;
  ifv.passengerId = null;
}

/** IFV が撃破されたとき:乗っていた班は後ろに飛び出し、1人を失い、制圧される。車体は残骸(軟らかい遮蔽)になる */
export function onIfvDestroyed(s: SimState, ifv: Unit): void {
  const p = s.units.find((u) => u.id === ifv.passengerId);
  if (p) {
    unload(ifv, p, s.map);
    p.hp = Math.max(1, p.hp - IFV.bailOutDamage);
    p.suppression = Math.min(100, p.suppression + IFV.bailOutSuppression);
    p.ticksSinceShot = 0;
    p.firedOn = true;
    p.shelledOnly = true;
  }
  s.map = {
    ...s.map,
    features: [
      ...s.map.features,
      { id: `wreck-${ifv.id}`, kind: 'soft', poly: rect(ifv.pos.x, ifv.pos.y, IFV.wreckSize.w, IFV.wreckSize.h, ifv.facing) },
    ],
  };
}

/**
 * 軽対戦車火器:射撃班は、見えている敵の IFV が射程(10〜150 m)にいれば 2 秒構えて撃つ(1発)。
 * 側面・背面を向けている IFV を優先する。撃ったら目標の id を返す。
 */
export function atDecide(u: Unit, enemies: Unit[], known: Set<string>, ready: boolean, map: MapData): string | null {
  u.atShot = null;
  if (!ready || u.atRounds <= 0 || u.orders.atAllowed === false) {
    u.atTargetId = null;
    u.atAimTicks = 0;
    return null;
  }
  const cands = enemies
    // 撃つのは IFV と、建物の中の班(壁ごと撃つ。FM 90-10-1 8-7)。IFV を先に狙う
    .filter((e) => (e.kind === 'ifv' || e.inBuilding !== null) && known.has(e.id))
    .filter((e) => {
      const d = dist(u.pos, e.pos);
      return d >= AT_WEAPON.minRange && d <= AT_WEAPON.range && lineOfFire(map, u.pos, e.pos) && !smokeBlocks(map, u.pos, e.pos);
    })
    .map((e) => ({ e, f: e.kind === 'ifv' ? 1 + ifvDamageFactor(map, e, u.pos, 'at') : 0, d: dist(u.pos, e.pos) }))
    .sort((a, b) => b.f - a.f || a.d - b.d);
  const t = cands[0]?.e;
  if (!t) {
    u.atTargetId = null;
    u.atAimTicks = 0;
    return null;
  }
  if (u.atTargetId === t.id) u.atAimTicks++;
  else {
    u.atTargetId = t.id;
    u.atAimTicks = 1;
  }
  if (u.atAimTicks < AT_AIM_TICKS) return null;
  u.atRounds--;
  u.atAimTicks = 0;
  u.atTargetId = null;
  u.atShot = t.id;
  return t.id;
}

/** 後方爆風を受けるか:撃った班の後ろ(目標と反対向き)の扇形・距離にいるか */
export function inBackblast(shooter: Vec2, target: Vec2, p: Vec2): boolean {
  const d = dist(shooter, p);
  if (d === 0 || d > AT_WEAPON.backblastRange) return false;
  const back = angleTo(target, shooter); // 目標から見て撃った班の向こう側
  return angleDiff(back, angleTo(shooter, p)) <= AT_WEAPON.backblastArc / 2;
}

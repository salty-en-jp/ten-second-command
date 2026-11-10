import {
  ARRIVE_EPSILON,
  BLIND_FIRE,
  CONTACT,
  COVER,
  DAMAGE,
  FIRETEAM,
  AT_WEAPON,
  BUILDING,
  IFV,
  MG,
  MORTAR,
  PHASE_TICKS,
  WALL,
  SNIPER,
  SMOKE,
  SUPPRESSION,
  unitStats,
  TICKS_PER_SECOND,
} from './config';
import { angleDiff, angleTo, dist, offsetPerimeterPoints } from './geometry';
import { effectiveCover, insideBuilding, lineOfFire, occupies, protectingHard, protects, walkable } from './terrain';
import { computeVision, sees } from './vision';
import { atDecide, dismountStep, ifvDamageFactor, ifvFollowRoute, ifvFollowWithdraw, inBackblast, mountStep, onIfvDestroyed, turnToward } from './ifv';
import { mortarSmoke, queueThrows, smokeBlocks, tryThrow, updateSmokes } from './smoke';
import { blastEffect, inAnyCover, pointObserved, queueMissions, triggerOnCall, tryFire, updateMortarState, WARNING_TICKS } from './mortar';
import { menAlive } from './units';
import { approachPoint, ASSAULT_TICKS, atEntrance, buildingById, buildingDamageFactor, capacityOf, ENTER_TICKS, EXIT_TICKS, insidePoint } from './building';
import type { MapData, Orders, SimState, Unit, Vec2 } from './types';

const REACTION_TICKS = Math.round(CONTACT.reactionSec * TICKS_PER_SECOND);
const QUIET_TICKS = Math.round(CONTACT.quietSecToEndContact * TICKS_PER_SECOND);
const RECOVERY_DELAY_TICKS = Math.round(SUPPRESSION.recoveryDelaySec * TICKS_PER_SECOND);

function cloneUnit(u: Unit): Unit {
  return {
    ...u,
    pos: { ...u.pos },
    coverTarget: u.coverTarget && { ...u.coverTarget },
    threatPos: u.threatPos && { ...u.threatPos },
    lastShotFrom: u.lastShotFrom && { ...u.lastShotFrom },
    lastKnownTargetPos: u.lastKnownTargetPos && { ...u.lastKnownTargetPos },
    lastFire: u.lastFire && { tick: u.lastFire.tick, point: { ...u.lastFire.point } },
    shot: u.shot && { ...u.shot, point: { ...u.shot.point } },
    orders: u.orders,
    missionQueue: u.missionQueue.map((m) => ({ target: { ...m.target }, tick: m.tick, kind: m.kind, registered: m.registered })),
    smokeQueue: u.smokeQueue.map((m) => ({ target: { ...m.target }, tick: m.tick })),
    adjustedAim: u.adjustedAim && { ...u.adjustedAim },
  };
}

export function cloneState(s: SimState): SimState {
  // 地形は変化しないので共有する
  // 地形と視界は書き換えずに作り直すので共有してよい
  return {
    tick: s.tick,
    map: s.map,
    outcome: s.outcome,
    units: s.units.map(cloneUnit),
    vision: s.vision,
    shells: s.shells, // 弾は書き換えずに配列ごと作り直す
    smokes: s.smokes,
    nextShellId: s.nextShellId,
    impacts: s.impacts,
    wallDamage: { ...s.wallDamage },
    defenseLine: s.defenseLine,
    ai: s.ai,
  };
}

export function createState(map: MapData, units: Unit[]): SimState {
  const sorted = units.map(cloneUnit).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const s: SimState = {
    tick: 0,
    map,
    units: sorted,
    outcome: 'ongoing',
    vision: { blue: { visible: [], lastSeen: {} }, red: { visible: [], lastSeen: {} } },
    shells: [],
    smokes: [],
    nextShellId: 1,
    impacts: [],
    wallDamage: {},
  };
  s.vision = computeVision(s);
  return s;
}

/**
 * 計画フェイズで命令を出す。経路は最初からやり直しになる。
 * 命令を渡さなかったユニットは、前の命令をそのまま続ける。
 */
export function issueOrders(state: SimState, orders: Record<string, Orders>): SimState {
  const s = cloneState(state);
  for (const u of s.units) {
    const o = orders[u.id];
    if (!o) continue;
    u.orders = {
      ...o,
      route: o.route.map((w) => ({ pos: { ...w.pos }, waitSec: w.waitSec })),
      withdrawRoute: o.withdrawRoute.map((p) => ({ ...p })),
      fireMissions: (o.fireMissions ?? []).map((m) => ({ target: { ...m.target }, atSec: m.atSec, kind: m.kind, registered: m.registered })),
      onCall: (o.onCall ?? []).map((t) => ({ target: { ...t.target }, rounds: t.rounds })),
      smokeThrows: (o.smokeThrows ?? []).map((m) => ({ target: { ...m.target }, atSec: m.atSec })),
    };
    if (u.kind === 'mortar') queueMissions(u, state.tick);
    if (u.smokeGrenades > 0 || (o.smokeThrows ?? []).length > 0) queueThrows(u, state.tick);
    if (u.inBuilding !== null || (o.enterId ?? null) !== (prevEnter(state, u.id) ?? null)) u.buildingTicks = 0;
    u.routeIndex = 0;
    u.waitTicksLeft = -1;
    u.withdrawIndex = 0;
    if (o.fire === 'hold') u.holdFireLifted = false;
    if (u.activity === 'advancing') u.activity = 'engaged';
  }
  return s;
}

function prevEnter(state: SimState, id: string): string | null | undefined {
  return state.units.find((x) => x.id === id)?.orders.enterId;
}

/** 1フェイズ(10秒)ぶん進める。各ティックの状態を順に返す(最後が次の計画フェイズの状態) */
export function runPhase(state: SimState, ticks = PHASE_TICKS): SimState[] {
  const frames: SimState[] = [];
  let s = state;
  for (let i = 0; i < ticks; i++) {
    s = step(s);
    frames.push(s);
  }
  return frames;
}

// ---------------------------------------------------------------- 知覚

function nearest(from: Vec2, units: Unit[]): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of units) {
    const d = dist(from, u.pos);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 移動

/** target へ speed(m/秒)で1ティックぶん近づく。着いたら true */
function moveToward(map: MapData, u: Unit, target: Vec2, speed: number): boolean {
  const d = dist(u.pos, target);
  if (d <= ARRIVE_EPSILON) return true;
  const stepLen = speed / TICKS_PER_SECOND;
  const next = d <= stepLen ? { ...target } : {
    x: u.pos.x + ((target.x - u.pos.x) / d) * stepLen,
    y: u.pos.y + ((target.y - u.pos.y) / d) * stepLen,
  };
  if (!walkable(map, u.pos, next)) return false; // 建物にぶつかる:止まる
  u.pos = next;
  u.moved = true;
  u.prone = false; // 動き出したら立つ
  return d <= stepLen;
}

/** 経路をたどる(待機を含む) */
function followRoute(map: MapData, u: Unit): void {
  const route = u.orders.route;
  const wp = route[u.routeIndex];
  if (!wp) return;
  if (u.waitTicksLeft < 0) {
    if (moveToward(map, u, wp.pos, unitStats(u.kind).speed)) {
      u.waitTicksLeft = Math.round(wp.waitSec * TICKS_PER_SECOND);
    }
  }
  if (u.waitTicksLeft >= 0) {
    if (u.waitTicksLeft === 0) {
      u.routeIndex++;
      u.waitTicksLeft = -1;
    } else {
      u.waitTicksLeft--;
    }
  }
}

function followWithdraw(map: MapData, u: Unit): void {
  const p = u.orders.withdrawRoute[u.withdrawIndex];
  if (!p) {
    u.activity = 'engaged';
    return;
  }
  if (moveToward(map, u, p, unitStats(u.kind).speed * CONTACT.withdrawSpeedFactor)) u.withdrawIndex++;
  if (u.withdrawIndex >= u.orders.withdrawRoute.length) u.activity = 'engaged';
}

/** 建物の中の班が、次に向かおうとしている地点(動くつもりがなければ null) */
function moveDest(u: Unit): Vec2 | null {
  if (u.activity === 'withdrawing') return u.orders.withdrawRoute[u.withdrawIndex] ?? null;
  if (u.activity === 'route' || u.activity === 'advancing') return u.orders.route[u.routeIndex]?.pos ?? null;
  return null;
}

/**
 * 建物に入る・出る。design.md 6.7
 * - 中にいて動こうとしているとき:2 秒で外へ出る(出口は行き先に一番近い壁の外)
 * - 経路の終点で「入る」を命じられているとき:入口へ歩き、3 秒で入る。敵がいれば突入(3 秒、入った瞬間に手榴弾)
 * 制圧状態以上では進まない。
 */
function buildingMove(map: MapData, u: Unit, prev: Unit[], canMove: boolean): void {
  if (u.kind !== 'fireteam' && u.kind !== 'sniper' && u.kind !== 'mg') return;
  if (u.inBuilding !== null) {
    const dest = moveDest(u);
    const b = buildingById(map, u.inBuilding);
    if (!dest || !b) {
      u.buildingTicks = 0;
      return;
    }
    if (!canMove || ++u.buildingTicks < EXIT_TICKS) return;
    u.pos = approachPoint(b, dest);
    u.inBuilding = null;
    u.buildingTicks = 0;
    u.moved = true;
    return;
  }
  const b = buildingById(map, u.orders.enterId);
  if (!b) return;
  // 経路を終えてから入る(撃ち合い中でも、経路を終えていれば入口へ向かう)
  const busy = u.activity === 'reacting' || u.activity === 'seekingCover' || (u.activity === 'withdrawing' && u.withdrawIndex < u.orders.withdrawRoute.length);
  if (u.routeIndex < u.orders.route.length || busy) {
    u.buildingTicks = 0;
    return;
  }
  if (!atEntrance(b, u.pos)) {
    u.buildingTicks = 0;
    if (canMove) moveToward(map, u, approachPoint(b, u.pos), unitStats(u.kind).speed);
    return;
  }
  if (!canMove) return;
  const friends = prev.filter((x) => x.alive && x.side === u.side && x.inBuilding === b.id && x.id !== u.id).length;
  if (friends >= capacityOf(b)) {
    u.buildingTicks = 0;
    return;
  }
  const foes = prev.some((x) => x.alive && x.side !== u.side && x.inBuilding === b.id);
  if (++u.buildingTicks < (foes ? ASSAULT_TICKS : ENTER_TICKS)) return;
  u.inBuilding = b.id;
  u.pos = insidePoint(b, u.pos);
  u.buildingTicks = 0;
  u.prone = false;
  if (foes) u.assaulted = b.id;
}

/** 3秒で届く範囲で、脅威の方向に正面が向いた遮蔽の位置を探す。design.md 7章 */
export function findCover(map: MapData, from: Vec2, threat: Vec2, speed: number = FIRETEAM.speed): Vec2 | null {
  const reach = speed * CONTACT.coverSearchSec;
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const f of map.features) {
    if (f.kind !== 'hard' && f.kind !== 'soft') continue;
    for (const q of offsetPerimeterPoints(f.poly, COVER.standoff, COVER.candidateSpacing)) {
      const d = dist(from, q);
      if (d > reach || d >= bestD) continue;
      if (insideBuilding(map, q) || !walkable(map, from, q)) continue;
      if (!protects(q, f, threat)) continue;
      best = q;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- スナイパー

/**
 * スナイパーの射撃判断。design.md 6.2
 * 射界(向きを中心に SNIPER.arcWidth)に入った敵を、反応時間ののちに1発撃つ。撃ったら装填を待つ。
 * 目標の優先順位:火力の集中で指定した敵 > 自分を撃ってきた敵 > 敵のスナイパー > 一番近い敵
 */
function sniperDecide(
  u: Unit,
  pu: Unit,
  enemies: Unit[],
  known: Set<string>,
  ready: boolean,
  map: MapData,
  prevById: Map<string, Unit>,
  nextTick: number,
): void {
  if (u.cooldownTicks > 0) u.cooldownTicks--;
  if (u.orders.focusTargetId !== null && !prevById.get(u.orders.focusTargetId)?.alive) {
    u.orders = { ...u.orders, focusTargetId: null };
  }
  if (!ready || isSuppressed(u)) {
    u.aimTargetId = null;
    u.aimTicks = 0;
    return;
  }
  const center = u.orders.facing ?? pu.facing;
  const cands = enemies.filter(
    (e) =>
      known.has(e.id) &&
      e.kind !== 'ifv' &&
      dist(u.pos, e.pos) <= SNIPER.range &&
      angleDiff(center, angleTo(u.pos, e.pos)) <= SNIPER.arcWidth / 2 &&
      lineOfFire(map, u.pos, e.pos) &&
      !smokeBlocks(map, u.pos, e.pos),
  );
  const t =
    cands.find((e) => e.id === u.orders.focusTargetId) ??
    cands.find((e) => e.id === pu.lastShooterId) ??
    nearest(u.pos, cands.filter((e) => e.kind === 'sniper')) ??
    nearest(u.pos, cands);
  if (!t) {
    u.aimTargetId = null;
    u.aimTicks = 0;
    return;
  }
  if (u.aimTargetId === t.id) u.aimTicks++;
  else {
    u.aimTargetId = t.id;
    u.aimTicks = 1;
  }
  u.threatPos = { ...t.pos };
  u.lastKnownTargetPos = { ...t.pos };
  u.lastKnownTargetId = t.id;
  const need = Math.round((t.moved ? SNIPER.reactionMovingSec : SNIPER.reactionStillSec) * TICKS_PER_SECOND);
  if (u.aimTicks >= need && u.cooldownTicks === 0) {
    u.shot = { targetId: t.id, point: { ...t.pos }, blind: false };
    u.lastFire = { tick: nextTick, point: { ...t.pos } };
    u.cooldownTicks = Math.round(SNIPER.cooldownSec * TICKS_PER_SECOND);
    u.aimTicks = 0;
  }
}

// ---------------------------------------------------------------- IFV

/**
 * IFV の1ティック(歩兵の接触ドリルは使わない)
 * - 敵を見つけたり撃たれたりしたら、接触後の方針に従う:保持=止まって車体を敵へ向ける、
 *   前進=経路を続けながら撃つ、離脱=離脱経路で下がる
 * - 砲塔は自動で目標を向く。撃てる相手は射撃班と同じく陣営が知っている敵
 * - 経路の終点で止まっていて「下車」が命じられていれば、乗っている班を降ろす
 */
function ifvTick(u: Unit, pu: Unit, seen: Unit[], wasShot: boolean, canFire: boolean, enemies: Unit[], known: Set<string>, s: SimState): void {
  const map = s.map;
  // 射撃禁止なら、敵を見ただけでは反応しない(撃たれたら反応する)
  const e = canFire ? nearest(u.pos, seen) : null;
  const threat = e ? e.pos : wasShot && !pu.shelledOnly && pu.lastShotFrom ? pu.lastShotFrom : null;
  if (threat) u.threatPos = { ...threat };
  if (u.activity === 'route' && threat) {
    u.activity =
      u.orders.policy === 'advance' ? 'advancing'
      : u.orders.policy === 'withdraw' && u.withdrawIndex < u.orders.withdrawRoute.length ? 'withdrawing'
      : 'engaged';
    if (u.activity === 'withdrawing') u.routeIndex = u.orders.route.length;
  }
  u.quietTicks = seen.length === 0 && !wasShot ? u.quietTicks + 1 : 0;
  if (u.activity !== 'route' && u.activity !== 'withdrawing' && u.quietTicks >= QUIET_TICKS) u.activity = 'route';

  switch (u.activity) {
    case 'withdrawing':
      ifvFollowWithdraw(map, u);
      break;
    case 'engaged':
      if (u.threatPos) turnToward(u, angleTo(u.pos, u.threatPos));
      break;
    default:
      ifvFollowRoute(map, u);
      if (u.routeIndex >= u.orders.route.length && u.orders.facing !== null && !u.moved) turnToward(u, u.orders.facing);
  }

  if (canFire) {
    const targets = enemies.filter(
      (t) =>
        known.has(t.id) && t.mountedIn === null && dist(u.pos, t.pos) <= IFV.cannonRange && lineOfFire(map, u.pos, t.pos) && !smokeBlocks(map, u.pos, t.pos),
    );
    if (u.orders.focusTargetId !== null && !targets.some((t) => t.id === u.orders.focusTargetId) && !enemies.some((t) => t.id === u.orders.focusTargetId)) {
      u.orders = { ...u.orders, focusTargetId: null };
    }
    const t = targets.find((x) => x.id === u.orders.focusTargetId) ?? nearest(u.pos, targets);
    if (t) {
      aim(u, t, false);
      u.turret = angleTo(u.pos, t.pos);
    } else u.turret = u.facing;
  } else u.turret = u.facing;

  if (u.passengerId) dismountStep(u, s.units.find((x) => x.id === u.passengerId), map);
}

// ---------------------------------------------------------------- 1ティック

function aim(u: Unit, t: Unit, blind: boolean): void {
  u.shot = { targetId: t.id, point: { ...t.pos }, blind };
  u.lastKnownTargetPos = { ...t.pos };
  u.lastKnownTargetId = t.id;
  u.threatPos = { ...t.pos };
}

const isSuppressed = (u: Unit) => u.suppression >= SUPPRESSION.suppressed;
const isPinned = (u: Unit) => u.suppression >= SUPPRESSION.pinned;

/** 射手の状態による係数。design.md 8.1 */
function shooterFactor(u: Unit): number {
  if (isPinned(u)) return 1; // 盲射。係数は BLIND_FIRE で別にかける
  if (isSuppressed(u)) return DAMAGE.shooterSuppressed;
  if (u.suppression >= SUPPRESSION.shaken) return DAMAGE.shooterShaken;
  return 1;
}

/** 据え付けた機関銃か */
const mgSet = (u: Unit) => u.kind === 'mg' && u.mortarState === 'deployed';

/** 距離による火力の減衰。design.md 6.1(据え付けた機関銃は 6.8 の射程) */
function rangeFactor(d: number, shooter?: Unit): number {
  const eff = shooter && mgSet(shooter) ? MG.effectiveRange : FIRETEAM.effectiveRange;
  const max = shooter && mgSet(shooter) ? MG.maxRange : FIRETEAM.maxRange;
  if (d <= eff) return 1;
  if (d >= max) return 0;
  return 1 - (d - eff) / (max - eff);
}

/**
 * 1ティック進める。state は書き換えず、新しい状態を返す。
 * 全ユニットは「前のティックの状態」を見て同時に判断し、射撃の効果は最後にまとめて反映する。
 * そのため、ユニットの処理順で結果が変わらない。
 */
export function step(state: SimState): SimState {
  if (state.outcome !== 'ongoing') return state;
  const map = state.map;
  const prev = state.units; // 判断は前のティックの状態から
  const s = cloneState(state);
  const prevById = new Map(prev.map((u) => [u.id, u]));

  // 各陣営が「知っている」敵:味方のだれかの視界に入っている敵と、前のティックにこちらを撃ってきた敵
  const known = { blue: new Set(state.vision.blue.visible), red: new Set(state.vision.red.visible) };
  for (const v of prev) {
    if (!v.alive) continue;
    if (v.shot?.targetId) {
      const t = prevById.get(v.shot.targetId);
      // 撃ってきた敵は見えていなくても撃ち返せる。ただし煙越しには撃ち返せない(煙の意味がなくなるため)
      if (t && !smokeBlocks(map, v.pos, t.pos)) known[t.side].add(v.id);
    }
  }

  // ---- 1. 各ユニットの判断と移動
  for (const u of s.units) {
    u.moved = false;
    u.shot = null;
    u.atShot = null;
    u.assaulted = null;
    if (!u.alive || u.mountedIn !== null) continue; // 乗車中は何もしない(位置はあとで車両に合わせる)
    const pu = prevById.get(u.id)!;
    const enemies = prev.filter((e) => e.alive && e.side !== u.side);
    const seen = enemies.filter((e) => sees(map, pu, e));
    const wasShot = pu.firedOn;
    const discovered = enemies.some((e) => sees(map, e, pu));

    // 射撃開始線:陣営が知っている敵がこの距離に入ったら撃ち始める(待ち伏せ)
    const inKillZone =
      u.orders.openFireRange != null &&
      enemies.some((e) => known[u.side].has(e.id) && dist(u.pos, e.pos) <= u.orders.openFireRange!);
    if (u.orders.fire === 'hold' && !u.holdFireLifted && (wasShot || discovered || inKillZone)) u.holdFireLifted = true;
    const canFire = u.orders.fire === 'free' || u.holdFireLifted;

    if (u.kind === 'ifv') {
      ifvTick(u, pu, seen, wasShot, canFire, enemies, known[u.side], s);
      continue;
    }

    // 迫撃砲だけに撃たれた(撃ってきた方向がない):遮蔽の内側ならとどまり、そうでなければ伏せる
    if (u.activity === 'route' && pu.shelledOnly && seen.length === 0) {
      u.activity = 'engaged';
      if (!inAnyCover(map, u.pos)) u.prone = true;
    }
    // 接触の発生
    if (u.activity === 'route' && (wasShot || (canFire && seen.length > 0))) {
      u.activity = 'reacting';
      u.reactTicksLeft = REACTION_TICKS;
      const e = nearest(u.pos, seen);
      u.threatPos = e ? { ...e.pos } : wasShot && pu.lastShotFrom ? { ...pu.lastShotFrom } : null;
    }
    if (wasShot && !pu.shelledOnly && pu.lastShotFrom && seen.length === 0) u.threatPos = { ...pu.lastShotFrom };

    // 接触の終了(敵が見えず、撃たれもしない状態が続いた)
    u.quietTicks = seen.length === 0 && !wasShot ? u.quietTicks + 1 : 0;
    if ((u.activity === 'engaged' || u.activity === 'advancing') && u.quietTicks >= QUIET_TICKS) {
      u.activity = 'route';
      u.prone = false;
      u.coverTarget = null;
    }

    // 移動
    // 迫撃砲は収納していないと動けない。飛翔音で伏せている間も動かない
    const mortarCanMove = u.kind === 'mortar' || u.kind === 'mg' ? updateMortarState(u) : true;
    if (u.duckTicks > 0) u.duckTicks--;
    const canMove = !isSuppressed(u) && mortarCanMove && u.duckTicks === 0;
    const mountTarget = u.orders.mountId ? s.units.find((x) => x.id === u.orders.mountId) : undefined;
    switch (u.activity) {
      case 'route':
        if (u.orders.mountId) {
          // 乗車:IFV の後ろへ歩いて行き、止まっている IFV に 3 秒で乗る
          const spot = mountStep(u, mountTarget);
          if (spot && canMove) moveToward(map, u, spot, unitStats(u.kind).speed);
          if (!spot && u.mountedIn === null) u.orders = { ...u.orders, mountId: null };
          if (u.mountedIn !== null) continue;
        } else if (canMove) followRoute(map, u);
        break;
      case 'reacting':
        if (canMove) followRoute(map, u); // 反応するまでは前の行動を続ける
        if (--u.reactTicksLeft <= 0) {
          const threat = u.threatPos ?? u.pos;
          if (mgSet(u)) {
            // 据え付けた機関銃は遮蔽を探して動かない(遮蔽の外なら伏せる)
            if (!effectiveCover(map, u.pos, threat) && u.inBuilding === null) u.prone = true;
            u.activity = 'engaged';
          } else if (u.inBuilding !== null || effectiveCover(map, u.pos, threat)) {
            u.activity = 'engaged';
          } else {
            u.coverTarget = findCover(map, u.pos, threat, unitStats(u.kind).speed);
            if (u.coverTarget) u.activity = 'seekingCover';
            else {
              u.prone = true;
              u.activity = 'engaged';
            }
          }
        }
        break;
      case 'seekingCover':
        if (!canMove) {
          u.prone = true;
          u.coverTarget = null;
          u.activity = 'engaged';
        } else if (u.coverTarget && moveToward(map, u, u.coverTarget, unitStats(u.kind).speed)) {
          u.coverTarget = null;
          u.activity = 'engaged';
        }
        break;
      case 'engaged':
        if (u.orders.policy === 'advance' && u.suppression < SUPPRESSION.advanceResumeBelow) {
          u.activity = 'advancing';
          u.prone = false;
        } else if (u.orders.policy === 'withdraw' && !isPinned(u) && u.withdrawIndex < u.orders.withdrawRoute.length) {
          u.activity = 'withdrawing';
          u.prone = false;
          u.routeIndex = u.orders.route.length; // 前進経路は取り消す
        }
        break;
      case 'advancing':
        if (u.suppression >= SUPPRESSION.advanceResumeBelow) u.activity = 'engaged';
        else followRoute(map, u);
        break;
      case 'withdrawing':
        if (!isPinned(u)) followWithdraw(map, u);
        break;
    }
    buildingMove(map, u, prev, canMove);

    // 射撃目標:陣営が知っている敵のうち、射程内で射線の通る敵
    const inContact = u.activity !== 'route' && u.activity !== 'reacting';
    // 発煙手榴弾(射撃班)
    if (u.kind === 'fireteam' && u.smokeQueue.length > 0) {
      const cloud = tryThrow(u, s.tick + 1, isPinned(u));
      if (cloud) s.smokes = [...s.smokes, cloud];
    }
    if (u.kind === 'mortar') {
      triggerOnCall(u, s.tick + 1, enemies.filter((e) => state.vision[u.side].visible.includes(e.id)).map((e) => e.pos));
      const shell = tryFire(u, s.tick + 1, map, s.nextShellId, isPinned(u));
      if (shell) {
        s.shells = [...s.shells, shell];
        s.nextShellId++;
      }
    }
    if (u.kind === 'sniper') {
      sniperDecide(u, pu, enemies, known[u.side], canFire && inContact, map, prevById, s.tick + 1);
    } else if (u.kind === 'mg' && u.reaimFacing !== null) {
      // 機関銃の据え直し中:撃たない
      if (u.cooldownTicks > 0) u.cooldownTicks--;
      if (u.cooldownTicks === 0) {
        u.orders = { ...u.orders, facing: u.reaimFacing };
        u.reaimFacing = null;
      }
    } else if (canFire && inContact) {
      const pinned = isPinned(u);
      // 据え付けた機関銃:向きを中心に 60° の扇形の中だけ、遠くまで撃てる。design.md 6.8
      const set = mgSet(u);
      const center = u.orders.facing ?? u.facing;
      const inArc = (p: Vec2) => !set || angleDiff(center, angleTo(u.pos, p)) <= MG.arcWidth / 2;
      const targets = enemies.filter(
        (e) =>
          known[u.side].has(e.id) &&
          inArc(e.pos) &&
          // 迫撃砲班の小銃は自衛用:有効射程(100 m)の中の敵だけを撃つ
          dist(u.pos, e.pos) < (u.kind === 'mortar' ? FIRETEAM.effectiveRange : set ? MG.maxRange : FIRETEAM.maxRange) &&
          lineOfFire(map, u.pos, e.pos) &&
          // 煙の向こうの敵は狙って撃てない(最終確認位置への制圧射撃はできる)
          !smokeBlocks(map, u.pos, e.pos) &&
          // 釘付けなら、効いている遮蔽の内側からの盲射だけ
          (!pinned || effectiveCover(map, u.pos, e.pos) !== null),
      );
      // 倒れた敵の最終確認位置は撃たない
      if (u.lastKnownTargetId !== null && !prevById.get(u.lastKnownTargetId)?.alive) {
        u.lastKnownTargetId = null;
        u.lastKnownTargetPos = null;
      }
      // 火力の集中:指定した敵が倒れたら指定を解除する
      if (u.orders.focusTargetId !== null && !prevById.get(u.orders.focusTargetId)?.alive) {
        u.orders = { ...u.orders, focusTargetId: null };
      }
      const focus = u.orders.focusTargetId;
      const focused = focus !== null ? targets.find((e) => e.id === focus) : undefined;
      const canSuppressAt = (p: Vec2 | null): p is Vec2 =>
        !pinned && p !== null && inArc(p) && dist(u.pos, p) < (set ? MG.maxRange : FIRETEAM.maxRange) && lineOfFire(map, u.pos, p);
      if (focused) {
        aim(u, focused, pinned);
      } else if (focus !== null && u.lastKnownTargetId === focus && canSuppressAt(u.lastKnownTargetPos)) {
        // 指定した敵が撃てない:その最終確認位置へ制圧射撃(指定は残す)
        u.shot = { targetId: null, point: { ...u.lastKnownTargetPos }, blind: false };
      } else {
        const t = nearest(u.pos, targets);
        // 扇形の外から撃たれて、扇形の中に撃てる敵がいない:そちらへ据え直す(2 秒)
        const from = wasShot && !pu.shelledOnly ? pu.lastShotFrom : null;
        if (set && !t && from && !inArc(from)) {
          u.reaimFacing = angleTo(u.pos, from);
          u.cooldownTicks = Math.round(MG.reaimSec * TICKS_PER_SECOND);
        } else if (t) aim(u, t, pinned);
        else if (u.orders.policy === 'hold' && u.activity === 'engaged' && canSuppressAt(u.lastKnownTargetPos)) {
          u.shot = { targetId: null, point: { ...u.lastKnownTargetPos }, blind: false }; // 制圧射撃
        }
      }
    }

    // 軽対戦車火器(射撃班のみ。見えている敵の IFV へ)
    if (u.kind === 'fireteam' && u.atRounds > 0 && atDecide(u, enemies, known[u.side], canFire && !isPinned(u), map)) {
      const t = prevById.get(u.atShot!)!;
      u.lastFire = { tick: s.tick + 1, point: { ...t.pos } };
    }

    // 向き(スナイパーは「向き」を指定されていれば射界を見張り続ける)
    if ((u.kind === 'sniper' || mgSet(u)) && u.orders.facing !== null) u.facing = u.orders.facing;
    else if (mgSet(u)) {
      // 据え付けたら、その向きを射界の中心として覚える
      u.orders = { ...u.orders, facing: u.facing };
    }
    else if (u.activity !== 'route' && u.threatPos) u.facing = angleTo(u.pos, u.threatPos);
    else if (u.orders.facing !== null) u.facing = u.orders.facing;
    else if (u.moved) u.facing = angleTo(pu.pos, u.pos);
  }

  // ---- 2. 射撃の効果を集計(射撃時の位置は前のティック)
  const dmg = new Map<string, number>();
  const supp = new Map<string, number>();
  const shotFrom = new Map<string, { pos: Vec2; id: string }>();
  const shelled = new Set<string>();
  const stopsRecovery = new Set<string>();
  let shooterId = '';
  const hit = (id: string, d: number, sp: number, from: Vec2, strong: boolean) => {
    dmg.set(id, (dmg.get(id) ?? 0) + d);
    supp.set(id, (supp.get(id) ?? 0) + sp);
    if (!shotFrom.has(id)) shotFrom.set(id, { pos: from, id: shooterId });
    if (strong) stopsRecovery.add(id);
  };
  for (const shooter of s.units) {
    if (!shooter.shot) continue;
    shooterId = shooter.id;
    const from = prevById.get(shooter.id)!.pos;
    if (shooter.kind === 'sniper') {
      // 1発の命中:耐久 −25、制圧値 +50(遮蔽の係数はかけない。design.md 6.2)
      if (shooter.shot.targetId !== null) hit(shooter.shot.targetId, SNIPER.damage, SNIPER.suppression, from, true);
      continue;
    }
    const isCannon = shooter.kind === 'ifv';
    const power = isCannon
      ? 1
      : (menAlive(shooter) / unitStats(shooter.kind).men) *
        shooterFactor(shooter) *
        (shooter.kind === 'mortar' ? MORTAR.smallArmsFactor : 1) *
        (shooter.kind === 'mg' && !mgSet(shooter) ? MG.unsetFactor : 1);
    const isMg = shooter.kind === 'mg';
    const firepower = isCannon ? IFV.firepower : isMg ? MG.firepower : FIRETEAM.firepower;
    const suppPerSec = isCannon ? IFV.suppressionPerSec : isMg ? MG.suppressionPerSec : SUPPRESSION.perFireteamPerSec;
    const strong = shooter.suppression < SUPPRESSION.stopsRecoveryBelow;
    const blindDmg = shooter.shot.blind ? BLIND_FIRE.damage : 1;
    const blindSupp = shooter.shot.blind ? BLIND_FIRE.suppression : 1;
    if (shooter.shot.targetId !== null && prevById.get(shooter.shot.targetId)!.kind === 'ifv') {
      // IFV を撃つ:小銃は装甲に効かず(制圧値だけ)、機関砲は当たった面で効き方が変わる
      const t = prevById.get(shooter.shot.targetId)!;
      const f = isCannon ? ifvDamageFactor(map, t, from, 'cannon') : 0;
      const r = isCannon ? 1 : rangeFactor(dist(from, t.pos), shooter) * power;
      hit(t.id, (firepower * f) / TICKS_PER_SECOND, (suppPerSec * r) / TICKS_PER_SECOND, from, strong);
    } else if (shooter.shot.targetId !== null) {
      const t = prevById.get(shooter.shot.targetId)!;
      const r = (isCannon ? 1 : rangeFactor(dist(from, t.pos), shooter)) * power;
      // 建物の中の班:向きの内側からは強く守られ、横・後ろや突破口のあとは弱い
      const bf = buildingDamageFactor(map, t, from);
      // IFV の機関砲に撃たれ続けた硬い遮蔽は崩れ、建物の外壁には突破口が開く
      if (isCannon) {
        const b = bf !== null ? buildingById(map, t.inBuilding) : null;
        const wall = b ? (b.breached ? null : b) : protectingHard(map, t.pos, from);
        if (wall) s.wallDamage[wall.id] = (s.wallDamage[wall.id] ?? 0) + 1;
      }
      const cover = effectiveCover(map, t.pos, from);
      const tf = bf !== null ? bf
        : cover === 'hard' ? COVER.hardDamage
        : cover === 'soft' ? COVER.softDamage
        : t.prone ? DAMAGE.proneOpen
        : t.moved ? DAMAGE.moving
        : DAMAGE.standingOpen;
      const sf = cover ? COVER.suppressionFactor : 1;
      hit(
        t.id,
        (firepower * r * tf * blindDmg) / TICKS_PER_SECOND,
        (suppPerSec * r * sf * blindSupp) / TICKS_PER_SECOND,
        from,
        strong,
      );
    } else {
      // 制圧射撃:ダメージなし、制圧値は半分
      const p = shooter.shot.point;
      const r = rangeFactor(dist(from, p), shooter) * power * SUPPRESSION.suppressiveFireFactor;
      for (const t of prev) {
        if (!t.alive || t.mountedIn !== null || t.side === shooter.side || dist(t.pos, p) > SUPPRESSION.suppressiveFireRadius) continue;
        const sf = effectiveCover(map, t.pos, from) ? COVER.suppressionFactor : 1;
        hit(t.id, 0, (suppPerSec * r * sf) / TICKS_PER_SECOND, from, strong);
      }
    }
  }

  // ---- 2a. 突入の手榴弾、軽対戦車火器と後方爆風、壁の崩壊
  for (const u of s.units) {
    if (!u.assaulted) continue;
    shooterId = u.id;
    for (const t of prev) {
      if (!t.alive || t.side === u.side || t.inBuilding !== u.assaulted) continue;
      hit(t.id, BUILDING.grenadeDamage, BUILDING.grenadeSuppression, u.pos, true);
    }
  }
  for (const shooter of s.units) {
    if (!shooter.atShot) continue;
    shooterId = shooter.id;
    const from = prevById.get(shooter.id)!.pos;
    const t = prevById.get(shooter.atShot)!;
    if (t.kind === 'ifv') hit(t.id, AT_WEAPON.damage * ifvDamageFactor(map, t, from, 'at'), AT_WEAPON.suppression, from, true);
    else hit(t.id, BUILDING.atDamage, BUILDING.atSuppression, from, true); // 建物の中の班を壁ごと撃つ
    for (const f of s.units) {
      if (!f.alive || f.mountedIn !== null || f.id === shooter.id || !inBackblast(from, t.pos, f.pos)) continue;
      hit(f.id, AT_WEAPON.backblastDamage, AT_WEAPON.backblastSuppression, from, true);
    }
  }
  for (const [id, ticks] of Object.entries(s.wallDamage)) {
    if (ticks < Math.round(WALL.collapseSec * TICKS_PER_SECOND)) continue;
    const wall = s.map.features.find((f) => f.id === id && (f.kind === 'hard' || (f.kind === 'building' && f.enterable)));
    delete s.wallDamage[id];
    if (!wall) continue;
    shooterId = '';
    const isBuilding = wall.kind === 'building';
    for (const u of s.units) {
      if (!u.alive || u.mountedIn !== null) continue;
      if (isBuilding ? u.inBuilding !== wall.id : !occupies(u.pos, wall)) continue;
      // 崩れた・突破された瞬間、内側の兵がはく離と破片で被害を受ける(FM 90-10-1 8-10)
      hit(u.id, WALL.collapseDamage, WALL.collapseSuppression, u.pos, true);
      shelled.add(u.id);
    }
    // 硬い遮蔽は瓦礫(軟らかい遮蔽)になる。建物は崩れず、突破口が開く
    const changed = isBuilding ? { ...wall, breached: true } : { ...wall, kind: 'soft' as const };
    s.map = { ...s.map, features: s.map.features.map((f) => (f === wall ? changed : f)) };
  }

  // ---- 2b. 迫撃砲弾:飛翔音の予兆と着弾(位置はこのティックに動いたあと)
  const nextTick = s.tick + 1;
  const landed = s.shells.filter((sh) => sh.impactTick === nextTick);
  for (const sh of s.shells) {
    if (sh.impactTick - nextTick !== WARNING_TICKS) continue;
    for (const u of s.units) {
      if (!u.alive || u.mountedIn !== null || u.kind === 'ifv' || dist(u.pos, sh.impact) > MORTAR.warningRadius) continue;
      // 遮蔽の内側ならその場にとどまり、そうでなければ伏せる(FM 7-8、TC 3-21.75 7-17)
      if (!inAnyCover(map, u.pos)) u.prone = true;
      u.duckTicks = Math.max(u.duckTicks, WARNING_TICKS + 1);
    }
  }
  for (const sh of landed) {
    shooterId = sh.shooterId;
    if (sh.kind === 'smoke') {
      // 発煙弾:着弾と同時に煙が立つ。ダメージはなく、近くの者の制圧値だけが上がる(白リンの心理的効果)
      s.smokes = [...s.smokes, mortarSmoke(sh.impact, nextTick, sh.id)];
      for (const t of s.units) {
        if (!t.alive || t.mountedIn !== null || dist(t.pos, sh.impact) > SMOKE.mortar.suppressRadius) continue;
        const directFire = supp.has(t.id);
        hit(t.id, 0, SMOKE.mortar.suppression, sh.impact, true);
        if (!directFire) shelled.add(t.id);
      }
      const shooter = s.units.find((u) => u.id === sh.shooterId);
      if (shooter && pointObserved(s, sh.side, sh.aim)) shooter.adjustedAim = { ...sh.aim };
      continue;
    }
    for (const t of s.units) {
      if (!t.alive || t.mountedIn !== null) continue;
      if (t.kind === 'ifv') {
        // 装甲車には直撃しか効かない(破片は装甲で防ぐ)。乗員はハッチを閉める(制圧値)
        const d = dist(t.pos, sh.impact);
        if (d > MORTAR.suppressRadius) continue;
        const dmg = d <= IFV.mortarDirectHitRadius ? MORTAR.centerDamage * ifvDamageFactor(map, t, sh.impact, 'mortarDirect') : 0;
        hit(t.id, dmg, MORTAR.suppression, sh.impact, true);
        shelled.add(t.id);
        continue;
      }
      const e = blastEffect(map, t, sh.impact);
      if (!e) continue;
      const directFire = supp.has(t.id);
      hit(t.id, e.damage, e.suppression, sh.impact, true);
      if (!directFire) shelled.add(t.id);
    }
    // 狙った地点を味方が見ていれば(観測者が着弾を見て修正を伝える)、次からはその付近に正確に落ちる
    const shooter = s.units.find((u) => u.id === sh.shooterId);
    if (shooter && pointObserved(s, sh.side, sh.aim)) shooter.adjustedAim = { ...sh.aim };
  }
  if (landed.length > 0) s.shells = s.shells.filter((sh) => sh.impactTick !== nextTick);
  s.impacts = [
    ...s.impacts.filter((im) => nextTick - im.tick <= TICKS_PER_SECOND),
    ...landed.map((sh) => ({ pos: { ...sh.impact }, tick: nextTick, side: sh.side })),
  ];

  // ---- 3. 反映
  for (const u of s.units) {
    if (!u.alive) continue;
    const sp = supp.get(u.id);
    u.firedOn = sp !== undefined;
    u.shelledOnly = shelled.has(u.id);
    if (sp !== undefined) {
      u.hp -= dmg.get(u.id) ?? 0;
      u.suppression += sp;
      if (!u.shelledOnly) {
        const sf = shotFrom.get(u.id)!;
        u.lastShotFrom = { ...sf.pos };
        u.lastShooterId = sf.id;
      }
    }
    if (stopsRecovery.has(u.id)) {
      u.ticksSinceShot = 0;
    } else {
      u.ticksSinceShot = Math.min(u.ticksSinceShot + 1, Number.MAX_SAFE_INTEGER);
      if (u.ticksSinceShot >= RECOVERY_DELAY_TICKS) u.suppression -= SUPPRESSION.recoveryPerSec / TICKS_PER_SECOND;
    }
    u.suppression = Math.max(0, Math.min(SUPPRESSION.max, u.suppression));
    if (u.suppression > SUPPRESSION.max - 1e-9) u.suppression = SUPPRESSION.max;
    if (u.hp <= 1e-9) {
      u.hp = 0;
      u.alive = false;
      u.shot = null;
      if (u.kind === 'ifv') onIfvDestroyed(s, u);
    }
  }

  // ---- 4. 発砲による暴露と視界
  for (const u of s.units) {
    const firedMortar = u.kind === 'mortar' && u.lastFire?.tick === s.tick + 1;
    u.ticksSinceFired = u.shot || u.atShot || firedMortar ? 0 : Math.min(u.ticksSinceFired + 1, Number.MAX_SAFE_INTEGER);
    // 乗車中の班は車両と一緒に動く
    if (u.mountedIn !== null) {
      const v = s.units.find((x) => x.id === u.mountedIn);
      if (v) u.pos = { ...v.pos };
    }
  }
  s.tick++;
  updateSmokes(s);
  s.vision = computeVision(s);

  // ---- 5. 勝敗
  // 片方の陣営がそもそもいない状態(計画フェイズのプレビュー)では勝敗を決めない
  const has = (side: 'blue' | 'red') => s.units.some((u) => u.side === side);
  if (has('blue') && has('red')) {
    const blue = s.units.some((u) => u.alive && u.side === 'blue');
    const red = s.units.some((u) => u.alive && u.side === 'red');
    s.outcome = blue && red ? 'ongoing' : blue ? 'blueWin' : red ? 'redWin' : 'draw';
    // 防衛線の突破:攻める側のユニットが線を越えたら、守る側の負け
    const line = s.defenseLine;
    if (line && s.outcome === 'ongoing') {
      const crossed = s.units.some((u) => u.alive && u.side !== line.defender && u.pos.y <= line.y);
      if (crossed) s.outcome = line.defender === 'blue' ? 'redWin' : 'blueWin';
    }
  }
  return s;
}

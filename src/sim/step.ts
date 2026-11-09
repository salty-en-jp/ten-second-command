import {
  ARRIVE_EPSILON,
  BLIND_FIRE,
  CONTACT,
  COVER,
  DAMAGE,
  FIRETEAM,
  PHASE_TICKS,
  SUPPRESSION,
  TICKS_PER_SECOND,
} from './config';
import { angleDiff, angleTo, dist, offsetPerimeterPoints } from './geometry';
import { effectiveCover, insideBuilding, lineOfFire, protects, walkable } from './terrain';
import { computeVision, sees } from './vision';
import { menAlive } from './units';
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
    shot: u.shot && { ...u.shot, point: { ...u.shot.point } },
    orders: u.orders,
  };
}

export function cloneState(s: SimState): SimState {
  // 地形は変化しないので共有する
  // 地形と視界は書き換えずに作り直すので共有してよい
  return { tick: s.tick, map: s.map, outcome: s.outcome, units: s.units.map(cloneUnit), vision: s.vision };
}

export function createState(map: MapData, units: Unit[]): SimState {
  const sorted = units.map(cloneUnit).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const s: SimState = { tick: 0, map, units: sorted, outcome: 'ongoing', vision: { blue: { visible: [], lastSeen: {} }, red: { visible: [], lastSeen: {} } } };
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
    };
    u.routeIndex = 0;
    u.waitTicksLeft = -1;
    u.withdrawIndex = 0;
    if (o.fire === 'hold') u.holdFireLifted = false;
    if (u.activity === 'advancing') u.activity = 'engaged';
  }
  return s;
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
  return d <= stepLen;
}

/** 経路をたどる(待機を含む) */
function followRoute(map: MapData, u: Unit): void {
  const route = u.orders.route;
  const wp = route[u.routeIndex];
  if (!wp) return;
  if (u.waitTicksLeft < 0) {
    if (moveToward(map, u, wp.pos, FIRETEAM.speed)) {
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
  if (moveToward(map, u, p, FIRETEAM.speed * CONTACT.withdrawSpeedFactor)) u.withdrawIndex++;
  if (u.withdrawIndex >= u.orders.withdrawRoute.length) u.activity = 'engaged';
}

/** 3秒で届く範囲で、脅威の方向に正面が向いた遮蔽の位置を探す。design.md 7章 */
export function findCover(map: MapData, from: Vec2, threat: Vec2): Vec2 | null {
  const reach = FIRETEAM.speed * CONTACT.coverSearchSec;
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

/** 距離による火力の減衰。design.md 6.1 */
function rangeFactor(d: number): number {
  if (d <= FIRETEAM.effectiveRange) return 1;
  if (d >= FIRETEAM.maxRange) return 0;
  return 1 - (d - FIRETEAM.effectiveRange) / (FIRETEAM.maxRange - FIRETEAM.effectiveRange);
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
      if (t) known[t.side].add(v.id);
    }
  }

  // ---- 1. 各ユニットの判断と移動
  for (const u of s.units) {
    u.moved = false;
    u.shot = null;
    if (!u.alive) continue;
    const pu = prevById.get(u.id)!;
    const enemies = prev.filter((e) => e.alive && e.side !== u.side);
    const seen = enemies.filter((e) => sees(map, pu, e));
    const wasShot = pu.firedOn;
    const discovered = enemies.some((e) => sees(map, e, pu));

    if (u.orders.fire === 'hold' && !u.holdFireLifted && (wasShot || discovered)) u.holdFireLifted = true;
    const canFire = u.orders.fire === 'free' || u.holdFireLifted;

    // 接触の発生
    if (u.activity === 'route' && (wasShot || (canFire && seen.length > 0))) {
      u.activity = 'reacting';
      u.reactTicksLeft = REACTION_TICKS;
      const e = nearest(u.pos, seen);
      u.threatPos = e ? { ...e.pos } : wasShot && pu.lastShotFrom ? { ...pu.lastShotFrom } : null;
    }
    if (wasShot && pu.lastShotFrom && seen.length === 0) u.threatPos = { ...pu.lastShotFrom };

    // 接触の終了(敵が見えず、撃たれもしない状態が続いた)
    u.quietTicks = seen.length === 0 && !wasShot ? u.quietTicks + 1 : 0;
    if ((u.activity === 'engaged' || u.activity === 'advancing') && u.quietTicks >= QUIET_TICKS) {
      u.activity = 'route';
      u.prone = false;
      u.coverTarget = null;
    }

    // 移動
    const canMove = !isSuppressed(u);
    switch (u.activity) {
      case 'route':
        if (canMove) followRoute(map, u);
        break;
      case 'reacting':
        if (canMove) followRoute(map, u); // 反応するまでは前の行動を続ける
        if (--u.reactTicksLeft <= 0) {
          const threat = u.threatPos ?? u.pos;
          if (effectiveCover(map, u.pos, threat)) {
            u.activity = 'engaged';
          } else {
            u.coverTarget = findCover(map, u.pos, threat);
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
        } else if (u.coverTarget && moveToward(map, u, u.coverTarget, FIRETEAM.speed)) {
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

    // 射撃目標:陣営が知っている敵のうち、射程内で射線の通る敵
    const inContact = u.activity !== 'route' && u.activity !== 'reacting';
    if (canFire && inContact) {
      const pinned = isPinned(u);
      const targets = enemies.filter(
        (e) =>
          known[u.side].has(e.id) &&
          dist(u.pos, e.pos) < FIRETEAM.maxRange &&
          lineOfFire(map, u.pos, e.pos) &&
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
        !pinned && p !== null && dist(u.pos, p) < FIRETEAM.maxRange && lineOfFire(map, u.pos, p);
      if (focused) {
        aim(u, focused, pinned);
      } else if (focus !== null && u.lastKnownTargetId === focus && canSuppressAt(u.lastKnownTargetPos)) {
        // 指定した敵が撃てない:その最終確認位置へ制圧射撃(指定は残す)
        u.shot = { targetId: null, point: { ...u.lastKnownTargetPos }, blind: false };
      } else {
        const t = nearest(u.pos, targets);
        if (t) aim(u, t, pinned);
        else if (u.orders.policy === 'hold' && u.activity === 'engaged' && canSuppressAt(u.lastKnownTargetPos)) {
          u.shot = { targetId: null, point: { ...u.lastKnownTargetPos }, blind: false }; // 制圧射撃
        }
      }
    }

    // 向き
    if (u.activity !== 'route' && u.threatPos) u.facing = angleTo(u.pos, u.threatPos);
    else if (u.orders.facing !== null) u.facing = u.orders.facing;
    else if (u.moved) u.facing = angleTo(pu.pos, u.pos);
  }

  // ---- 2. 射撃の効果を集計(射撃時の位置は前のティック)
  const dmg = new Map<string, number>();
  const supp = new Map<string, number>();
  const shotFrom = new Map<string, Vec2>();
  const stopsRecovery = new Set<string>();
  const hit = (id: string, d: number, sp: number, from: Vec2, strong: boolean) => {
    dmg.set(id, (dmg.get(id) ?? 0) + d);
    supp.set(id, (supp.get(id) ?? 0) + sp);
    if (!shotFrom.has(id)) shotFrom.set(id, from);
    if (strong) stopsRecovery.add(id);
  };
  for (const shooter of s.units) {
    if (!shooter.shot) continue;
    const from = prevById.get(shooter.id)!.pos;
    const power = (menAlive(shooter) / FIRETEAM.men) * shooterFactor(shooter);
    const strong = shooter.suppression < SUPPRESSION.stopsRecoveryBelow;
    const blindDmg = shooter.shot.blind ? BLIND_FIRE.damage : 1;
    const blindSupp = shooter.shot.blind ? BLIND_FIRE.suppression : 1;
    if (shooter.shot.targetId !== null) {
      const t = prevById.get(shooter.shot.targetId)!;
      const r = rangeFactor(dist(from, t.pos)) * power;
      const cover = effectiveCover(map, t.pos, from);
      const tf = cover === 'hard' ? COVER.hardDamage
        : cover === 'soft' ? COVER.softDamage
        : t.prone ? DAMAGE.proneOpen
        : t.moved ? DAMAGE.moving
        : DAMAGE.standingOpen;
      const sf = cover ? COVER.suppressionFactor : 1;
      hit(
        t.id,
        (FIRETEAM.firepower * r * tf * blindDmg) / TICKS_PER_SECOND,
        (SUPPRESSION.perFireteamPerSec * r * sf * blindSupp) / TICKS_PER_SECOND,
        from,
        strong,
      );
    } else {
      // 制圧射撃:ダメージなし、制圧値は半分
      const p = shooter.shot.point;
      const r = rangeFactor(dist(from, p)) * power * SUPPRESSION.suppressiveFireFactor;
      for (const t of prev) {
        if (!t.alive || t.side === shooter.side || dist(t.pos, p) > SUPPRESSION.suppressiveFireRadius) continue;
        const sf = effectiveCover(map, t.pos, from) ? COVER.suppressionFactor : 1;
        hit(t.id, 0, (SUPPRESSION.perFireteamPerSec * r * sf) / TICKS_PER_SECOND, from, strong);
      }
    }
  }

  // ---- 3. 反映
  for (const u of s.units) {
    if (!u.alive) continue;
    const sp = supp.get(u.id);
    u.firedOn = sp !== undefined;
    if (sp !== undefined) {
      u.hp -= dmg.get(u.id) ?? 0;
      u.suppression += sp;
      u.lastShotFrom = { ...shotFrom.get(u.id)! };
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
    }
  }

  // ---- 4. 発砲による暴露と視界
  for (const u of s.units) {
    u.ticksSinceFired = u.shot ? 0 : Math.min(u.ticksSinceFired + 1, Number.MAX_SAFE_INTEGER);
  }
  s.tick++;
  s.vision = computeVision(s);

  // ---- 5. 勝敗
  // 片方の陣営がそもそもいない状態(計画フェイズのプレビュー)では勝敗を決めない
  const has = (side: 'blue' | 'red') => s.units.some((u) => u.side === side);
  if (has('blue') && has('red')) {
    const blue = s.units.some((u) => u.alive && u.side === 'blue');
    const red = s.units.some((u) => u.alive && u.side === 'red');
    s.outcome = blue && red ? 'ongoing' : blue ? 'blueWin' : red ? 'redWin' : 'draw';
  }
  return s;
}

import { unitStats } from './config';
import type { Orders, Side, Unit, UnitKind, Vec2 } from './types';

export function defaultOrders(): Orders {
  return { route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null };
}

/** 射撃班を作る */
export function makeFireteam(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return makeUnit('fireteam', id, side, pos, facing, orders);
}

/** スナイパーを作る */
export function makeSniper(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return makeUnit('sniper', id, side, pos, facing, orders);
}

export function makeUnit(kind: UnitKind, id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return {
    id,
    side,
    kind,
    pos: { ...pos },
    facing,
    hp: unitStats(kind).maxHp,
    suppression: 0,
    alive: true,
    prone: false,
    orders: { ...defaultOrders(), ...orders },
    activity: 'route',
    reactTicksLeft: 0,
    routeIndex: 0,
    waitTicksLeft: -1,
    withdrawIndex: 0,
    coverTarget: null,
    holdFireLifted: false,
    ticksSinceShot: Number.MAX_SAFE_INTEGER,
    firedOn: false,
    quietTicks: 0,
    threatPos: null,
    lastShotFrom: null,
    lastKnownTargetPos: null,
    lastKnownTargetId: null,
    moved: false,
    shot: null,
    ticksSinceFired: Number.MAX_SAFE_INTEGER,
    lastShooterId: null,
    cooldownTicks: 0,
    aimTargetId: null,
    aimTicks: 0,
    lastFire: null,
  };
}

/** 残っている人数 */
export function menAlive(u: Unit): number {
  return Math.max(0, Math.ceil(u.hp / unitStats(u.kind).hpPerMan - 1e-9));
}

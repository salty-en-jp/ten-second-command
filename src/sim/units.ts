import { FIRETEAM } from './config';
import type { Orders, Side, Unit, Vec2 } from './types';

export function defaultOrders(): Orders {
  return { route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [] };
}

/** 射撃班を作る */
export function makeFireteam(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return {
    id,
    side,
    pos: { ...pos },
    facing,
    hp: FIRETEAM.maxHp,
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
    quietTicks: 0,
    threatPos: null,
    lastShotFrom: null,
    lastKnownTargetPos: null,
    moved: false,
    shot: null,
  };
}

/** 残っている人数 */
export function menAlive(u: Unit): number {
  return Math.max(0, Math.ceil(u.hp / FIRETEAM.hpPerMan - 1e-9));
}

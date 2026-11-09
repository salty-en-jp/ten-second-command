import { MORTAR, SMOKE, unitStats } from './config';
import type { Orders, Side, Unit, UnitKind, Vec2 } from './types';

export function defaultOrders(): Orders {
  return { route: [], facing: null, fire: 'free', policy: 'hold', withdrawRoute: [], focusTargetId: null };
}

/** 射撃班を作る */
export function makeFireteam(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return makeUnit('fireteam', id, side, pos, facing, orders);
}

/** IFV を作る */
export function makeIfv(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return makeUnit('ifv', id, side, pos, facing, orders);
}

/** 射撃班を IFV に乗せた状態にする(ステージの初期配置用) */
export function mount(passenger: Unit, ifv: Unit): void {
  passenger.mountedIn = ifv.id;
  passenger.pos = { ...ifv.pos };
  ifv.passengerId = passenger.id;
}

/** 迫撃砲班を作る */
export function makeMortar(id: string, side: Side, pos: Vec2, facing: number, orders?: Partial<Orders>): Unit {
  return makeUnit('mortar', id, side, pos, facing, orders);
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
    mortarState: 'packed',
    mortarTicks: 0,
    rounds: kind === 'mortar' ? MORTAR.rounds : 0,
    smokeRounds: kind === 'mortar' ? SMOKE.mortar.maxRounds : 0,
    smokeGrenades: kind === 'fireteam' ? SMOKE.grenade.perTeam : 0,
    smokeQueue: [],
    missionQueue: [],
    adjustedAim: null,
    duckTicks: 0,
    shelledOnly: false,
    mountedIn: null,
    passengerId: null,
    mountTicks: 0,
    turret: facing,
    atRounds: 0,
    atTargetId: null,
    atAimTicks: 0,
    atShot: null,
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

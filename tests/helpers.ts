import {
  createState,
  DEG,
  makeFireteam,
  rect,
  runPhase,
  step,
  TICKS_PER_SECOND,
  type MapData,
  type Orders,
  type SimState,
  type Unit,
} from '../src/sim';

/**
 * テスト用の地形:南北に向かい合う2本の石垣(硬い遮蔽、約60m離れている)
 * - 南の石垣:y=40(北面 y=40.5)
 * - 北の石垣:y=100(南面 y=99.5)
 */
export const duelMap: MapData = {
  width: 200,
  height: 150,
  features: [
    { id: 'southWall', kind: 'hard', poly: rect(100, 40, 40, 1) },
    { id: 'northWall', kind: 'hard', poly: rect(100, 100, 40, 1) },
  ],
};

/** 南の石垣の内側(南側)に立つ位置 */
export const southBehindWall = (x: number) => ({ x, y: 39 });
/** 北の石垣の内側(北側)に立つ位置 */
export const northBehindWall = (x: number) => ({ x, y: 101 });

export const NORTH = 90 * DEG;
export const SOUTH = -90 * DEG;
export const WEST = 180 * DEG;

export const holdOrders: Partial<Orders> = { fire: 'free', policy: 'hold' };

export function blue(id: string, pos: { x: number; y: number }, facing = NORTH, orders: Partial<Orders> = holdOrders): Unit {
  return makeFireteam(id, 'blue', pos, facing, orders);
}
export function red(id: string, pos: { x: number; y: number }, facing = SOUTH, orders: Partial<Orders> = holdOrders): Unit {
  return makeFireteam(id, 'red', pos, facing, orders);
}

export function scenario(units: Unit[], map: MapData = duelMap): SimState {
  return createState(map, units);
}

export const unit = (s: SimState, id: string): Unit => {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`unit ${id} not found`);
  return u;
};

export const seconds = (sec: number) => Math.round(sec * TICKS_PER_SECOND);

/** 条件を満たすまで進める。満たしたティック数(開始からの)を返す。満たさなければ null */
export function runUntil(s: SimState, maxTicks: number, cond: (s: SimState) => boolean): { state: SimState; ticks: number | null } {
  let cur = s;
  for (let i = 1; i <= maxTicks; i++) {
    cur = step(cur);
    if (cond(cur)) return { state: cur, ticks: i };
  }
  return { state: cur, ticks: null };
}

export function runTicks(s: SimState, ticks: number): SimState {
  const frames = runPhase(s, ticks);
  return frames[frames.length - 1] ?? s;
}

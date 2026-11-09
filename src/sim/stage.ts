import { DEG } from './config';
import { rect } from './geometry';
import { defaultOrders, makeUnit, mount } from './units';
import type { MapData, Orders, Side, SimState, TerrainFeature, TerrainKind, UnitKind, Vec2 } from './types';
import { createState } from './step';
import { applyAi, type AiPlan } from './ai';
import { buildingAt } from './building';

/** ステージ JSON の形。角度は度数で書く */
export interface StageData {
  id?: string;
  name: string;
  /** ミッション選択画面に出す説明 */
  description?: string;
  /** 目標フェイズ数(ステージ評価の ★2・★3 の条件) */
  par?: number;
  width: number;
  height: number;
  features: Array<{
    id: string;
    kind: TerrainKind;
    note?: string;
    /** 建物:射撃班とスナイパーが中に入れる */
    enterable?: boolean;
    rect?: { cx: number; cy: number; w: number; h: number; angleDeg?: number };
    poly?: Vec2[];
  }>;
  units: Array<{
    id: string;
    /** 画面に出す名前(例:第1班) */
    name?: string;
    /** 兵科(省略時は射撃班) */
    kind?: UnitKind;
    side: Side;
    x: number;
    y: number;
    facingDeg: number;
    orders?: Partial<Omit<Orders, 'facing'>> & { facingDeg?: number | null };
    /** 最初からこの IFV に乗っている */
    mountedIn?: string;
    /** 軽対戦車火器の弾数(射撃班のオプション装備) */
    at?: number;
  }>;
  /** 敵 AI(省略時は決まった命令のまま) */
  ai?: AiPlan;
  /** ミッション選択画面とゲーム中に出す、敵の性格の説明 */
  aiLabel?: { name: string; description: string; hint: string };
  /** 防衛線:守る側と、攻める側が越えたら負けになる y */
  defenseLine?: { defender: Side; y: number };
  /** 配置フェイズがあるか(true なら、ステージの始めに配置可能エリアの中で味方を置き直せる) */
  deployment?: boolean;
  /** 配置可能エリア */
  deployZone?: { x: number; y: number; w: number; h: number };
}

export function loadStage(data: StageData): SimState {
  const features: TerrainFeature[] = data.features.map((f) => ({
    id: f.id,
    kind: f.kind,
    poly: f.poly ?? (f.rect ? rect(f.rect.cx, f.rect.cy, f.rect.w, f.rect.h, (f.rect.angleDeg ?? 0) * DEG) : []),
    ...(f.enterable ? { enterable: true } : {}),
  }));
  const map: MapData = { width: data.width, height: data.height, features };
  const units = data.units.map((u) => {
    const { facingDeg, ...rest } = u.orders ?? {};
    const orders: Orders = {
      ...defaultOrders(),
      ...rest,
      facing: facingDeg === undefined || facingDeg === null ? null : facingDeg * DEG,
    };
    const unit = makeUnit(u.kind ?? 'fireteam', u.id, u.side, { x: u.x, y: u.y }, u.facingDeg * DEG, orders);
    unit.atRounds = u.at ?? 0;
    // 入れる建物の中に置かれた班は、最初から建物の中にいる
    const b = unit.kind === 'fireteam' || unit.kind === 'sniper' ? buildingAt(map, unit.pos) : null;
    if (b) unit.inBuilding = b.id;
    return unit;
  });
  for (const u of data.units) {
    if (!u.mountedIn) continue;
    const p = units.find((x) => x.id === u.id)!;
    const v = units.find((x) => x.id === u.mountedIn);
    if (v) mount(p, v);
  }
  const state = createState(map, units);
  if (data.defenseLine) state.defenseLine = { ...data.defenseLine };
  return state;
}

/** ステージに敵 AI があれば、計画フェイズの開始時に AI の命令を出す */
export function planAi(state: SimState, data: StageData): SimState {
  return data.ai ? applyAi(state, data.ai) : state;
}

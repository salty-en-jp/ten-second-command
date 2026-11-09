import { DEG } from './config';
import { rect } from './geometry';
import { defaultOrders, makeUnit } from './units';
import type { MapData, Orders, Side, SimState, TerrainFeature, TerrainKind, UnitKind, Vec2 } from './types';
import { createState } from './step';

/** ステージ JSON の形。角度は度数で書く */
export interface StageData {
  id?: string;
  name: string;
  /** ミッション選択画面に出す説明 */
  description?: string;
  width: number;
  height: number;
  features: Array<{
    id: string;
    kind: TerrainKind;
    note?: string;
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
  }>;
  /** 配置可能エリア(後の段階で使う) */
  deployZone?: { x: number; y: number; w: number; h: number };
}

export function loadStage(data: StageData): SimState {
  const features: TerrainFeature[] = data.features.map((f) => ({
    id: f.id,
    kind: f.kind,
    poly: f.poly ?? (f.rect ? rect(f.rect.cx, f.rect.cy, f.rect.w, f.rect.h, (f.rect.angleDeg ?? 0) * DEG) : []),
  }));
  const map: MapData = { width: data.width, height: data.height, features };
  const units = data.units.map((u) => {
    const { facingDeg, ...rest } = u.orders ?? {};
    const orders: Orders = {
      ...defaultOrders(),
      ...rest,
      facing: facingDeg === undefined || facingDeg === null ? null : facingDeg * DEG,
    };
    return makeUnit(u.kind ?? 'fireteam', u.id, u.side, { x: u.x, y: u.y }, u.facingDeg * DEG, orders);
  });
  return createState(map, units);
}

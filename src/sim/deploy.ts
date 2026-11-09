/**
 * 配置フェイズ。design.md 3章
 * ステージの始めに、配置可能エリアの中で味方の部隊を好きな場所に置く。
 * 置いた結果の視界で、見える敵だけがわかる(敵の初期配置は、味方の視界に入る範囲だけ見える)。
 */
import { pointInPolygon } from './geometry';
import { cloneState } from './step';
import { computeVision } from './vision';
import type { SimState, Vec2 } from './types';

export interface DeployZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** その場所に置けるか:配置可能エリアの中で、建物と硬い遮蔽(壁・土塁)の上ではない */
export function canDeployAt(state: SimState, zone: DeployZone, p: Vec2): boolean {
  if (p.x < zone.x || p.x > zone.x + zone.w || p.y < zone.y || p.y > zone.y + zone.h) return false;
  return !state.map.features.some((f) => (f.kind === 'building' || f.kind === 'hard') && pointInPolygon(p, f.poly));
}

/** 味方の部隊を別の場所に置き直した状態を返す(置けない場所なら元のまま)。乗っている班も一緒に動く */
export function deployUnit(state: SimState, zone: DeployZone, id: string, p: Vec2, facing?: number): SimState {
  const u0 = state.units.find((u) => u.id === id);
  if (!u0 || u0.side !== 'blue' || u0.mountedIn !== null || !canDeployAt(state, zone, p)) return state;
  const s = cloneState(state);
  for (const u of s.units) {
    if (u.id === id || u.mountedIn === id) {
      u.pos = { ...p };
      if (facing !== undefined) {
        u.facing = facing;
        u.turret = facing;
      }
    }
  }
  // 置き直したら、最終確認位置も含めて視界を作り直す(まだ何も起きていないので)
  s.vision = { blue: { visible: [], lastSeen: {} }, red: { visible: [], lastSeen: {} } };
  s.vision = computeVision(s);
  return s;
}

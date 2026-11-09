/** 配置フェイズ(design.md 3章)のテスト */
import { describe, expect, it } from 'vitest';
import { canDeployAt, createState, DEG, deployUnit, makeFireteam, makeIfv, mount, rect, type MapData } from '../src/sim';
import { unit } from './helpers';

const map: MapData = { width: 300, height: 200, features: [{ id: 'house', kind: 'building', poly: rect(50, 20, 10, 10) }] };
const zone = { x: 10, y: 5, w: 280, h: 40 };
const N = 90 * DEG;
const S = -90 * DEG;

describe('配置フェイズ', () => {
  const s0 = () =>
    createState(map, [makeFireteam('b1', 'blue', { x: 100, y: 20 }, N), makeFireteam('r1', 'red', { x: 150, y: 180 }, S)]);

  it('配置可能エリアの中で、建物の上でなければ置ける', () => {
    expect(canDeployAt(s0(), zone, { x: 100, y: 40 })).toBe(true);
    expect(canDeployAt(s0(), zone, { x: 100, y: 60 })).toBe(false); // エリアの外
    expect(canDeployAt(s0(), zone, { x: 50, y: 20 })).toBe(false); // 建物の上
  });

  it('置き直すと位置が変わり、置けない場所なら元のまま。敵の部隊は動かせない', () => {
    const a = deployUnit(s0(), zone, 'b1', { x: 200, y: 30 });
    expect(unit(a, 'b1').pos).toEqual({ x: 200, y: 30 });
    const b = deployUnit(s0(), zone, 'b1', { x: 200, y: 100 });
    expect(unit(b, 'b1').pos).toEqual({ x: 100, y: 20 });
    const c = deployUnit(s0(), zone, 'r1', { x: 200, y: 30 });
    expect(unit(c, 'r1').pos).toEqual({ x: 150, y: 180 });
  });

  it('置いた場所から見える敵だけがわかる', () => {
    const far = s0();
    expect(far.vision.blue.visible).toEqual([]);
    // 敵まで 120 m 以内(視界の中)に置くと見える
    const s = createState(map, [makeFireteam('b1', 'blue', { x: 100, y: 20 }, N), makeFireteam('r1', 'red', { x: 150, y: 140 }, S)]);
    expect(s.vision.blue.visible).toEqual([]);
    const near = deployUnit(s, { x: 0, y: 0, w: 300, h: 200 }, 'b1', { x: 150, y: 40 });
    expect(near.vision.blue.visible).toEqual(['r1']);
  });

  it('IFV を置き直すと、乗っている班も一緒に動く', () => {
    const v = makeIfv('v', 'blue', { x: 100, y: 20 }, N);
    const p = makeFireteam('p', 'blue', { x: 100, y: 20 }, N);
    mount(p, v);
    const s = deployUnit(createState(map, [v, p]), zone, 'v', { x: 220, y: 30 });
    expect(unit(s, 'p').pos).toEqual({ x: 220, y: 30 });
    // 乗っている班だけを動かすことはできない
    expect(unit(deployUnit(s, zone, 'p', { x: 120, y: 30 }), 'p').pos).toEqual({ x: 220, y: 30 });
  });
});

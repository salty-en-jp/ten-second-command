import { describe, expect, it } from 'vitest';
import { effectiveCover, findCover, lineOfFire } from '../src/sim';
import { duelMap, northBehindWall, southBehindWall } from './helpers';

describe('遮蔽の方向性(design.md 4.3)', () => {
  const p = northBehindWall(100); // 北の石垣の北側。正面は南

  it('正面(南)から撃たれたら効く', () => {
    expect(effectiveCover(duelMap, p, { x: 100, y: 40 })).toBe('hard');
  });
  it('正面から 60° 以内なら効く', () => {
    // 南から東へ 55° ずれた方向
    const a = (-90 + 55) * (Math.PI / 180);
    expect(effectiveCover(duelMap, p, { x: p.x + 50 * Math.cos(a), y: p.y + 50 * Math.sin(a) })).toBe('hard');
  });
  it('正面から 60° を超えたら効かない(側面)', () => {
    const a = (-90 + 65) * (Math.PI / 180);
    expect(effectiveCover(duelMap, p, { x: p.x + 50 * Math.cos(a), y: p.y + 50 * Math.sin(a) })).toBeNull();
  });
  it('背面からは効かない', () => {
    expect(effectiveCover(duelMap, p, { x: 100, y: 140 })).toBeNull();
  });
});

describe('射線', () => {
  it('自分が内側にいる石垣は越しに撃てる', () => {
    expect(lineOfFire(duelMap, southBehindWall(100), northBehindWall(100))).toBe(true);
  });
  it('関係ない石垣はさえぎる', () => {
    expect(lineOfFire(duelMap, { x: 100, y: 30 }, { x: 100, y: 50 })).toBe(false);
  });
});

describe('遮蔽への退避(design.md 7章)', () => {
  it('3秒で届く範囲に、脅威の方向を向いた遮蔽があればそこを選ぶ', () => {
    const c = findCover(duelMap, { x: 100, y: 34 }, { x: 100, y: 100 });
    expect(c).not.toBeNull();
    expect(effectiveCover(duelMap, c!, { x: 100, y: 100 })).toBe('hard');
  });
  it('届く範囲になければ null(伏せる)', () => {
    expect(findCover(duelMap, { x: 100, y: 20 }, { x: 100, y: 100 })).toBeNull();
  });
});

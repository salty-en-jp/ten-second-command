/**
 * docs/design.md「9. 設計目標」の自動テスト。
 * 数値を変えたら必ずこのテストを通すこと。通らなくなったら、テストを書き換えずに相談する。
 */
import { describe, expect, it } from 'vitest';
import { issueOrders, loadStage, PHASE_TICKS, rect, runPhase, SUPPRESSION, type MapData, type Orders, type StageData } from '../src/sim';
import stageData from '../stages/mvp.json';
import {
  blue,
  northBehindWall,
  red,
  runTicks,
  runUntil,
  scenario,
  seconds,
  southBehindWall,
  unit,
  WEST,
} from './helpers';

describe('設計目標1:1対1、互いに硬い遮蔽の内側で正面から撃ち合う', () => {
  it('どちらも 60 秒以内には全滅しない(にらみ合いになる)', () => {
    const start = scenario([blue('b1', southBehindWall(100)), red('r1', northBehindWall(100))]);
    const end = runTicks(start, seconds(60));
    const b = unit(end, 'b1');
    const r = unit(end, 'r1');
    expect(b.alive).toBe(true);
    expect(r.alive).toBe(true);
    // 本当に撃ち合っていたことも確かめる(撃ち合わずに生き残っただけ、を防ぐ)
    expect(b.hp).toBeLessThan(100);
    expect(r.hp).toBeLessThan(100);
  });
});

describe('設計目標2:2対1、撃たれる側が遮蔽の内側', () => {
  it('撃たれる側は 2〜4 秒で制圧状態(制圧値 70 以上)になる', () => {
    const start = scenario([
      blue('b1', southBehindWall(95)),
      blue('b2', southBehindWall(105)),
      red('r1', northBehindWall(100)),
    ]);
    const { ticks } = runUntil(start, seconds(10), (s) => unit(s, 'r1').suppression >= SUPPRESSION.suppressed);
    expect(ticks).not.toBeNull();
    expect(ticks!).toBeGreaterThanOrEqual(seconds(2));
    expect(ticks!).toBeLessThanOrEqual(seconds(4));
  });
});

describe('設計目標3:側面から撃つ', () => {
  /** 正面の1班で敵を制圧してから、側面の1班に射撃を許可する */
  function suppressThenFlank(flank: boolean) {
    const start = scenario([
      blue('b1', southBehindWall(100)),
      // 側面の班:東側、石垣の延長線の少し北。最初は射撃禁止で待機している
      blue('b2', { x: 150, y: 104 }, WEST, { fire: 'hold', policy: 'hold' }),
      red('r1', northBehindWall(100)),
    ]);
    const { state: suppressed, ticks } = runUntil(start, seconds(30), (s) => unit(s, 'r1').suppression >= SUPPRESSION.suppressed);
    expect(ticks, '正面の班だけで目標が制圧されること').not.toBeNull();
    expect(unit(suppressed, 'r1').alive).toBe(true);

    const orders: Record<string, Orders> = {};
    if (flank) orders.b2 = { ...unit(suppressed, 'b2').orders, fire: 'free' };
    return issueOrders(suppressed, orders);
  }

  it('制圧された目標を側面から撃つと、遮蔽が無効になり、10 秒以内に全滅する', () => {
    const s = suppressThenFlank(true);
    const end = runTicks(s, seconds(10));
    expect(unit(end, 'r1').alive).toBe(false);
  });

  it('(比較)側面から撃たなければ、10 秒たっても全滅しない', () => {
    const s = suppressThenFlank(false);
    const end = runTicks(s, seconds(10));
    expect(unit(end, 'r1').alive).toBe(true);
  });
});

describe('設計目標4:決定性', () => {
  const advanceOrders = (): Record<string, Orders> => ({
    b1: {
      route: [{ pos: { x: 60, y: 60 }, waitSec: 1 }, { pos: { x: 40, y: 84 }, waitSec: 0 }],
      facing: null,
      fire: 'free',
      policy: 'advance',
      withdrawRoute: [],
      focusTargetId: null,
    },
    b2: {
      route: [],
      facing: Math.PI / 2,
      fire: 'free',
      policy: 'hold',
      withdrawRoute: [],
      focusTargetId: 'r1',
    },
  });

  function play() {
    let s = issueOrders(loadStage(stageData as StageData), advanceOrders());
    const frames = [];
    for (let phase = 0; phase < 6; phase++) {
      const f = runPhase(s);
      frames.push(...f);
      s = f[f.length - 1]!;
    }
    return frames;
  }

  it('同じ初期状態と同じ命令からは、何度実行してもまったく同じ結果になる', () => {
    const a = JSON.stringify(play().map((f) => f.units));
    for (let i = 0; i < 3; i++) {
      expect(JSON.stringify(play().map((f) => f.units))).toBe(a);
    }
  });

  it('ユニットを渡す順番を変えても結果は同じ', () => {
    const units = [
      blue('b1', southBehindWall(95)),
      blue('b2', southBehindWall(105)),
      red('r1', northBehindWall(100)),
    ];
    const a = runTicks(scenario(units), PHASE_TICKS * 3);
    const b = runTicks(scenario([...units].reverse()), PHASE_TICKS * 3);
    expect(JSON.stringify(b.units)).toBe(JSON.stringify(a.units));
  });

  it('前の状態を書き換えない(リトライ・リプレイのため)', () => {
    const s = loadStage(stageData as StageData);
    const before = JSON.stringify(s.units);
    runPhase(s);
    expect(JSON.stringify(s.units)).toBe(before);
  });
});

describe('設計目標5:建物の中の班', () => {
  // 家(14 m × 10 m)の中に敵の班。味方は南と東の石垣の内側(家から約 65〜70 m)
  const town: MapData = {
    width: 400,
    height: 300,
    features: [
      { id: 'house', kind: 'building', enterable: true, poly: rect(200, 150, 14, 10) },
      { id: 'wallS', kind: 'hard', poly: rect(200, 80, 12, 1) },
      { id: 'wallE', kind: 'hard', poly: rect(280, 150, 1, 12) },
    ],
  };
  const fight = (twoDirections: boolean) => {
    const r = red('r1', { x: 200, y: 147 });
    r.inBuilding = 'house';
    const us = [r, blue('b1', { x: 200, y: 79 })];
    if (twoDirections) us.push(blue('b2', { x: 281, y: 150 }, WEST));
    return runUntil(scenario(us, town), seconds(30), (s) => !unit(s, 'r1').alive);
  };

  it('二方向から同時に攻めれば、30 秒以内に全滅させられる', () => {
    expect(fight(true).ticks).not.toBeNull();
  });

  it('(比較)1方向からだけでは、30 秒たっても全滅しない', () => {
    expect(fight(false).ticks).toBeNull();
  });
});

/** 編成ポイント制のテスト。design.md 3章 */
import { describe, expect, it } from 'vitest';
import { applyRoster, defaultRoster, DEPLOY_COST, loadStage, rosterCost, rosterValid, type StageData } from '../src/sim';
import crossroadsJson from '../stages/crossroads.json';
import riversideJson from '../stages/riverside.json';
import { unit } from './helpers';

const crossroads = crossroadsJson as StageData;
const riverside = riversideJson as StageData;

describe('編成ポイント', () => {
  it('最初の編成は控えを含まず、持ち点ちょうどに収まる', () => {
    for (const st of [crossroads, riverside]) {
      const base = loadStage(st, true);
      const c = defaultRoster(st);
      expect(rosterCost(base, c)).toBe(st.budget);
      expect(rosterValid(base, c, st.budget!)).toBe(true);
      // 控えなしで読み込んだ状態と、最初の編成を当てはめた状態は同じ部隊
      const ids = (s: ReturnType<typeof loadStage>) => s.units.map((u) => u.id).join(',');
      expect(ids(applyRoster(base, c))).toBe(ids(loadStage(st)));
    }
  });

  it('控えを足すと持ち点を超えて出撃できない。かわりに何かを外せば出撃できる', () => {
    const base = loadStage(crossroads, true);
    const c = defaultRoster(crossroads);
    c.b3 = { take: true, at: false };
    expect(rosterCost(base, c)).toBe(crossroads.budget! + DEPLOY_COST.fireteam);
    expect(rosterValid(base, c, crossroads.budget!)).toBe(false);
    c.m1 = { take: false, at: false };
    expect(rosterValid(base, c, crossroads.budget!)).toBe(true);
    const s = applyRoster(base, c);
    expect(s.units.some((u) => u.id === 'm1')).toBe(false);
    expect(unit(s, 'b3').alive).toBe(true);
  });

  it('射撃班の対戦車火器は +3 点で1発', () => {
    const base = loadStage(crossroads, true);
    const c = defaultRoster(crossroads);
    c.b1 = { take: true, at: true };
    expect(rosterCost(base, c)).toBe(crossroads.budget! + DEPLOY_COST.at);
    expect(unit(applyRoster(base, c), 'b1').atRounds).toBe(1);
    expect(unit(applyRoster(base, defaultRoster(crossroads)), 'b1').atRounds).toBe(0);
  });

  it('IFV を連れていかなければ、乗っていた班は降りた状態で出る', () => {
    const base = loadStage(riverside, true);
    const c = defaultRoster(riverside);
    expect(unit(applyRoster(base, c), 'b3').mountedIn).toBe('v1');
    c.v1 = { take: false, at: false };
    const s = applyRoster(base, c);
    expect(s.units.some((u) => u.id === 'v1')).toBe(false);
    expect(unit(s, 'b3').mountedIn).toBeNull();
  });

  it('1部隊も選ばなければ出撃できない', () => {
    const base = loadStage(crossroads, true);
    const c = defaultRoster(crossroads);
    for (const k of Object.keys(c)) c[k] = { take: false, at: false };
    expect(rosterValid(base, c, crossroads.budget!)).toBe(false);
  });
});

/** 編成ポイント制(好きな兵科を好きな数だけ買う)のテスト。design.md 3章 */
import { describe, expect, it } from 'vitest';
import {
  armyCost, armyValid, boardInDeployment, buyUnit, DEPLOY_COST, leaveInDeployment, loadStage, nextUnitId, sellUnit, setAt, type StageData,
} from '../src/sim';
import crossroadsJson from '../stages/crossroads.json';
import riversideJson from '../stages/riverside.json';
import kaidoJson from '../stages/kaido.json';
import { unit } from './helpers';

const crossroads = crossroadsJson as StageData;
const riverside = riversideJson as StageData;

describe('編成ポイント', () => {
  it('ステージに書かれた最初の編成は、持ち点以内', () => {
    for (const st of [crossroads, riverside, kaidoJson as StageData]) {
      const s = loadStage(st);
      expect(armyCost(s)).toBeLessThanOrEqual(st.budget!);
      expect(armyValid(s, st.budget!)).toBe(true);
    }
  });

  it('数の上限なく買える。全部を狙撃手にもできる', () => {
    let s = loadStage(crossroads);
    for (const u of s.units.filter((x) => x.side === 'blue')) s = sellUnit(s, u.id);
    expect(armyValid(s, crossroads.budget!)).toBe(false); // 1部隊もない
    for (let i = 0; i < 5; i++) s = buyUnit(s, 'sniper', crossroads.deployZone!)!.state;
    const snipers = s.units.filter((u) => u.side === 'blue');
    expect(snipers.map((u) => u.id)).toEqual(['bs', 'bs2', 'bs3', 'bs4', 'bs5']);
    expect(armyCost(s)).toBe(5 * DEPLOY_COST.sniper);
    expect(armyValid(s, crossroads.budget!)).toBe(true);
    // 買った部隊は配置エリアの中で、互いに離れて置かれる
    for (const u of snipers) {
      const z = crossroads.deployZone!;
      expect(u.pos.x >= z.x && u.pos.x <= z.x + z.w && u.pos.y >= z.y && u.pos.y <= z.y + z.h).toBe(true);
    }
  });

  it('持ち点を超えると出撃できない', () => {
    const r = buyUnit(loadStage(crossroads), 'fireteam', crossroads.deployZone!)!;
    expect(r.id).toBe('b3');
    expect(armyCost(r.state)).toBe(armyCost(loadStage(crossroads)) + DEPLOY_COST.fireteam);
    expect(armyValid(r.state, crossroads.budget!)).toBe(false);
  });

  it('射撃班の対戦車火器は +3 点で1発', () => {
    const s0 = loadStage(crossroads);
    const s = setAt(s0, 'b1', true);
    expect(unit(s, 'b1').atRounds).toBe(1);
    expect(armyCost(s)).toBe(armyCost(s0) + DEPLOY_COST.at);
  });

  it('IFV を外すと乗っていた班は降りる。配置フェイズで乗せ直せる', () => {
    let s = loadStage(riverside);
    expect(unit(s, 'b3').mountedIn).toBe('v1');
    s = leaveInDeployment(s, 'b3', riverside.deployZone!);
    expect(unit(s, 'b3').mountedIn).toBeNull();
    expect(unit(s, 'v1').passengerId).toBeNull();
    s = boardInDeployment(s, 'b3', 'v1');
    expect(unit(s, 'b3').mountedIn).toBe('v1');
    s = sellUnit(s, 'v1');
    expect(unit(s, 'b3').mountedIn).toBeNull();
    expect(nextUnitId(s, 'ifv')).toBe('v1');
  });
});

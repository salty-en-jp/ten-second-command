/**
 * ステージ評価。design.md 10章(段階6)
 * ★1:勝利 / ★2:目標フェイズ以内に勝利 / ★3:目標フェイズ以内で、全滅した班がなく、失った耐久が全体の3割以下
 */
import type { SimState } from './types';

export const EVAL = {
  /** ★3 の条件:失った耐久の割合の上限 */
  maxLossRatio: 0.3,
} as const;

export interface Evaluation {
  stars: 0 | 1 | 2 | 3;
  phases: number;
  par: number;
  /** 味方が失った耐久の割合(0〜1) */
  lossRatio: number;
  /** 全滅した味方の id */
  destroyed: string[];
}

export function evaluate(initial: SimState, final: SimState, phases: number, par: number): Evaluation {
  const start = initial.units.filter((u) => u.side === 'blue');
  let max = 0;
  let lost = 0;
  const destroyed: string[] = [];
  for (const u0 of start) {
    const u = final.units.find((x) => x.id === u0.id);
    max += u0.hp;
    lost += u0.hp - (u?.hp ?? 0);
    if (!u?.alive) destroyed.push(u0.id);
  }
  const lossRatio = max > 0 ? lost / max : 0;
  let stars: Evaluation['stars'] = 0;
  if (final.outcome === 'blueWin') {
    stars = 1;
    if (phases <= par) {
      stars = 2;
      if (destroyed.length === 0 && lossRatio <= EVAL.maxLossRatio + 1e-9) stars = 3;
    }
  }
  return { stars, phases, par, lossRatio, destroyed };
}

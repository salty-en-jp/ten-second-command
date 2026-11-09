/**
 * 敵 AI(性格:待ち伏せ型・突撃型・防御型)。design.md 6.6
 * - 各計画フェイズの開始時に、AI が受け持つ陣営の各ユニットへ「命令」を出す(プレイヤーと同じ命令の種類)
 * - 判断に使うのは、その陣営が見ているもの(視界・20 秒以内の最終確認位置)だけ。プレイヤーの命令は見ない
 * - 乱数は使わない。迷ったら距離、次に id の順で決める
 * 根拠:FM 100-2-1(1984)、FM 7-8(1992)、ATP 3-21.8(2024)。
 */
import { DEG, PHASE_TICKS, TICKS_PER_SECOND } from './config';
import { angleTo, dist } from './geometry';
import { issueOrders } from './step';
import { effectiveCover, lineOfFire } from './terrain';
import type { AiMemory, Orders, Side, SimState, Unit, Vec2 } from './types';

export type Personality = 'ambush' | 'assault' | 'defense';

export interface AiPosition {
  x: number;
  y: number;
  facingDeg: number;
}

/** ステージに書く AI の設定 */
export interface AiPlan {
  personality: Personality;
  /** AI が受け持つ陣営 */
  side: Side;
  /** ユニットごとの陣地の一覧。待ち伏せ型は下がる順、防御型は [0] が主陣地で残りが交代・補助陣地 */
  positions?: Record<string, AiPosition[]>;
  /** 突撃型:敵が見えていない間に進む道 */
  advanceRoutes?: Record<string, Vec2[]>;
  /** 回り込み点(突撃型の回り込み、防御型の反撃) */
  flankPoints?: Vec2[];
  /** 待ち伏せ型の射撃開始線(m) */
  openFireRange?: number;
}

/** AI の数値 (暫定) */
export const AI = {
  /** これより古い最終確認位置は忘れる(秒) */
  memorySec: 20,
  /** 待ち伏せ型の射撃開始線(m) */
  openFireRange: 60,
  /** 待ち伏せ型:動揺以上でこの距離に敵がいたら下がる(m) */
  pressedRange: 40,
  /** 待ち伏せ型:撃ち始めてからこのフェイズ数で下がる */
  ambushPhases: 2,
  /** 防御型:1フェイズで移れる陣地までの距離(m) */
  shiftRange: 25,
  /** 防御型の反撃:陣地からこの距離に敵がいたら */
  counterRange: 60,
  /** この距離より遠い敵からは見えないものとして回り込み点を選ぶ(m) */
  hiddenBeyond: 130,
  /** 2人を失った班は下がる(防御型は1人になるまで残る) */
  retreatHp: 50,
  defenseRetreatHp: 25,
} as const;

interface Threat {
  id: string;
  pos: Vec2;
  visible: boolean;
}

const O = (o: Partial<Orders>): Orders => ({
  route: [],
  facing: null,
  fire: 'free',
  policy: 'hold',
  withdrawRoute: [],
  focusTargetId: null,
  ...o,
});
const wp = (p: Vec2) => ({ pos: { x: p.x, y: p.y }, waitSec: 0 });
const posOf = (p: AiPosition): Vec2 => ({ x: p.x, y: p.y });
const byDistThenId = (from: Vec2) => (a: { id: string; pos: Vec2 }, b: { id: string; pos: Vec2 }) =>
  dist(from, a.pos) - dist(from, b.pos) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function emptyMemory(): AiMemory {
  return { posIndex: {}, firstFireTick: null, counterUsed: false, flanking: {} };
}

/** 陣営が知っている敵(見えている敵と、20 秒以内の最終確認位置) */
export function knownThreats(state: SimState, side: Side): Threat[] {
  const v = state.vision[side];
  const out: Threat[] = [];
  for (const id of v.visible) {
    const u = state.units.find((x) => x.id === id);
    if (u?.alive) out.push({ id, pos: { ...u.pos }, visible: true });
  }
  for (const [id, ls] of Object.entries(v.lastSeen)) {
    if (v.visible.includes(id)) continue;
    if (state.tick - ls.tick > AI.memorySec * TICKS_PER_SECOND) continue;
    out.push({ id, pos: { ...ls.pos }, visible: false });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** その場所が、知っている敵のどれからも見えないか */
function hiddenFrom(state: SimState, p: Vec2, threats: Threat[]): boolean {
  return threats.every((t) => dist(t.pos, p) > AI.hiddenBeyond || !lineOfFire(state.map, t.pos, p));
}

/** AI の命令を出した状態を返す(計画フェイズの開始時に呼ぶ) */
export function applyAi(state: SimState, plan: AiPlan): SimState {
  const mem: AiMemory = state.ai
    ? { ...state.ai, posIndex: { ...state.ai.posIndex }, flanking: { ...state.ai.flanking } }
    : emptyMemory();
  const us = state.units.filter((u) => u.alive && u.side === plan.side && u.mountedIn === null);
  const threats = knownThreats(state, plan.side);
  if (mem.firstFireTick === null && us.some((u) => u.ticksSinceFired !== Number.MAX_SAFE_INTEGER)) mem.firstFireTick = state.tick;

  let orders: Record<string, Orders> = {};
  if (plan.personality === 'ambush') orders = ambush(state, plan, mem, us, threats);
  else if (plan.personality === 'assault') orders = assault(state, plan, mem, us, threats);
  else orders = defense(state, plan, mem, us, threats);
  return issueOrders({ ...state, ai: mem }, orders);
}

// ---------------------------------------------------------------- 待ち伏せ型

/**
 * 隠れて近づくまで撃たない(射撃開始線)。押されたら、交互に援護しながら次の陣地へ下がる。
 * 下がる条件:2人を失った/動揺以上で 40 m 以内に敵/敵が遮蔽の効かない向きにいる/撃ち始めて2フェイズ。
 * 下がるのは1フェイズに1班まで(残りが援護する)。戦力が半分を切ったら全員下がる。
 */
function ambush(state: SimState, plan: AiPlan, mem: AiMemory, us: Unit[], threats: Threat[]): Record<string, Orders> {
  const range = plan.openFireRange ?? AI.openFireRange;
  const out: Record<string, Orders> = {};
  const longFight = mem.firstFireTick !== null && state.tick - mem.firstFireTick >= AI.ambushPhases * PHASE_TICKS && threats.length > 0;
  const broken = threats.length > 0 && us.length * 2 < threats.length;
  let retreatedThisPhase = false;
  for (const u of us) {
    const list = plan.positions?.[u.id] ?? [];
    const idx = mem.posIndex[u.id] ?? 0;
    const here = list[idx];
    const near = threats.slice().sort(byDistThenId(u.pos))[0];
    const pressed =
      u.hp <= AI.retreatHp ||
      (u.suppression >= 40 && !!near && dist(u.pos, near.pos) <= AI.pressedRange) ||
      // 横を突かれた:正面には遮蔽が効く陣地なのに、敵が遮蔽の効かない向きにいる
      (!!near && !!here && mem.firstFireTick !== null && dist(u.pos, near.pos) <= 120 &&
        effectiveCover(state.map, u.pos, { x: u.pos.x + Math.cos(here.facingDeg * DEG) * 50, y: u.pos.y + Math.sin(here.facingDeg * DEG) * 50 }) !== null &&
        effectiveCover(state.map, u.pos, near.pos) === null) ||
      longFight;
    const next = list[idx + 1];
    if ((pressed || broken) && next && (!retreatedThisPhase || broken)) {
      retreatedThisPhase = true;
      mem.posIndex[u.id] = idx + 1;
      out[u.id] = O({
        route: [wp(posOf(next))],
        withdrawRoute: [posOf(next)],
        policy: 'withdraw',
        fire: 'hold',
        openFireRange: range,
        facing: next.facingDeg * DEG,
      });
      continue;
    }
    // とどまる:まだ誰も撃っていなければ待ち伏せを続け、撃ち合いが始まっていれば撃つ
    const atPost = !here || dist(u.pos, posOf(here)) < 2;
    const quiet = !near || dist(u.pos, near.pos) > range;
    out[u.id] = O({
      route: here && !atPost ? [wp(posOf(here))] : [],
      fire: quiet && (mem.firstFireTick === null || !near) ? 'hold' : 'free',
      openFireRange: range,
      policy: 'hold',
      facing: here ? here.facingDeg * DEG : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 突撃型

/**
 * 敵が見えていない間は決められた道を進む。見つけたら、射線の通る一番近い班が抑え(火力の集中)、
 * 残りの班は敵から見えない回り込み点へ回ってから撃つ。回り込み役が制圧されたら全員その場で保持。
 */
function assault(state: SimState, plan: AiPlan, mem: AiMemory, us: Unit[], threats: Threat[]): Record<string, Orders> {
  const out: Record<string, Orders> = {};
  if (threats.length === 0) {
    for (const u of us) {
      const route = plan.advanceRoutes?.[u.id] ?? [];
      // 道のどこから進み直すか:今いる場所から終点までの道のりが一番短くなる点(脇道にそれていても戻りすぎない)
      let i = route.length;
      let best = Infinity;
      for (let k = 0; k < route.length; k++) {
        let len = dist(u.pos, route[k]!);
        for (let m = k; m < route.length - 1; m++) len += dist(route[m]!, route[m + 1]!);
        if (len < best - 1e-9) {
          best = len;
          i = k;
        }
      }
      while (i < route.length && dist(u.pos, route[i]!) < 3) i++;
      mem.posIndex[u.id] = i;
      mem.flanking[u.id] = false;
      out[u.id] = O({ route: route.slice(i).map(wp), policy: 'advance', fire: 'free' });
    }
    return out;
  }
  const center = { x: us.reduce((a, u) => a + u.pos.x, 0) / Math.max(1, us.length), y: us.reduce((a, u) => a + u.pos.y, 0) / Math.max(1, us.length) };
  const target = threats.slice().sort(byDistThenId(center))[0]!;
  const stalled = us.some((u) => mem.flanking[u.id] && (u.suppression >= 70 || u.hp <= AI.retreatHp));
  const canSee = (u: Unit) => dist(u.pos, target.pos) <= 150 && lineOfFire(state.map, u.pos, target.pos);
  const fixer = us.filter((u) => !mem.flanking[u.id]).sort((a, b) => Number(canSee(b)) - Number(canSee(a)) || dist(a.pos, target.pos) - dist(b.pos, target.pos) || (a.id < b.id ? -1 : 1))[0];
  const usedPoints: Vec2[] = [];
  for (const u of us) {
    const facing = angleTo(u.pos, target.pos);
    if (stalled || u === fixer) {
      out[u.id] = O({ policy: 'hold', fire: 'free', focusTargetId: target.visible ? target.id : null, facing });
      continue;
    }
    const fp = (plan.flankPoints ?? [])
      .filter((p) => !usedPoints.some((q) => dist(p, q) < 1))
      .filter((p) => hiddenFrom(state, p, threats))
      .sort((a, b) => dist(u.pos, a) - dist(u.pos, b))[0];
    if (!fp || dist(u.pos, fp) < 3) {
      // 回り込み点に着いた(または使える点がない):そこから撃つ
      out[u.id] = O({ policy: 'hold', fire: 'free', focusTargetId: target.visible ? target.id : null, facing });
      continue;
    }
    usedPoints.push(fp);
    mem.flanking[u.id] = true;
    out[u.id] = O({ route: [wp(fp)], policy: 'advance', fire: 'hold', facing: angleTo(fp, target.pos) });
  }
  return out;
}

// ---------------------------------------------------------------- 防御型

/**
 * 陣地から下がらない。敵が遮蔽の効かない向きにいれば、その向きに正面が向いた近くの陣地へ移るか、向きを変える。
 * 敵が陣地に迫り、こちらの数が上回っていれば、1回だけ1班が回り込み点から反撃する。
 */
function defense(state: SimState, plan: AiPlan, mem: AiMemory, us: Unit[], threats: Threat[]): Record<string, Orders> {
  const out: Record<string, Orders> = {};
  for (const u of us) {
    const list = plan.positions?.[u.id] ?? [];
    const idx = mem.posIndex[u.id] ?? 0;
    const here = list[idx];
    const near = threats.slice().sort(byDistThenId(u.pos))[0];
    if (u.hp <= AI.defenseRetreatHp && list.length > 1 && idx !== list.length - 1) {
      mem.posIndex[u.id] = list.length - 1;
      const last = list[list.length - 1]!;
      out[u.id] = O({ route: [wp(posOf(last))], withdrawRoute: [posOf(last)], policy: 'withdraw', fire: 'free', facing: last.facingDeg * DEG });
      continue;
    }
    if (near && effectiveCover(state.map, u.pos, near.pos) === null) {
      const j = list.findIndex(
        (p, k) => k !== idx && dist(u.pos, posOf(p)) <= AI.shiftRange && effectiveCover(state.map, posOf(p), near.pos) !== null,
      );
      if (j >= 0) {
        mem.posIndex[u.id] = j;
        out[u.id] = O({ route: [wp(posOf(list[j]!))], policy: 'advance', fire: 'free', facing: angleTo(posOf(list[j]!), near.pos) });
      } else {
        out[u.id] = O({ policy: 'hold', fire: 'free', facing: angleTo(u.pos, near.pos) });
      }
      continue;
    }
    const atPost = !here || dist(u.pos, posOf(here)) < 2;
    out[u.id] = O({
      route: here && !atPost ? [wp(posOf(here))] : [],
      policy: 'hold',
      fire: 'free',
      facing: near ? angleTo(u.pos, near.pos) : here ? here.facingDeg * DEG : null,
    });
  }
  // 反撃(1回だけ)
  const posts = Object.values(plan.positions ?? {}).flat().map(posOf);
  const close = threats.filter((t) => posts.some((p) => dist(p, t.pos) <= AI.counterRange));
  const healthy = us.filter((u) => u.suppression < 40 && u.hp > AI.retreatHp);
  if (!mem.counterUsed && close.length > 0 && healthy.length > threats.length && (plan.flankPoints ?? []).length > 0) {
    const t = close.sort(byDistThenId(posts[0] ?? { x: 0, y: 0 }))[0]!;
    const pick = healthy
      .map((u) => ({ u, fp: (plan.flankPoints ?? []).slice().sort((a, b) => dist(u.pos, a) - dist(u.pos, b))[0]! }))
      .sort((a, b) => dist(a.u.pos, a.fp) - dist(b.u.pos, b.fp) || (a.u.id < b.u.id ? -1 : 1))[0];
    if (pick) {
      mem.counterUsed = true;
      out[pick.u.id] = O({ route: [wp(pick.fp)], policy: 'advance', fire: 'free', facing: angleTo(pick.fp, t.pos), focusTargetId: t.visible ? t.id : null });
    }
  }
  return out;
}

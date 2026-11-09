/**
 * ゲームの数値はすべてここに集める。
 * docs/design.md で (暫定) とされている数値と、設計書にない MVP 用の仮決め(【仮決め】)がある。
 * 値を変えたら docs/design.md も更新すること。
 */

/** 1秒 = 20ティック(固定) */
export const TICKS_PER_SECOND = 20;
/** 1フェイズの長さ(秒)。design.md 3章 */
export const PHASE_SECONDS = 10;
export const PHASE_TICKS = PHASE_SECONDS * TICKS_PER_SECOND;

export const DEG = Math.PI / 180;

/** 射撃班。design.md 6.1 */
export const FIRETEAM = {
  maxHp: 100,
  hpPerMan: 25,
  men: 4,
  /** m/秒 (暫定) */
  speed: 2.5,
  /** m/秒 (暫定)。MVP では使う場面がまだない */
  proneSpeed: 0.8,
  /** m (暫定) */
  sightRange: 120,
  /** 視界の扇形の全角。design.md 4.1 */
  sightArc: 120 * DEG,
  /** 耐久/秒 (暫定) */
  firepower: 10,
  /** この距離まで減衰なし (暫定) */
  effectiveRange: 100,
  /** この距離で火力 0 (暫定) */
  maxRange: 200,
} as const;

/** 接触時の自動行動。design.md 7章 */
export const CONTACT = {
  /** 反応遅延(秒) */
  reactionSec: 0.5,
  /** 「近く」の遮蔽 = この秒数で届く範囲 */
  coverSearchSec: 3,
  /** 離脱時の速度倍率 */
  withdrawSpeedFactor: 0.7,
  /** 【仮決め】敵が見えず撃たれもしない状態がこの秒数続いたら、接触を解いて通常行動に戻る */
  quietSecToEndContact: 3,
} as const;

/** 遮蔽。design.md 4.2 / 4.3 / 8.1 / 8.2 */
export const COVER = {
  /** 正面からこの角度以内の射撃にだけ遮蔽が効く */
  arc: 60 * DEG,
  hardDamage: 0.2,
  softDamage: 0.5,
  /** 遮蔽の内側でも制圧値の増加はここまでしか減らない */
  suppressionFactor: 0.8,
  /** 【仮決め】遮蔽物の縁からこの距離以内にいれば「遮蔽の内側」 */
  occupyDistance: 1.5,
  /** 【仮決め】遮蔽を探すとき、遮蔽物の縁からこの距離だけ離れた位置を目指す */
  standoff: 0.8,
  /** 【仮決め】遮蔽を探すとき、縁に沿ってこの間隔(m)で候補位置を調べる */
  candidateSpacing: 1,
} as const;

/** ダメージ係数。design.md 8.1 */
export const DAMAGE = {
  proneOpen: 0.6,
  moving: 0.8,
  standingOpen: 1.0,
  shooterShaken: 0.7,
  shooterSuppressed: 0.3,
} as const;

/** 制圧値。design.md 8.2 */
export const SUPPRESSION = {
  /** 射撃班1つから受ける増加量/秒 (暫定) */
  perFireteamPerSec: 25,
  /** 撃たれなくなってから回復が始まるまで(秒) */
  recoveryDelaySec: 1,
  /** 回復量/秒 (暫定) */
  recoveryPerSec: 20,
  shaken: 40,
  suppressed: 70,
  pinned: 100,
  max: 100,
  /** 前進方針で経路を再開できる上限(これ未満で再開) */
  advanceResumeBelow: 40,
  /** 制圧射撃(見えない最終確認位置への射撃)は通常の半分 */
  suppressiveFireFactor: 0.5,
  /** 【仮決め】制圧射撃の着弾点からこの半径(m)にいる敵が制圧値を受ける */
  suppressiveFireRadius: 5,
} as const;

/** 移動の到着判定(m) */
export const ARRIVE_EPSILON = 0.01;

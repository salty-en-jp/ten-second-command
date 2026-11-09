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

/**
 * スナイパー。design.md 6.2
 * 射撃班のような毎ティックの火力ではなく、1発ずつ撃つ。
 */
export const SNIPER = {
  maxHp: 25,
  hpPerMan: 25,
  men: 1,
  /** m/秒 (暫定) */
  speed: 1.2,
  proneSpeed: 0.8,
  /** m (暫定) */
  sightRange: 250,
  /** 見張る範囲は射撃班と同じ扇形(観測手が双眼鏡で広く見る。FM 23-10 4-14) */
  sightArc: 120 * DEG,
  /** 射程(暫定)。この距離まで減衰なし */
  range: 250,
  /** 射界の幅(暫定)。「向き」で指定した方向を中心に、この幅の中の敵だけを撃つ */
  arcWidth: 30 * DEG,
  /** 射界に入ってから撃つまで(秒)。止まっている目標 (暫定) */
  reactionStillSec: 0.4,
  /** 移動中の目標 (暫定) */
  reactionMovingSec: 1.2,
  /** 1発撃ってから次を撃てるまで(秒) (暫定) */
  cooldownSec: 8,
  /** 命中時の効果 */
  damage: 25,
  suppression: 50,
} as const;

/**
 * 迫撃砲班。design.md 6.3(60mm 迫撃砲 M224 の班を縮尺に合わせて抽象化。FM 23-90、ATP 3-21.90)
 */
export const MORTAR = {
  maxHp: 75,
  hpPerMan: 25,
  men: 3,
  /** m/秒 (暫定) */
  speed: 1.5,
  proneSpeed: 0.8,
  sightRange: 120,
  sightArc: 120 * DEG,
  /** 撃てる状態にする(展開)までの秒数 (暫定) */
  deploySec: 4,
  /** 移動できる状態にする(撤収)までの秒数 (暫定) */
  packSec: 3,
  /** 発射から着弾までの秒数 (暫定) */
  flightSec: 4,
  /** 射程 (暫定) */
  minRange: 50,
  maxRange: 400,
  /** 弾数 (暫定) */
  rounds: 8,
  /** 連続発射の間隔(秒) (暫定) */
  intervalSec: 2,
  /** 着弾効果 (暫定) */
  lethalRadius: 8,
  centerDamage: 60,
  suppressRadius: 15,
  suppression: 40,
  /** 迫撃砲の被害の係数:伏せている目標 / 遮蔽の内側の目標(上から落ちるので遮蔽の向きは問わない) */
  proneFactor: 0.5,
  coverFactor: 0.3,
  /** 観測されていない射撃は、狙った地点から迫撃砲の反対側へこれだけずれる(m) */
  unobservedError: 12,
  /** 着弾を味方が見ていれば、その地点からこの半径(m)以内への次の射撃は正確になる */
  adjustRadius: 15,
  /** 飛翔音の予兆:着弾のこの秒数前に、着弾点からこの半径以内のユニットが伏せる */
  warningSec: 0.5,
  warningRadius: 15,
  /** 自衛の小銃射撃の火力(射撃班に対する倍率)。撃つのは有効射程(100 m)の中の敵だけ */
  smallArmsFactor: 0.5,
} as const;

/**
 * 歩兵戦闘車(IFV)。design.md 6.4(M2 ブラッドレーを抽象化。FM 7-7J)
 */
export const IFV = {
  maxHp: 200,
  /** 人数で火力が変わらないので 1 人扱い */
  hpPerMan: 200,
  men: 1,
  /** m/秒 (暫定) */
  speed: 6,
  reverseSpeed: 2,
  proneSpeed: 0,
  /** 旋回(ラジアン/秒) (暫定) */
  turnRate: 45 * DEG,
  /** 茂み・軟らかい遮蔽の上を通るときの速度倍率 (暫定) */
  roughFactor: 0.5,
  sightRange: 150,
  sightArc: 120 * DEG,
  /** ハッチを閉めた状態(制圧値 70 以上)の視界の扇形と、見えない車体まわりの距離 (暫定) */
  buttonedArc: 60 * DEG,
  buttonedBlindRadius: 10,
  /** 機関砲 (暫定) */
  cannonRange: 300,
  firepower: 20,
  suppressionPerSec: 40,
  /** 乗車・下車(秒) (暫定) */
  mountSec: 3,
  /** 下車した班を置く、車体の後ろの距離(m) */
  dismountDistance: 5,
  /** 撃破されたとき、乗っていた班が受ける被害と制圧値 */
  bailOutDamage: 25,
  bailOutSuppression: 60,
  /** 撃破された車体の残骸(軟らかい遮蔽)の大きさ */
  wreckSize: { w: 7, h: 3.5 },
  /** 迫撃砲は直撃(この距離以内)でないと効かない */
  mortarDirectHitRadius: 2,
} as const;

/**
 * IFV の装甲:攻撃の種類 × 当たった面(正面・側面・背面)の被ダメージ係数。design.md 6.4 (暫定)
 * 正面・背面は車体の向きから ±45° 以内。
 */
export const IFV_ARMOR = {
  rifle: { front: 0, side: 0, rear: 0 },
  cannon: { front: 0.3, side: 1.0, rear: 1.2 },
  at: { front: 0.2, side: 1.0, rear: 1.5 },
  mortarDirect: { front: 0.5, side: 0.5, rear: 0.5 },
} as const;

/** 軽対戦車火器(射撃班のオプション装備、使い捨て1発)。design.md 6.1(AT4・M72。FM 23-25) */
export const AT_WEAPON = {
  /** 最小射程(信管が作動する距離)と射程 (暫定) */
  minRange: 10,
  range: 150,
  /** 構えてから撃つまで(秒) (暫定) */
  aimSec: 2,
  damage: 120,
  suppression: 50,
  /** 後方爆風:後ろのこの距離・この扇形にいる味方が制圧値と少しの被害を受ける */
  backblastRange: 10,
  backblastArc: 90 * DEG,
  backblastSuppression: 30,
  backblastDamage: 5,
} as const;

/**
 * 壁の崩壊:IFV の機関砲で撃たれ続けた硬い遮蔽は崩れて軟らかい遮蔽(瓦礫)になる (暫定)
 * 25mm は外壁の突破と、土・土嚢の陣地に非常に効果的(FM 7-8 6-17、FM 3-21.8 F-85)。
 */
export const WALL = {
  /** IFV の機関砲がこの秒数撃ち続けると崩れる */
  collapseSec: 12,
  /** 崩れた瞬間、その遮蔽の内側にいた者が受ける被害と制圧値 */
  collapseDamage: 15,
  collapseSuppression: 30,
} as const;

/** 兵科ごとの基本の値 */
export function unitStats(kind: 'fireteam' | 'sniper' | 'mortar' | 'ifv') {
  return kind === 'sniper' ? SNIPER : kind === 'mortar' ? MORTAR : kind === 'ifv' ? IFV : FIRETEAM;
}

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
  /** 制圧射撃の着弾点からこの半径(m)にいる敵が制圧値を受ける (暫定) */
  suppressiveFireRadius: 5,
  /**
   * 射手の制圧値がこれ未満(平常・動揺)の射撃だけが、相手の回復を止める。
   * 制圧状態の射撃と盲射は、制圧値を加えるが回復の待ちを止めない。
   */
  stopsRecoveryBelow: 70,
} as const;

/** 盲射:釘付けでも、効いている遮蔽の内側からなら銃だけ出して撃てる (暫定) */
export const BLIND_FIRE = {
  damage: 0.1,
  suppression: 0.2,
} as const;

/** 視界。design.md 4.1 */
export const VISION = {
  /** 茂みの中にいる目標は、この倍率の距離まで近づかないと発見できない */
  concealmentFactor: 0.5,
  /** 発砲したユニットは、この秒数のあいだ発見距離が伸びる */
  fireExposureSec: 2,
  fireExposureFactor: 2,
} as const;

/** 移動の到着判定(m) */
export const ARRIVE_EPSILON = 0.01;

export interface Vec2 {
  x: number;
  y: number;
}

export type Side = 'blue' | 'red';

/** 兵科 */
export type UnitKind = 'fireteam' | 'sniper' | 'mortar' | 'ifv';

/** 迫撃砲の射撃命令:フェイズ開始から atSec 秒後に target へ1発 */
export interface FireMission {
  target: Vec2;
  atSec: number;
}

/** 飛んでいる迫撃砲弾 */
export interface Shell {
  id: number;
  side: Side;
  shooterId: string;
  /** 狙った地点 */
  aim: Vec2;
  /** 実際に落ちる地点 */
  impact: Vec2;
  firedTick: number;
  impactTick: number;
}

/** 迫撃砲の状態:収納(移動できる)/展開中/展開済(撃てる)/撤収中 */
export type MortarState = 'packed' | 'deploying' | 'deployed' | 'packing';

/** design.md 4.2 の地形の種類(開けた地面は「何もない場所」として扱う) */
export type TerrainKind = 'hard' | 'soft' | 'concealment' | 'building';

export interface TerrainFeature {
  id: string;
  kind: TerrainKind;
  /** 凸多角形の頂点(m)。順番は時計回り・反時計回りどちらでもよい */
  poly: Vec2[];
}

export interface MapData {
  width: number;
  height: number;
  features: TerrainFeature[];
}

export interface Waypoint {
  pos: Vec2;
  /** このウェイポイントに着いてから待つ秒数 */
  waitSec: number;
}

/** 交戦姿勢:自由射撃 / 射撃禁止 */
export type FirePosture = 'free' | 'hold';

/** 接触後の方針:前進 / 保持 / 離脱 */
export type ContactPolicy = 'advance' | 'hold' | 'withdraw';

export interface Orders {
  route: Waypoint[];
  /** 向く方向(ラジアン、+x 方向が 0、反時計回り)。null なら進行方向を向く */
  facing: number | null;
  fire: FirePosture;
  policy: ContactPolicy;
  /** 離脱方針のときに後退する経路 */
  withdrawRoute: Vec2[];
  /**
   * 火力の集中(オプション):優先して撃つ敵の id。null なら一番近い敵を撃つ。
   * 指定した敵が撃てない(知らない・射程外・射線が通らない)ときは、一番近い敵を撃つ。
   */
  focusTargetId: string | null;
  /** 迫撃砲:経路の終点で展開して撃てる状態にする */
  deploy?: boolean;
  /** 迫撃砲:射撃命令 */
  fireMissions?: FireMission[];
  /** IFV:経路の終点で止まったら、乗っている班を下車させる */
  dismount?: boolean;
  /** 射撃班:この IFV に乗車する(IFV の後ろへ歩いて行って乗る) */
  mountId?: string | null;
  /** 射撃班:軽対戦車火器の使用許可(省略時は許可) */
  atAllowed?: boolean;
  /**
   * 射撃開始線(敵 AI の待ち伏せ用):射撃禁止のとき、陣営が知っている敵がこの距離(m)以内に入ったら撃ち始める。
   * null/省略なら使わない。
   */
  openFireRange?: number | null;
}

/**
 * 歩兵の行動段階。design.md 7章
 * - route:通常行動(経路移動・待機)
 * - reacting:接触した直後の反応遅延
 * - seekingCover:遮蔽へ退避中
 * - engaged:応射中(ここで接触後の方針が効く)
 * - advancing:前進方針で経路を再開している
 * - withdrawing:離脱方針で後退中
 */
export type Activity = 'route' | 'reacting' | 'seekingCover' | 'engaged' | 'advancing' | 'withdrawing';

export interface Unit {
  id: string;
  side: Side;
  kind: UnitKind;
  pos: Vec2;
  facing: number;
  hp: number;
  suppression: number;
  alive: boolean;
  prone: boolean;
  orders: Orders;

  activity: Activity;
  /** 反応遅延の残りティック */
  reactTicksLeft: number;
  /** 経路の何番目のウェイポイントへ向かっているか */
  routeIndex: number;
  /** 現在のウェイポイントでの待機の残りティック。-1 は未到着 */
  waitTicksLeft: number;
  withdrawIndex: number;
  coverTarget: Vec2 | null;
  /** 射撃禁止が(撃たれた・発見されたことで)解除されたか */
  holdFireLifted: boolean;
  /** 相手の回復を止める射撃(平常・動揺の射手の射撃)を最後に受けてからのティック数 */
  ticksSinceShot: number;
  /** 前のティックに何らかの射撃(弱い射撃や盲射を含む)を受けたか */
  firedOn: boolean;
  /** 敵が見えず撃たれもしない状態が続いたティック数 */
  quietTicks: number;
  /** 脅威の方向を決めるための位置(最後に見た/撃ってきた敵) */
  threatPos: Vec2 | null;
  /** 最後に撃たれたときの射手の位置 */
  lastShotFrom: Vec2 | null;
  /** このユニットが最後に射撃目標にした敵の位置(最終確認位置) */
  lastKnownTargetPos: Vec2 | null;
  lastKnownTargetId: string | null;

  /** このティックに動いたか(被ダメージ係数「移動中」に使う) */
  moved: boolean;
  /** このティックの射撃(描画用) */
  shot: Shot | null;
  /** 最後に発砲してからのティック数(発砲による暴露に使う) */
  ticksSinceFired: number;
  /** 最後にこちらを撃ってきた敵の id */
  lastShooterId: string | null;

  // ---- スナイパー用
  /** 次を撃てるまでの残りティック */
  cooldownTicks: number;
  /** 狙っている敵と、狙い始めてからのティック数 */
  aimTargetId: string | null;
  aimTicks: number;
  /** 最後に撃ったティックと着弾点(描画用) */
  lastFire: { tick: number; point: Vec2 } | null;

  // ---- 迫撃砲用
  mortarState: MortarState;
  /** 展開・撤収の残りティック */
  mortarTicks: number;
  rounds: number;
  /** まだ撃っていない射撃命令(撃つティックつき) */
  missionQueue: Array<{ target: Vec2; tick: number }>;
  /** 着弾を味方が見て修正が済んだ地点 */
  adjustedAim: Vec2 | null;

  /** 飛翔音で伏せている残りティック(この間は動かない) */
  duckTicks: number;
  /** 前のティックに受けた射撃が迫撃砲だけだったか(撃ってきた方向がない) */
  shelledOnly: boolean;

  // ---- IFV と乗車
  /** 乗っている IFV の id(乗車中は地図に出ず、撃てず、撃たれない) */
  mountedIn: string | null;
  /** IFV:乗せている班の id */
  passengerId: string | null;
  /** 乗車・下車の進み具合(ティック) */
  mountTicks: number;
  /** IFV:砲塔の向き(描画用) */
  turret: number;

  // ---- 軽対戦車火器
  atRounds: number;
  atTargetId: string | null;
  atAimTicks: number;
  /** このティックに撃った対戦車火器の目標(描画用) */
  atShot: string | null;
}

export interface Shot {
  /** 直接射撃の目標。制圧射撃なら null */
  targetId: string | null;
  point: Vec2;
  /** 釘付け状態からの盲射か */
  blind: boolean;
}

export type Outcome = 'ongoing' | 'blueWin' | 'redWin' | 'draw';

/** ある陣営から見た敵の情報。design.md 4.1 */
export interface SideVision {
  /** いま味方のいずれかの視界に入っている敵の id(昇順) */
  visible: string[];
  /** 敵ごとの最終確認位置と、そのときのティック */
  lastSeen: Record<string, { pos: Vec2; tick: number }>;
}

export interface SimState {
  tick: number;
  map: MapData;
  /** id の昇順で並べる(処理順を固定するため) */
  units: Unit[];
  outcome: Outcome;
  /** 各陣営の視界(blue = 味方から見た敵の情報) */
  vision: Record<Side, SideVision>;
  /** 飛んでいる迫撃砲弾 */
  shells: Shell[];
  nextShellId: number;
  /** 最近の着弾(描画用。1秒で消える) */
  impacts: Array<{ pos: Vec2; tick: number; side: Side }>;
  /** 硬い遮蔽ごとの、IFV の機関砲に撃たれた累計ティック(壁の崩壊) */
  wallDamage: Record<string, number>;
  /** 防衛線:守る側の陣営と、攻める側がこの y より手前(小さい側)に入ったら守る側の負け */
  defenseLine?: { defender: Side; y: number } | null;
  /** 敵 AI の記憶(フェイズをまたいで覚えておくこと) */
  ai?: AiMemory;
}

/** 敵 AI の記憶 */
export interface AiMemory {
  /** ユニットごとの、今いる陣地の番号 */
  posIndex: Record<string, number>;
  /** 最初に撃ち始めたティック(待ち伏せ型の撤収判断) */
  firstFireTick: number | null;
  /** 反撃をもう使ったか(防御型) */
  counterUsed: boolean;
  /** 回り込みに向かっているユニット(突撃型・防御型の反撃) */
  flanking: Record<string, boolean>;
}

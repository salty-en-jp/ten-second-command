export interface Vec2 {
  x: number;
  y: number;
}

export type Side = 'blue' | 'red';

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
}

export interface Shot {
  /** 直接射撃の目標。制圧射撃なら null */
  targetId: string | null;
  point: Vec2;
  /** 釘付け状態からの盲射か */
  blind: boolean;
}

export type Outcome = 'ongoing' | 'blueWin' | 'redWin' | 'draw';

export interface SimState {
  tick: number;
  map: MapData;
  /** id の昇順で並べる(処理順を固定するため) */
  units: Unit[];
  outcome: Outcome;
}

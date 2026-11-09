/**
 * 描画:sim の状態を読んで Canvas に描くだけ。状態は書き換えない。
 */
import { MORTAR, SNIPER, SUPPRESSION, unitStats, type Shell, type MapData, type Orders, type SimState, type TerrainKind, type Unit, type Vec2 } from '../sim';
import { menAlive } from '../sim/units';

export interface View {
  ctx: CanvasRenderingContext2D;
  /** 1 m あたりのピクセル(CSS ピクセル) */
  scale: number;
  map: MapData;
}

/** ワールド座標(m、北が +y)→ 画面座標(左上原点) */
export const toScreen = (v: View, p: Vec2) => ({ x: p.x * v.scale, y: (v.map.height - p.y) * v.scale });
export const toWorld = (v: View, x: number, y: number): Vec2 => ({ x: x / v.scale, y: v.map.height - y / v.scale });

const TERRAIN_STYLE: Record<TerrainKind, { fill: string; stroke: string }> = {
  hard: { fill: '#b9b4a6', stroke: '#e8e2d0' },
  soft: { fill: '#8a6438', stroke: '#c49a62' },
  concealment: { fill: 'rgba(52, 110, 46, 0.55)', stroke: 'rgba(120, 180, 100, 0.6)' },
  building: { fill: '#5b3d34', stroke: '#2b1d18' },
};

export const SIDE_COLOR = { blue: '#5aa9ff', red: '#ff6b5a' } as const;

function poly(v: View, pts: Vec2[]) {
  const { ctx } = v;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

export function drawTerrain(v: View) {
  const { ctx, map, scale } = v;
  ctx.fillStyle = '#56653f';
  ctx.fillRect(0, 0, map.width * scale, map.height * scale);
  // 10 m ごとの薄い格子
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= map.width; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, map.height * scale);
    ctx.stroke();
  }
  for (let y = 0; y <= map.height; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(map.width * scale, y * scale);
    ctx.stroke();
  }
  const order: TerrainKind[] = ['concealment', 'soft', 'hard', 'building'];
  for (const kind of order) {
    for (const f of map.features) {
      if (f.kind !== kind) continue;
      const st = TERRAIN_STYLE[kind];
      poly(v, f.poly);
      ctx.fillStyle = st.fill;
      ctx.fill();
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = kind === 'concealment' ? 1 : 1.5;
      ctx.stroke();
    }
  }
  // 方位と縮尺
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `${Math.max(10, scale * 4)}px system-ui`;
  ctx.textAlign = 'right';
  ctx.fillText('北 ↑', map.width * scale - 6, 16);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(8, map.height * scale - 10);
  ctx.lineTo(8 + 20 * scale, map.height * scale - 10);
  ctx.stroke();
  ctx.fillText('20 m', 10, map.height * scale - 14);
}

export function drawDeployZone(v: View, z: { x: number; y: number; w: number; h: number } | undefined) {
  if (!z) return;
  const a = toScreen(v, { x: z.x, y: z.y + z.h });
  v.ctx.strokeStyle = 'rgba(90,169,255,0.25)';
  v.ctx.setLineDash([4, 4]);
  v.ctx.strokeRect(a.x, a.y, z.w * v.scale, z.h * v.scale);
  v.ctx.setLineDash([]);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** 2つのティックの間を補間したユニット(描画用のコピー) */
export function interpolate(a: SimState, b: SimState, t: number): Unit[] {
  return b.units.map((ub) => {
    const ua = a.units.find((u) => u.id === ub.id) ?? ub;
    return {
      ...ub,
      pos: { x: lerp(ua.pos.x, ub.pos.x, t), y: lerp(ua.pos.y, ub.pos.y, t) },
      facing: lerpAngle(ua.facing, ub.facing, t),
    };
  });
}

/** 射撃の線 */
export function drawShots(v: View, units: Unit[]) {
  const { ctx } = v;
  for (const u of units) {
    if (!u.alive || !u.shot) continue;
    const a = toScreen(v, u.pos);
    const b = toScreen(v, u.shot.point);
    ctx.strokeStyle = u.side === 'blue' ? 'rgba(160,210,255,0.55)' : 'rgba(255,170,150,0.55)';
    ctx.lineWidth = u.shot.blind ? 1 : 1.5;
    ctx.setLineDash(u.shot.targetId === null ? [2, 5] : u.shot.blind ? [6, 6] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (u.shot.targetId === null) {
      ctx.strokeStyle = 'rgba(255,220,120,0.5)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, SUPPRESSION.suppressiveFireRadius * v.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function suppressionColor(s: number) {
  if (s >= SUPPRESSION.pinned) return '#ff3b30';
  if (s >= SUPPRESSION.suppressed) return '#ff9500';
  if (s >= SUPPRESSION.shaken) return '#ffd60a';
  return null;
}

export interface UnitDrawOptions {
  selected?: boolean;
  ghost?: boolean;
  label?: string;
  showSight?: boolean;
  /** スナイパーの射界を描く */
  showArc?: boolean;
  /** 射界の中心(計画中の向き)。省略時は今の向き */
  arcCenter?: number;
}

/** 迫撃砲の射程(最小・最大)の輪 */
export function drawMortarRange(v: View, u: Unit) {
  const { ctx, scale } = v;
  const p = toScreen(v, u.pos);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,224,122,0.35)';
  ctx.setLineDash([2, 6]);
  for (const r of [MORTAR.minRange, MORTAR.maxRange]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 着弾範囲(殺傷 8 m と制圧 15 m の輪)と文字 */
function blastMarker(v: View, at: Vec2, color: string, text: string, dashed: boolean) {
  const { ctx, scale } = v;
  const p = toScreen(v, at);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.beginPath();
  ctx.arc(p.x, p.y, MORTAR.lethalRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, MORTAR.suppressRadius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p.x - 4, p.y - 4);
  ctx.lineTo(p.x + 4, p.y + 4);
  ctx.moveTo(p.x + 4, p.y - 4);
  ctx.lineTo(p.x - 4, p.y + 4);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, p.x, p.y - MORTAR.suppressRadius * scale - 4);
  ctx.restore();
}

/** 計画中の射撃命令(観測が済んでいない地点は、遠くへずれる見込みも示す) */
export function drawFireMissions(v: View, u: Unit, missions: Array<{ target: Vec2; atSec: number }>) {
  // 同じ地点(1 m 以内)への命令はまとめて1つの印にする
  const groups: Array<{ target: Vec2; times: number[] }> = [];
  for (const m of missions) {
    const g = groups.find((x) => Math.hypot(x.target.x - m.target.x, x.target.y - m.target.y) < 1);
    if (g) g.times.push(m.atSec);
    else groups.push({ target: m.target, times: [m.atSec] });
  }
  groups.forEach((m) => {
    const adjusted = u.adjustedAim && Math.hypot(u.adjustedAim.x - m.target.x, u.adjustedAim.y - m.target.y) <= MORTAR.adjustRadius;
    blastMarker(v, m.target, '#ffe07a', `${m.times.length}発:${m.times.join('・')}秒に発射${adjusted ? '' : '(観測が済むまでは遠くへずれる)'}`, !adjusted);
    if (!adjusted) {
      const d = Math.hypot(m.target.x - u.pos.x, m.target.y - u.pos.y) || 1;
      const off = { x: m.target.x + ((m.target.x - u.pos.x) / d) * MORTAR.unobservedError, y: m.target.y + ((m.target.y - u.pos.y) / d) * MORTAR.unobservedError };
      const a = toScreen(v, m.target);
      const b = toScreen(v, off);
      v.ctx.save();
      v.ctx.strokeStyle = 'rgba(255,224,122,0.6)';
      v.ctx.setLineDash([2, 3]);
      v.ctx.beginPath();
      v.ctx.moveTo(a.x, a.y);
      v.ctx.lineTo(b.x, b.y);
      v.ctx.stroke();
      v.ctx.restore();
    }
  });
}

/** 飛んでいる味方の迫撃砲弾の着弾予定位置 */
export function drawShells(v: View, shells: Shell[], side: 'blue' | 'red', tick: number) {
  for (const sh of shells) {
    if (sh.side !== side) continue;
    blastMarker(v, sh.impact, '#ff9f43', `着弾まで ${((sh.impactTick - tick) / 20).toFixed(1)}秒`, false);
  }
}

/** 着弾(1 秒かけて広がって消える) */
export function drawImpacts(v: View, impacts: Array<{ pos: Vec2; tick: number }>, tick: number) {
  const { ctx, scale } = v;
  for (const im of impacts) {
    const age = (tick - im.tick) / 20;
    if (age < 0 || age > 1) continue;
    const p = toScreen(v, im.pos);
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = 'rgba(255,170,60,0.5)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, MORTAR.lethalRadius * scale * (0.5 + age), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,180,0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, MORTAR.suppressRadius * scale * (0.3 + age), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 敵の迫撃砲の飛翔音(着弾 0.5 秒前):近くの味方の頭上に「ヒュッ」 */
export function drawIncomingWarning(v: View, u: Unit) {
  const p = toScreen(v, u.pos);
  v.ctx.save();
  v.ctx.fillStyle = '#ffd60a';
  v.ctx.font = 'bold 12px system-ui';
  v.ctx.textAlign = 'center';
  v.ctx.fillText('ヒュッ!', p.x, p.y - 26);
  v.ctx.restore();
}

/** スナイパーの1発(撃ってから 0.5 秒だけ光る線) */
export function drawTracers(v: View, units: Unit[], tick: number) {
  const { ctx } = v;
  for (const u of units) {
    if ((u.kind !== 'sniper' && u.kind !== 'fireteam') || !u.lastFire) continue;
    const age = tick - u.lastFire.tick;
    if (age < 0 || age > 10) continue;
    const a = toScreen(v, u.pos);
    const b = toScreen(v, u.lastFire.point);
    ctx.save();
    ctx.globalAlpha = 1 - age / 11;
    ctx.strokeStyle = u.kind === 'fireteam' ? '#ffb36b' : '#fff6c0';
    ctx.lineWidth = u.kind === 'fireteam' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawUnit(v: View, u: Unit, opt: UnitDrawOptions = {}) {
  const { ctx, scale } = v;
  const p = toScreen(v, u.pos);
  const color = SIDE_COLOR[u.side];
  const r = Math.max(5, 2.6 * scale);
  ctx.save();
  if (opt.ghost) ctx.globalAlpha = 0.4;

  if (!u.alive) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y - r);
    ctx.lineTo(p.x + r, p.y + r);
    ctx.moveTo(p.x + r, p.y - r);
    ctx.lineTo(p.x - r, p.y + r);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // 視界の扇形(画面では y が下向きなので角度の符号が逆になる)
  const stats = unitStats(u.kind);
  if (opt.showSight) {
    const half = stats.sightArc / 2;
    ctx.fillStyle = u.side === 'blue' ? 'rgba(90,169,255,0.05)' : 'rgba(255,107,90,0.05)';
    ctx.strokeStyle = u.side === 'blue' ? 'rgba(90,169,255,0.35)' : 'rgba(255,107,90,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, stats.sightRange * scale, -u.facing - half, -u.facing + half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // スナイパーの射界(この細い扇形の中の敵だけを撃つ)
  if (u.kind === 'sniper' && opt.showArc) {
    const c = opt.arcCenter ?? u.facing;
    const half = SNIPER.arcWidth / 2;
    ctx.fillStyle = u.side === 'blue' ? 'rgba(255,224,122,0.14)' : 'rgba(255,107,90,0.16)';
    ctx.strokeStyle = u.side === 'blue' ? 'rgba(255,224,122,0.6)' : 'rgba(255,107,90,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, SNIPER.range * scale, -c - half, -c + half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 制圧値のリング
  const sc = suppressionColor(u.suppression);
  if (sc) {
    ctx.strokeStyle = sc;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (opt.selected) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 本体(射撃班は丸、スナイパーはひし形、迫撃砲は四角、IFV は向きのある長方形と砲塔)
  ctx.fillStyle = color;
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (u.kind === 'ifv') {
    const L = Math.max(10, 7 * scale);
    const W = Math.max(5, 3.6 * scale);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-u.facing);
    ctx.rect(-L / 2, -W / 2, L, W);
    ctx.fill();
    ctx.stroke();
    // 車体の前を示す三角
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);
    ctx.lineTo(L / 2 - 4, -3);
    ctx.lineTo(L / 2 - 4, 3);
    ctx.fill();
    ctx.restore();
    // 砲塔と砲身
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, W * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(-u.turret) * L * 0.8, p.y + Math.sin(-u.turret) * L * 0.8);
    ctx.stroke();
    ctx.beginPath(); // 下の fill/stroke を空打ちにする
  } else if (u.kind === 'mortar') {
    const k = r * 0.85;
    ctx.rect(p.x - k, p.y - k, k * 2, k * 2);
  } else if (u.kind === 'sniper') {
    const k = r * 0.9;
    ctx.moveTo(p.x, p.y - k);
    ctx.lineTo(p.x + k, p.y);
    ctx.lineTo(p.x, p.y + k);
    ctx.lineTo(p.x - k, p.y);
    ctx.closePath();
  } else if (u.prone) ctx.ellipse(p.x, p.y, r * 1.2, r * 0.6, -u.facing + Math.PI / 2, 0, Math.PI * 2);
  else ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 向き(IFV は車体と砲塔で示しているので描かない)
  if (u.kind !== 'ifv') {
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(-u.facing) * (r + 5), p.y + Math.sin(-u.facing) * (r + 5));
  ctx.stroke();
  }

  // 人数(残りの兵を点で)
  const men = menAlive(u);
  // 軽対戦車火器を持っていれば小さな印
  if (u.atRounds > 0) {
    ctx.fillStyle = '#ffb36b';
    ctx.fillRect(p.x + 10, p.y + r + 3, 5, 5);
  }
  for (let i = 0; i < (u.kind === 'ifv' ? 0 : stats.men); i++) {
    ctx.fillStyle = i < men ? '#fff' : 'rgba(255,255,255,0.15)';
    ctx.fillRect(p.x - 9 + i * 5, p.y + r + 4, 4, 3);
  }
  if (opt.label) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(opt.label, p.x, p.y - r - 7);
  }
  ctx.restore();
}

/** 見えなくなった敵の最終確認位置(何秒前か付き) */
export function drawLastSeen(v: View, side: 'blue' | 'red', pos: Vec2, secondsAgo: number, name: string) {
  const { ctx, scale } = v;
  const p = toScreen(v, pos);
  const r = Math.max(5, 2.6 * scale);
  ctx.save();
  ctx.strokeStyle = SIDE_COLOR[side];
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`${name}?`, p.x, p.y - r - 6);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(`${secondsAgo.toFixed(0)}秒前`, p.x, p.y + r + 12);
  ctx.restore();
}

/**
 * 視界の外から撃たれたときの、おおまかな射撃方向(design.md 4.1)。
 * 正確な位置がわからないよう、方向を 15° 刻みに丸めて ±20° の扇形で示す。
 */
export function drawUnseenFire(v: View, target: Vec2, from: Vec2) {
  const { ctx, scale } = v;
  const step = (15 * Math.PI) / 180;
  const a = Math.round(Math.atan2(from.y - target.y, from.x - target.x) / step) * step;
  const half = (20 * Math.PI) / 180;
  const p = toScreen(v, target);
  ctx.save();
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 60 * scale);
  g.addColorStop(0, 'rgba(255,80,60,0.35)');
  g.addColorStop(1, 'rgba(255,80,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.arc(p.x, p.y, 60 * scale, -a - half, -a + half);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 計画中の経路(ウェイポイントと待機秒数、離脱経路、向き、火力の集中) */
export function drawOrders(v: View, u: Unit, o: Orders, selected: boolean, targets: Unit[]) {
  const { ctx } = v;
  ctx.save();
  ctx.globalAlpha = selected ? 1 : 0.45;
  const path = [u.pos, ...o.route.map((w) => w.pos)];
  ctx.strokeStyle = '#a8d4ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  path.forEach((p, i) => {
    const s = toScreen(v, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  o.route.forEach((w, i) => {
    const s = toScreen(v, w.pos);
    ctx.setLineDash([]);
    ctx.fillStyle = '#a8d4ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}${w.waitSec > 0 ? ` 待${w.waitSec}秒` : ''}`, s.x + 6, s.y - 4);
  });
  // 離脱経路
  if (o.withdrawRoute.length > 0) {
    const last = o.route.at(-1)?.pos ?? u.pos;
    ctx.strokeStyle = '#ffb36b';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    [last, ...o.withdrawRoute].forEach((p, i) => {
      const s = toScreen(v, p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of o.withdrawRoute) {
      const s = toScreen(v, p);
      ctx.fillStyle = '#ffb36b';
      ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
    }
  }
  // 指定の向き
  if (o.facing !== null) {
    const end = o.route.at(-1)?.pos ?? u.pos;
    const s = toScreen(v, end);
    ctx.strokeStyle = '#ffe07a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(-o.facing) * 30, s.y + Math.sin(-o.facing) * 30);
    ctx.stroke();
  }
  // 火力の集中
  if (o.focusTargetId) {
    const t = targets.find((x) => x.id === o.focusTargetId);
    if (t) {
      const s = toScreen(v, t.pos);
      ctx.strokeStyle = '#ffe07a';
      ctx.lineWidth = 2;
      const r = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.moveTo(s.x - r - 4, s.y);
      ctx.lineTo(s.x + r + 4, s.y);
      ctx.moveTo(s.x, s.y - r - 4);
      ctx.lineTo(s.x, s.y + r + 4);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 描画:sim の状態を読んで Canvas に描くだけ。状態は書き換えない。
 */
import {
  MG, MORTAR, SMOKE, SNIPER, SUPPRESSION, unitStats, type Shell, type SmokeCloud, type MapData, type Orders, type SimState, type TerrainKind, type Unit, type Vec2 } from '../sim';
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

/** 地図の描き方:作戦地図(紙の地図と部隊記号)/戦術図(これまでの表示) */
export type MapStyle = 'paper' | 'tactical';
let STYLE: MapStyle = 'paper';
export function setMapStyle(s: MapStyle) {
  STYLE = s;
}
export const mapStyle = () => STYLE;
const paper = () => STYLE === 'paper';

const TACTICAL_SIDE = { blue: '#5aa9ff', red: '#ff6b5a' } as const;
const PAPER_SIDE = { blue: '#1f5fbf', red: '#c0392b' } as const;
/** 陣営の色(描き方で変わる) */
export const SIDE_COLOR = new Proxy({} as Record<'blue' | 'red', string>, {
  get: (_t, k: 'blue' | 'red') => (paper() ? PAPER_SIDE : TACTICAL_SIDE)[k],
});
/** 紙の地図のインク */
const INK = '#2a241c';

/**
 * 作戦地図では、明るい色の文字のまわりに濃いふちを付けて、紙の上でも読めるようにする。
 * Canvas の fillText を一度だけ包む(描くだけで、状態には触れない)。
 */
function isLight(style: string | CanvasGradient | CanvasPattern): boolean {
  if (typeof style !== 'string') return false;
  let r = 0;
  let g = 0;
  let b = 0;
  if (style.startsWith('#')) {
    const h = style.length === 4 ? style.slice(1).split('').map((c) => c + c).join('') : style.slice(1, 7);
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  } else {
    const m = style.match(/\d+(\.\d+)?/g);
    if (!m) return false;
    [r = 0, g = 0, b = 0] = m.map(Number);
  }
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

export function installTextHalo(ctx: CanvasRenderingContext2D) {
  const orig = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    if (paper() && isLight(ctx.fillStyle)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(40,32,22,0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeText(text, x, y, maxWidth);
      ctx.restore();
    }
    orig(text, x, y, maxWidth);
  };
}

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
  if (paper()) return drawPaperTerrain(v);
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
      ctx.fillStyle = f.enterable ? '#8a5d48' : st.fill;
      ctx.fill();
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = kind === 'concealment' ? 1 : 1.5;
      ctx.stroke();
      if (f.enterable) drawEnterable(v, f.poly, !!f.breached);
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

/** 作戦地図風の地形:紙の色、インクの格子、木の記号、黒い建物 */
function drawPaperTerrain(v: View) {
  const { ctx, map, scale } = v;
  const W = map.width * scale;
  const H = map.height * scale;
  ctx.fillStyle = '#e9e1c9';
  ctx.fillRect(0, 0, W, H);
  // 10 m の細い格子と、50 m ごとの太い格子(番号つき)
  for (let x = 0; x <= map.width; x += 10) {
    ctx.strokeStyle = x % 50 === 0 ? 'rgba(70,55,30,0.28)' : 'rgba(70,55,30,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, H);
    ctx.stroke();
  }
  for (let y = 0; y <= map.height; y += 10) {
    ctx.strokeStyle = y % 50 === 0 ? 'rgba(70,55,30,0.28)' : 'rgba(70,55,30,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, H - y * scale);
    ctx.lineTo(W, H - y * scale);
    ctx.stroke();
  }
  ctx.save();
  ctx.fillStyle = 'rgba(70,55,30,0.55)';
  ctx.font = '9px system-ui';
  for (let x = 50; x < map.width; x += 50) ctx.fillText(String(x / 10).padStart(2, '0'), x * scale + 2, 10);
  for (let y = 50; y < map.height; y += 50) ctx.fillText(String(y / 10).padStart(2, '0'), 2, H - y * scale - 2);
  ctx.restore();

  const order: TerrainKind[] = ['concealment', 'soft', 'hard', 'building'];
  for (const kind of order) {
    for (const f of map.features) {
      if (f.kind !== kind) continue;
      poly(v, f.poly);
      if (kind === 'concealment') {
        ctx.fillStyle = 'rgba(112,152,84,0.32)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,118,58,0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
        drawTrees(v, f.poly);
      } else if (kind === 'soft') {
        ctx.fillStyle = 'rgba(150,110,62,0.45)';
        ctx.fill();
        ctx.strokeStyle = '#7a5530';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (kind === 'hard') {
        ctx.fillStyle = '#5c4a36';
        ctx.fill();
        ctx.strokeStyle = '#2f261b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.fillStyle = f.enterable ? '#9a8a74' : '#3f3a35';
        ctx.fill();
        ctx.strokeStyle = '#1e1b18';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (f.enterable) drawEnterable(v, f.poly, !!f.breached);
      }
    }
  }
  // 方位記号と縮尺(白黒交互の物差し)
  ctx.save();
  const nx = W - 18;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(nx, 6);
  ctx.lineTo(nx + 6, 24);
  ctx.lineTo(nx, 19);
  ctx.lineTo(nx - 6, 24);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('N', nx, 36);
  const y0 = H - 12;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK : '#f4eedc';
    ctx.fillRect(8 + i * 10 * scale, y0, 10 * scale, 4);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(8, y0, 40 * scale, 4);
  ctx.fillStyle = INK;
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('0', 6, y0 - 3);
  ctx.fillText('40 m', 8 + 40 * scale - 10, y0 - 3);
  ctx.restore();
}

/** 茂み・林の木の記号(小さな丸を並べる) */
function drawTrees(v: View, pts: Vec2[]) {
  const { ctx, scale } = v;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  ctx.save();
  poly(v, pts);
  ctx.clip();
  ctx.strokeStyle = 'rgba(70,108,50,0.75)';
  ctx.lineWidth = 1;
  const step = 7;
  const thin = Math.min(x1 - x0, y1 - y0) < 6;
  for (let y = y0 + (thin ? (y1 - y0) / 2 : step / 2), row = 0; y <= y1; y += step, row++) {
    for (let x = x0 + (thin ? (x1 - x0) / 2 : (row % 2 ? step : step / 2)); x <= x1; x += step) {
      const s = toScreen(v, { x, y });
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1.5, 1.4 * scale), 0, Math.PI * 2);
      ctx.stroke();
      if (thin && x1 - x0 < 6) break;
    }
    if (thin && y1 - y0 < 6) break;
  }
  ctx.restore();
}

/** 作戦地図の部隊記号(NATO 式):味方は長方形、敵はひし形。中の記号が兵科 */
function drawPaperSymbol(v: View, u: Unit, p: { x: number; y: number }, r: number) {
  const { ctx } = v;
  const w = r * 2.6;
  const h = r * 1.8;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.fillStyle = u.side === 'blue' ? '#a9c9ef' : '#f2aaa0';
  ctx.beginPath();
  if (u.side === 'blue') ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
  else {
    const d = h * 0.95;
    ctx.moveTo(p.x, p.y - d);
    ctx.lineTo(p.x + d, p.y);
    ctx.lineTo(p.x, p.y + d);
    ctx.lineTo(p.x - d, p.y);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  // 枠の内側の四角(記号を描く場所)
  const iw = u.side === 'blue' ? w / 2 : h * 0.48;
  const ih = u.side === 'blue' ? h / 2 : h * 0.48;
  ctx.beginPath();
  const cross = () => {
    ctx.moveTo(p.x - iw, p.y - ih);
    ctx.lineTo(p.x + iw, p.y + ih);
    ctx.moveTo(p.x + iw, p.y - ih);
    ctx.lineTo(p.x - iw, p.y + ih);
  };
  if (u.kind === 'mortar') {
    // 迫撃砲:上向きの矢印と、下の小さな丸
    ctx.moveTo(p.x, p.y + ih * 0.5);
    ctx.lineTo(p.x, p.y - ih * 0.9);
    ctx.moveTo(p.x - ih * 0.45, p.y - ih * 0.45);
    ctx.lineTo(p.x, p.y - ih * 0.9);
    ctx.lineTo(p.x + ih * 0.45, p.y - ih * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y + ih * 0.7, ih * 0.22, 0, Math.PI * 2);
  } else if (u.kind === 'ifv') {
    // 機械化歩兵:×と、装軌を表す楕円
    cross();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, iw * 0.7, ih * 0.6, 0, 0, Math.PI * 2);
  } else {
    cross();
  }
  ctx.stroke();
  // 兵科の文字(狙撃手 SN、機関銃 MG)
  const tag = u.kind === 'sniper' ? 'SN' : u.kind === 'mg' ? 'MG' : '';
  if (tag) {
    ctx.fillStyle = INK;
    ctx.font = 'bold 8px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(tag, p.x + w / 2 + 2, p.y + 3);
  }
  // 伏せているときは枠の下に線
  if (u.prone) {
    ctx.beginPath();
    ctx.moveTo(p.x - w / 2, p.y + h / 2 + 2);
    ctx.lineTo(p.x + w / 2, p.y + h / 2 + 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** 入れる建物:内側に窓の点線。突破口が開いたら外周をオレンジの破線で示す */
function drawEnterable(v: View, pts: Vec2[], breached: boolean) {
  const { ctx } = v;
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
  const inner = pts.map((p) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    return { x: p.x + ((c.x - p.x) / d) * 1.5, y: p.y + ((c.y - p.y) / d) * 1.5 };
  });
  ctx.save();
  poly(v, inner);
  ctx.strokeStyle = paper() ? '#f6efdc' : 'rgba(255,230,180,0.75)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.stroke();
  if (breached) {
    poly(v, pts);
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
  }
  ctx.restore();
}

/** 防衛線(ここを敵に越えられたら負け) */
export function drawDefenseLine(v: View, y: number) {
  const { ctx, map, scale } = v;
  const p = toScreen(v, { x: 0, y });
  ctx.save();
  ctx.strokeStyle = 'rgba(255,90,70,0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(0, p.y);
  ctx.lineTo(map.width * scale, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,120,100,0.95)';
  ctx.font = 'bold 11px system-ui';
  ctx.fillText('防衛線(敵に越えられたら負け)', 8, p.y - 4);
  ctx.restore();
}

/** 配置フェイズ:ドラッグ中の部隊の置き先 */
export function drawDeployGhost(v: View, u: Unit, ok: boolean) {
  drawUnit(v, u, { ghost: true });
  const p = toScreen(v, u.pos);
  v.ctx.save();
  v.ctx.strokeStyle = ok ? '#7dff9a' : '#ff5a46';
  v.ctx.lineWidth = 2;
  v.ctx.beginPath();
  v.ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
  v.ctx.stroke();
  v.ctx.restore();
}

export function drawDeployZone(v: View, z: { x: number; y: number; w: number; h: number } | undefined, active = false) {
  if (!z) return;
  const a = toScreen(v, { x: z.x, y: z.y + z.h });
  if (active) {
    v.ctx.fillStyle = 'rgba(90,169,255,0.10)';
    v.ctx.fillRect(a.x, a.y, z.w * v.scale, z.h * v.scale);
  }
  v.ctx.strokeStyle = active ? 'rgba(90,169,255,0.8)' : 'rgba(90,169,255,0.25)';
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

/** 煙:立っている煙は灰色の雲、これから立つ煙は点線と残り秒数 */
export function drawSmokes(v: View, smokes: SmokeCloud[], tick: number) {
  const { ctx, scale } = v;
  for (const c of smokes) {
    const p = toScreen(v, c.pos);
    ctx.save();
    if (c.startTick <= tick) {
      const left = (c.endTick - tick) / 20;
      ctx.globalAlpha = Math.min(1, left / 3) * 0.78; // 消える前の3秒で薄くなる
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, c.r * scale);
      g.addColorStop(0, paper() ? 'rgba(150,150,150,1)' : 'rgba(230,230,225,1)');
      g.addColorStop(0.75, paper() ? 'rgba(170,170,168,0.95)' : 'rgba(210,210,205,0.95)');
      g.addColorStop(1, paper() ? 'rgba(180,180,178,0.4)' : 'rgba(200,200,195,0.4)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#333';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`煙 ${left.toFixed(0)}秒`, p.x, p.y + 3);
    } else {
      ctx.strokeStyle = 'rgba(230,230,225,0.8)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, c.r * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`煙まで ${((c.startTick - tick) / 20).toFixed(1)}秒`, p.x, p.y + 3);
    }
    ctx.restore();
  }
}

/** 計画中の発煙手榴弾(投げる地点と、届く範囲の輪) */
export function drawSmokeThrows(v: View, u: Unit, throws: Array<{ target: Vec2; atSec: number }>, selected: boolean) {
  const { ctx, scale } = v;
  ctx.save();
  if (selected && u.smokeGrenades > 0) {
    const p = toScreen(v, u.pos);
    ctx.strokeStyle = 'rgba(230,230,225,0.35)';
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, SMOKE.grenade.throwRange * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([4, 3]);
  for (const t of throws) {
    const p = toScreen(v, t.target);
    const ok = Math.hypot(t.target.x - u.pos.x, t.target.y - u.pos.y) <= SMOKE.grenade.throwRange;
    ctx.strokeStyle = ok ? 'rgba(230,230,225,0.9)' : 'rgba(255,90,70,0.9)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, SMOKE.grenade.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ok ? `煙:${t.atSec}秒に投げる` : '煙:届かない(30 m まで)', p.x, p.y - SMOKE.grenade.radius * scale - 4);
  }
  ctx.restore();
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
export function drawFireMissions(v: View, u: Unit, missions: Array<{ target: Vec2; atSec: number; kind?: 'he' | 'smoke' }>) {
  // 同じ地点(1 m 以内)・同じ弾の種類の命令はまとめて1つの印にする
  const groups: Array<{ target: Vec2; times: number[]; smoke: boolean }> = [];
  for (const m of missions) {
    const smoke = m.kind === 'smoke';
    const g = groups.find((x) => x.smoke === smoke && Math.hypot(x.target.x - m.target.x, x.target.y - m.target.y) < 1);
    if (g) g.times.push(m.atSec);
    else groups.push({ target: m.target, times: [m.atSec], smoke });
  }
  groups.forEach((m) => {
    const adjusted = u.adjustedAim && Math.hypot(u.adjustedAim.x - m.target.x, u.adjustedAim.y - m.target.y) <= MORTAR.adjustRadius;
    blastMarker(v, m.target, m.smoke ? '#e6e6e1' : '#ffe07a', `${m.smoke ? '発煙弾' : ''}${m.times.length}発:${m.times.join('・')}秒に発射${adjusted ? '' : '(観測が済むまでは遠くへずれる)'}`, !adjusted);
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

/** 迫撃砲の待機射撃の地点:この円の中に味方が敵を見つけたら撃つ */
export function drawOnCall(v: View, targets: Array<{ target: Vec2; rounds: number }>) {
  const { ctx } = v;
  for (const t of targets) {
    const c = toScreen(v, t.target);
    ctx.save();
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, MORTAR.onCallRadius * v.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(c.x - 5, c.y);
    ctx.lineTo(c.x + 5, c.y);
    ctx.moveTo(c.x, c.y - 5);
    ctx.lineTo(c.x, c.y + 5);
    ctx.stroke();
    ctx.fillStyle = '#ffcf99';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`待機射撃 ${t.rounds}発`, c.x, c.y - MORTAR.onCallRadius * v.scale - 4);
    ctx.restore();
  }
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

  // 据え付けた機関銃の射界(60°。この中の敵だけを遠くまで撃つ)
  if (u.kind === 'mg' && u.mortarState === 'deployed' && opt.showArc) {
    const c = opt.arcCenter ?? u.orders.facing ?? u.facing;
    const half = MG.arcWidth / 2;
    ctx.fillStyle = u.side === 'blue' ? 'rgba(255,170,90,0.10)' : 'rgba(255,107,90,0.12)';
    ctx.strokeStyle = u.side === 'blue' ? 'rgba(255,170,90,0.55)' : 'rgba(255,107,90,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, MG.maxRange * scale, -c - half, -c + half);
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
    ctx.strokeStyle = paper() ? INK : '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 作戦地図:部隊記号で描く(向きは短い線で示す)
  if (paper()) {
    drawPaperSymbol(v, u, p, r);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const a = u.kind === 'ifv' ? u.turret : u.facing;
    ctx.moveTo(p.x + Math.cos(-a) * r * 1.2, p.y + Math.sin(-a) * r * 1.2);
    ctx.lineTo(p.x + Math.cos(-a) * (r * 1.2 + 7), p.y + Math.sin(-a) * (r * 1.2 + 7));
    ctx.stroke();
  } else {
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
  } else if (u.kind === 'mg') {
    // 機関銃:三角形(据え付けると底辺に横棒)
    const k = r * 1.05;
    ctx.moveTo(p.x, p.y - k);
    ctx.lineTo(p.x + k, p.y + k * 0.8);
    ctx.lineTo(p.x - k, p.y + k * 0.8);
    ctx.closePath();
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
  }

  // 人数(残りの兵を点で)
  const men = menAlive(u);
  // 軽対戦車火器を持っていれば小さな印
  if (u.atRounds > 0) {
    ctx.fillStyle = '#ffb36b';
    ctx.fillRect(p.x + 10, p.y + r + 3, 5, 5);
  }
  for (let i = 0; i < (u.kind === 'ifv' ? 0 : stats.men); i++) {
    ctx.fillStyle = paper() ? (i < men ? INK : 'rgba(42,36,28,0.15)') : i < men ? '#fff' : 'rgba(255,255,255,0.15)';
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
  ctx.strokeStyle = paper() ? '#1f5fbf' : '#a8d4ff';
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
    ctx.fillStyle = paper() ? '#1f5fbf' : '#a8d4ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}${w.waitSec > 0 ? ` 待${w.waitSec}秒` : ''}`, s.x + 6, s.y - 4);
  });
  // 経路の終点から建物に入る
  if (o.enterId) {
    const s = toScreen(v, o.route.at(-1)?.pos ?? u.pos);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffe6b4';
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('▶ 建物に入る', s.x + 6, s.y + 14);
  }
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

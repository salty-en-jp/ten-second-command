/**
 * 画面の進行(配置済み → 計画 → 実行 → 計画 …)と操作。
 * ルールの計算はすべて sim に任せ、ここでは命令の下書きと再生だけを扱う。
 */
import {
  issueOrders,
  loadStage,
  PHASE_SECONDS,
  PHASE_TICKS,
  runPhase,
  TICKS_PER_SECOND,
  dist,
  angleTo,
  type Orders,
  type SimState,
  type StageData,
  type Unit,
  type Vec2,
} from '../sim';
import {
  drawDeployZone,
  drawOrders,
  drawShots,
  drawTerrain,
  drawUnit,
  interpolate,
  toWorld,
  type View,
} from '../render/draw';
import { draftsFor, label } from './orders';
import { renderPanel, type Tool } from './panel';

type Mode = 'planning' | 'executing' | 'over';

export class App {
  private stage: StageData;
  private initial: SimState;
  private current: SimState;
  private drafts: Record<string, Orders>;
  private preview: SimState[] = [];
  private frames: SimState[] = [];
  private mode: Mode = 'planning';
  private phase = 1;
  private selected: string | null = 'b1';
  private tool: Tool = 'route';
  private showSight: 'selected' | 'all' | 'none' = 'selected';
  private scrubTick = 0;
  private playTick = 0;
  private speed = 1;
  private lastTime = 0;
  private view: View;

  constructor(
    private canvas: HTMLCanvasElement,
    private panel: HTMLElement,
    private timeline: HTMLElement,
    private status: HTMLElement,
    stage: StageData,
  ) {
    this.stage = stage;
    this.initial = loadStage(stage);
    this.current = this.initial;
    this.drafts = draftsFor(this.current);
    const ctx = canvas.getContext('2d')!;
    this.view = { ctx, scale: 1, map: this.initial.map };
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.undoPoint();
    });
    this.resize();
    this.recomputePreview();
    this.refreshUI();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ 計画フェイズ

  /** 味方だけで命令どおりに動かしたときの予定(敵の未来は使わない) */
  private recomputePreview() {
    const friendlyOnly: SimState = { ...this.current, units: this.current.units.filter((u) => u.side === 'blue') };
    this.preview = runPhase(issueOrders(friendlyOnly, this.drafts));
  }

  private changed() {
    this.recomputePreview();
    this.refreshUI();
  }

  private selectedUnit(): Unit | undefined {
    return this.current.units.find((u) => u.id === this.selected && u.alive);
  }

  private onPointer(e: PointerEvent) {
    if (this.mode !== 'planning') return;
    const r = this.canvas.getBoundingClientRect();
    const p = toWorld(this.view, e.clientX - r.left, e.clientY - r.top);
    if (e.button === 2) return;

    const near = (side: 'blue' | 'red', radius: number) =>
      this.current.units
        .filter((u) => u.alive && u.side === side)
        .map((u) => ({ u, d: dist(u.pos, p) }))
        .filter((x) => x.d < radius)
        .sort((a, b) => a.d - b.d)[0]?.u;

    if (this.tool === 'focus') {
      const t = near('red', 6);
      const o = this.selected ? this.drafts[this.selected] : undefined;
      if (t && o) {
        o.focusTargetId = o.focusTargetId === t.id ? null : t.id;
        this.tool = 'route';
        this.changed();
      }
      return;
    }
    // 別の班をクリックしたら選び直す(選んでいる班の近くをクリックしたら経路の点になる)
    const b = near('blue', 3.5);
    if (b && b.id !== this.selected) {
      this.selected = b.id;
      this.refreshUI();
      return;
    }
    const u = this.selectedUnit();
    const o = this.selected ? this.drafts[this.selected] : undefined;
    if (!u || !o) return;
    const clamped: Vec2 = {
      x: Math.max(0, Math.min(this.view.map.width, p.x)),
      y: Math.max(0, Math.min(this.view.map.height, p.y)),
    };
    if (this.tool === 'route') o.route.push({ pos: clamped, waitSec: 0 });
    else if (this.tool === 'withdraw') o.withdrawRoute.push(clamped);
    else if (this.tool === 'facing') {
      const from = o.route.at(-1)?.pos ?? u.pos;
      o.facing = angleTo(from, clamped);
      this.tool = 'route';
    }
    this.changed();
  }

  private undoPoint() {
    if (this.mode !== 'planning' || !this.selected) return;
    const o = this.drafts[this.selected];
    if (!o) return;
    if (this.tool === 'withdraw') o.withdrawRoute.pop();
    else o.route.pop();
    this.changed();
  }

  // ------------------------------------------------------------ 実行フェイズ

  execute() {
    if (this.mode !== 'planning') return;
    const s = issueOrders(this.current, this.drafts);
    this.frames = [s, ...runPhase(s)];
    this.playTick = 0;
    this.mode = 'executing';
    this.refreshUI();
  }

  private finishPhase() {
    this.current = this.frames.at(-1)!;
    this.frames = [];
    if (this.current.outcome !== 'ongoing') {
      this.mode = 'over';
    } else {
      this.mode = 'planning';
      this.phase++;
      this.drafts = draftsFor(this.current);
      if (this.selected && !this.drafts[this.selected]) this.selected = Object.keys(this.drafts)[0] ?? null;
      this.scrubTick = 0;
      this.recomputePreview();
    }
    this.refreshUI();
  }

  retry() {
    this.current = this.initial;
    this.drafts = draftsFor(this.current);
    this.frames = [];
    this.mode = 'planning';
    this.phase = 1;
    this.scrubTick = 0;
    this.selected = 'b1';
    this.tool = 'route';
    this.recomputePreview();
    this.refreshUI();
  }

  private loop(t: number) {
    const dt = this.lastTime ? Math.min(0.1, (t - this.lastTime) / 1000) : 0;
    this.lastTime = t;
    if (this.mode === 'executing') {
      this.playTick += dt * TICKS_PER_SECOND * this.speed;
      if (this.playTick >= PHASE_TICKS) {
        this.playTick = PHASE_TICKS;
        this.draw();
        this.finishPhase();
      } else {
        this.updateTimeText();
        this.renderPanel(); // 部隊の状態を更新
      }
    }
    this.draw();
    requestAnimationFrame((tt) => this.loop(tt));
  }

  // ------------------------------------------------------------ 描画

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.scale = w / this.view.map.width;
    this.draw();
  }

  private draw() {
    const v = this.view;
    v.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawTerrain(v);
    if (this.mode === 'planning' && this.phase === 1) drawDeployZone(v, this.stage.deployZone);

    let units: Unit[];
    if (this.mode === 'executing' && this.frames.length > 0) {
      const i = Math.floor(this.playTick);
      const a = this.frames[Math.min(i, this.frames.length - 1)]!;
      const b = this.frames[Math.min(i + 1, this.frames.length - 1)]!;
      units = interpolate(a, b, this.playTick - i);
    } else {
      units = this.current.units;
    }

    if (this.mode === 'planning') {
      const enemies = units.filter((u) => u.side === 'red');
      for (const u of units) {
        const o = this.drafts[u.id];
        if (o) drawOrders(v, u, o, u.id === this.selected, enemies);
      }
      // タイムラインのスクラブ:味方の予定位置をゴーストで
      if (this.scrubTick > 0) {
        const f = this.preview[Math.min(this.scrubTick, this.preview.length) - 1];
        if (f) for (const g of f.units) drawUnit(v, g, { ghost: true });
      }
    }
    drawShots(v, units);
    for (const u of units) {
      drawUnit(v, u, {
        selected: this.mode === 'planning' && u.id === this.selected,
        label: label(u),
        showSight:
          u.alive &&
          (this.showSight === 'all' ||
            (this.showSight === 'selected' && (u.id === this.selected || u.side === 'red'))),
      });
    }
  }

  // ------------------------------------------------------------ 画面の文字とボタン

  private updateTimeText() {
    const el = this.timeline.querySelector('.time');
    const tick = this.mode === 'executing' ? this.playTick : this.scrubTick;
    if (el) el.textContent = `${(tick / TICKS_PER_SECOND).toFixed(1)} / ${PHASE_SECONDS.toFixed(1)} 秒`;
    const slider = this.timeline.querySelector<HTMLInputElement>('input[type=range]');
    if (slider && this.mode === 'executing') slider.value = String(Math.floor(tick));
  }

  private refreshUI() {
    const outcomeText =
      this.current.outcome === 'blueWin' ? '勝利:敵を全滅させました'
      : this.current.outcome === 'redWin' ? '敗北:味方が全滅しました'
      : this.current.outcome === 'draw' ? '引き分け:双方が全滅しました'
      : '';
    this.status.textContent =
      this.mode === 'over' ? outcomeText
      : this.mode === 'executing' ? `フェイズ ${this.phase}:実行中`
      : `フェイズ ${this.phase}:計画(時間停止中)`;

    // タイムライン
    const planning = this.mode === 'planning';
    this.timeline.innerHTML = `
      <button class="primary" data-act="exec" ${planning ? '' : 'disabled'}>▶ 実行(${PHASE_SECONDS}秒)</button>
      <input type="range" min="0" max="${PHASE_TICKS}" step="1" value="${this.mode === 'executing' ? Math.floor(this.playTick) : this.scrubTick}" ${planning ? '' : 'disabled'} title="予定位置のプレビュー" />
      <span class="time"></span>
      <span class="row">${[1, 2, 4].map((s) => `<button data-speed="${s}" class="${this.speed === s ? 'on' : ''}">×${s}</button>`).join('')}</span>
      <button data-act="retry">↺ 最初からやり直す</button>
    `;
    this.updateTimeText();
    this.timeline.querySelector('[data-act=exec]')?.addEventListener('click', () => this.execute());
    this.timeline.querySelector('[data-act=retry]')?.addEventListener('click', () => this.retry());
    this.timeline.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        this.speed = Number(b.dataset.speed);
        this.refreshUI();
      }),
    );
    this.timeline.querySelector<HTMLInputElement>('input[type=range]')?.addEventListener('input', (e) => {
      this.scrubTick = Number((e.target as HTMLInputElement).value);
      this.updateTimeText();
    });

    this.timeline.insertAdjacentHTML(
      'beforeend',
      `<span class="row">視界:${(['selected', 'all', 'none'] as const)
        .map((m) => `<button data-sight="${m}" class="${this.showSight === m ? 'on' : ''}">${{ selected: '選んだ班と敵', all: '全部', none: '隠す' }[m]}</button>`)
        .join('')}</span>`,
    );
    this.timeline.querySelectorAll<HTMLButtonElement>('[data-sight]').forEach((b) =>
      b.addEventListener('click', () => {
        this.showSight = b.dataset.sight as typeof this.showSight;
        this.refreshUI();
      }),
    );
    this.renderPanel();
  }

  private panelTick = -1;
  private renderPanel() {
    // 実行中は5ティックごとに更新(毎フレームだと重い)
    if (this.mode === 'executing') {
      const t = Math.floor(this.playTick / 5);
      if (t === this.panelTick) return;
      this.panelTick = t;
    }
    let units = this.current.units;
    if (this.mode === 'executing' && this.frames.length > 0) {
      units = this.frames[Math.min(Math.floor(this.playTick), this.frames.length - 1)]!.units;
    }
    const outcomeText =
      this.current.outcome === 'blueWin' ? '勝利:敵を全滅させました'
      : this.current.outcome === 'redWin' ? '敗北:味方が全滅しました'
      : this.current.outcome === 'draw' ? '引き分け:双方が全滅しました'
      : '';
    renderPanel(this.panel, {
      mode: this.mode,
      outcomeText,
      units,
      selected: this.selected,
      drafts: this.drafts,
      tool: this.tool,
      onSelect: (id) => {
        this.selected = id;
        this.refreshUI();
      },
      onTool: (t) => {
        this.tool = t;
        this.refreshUI();
      },
      onChange: () => this.changed(),
      onRetry: () => this.retry(),
    });
  }
}

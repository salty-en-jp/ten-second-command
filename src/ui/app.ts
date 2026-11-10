/**
 * 画面の進行(配置済み → 計画 → 実行 → 計画 …)と操作。
 * ルールの計算はすべて sim に任せ、ここでは命令の下書きと再生だけを扱う。
 */
import {
  issueOrders,
  loadStage,
  deployUnit,
  canDeployAt,
  planAi,
  evaluate,
  type Evaluation,
  PHASE_SECONDS,
  PHASE_TICKS,
  runPhase,
  TICKS_PER_SECOND,
  MORTAR,
  WARNING_TICKS,
  dist,
  angleTo,
  approachPoint,
  applyRoster,
  defaultRoster,
  rosterCost,
  rosterValid,
  type RosterChoice,
  buildingAt,
  type Orders,
  type SimState,
  type StageData,
  type Unit,
  type Vec2,
} from '../sim';
import {
  drawDeployZone,
  drawDeployGhost,
  drawDefenseLine,
  drawLastSeen,
  drawUnseenFire,
  drawTracers,
  drawFireMissions,
  drawImpacts,
  drawIncomingWarning,
  drawMortarRange,
  drawShells,
  drawSmokes,
  drawSmokeThrows,
  drawOrders,
  drawShots,
  drawTerrain,
  drawUnit,
  interpolate,
  toWorld,
  type View,
} from '../render/draw';
import { draftsFor, label, setLabels } from './orders';
import { saveBest } from './storage';
import { renderPanel, type Tool } from './panel';

type Mode = 'deploying' | 'planning' | 'executing' | 'over';

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
  /** 勝敗がついたときの評価 */
  private result: { ev: Evaluation; best: number } | null = null;
  private showSight: 'selected' | 'all' | 'none' = 'selected';
  /** 確認用:敵を全部見せる */
  private revealAll = false;
  private scrubTick = 0;
  private playTick = 0;
  private speed = 1;
  private lastTime = 0;
  private view: View;
  /** 配置フェイズ:控えも含めた全部隊の位置(編成を変えても位置を覚えておく)と、編成の選択 */
  private deployBase: SimState | null = null;
  private roster: RosterChoice = {};

  constructor(
    private canvas: HTMLCanvasElement,
    private panel: HTMLElement,
    private timeline: HTMLElement,
    private status: HTMLElement,
    stage: StageData,
  ) {
    this.stage = stage;
    setLabels(stage.units);
    canvas.style.aspectRatio = `${stage.width} / ${stage.height}`;
    this.initial = loadStage(stage);
    if (stage.deployment && stage.deployZone) {
      // 配置フェイズ:敵 AI はまだ命令を出さない(配置が決まってから考える)
      this.mode = 'deploying';
      this.current = this.initial;
      this.startDeployment();
    } else {
      this.current = planAi(this.initial, stage); // 敵 AI は計画フェイズの開始時に命令を出す
    }
    this.drafts = draftsFor(this.current);
    const ctx = canvas.getContext('2d')!;
    this.view = { ctx, scale: 1, map: this.initial.map };
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    canvas.addEventListener('pointermove', (e) => this.onDeployMove(e));
    canvas.addEventListener('pointerup', (e) => this.onDeployUp(e));
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

  // ------------------------------------------------------------ 配置フェイズ

  private dragging: string | null = null;
  private dragPos: Vec2 | null = null;

  private worldOf(e: PointerEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return toWorld(this.view, e.clientX - r.left, e.clientY - r.top);
  }

  private deployableUnitAt(p: Vec2) {
    return this.current.units
      .filter((u) => u.side === 'blue' && u.alive && u.mountedIn === null)
      .map((u) => ({ u, d: dist(u.pos, p) }))
      .filter((x) => x.d < 5)
      .sort((a, b) => a.d - b.d)[0]?.u;
  }

  /** 配置フェイズ:部隊を押さえたらドラッグ開始。何もない所を押したら、選んでいる部隊をそこへ置く */
  private onDeployDown(e: PointerEvent) {
    const p = this.worldOf(e);
    const u = this.deployableUnitAt(p);
    if (u) {
      this.selected = u.id;
      this.dragging = u.id;
      this.dragPos = p;
      this.canvas.setPointerCapture?.(e.pointerId);
    } else if (this.selected) {
      this.moveInDeployment(this.selected, p);
    }
    this.refreshUI();
  }

  private onDeployMove(e: PointerEvent) {
    if (this.mode !== 'deploying' || !this.dragging) return;
    this.dragPos = this.worldOf(e);
  }

  private onDeployUp(e: PointerEvent) {
    if (this.mode !== 'deploying' || !this.dragging) return;
    this.moveInDeployment(this.dragging, this.worldOf(e));
    this.dragging = null;
    this.dragPos = null;
    this.refreshUI();
  }

  /** 配置フェイズを始める(控えも含めて読み込み、最初の編成にする) */
  private startDeployment() {
    this.deployBase = loadStage(this.stage, true);
    this.roster = defaultRoster(this.stage);
    this.applyRosterChoice();
  }

  /** 編成の選択を反映する(連れていかない部隊は地図から消える) */
  private applyRosterChoice() {
    if (!this.deployBase) return;
    this.current = this.stage.budget ? applyRoster(this.deployBase, this.roster) : this.deployBase;
    if (this.selected && !this.current.units.some((u) => u.id === this.selected)) {
      this.selected = this.current.units.find((u) => u.side === 'blue' && u.mountedIn === null)?.id ?? null;
    }
  }

  /** 置き直した位置を、控えも含めた全部隊の状態に写す */
  private moveInDeployment(id: string, p: Vec2) {
    const next = deployUnit(this.current, this.stage.deployZone!, id, p);
    if (next === this.current || !this.deployBase) return;
    const base = this.deployBase;
    this.deployBase = {
      ...base,
      units: base.units.map((u) => {
        const n = next.units.find((x) => x.id === u.id);
        return n && (n.id === id || n.mountedIn === id || u.mountedIn === id) ? { ...u, pos: { ...n.pos }, facing: n.facing, turret: n.turret, inBuilding: n.inBuilding } : u;
      }),
    };
    this.applyRosterChoice();
  }

  private rosterOk(): boolean {
    return !this.stage.budget || !this.deployBase || rosterValid(this.deployBase, this.roster, this.stage.budget);
  }

  /** 配置完了:この配置を「やり直し」の出発点にして、計画フェイズへ */
  finishDeployment() {
    if (!this.rosterOk()) return;
    this.initial = this.current;
    this.current = planAi(this.initial, this.stage);
    this.drafts = draftsFor(this.current);
    this.mode = 'planning';
    this.recomputePreview();
    this.refreshUI();
  }

  /** 配置からやり直す */
  redeploy() {
    this.startDeployment();
    this.initial = this.current;
    this.result = null;
    this.frames = [];
    this.phase = 1;
    this.mode = 'deploying';
    this.refreshUI();
  }

  private onPointer(e: PointerEvent) {
    if (this.mode === 'deploying') return this.onDeployDown(e);
    if (this.mode !== 'planning') return;
    const r = this.canvas.getBoundingClientRect();
    const p = toWorld(this.view, e.clientX - r.left, e.clientY - r.top);
    if (e.button === 2) return;

    const near = (side: 'blue' | 'red', radius: number) =>
      this.current.units
        .filter((u) => u.alive && u.side === side && u.mountedIn === null)
        .map((u) => ({ u, d: dist(u.pos, p) }))
        .filter((x) => x.d < radius)
        .sort((a, b) => a.d - b.d)[0]?.u;

    if (this.tool === 'focus') {
      // 見えている敵、または最終確認位置をクリックして指定する
      const ls = this.current.vision.blue.lastSeen;
      const t =
        near('red', 6) && (this.revealAll || this.current.vision.blue.visible.includes(near('red', 6)!.id))
          ? near('red', 6)
          : Object.entries(ls)
              .map(([id, x]) => ({ u: { id }, d: dist(x.pos, p) }))
              .filter((x) => x.d < 6)
              .sort((a, b) => a.d - b.d)[0]?.u;
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
    if (this.tool === 'smoke') {
      const ts = (o.smokeThrows ??= []);
      const last = ts.at(-1);
      ts.push({ target: clamped, atSec: last ? Math.min(10, last.atSec + 2) : 0 });
    } else if (this.tool === 'mortar') {
      const ms = (o.fireMissions ??= []);
      const last = ms.at(-1);
      ms.push({ target: clamped, atSec: last ? Math.min(10, last.atSec + 2) : 0 });
      o.deploy = true; // 撃つには展開が必要なので、射撃を命じたら自動で展開する
    } else if (this.tool === 'route') {
      // 入れる建物をクリック:入口まで歩いて入る(射撃班とスナイパー)
      const b = (u.kind === 'fireteam' || u.kind === 'sniper') && u.mountedIn === null ? buildingAt(this.view.map, clamped) : null;
      const from = o.route.at(-1)?.pos ?? u.pos;
      if (b && u.inBuilding === b.id && o.route.length === 0) o.enterId = b.id;
      else if (b) {
        o.route.push({ pos: approachPoint(b, from), waitSec: 0 });
        o.enterId = b.id;
      } else {
        o.route.push({ pos: clamped, waitSec: 0 });
        o.enterId = null; // 入ったあとに経路を足したら、入るのをやめる
      }
    }
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
    if (this.tool === 'smoke') o.smokeThrows?.pop();
    else if (this.tool === 'mortar') o.fireMissions?.pop();
    else if (this.tool === 'withdraw') o.withdrawRoute.pop();
    else {
      o.route.pop();
      o.enterId = null;
    }
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
    if (this.current.outcome === 'ongoing') this.current = planAi(this.current, this.stage);
    this.frames = [];
    if (this.current.outcome !== 'ongoing') {
      this.mode = 'over';
      const ev = evaluate(this.initial, this.current, this.phase, this.stage.par ?? 99);
      this.result = { ev, best: saveBest(this.stage.id, ev.stars) };
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
    this.current = planAi(this.initial, this.stage);
    this.result = null;
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
    // 地形は状態の中にある(壁が崩れる、車両の残骸が増えるため)
    const terrainFrame = this.mode === 'executing' && this.frames.length > 0 ? this.frames[Math.min(Math.floor(this.playTick) + 1, this.frames.length - 1)]! : this.current;
    v.map = terrainFrame.map;
    drawTerrain(v);
    if (this.mode === 'deploying' || (this.mode === 'planning' && this.phase === 1)) drawDeployZone(v, this.stage.deployZone, this.mode === 'deploying');
    if (this.current.defenseLine) drawDefenseLine(v, this.current.defenseLine.y);

    let units: Unit[];
    let frame: SimState = this.current;
    if (this.mode === 'executing' && this.frames.length > 0) {
      const i = Math.floor(this.playTick);
      const a = this.frames[Math.min(i, this.frames.length - 1)]!;
      const b = this.frames[Math.min(i + 1, this.frames.length - 1)]!;
      units = interpolate(a, b, this.playTick - i);
      frame = b;
    } else {
      units = this.current.units;
    }

    // 視界:味方から見えている敵だけを描く(倒れた敵は、倒したことがわかるので描く)
    const vis = new Set(frame.vision.blue.visible);
    const shown = (u: Unit) => u.mountedIn === null && (u.side === 'blue' || this.revealAll || vis.has(u.id) || !u.alive);
    if (!this.revealAll) {
      for (const [id, ls] of Object.entries(frame.vision.blue.lastSeen)) {
        if (vis.has(id)) continue;
        drawLastSeen(v, 'red', ls.pos, (frame.tick - ls.tick) / TICKS_PER_SECOND, label({ id }));
      }
      // 視界の外からの射撃は、おおまかな方向だけ示す(スナイパーの1発は1秒間)
      for (const e of units) {
        if (e.side !== 'red' || shown(e)) continue;
        if (e.shot?.targetId) {
          const t = units.find((x) => x.id === e.shot!.targetId);
          if (t) drawUnseenFire(v, t.pos, e.pos);
        } else if (e.kind === 'sniper' && e.lastFire && frame.tick - e.lastFire.tick <= TICKS_PER_SECOND) {
          drawUnseenFire(v, e.lastFire.point, e.pos);
        }
      }
    }

    if (this.mode === 'planning') {
      const enemies = units.filter((u) => u.side === 'red' && shown(u));
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
    // 煙
    drawSmokes(v, frame.smokes, frame.tick);
    // 迫撃砲:味方の弾の着弾予定位置、着弾、計画中の射撃、射程
    drawShells(v, frame.shells, 'blue', frame.tick);
    drawImpacts(v, frame.impacts, frame.tick);
    if (this.mode === 'planning') {
      for (const u of units) {
        const o = this.drafts[u.id];
        if (o && (o.smokeThrows ?? []).length + u.smokeGrenades > 0 && u.side === 'blue') drawSmokeThrows(v, u, o.smokeThrows ?? [], u.id === this.selected && this.tool === 'smoke');
        if (u.kind !== 'mortar' || !o) continue;
        if (u.id === this.selected) drawMortarRange(v, u);
        drawFireMissions(v, u, o.fireMissions ?? []);
      }
    }
    // 敵の弾の飛翔音:着弾 0.5 秒前から、近くの味方に表示
    for (const sh of frame.shells) {
      if (sh.side === 'blue' || sh.impactTick - frame.tick > WARNING_TICKS) continue;
      for (const u of units) {
        if (u.side === 'blue' && u.alive && Math.hypot(u.pos.x - sh.impact.x, u.pos.y - sh.impact.y) <= MORTAR.warningRadius) drawIncomingWarning(v, u);
      }
    }
    drawShots(v, units.filter(shown));
    drawTracers(v, units.filter(shown), frame.tick);
    for (const u of units) {
      if (!shown(u)) continue;
      drawUnit(v, u, {
        selected: (this.mode === 'planning' || this.mode === 'deploying') && u.id === this.selected,
        label: label(u),
        showArc: u.alive && (u.side === 'red' || u.id === this.selected || this.mode === 'executing'),
        arcCenter: this.mode === 'planning' ? (this.drafts[u.id]?.facing ?? undefined) : undefined,
        showSight:
          u.alive &&
          (this.showSight === 'all' ||
            (this.showSight === 'selected' && (u.id === this.selected || u.side === 'red'))),
      });
    }
    // 配置フェイズ:ドラッグ中の部隊を置く先(置けない場所なら赤)
    if (this.mode === 'deploying' && this.dragging && this.dragPos) {
      const u = units.find((x) => x.id === this.dragging);
      if (u) {
        const ok = canDeployAt(this.current, this.stage.deployZone!, this.dragPos, this.current.units.find((x) => x.id === this.dragging));
        drawDeployGhost(v, { ...u, pos: this.dragPos }, ok);
      }
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
      : this.current.outcome === 'redWin'
        ? this.current.units.some((u) => u.side === 'blue' && u.alive) ? '敗北:防衛線を突破されました' : '敗北:味方が全滅しました'
      : this.current.outcome === 'draw' ? '引き分け:双方が全滅しました'
      : '';
    const ai = this.stage.aiLabel ? `敵:${this.stage.aiLabel.name}(${this.stage.aiLabel.hint})  ` : '';
    this.status.textContent =
      ai +
      (this.mode === 'over' ? outcomeText
      : this.mode === 'executing' ? `フェイズ ${this.phase}:実行中`
      : `フェイズ ${this.phase}:計画(時間停止中)`);

    // タイムライン
    const planning = this.mode === 'planning';
    if (this.mode === 'deploying') {
      this.timeline.innerHTML = `<button class="primary" data-act="deployed" ${this.rosterOk() ? '' : 'disabled'}>✔ 配置完了(計画フェイズへ)</button>
        <span class="hint">部隊を点線の配置エリアの中でドラッグして置いてください(スマホは、部隊をタップしてから置きたい場所をタップ)。置いた場所から見える敵だけが表示されます。</span>`;
      this.timeline.querySelector('[data-act=deployed]')?.addEventListener('click', () => this.finishDeployment());
      this.status.textContent = (this.stage.aiLabel ? `敵:${this.stage.aiLabel.name}  ` : '') + '配置フェイズ';
      renderPanel(this.panel, {
        result: null, vision: this.current.vision.blue, tick: 0, revealAll: false, mode: 'deploying', outcomeText: '',
        units: this.current.units, selected: this.selected, drafts: {}, tool: this.tool,
        roster: this.stage.budget && this.deployBase
          ? { budget: this.stage.budget, choice: this.roster, units: this.deployBase.units.filter((u) => u.side === 'blue'), cost: rosterCost(this.deployBase, this.roster) }
          : undefined,
        onRoster: (id, field) => {
          const c = this.roster[id];
          if (!c) return;
          c[field] = !c[field];
          this.applyRosterChoice();
          this.refreshUI();
        },
        onSelect: (id) => { this.selected = id; this.refreshUI(); },
        onTool: () => {}, onChange: () => {}, onRetry: () => this.retry(),
      });
      return;
    }
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
    this.timeline.insertAdjacentHTML(
      'beforeend',
      `<label class="hint"><input type="checkbox" data-reveal ${this.revealAll ? 'checked' : ''}/> 敵を全部見せる(確認用)</label>`,
    );
    this.timeline.querySelector<HTMLInputElement>('[data-reveal]')?.addEventListener('change', (e) => {
      this.revealAll = (e.target as HTMLInputElement).checked;
      this.refreshUI();
    });
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
    let frame = this.current;
    if (this.mode === 'executing' && this.frames.length > 0) {
      frame = this.frames[Math.min(Math.floor(this.playTick), this.frames.length - 1)]!;
    }
    const units = frame.units;
    const outcomeText =
      this.current.outcome === 'blueWin' ? '勝利:敵を全滅させました'
      : this.current.outcome === 'redWin'
        ? this.current.units.some((u) => u.side === 'blue' && u.alive) ? '敗北:防衛線を突破されました' : '敗北:味方が全滅しました'
      : this.current.outcome === 'draw' ? '引き分け:双方が全滅しました'
      : '';
    renderPanel(this.panel, {
      result: this.result,
      canRedeploy: !!this.stage.deployment,
      onRedeploy: () => this.redeploy(),
      vision: frame.vision.blue,
      tick: frame.tick,
      revealAll: this.revealAll,
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

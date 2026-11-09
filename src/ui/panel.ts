/** 右側のパネル:選んだ班への命令を入力する */
import { MORTAR, SUPPRESSION, TICKS_PER_SECOND, type Orders, type SideVision, type Unit } from '../sim';
import { label } from './orders';
import { starText } from './storage';
import type { Evaluation } from '../sim';

export type Tool = 'route' | 'withdraw' | 'facing' | 'focus' | 'mortar';

interface PanelProps {
  result: { ev: Evaluation; best: number } | null;
  vision: SideVision;
  tick: number;
  revealAll: boolean;
  mode: 'deploying' | 'planning' | 'executing' | 'over';
  canRedeploy?: boolean;
  onRedeploy?(): void;
  outcomeText: string;
  units: Unit[];
  selected: string | null;
  drafts: Record<string, Orders>;
  tool: Tool;
  onSelect(id: string): void;
  onTool(t: Tool): void;
  onChange(): void;
  onRetry(): void;
}

const stateText = (u: Unit) => {
  if (!u.alive) return '全滅';
  const s = u.suppression;
  const st = s >= SUPPRESSION.pinned ? '釘付け' : s >= SUPPRESSION.suppressed ? '制圧' : s >= SUPPRESSION.shaken ? '動揺' : '平常';
  const act: Record<Unit['activity'], string> = {
    route: '通常行動', reacting: '接触!', seekingCover: '遮蔽へ退避', engaged: '応射', advancing: '前進', withdrawing: '離脱',
  };
  return `${st}・${act[u.activity]}${u.prone ? '(伏せ)' : ''}`;
};

const btn = (attr: string, text: string, on: boolean) => `<button ${attr} class="${on ? 'on' : ''}">${text}</button>`;

export function renderPanel(el: HTMLElement, p: PanelProps) {
  const blue = p.units.filter((u) => u.side === 'blue');
  const red = p.units.filter((u) => u.side === 'red');
  const status = (u: Unit) => {
    if (u.mountedIn !== null && u.alive) {
      if (u.side === 'red' && !p.revealAll) return `<div class="hint">${label(u)}:見えていない</div>`;
      return `<div class="hint">${label(u)}:${label({ id: u.mountedIn })}に乗車中(耐久 ${Math.ceil(u.hp)}/100)${u.atRounds > 0 ? `、対戦車火器 ${u.atRounds}発` : ''}</div>`;
    }
    if (u.side === 'red' && u.alive && !p.revealAll && !p.vision.visible.includes(u.id)) {
      const ls = p.vision.lastSeen[u.id];
      return `<div class="hint">${label(u)}:見えていない${ls ? `(最終確認 ${((p.tick - ls.tick) / TICKS_PER_SECOND).toFixed(0)}秒前)` : '(まだ見つけていない)'}</div>`;
    }
    const max = u.kind === 'sniper' ? 25 : u.kind === 'mortar' ? MORTAR.maxHp : u.kind === 'ifv' ? 200 : 100;
    const extra =
      u.kind === 'ifv' && u.alive
        ? `${u.suppression >= 70 ? '、ハッチを閉めている(視界が狭い)' : ''}${u.passengerId ? `、${label({ id: u.passengerId })}が乗車中` : ''}`
        : u.atRounds > 0 && u.alive ? `、対戦車火器 ${u.atRounds}発${u.atAimTicks > 0 ? '(構えている)' : ''}` : '';
    const mortarState = { packed: '収納(移動できる)', deploying: '展開中', deployed: '展開済(撃てる)', packing: '撤収中' };
    const mortar =
      u.kind === 'mortar' && u.alive
        ? `、${mortarState[u.mortarState]}${u.mortarTicks > 0 ? ` あと${(u.mortarTicks / TICKS_PER_SECOND).toFixed(1)}秒` : ''}、残弾 ${u.rounds}/${MORTAR.rounds}`
        : '';
    const sniper =
      u.kind === 'sniper' && u.alive
        ? u.cooldownTicks > 0 ? `、装填中 あと${(u.cooldownTicks / TICKS_PER_SECOND).toFixed(1)}秒` : u.aimTargetId ? `、${label({ id: u.aimTargetId })}を狙っている` : ''
        : '';
    return `<div class="hint">${label(u)}:耐久 ${Math.ceil(u.hp)}/${max}、制圧値 ${Math.round(u.suppression)}(${stateText(u)})${sniper}${mortar}${extra}</div>`;
  };

  let html = '';
  if (p.mode === 'over') {
    const r = p.result;
    const evalHtml =
      r && r.ev.stars > 0
        ? `<div class="stars">${starText(r.ev.stars)}</div>
           <div class="hint">かかったフェイズ:${r.ev.phases}(目標 ${r.ev.par})${r.ev.phases <= r.ev.par ? ' ✓' : ''}<br>
           失った耐久:${Math.round(r.ev.lossRatio * 100)}%(★3 は 30% 以下)<br>
           全滅した班:${r.ev.destroyed.length ? r.ev.destroyed.map((id) => label({ id })).join('、') : 'なし'}<br>
           このミッションの最高:${starText(r.best)}</div>
           <div class="hint">★1 勝利 / ★2 目標フェイズ以内 / ★3 さらに全滅した班なし・失った耐久30%以下</div>`
        : '';
    html += `<div class="overlay">${p.outcomeText}${evalHtml}<div class="row" style="justify-content:center"><button class="primary" data-act="retry">同じ配置からやり直す</button>${p.canRedeploy ? '<button data-act="redeploy">配置からやり直す</button>' : ''}<a href="#"><button>ミッション選択へ</button></a></div></div>`;
  }
  html += `<div class="group"><h3>部隊の状態</h3>${[...blue, ...red].map(status).join('')}</div>`;

  const u = blue.find((x) => x.id === p.selected && x.alive);
  const o = p.selected ? p.drafts[p.selected] : undefined;
  if (p.mode === 'planning' && u && o) {
    html += `
      <div class="group"><h3>命令を出す班</h3>
        <div class="row units">${blue.filter((x) => x.alive).map((x) => btn(`data-sel="${x.id}"`, label(x), x.id === p.selected)).join('')}</div>
      </div>
      <div class="group"><h3>地図をクリックして入力</h3>
        <div class="row">
          ${btn('data-tool="route"', '経路', p.tool === 'route')}
          ${btn('data-tool="facing"', u.kind === 'sniper' ? '射界(向き)' : '向き', p.tool === 'facing')}
          ${btn('data-tool="withdraw"', '離脱経路', p.tool === 'withdraw')}
          ${btn('data-tool="focus"', '撃つ敵を指定', p.tool === 'focus')}
          ${u.kind === 'mortar' ? btn('data-tool="mortar"', '迫撃砲の射撃', p.tool === 'mortar') : ''}
        </div>
        <div class="hint">${
          p.tool === 'route' ? '地図をクリックすると経路の点を足します。右クリックか「最後の点を消す」で取り消せます。'
          : p.tool === 'facing' ? (u.kind === 'sniper' ? '撃つ方向をクリックします。黄色い細い扇形(幅30°)の中に入った敵だけを撃ちます。' : '向かせたい方向をクリックします(経路の終点から)。')
          : p.tool === 'withdraw' ? '「離脱」のときに下がる経路をクリックで足します。右クリックで消します。'
          : p.tool === 'mortar' ? `着弾させたい場所をクリックします(1回で1発、2秒おき。自動で「展開する」になります)。射程は${MORTAR.minRange}〜${MORTAR.maxRange} m、発射から${MORTAR.flightSec}秒で着弾。味方のだれかがその場所を見ていないと、遠くへずれます(点線の矢印)。右クリックで最後の1発を取り消し。`
          : '集中して撃つ敵をクリックします。もう一度クリックで解除。'
        }</div>
      </div>
      ${u.kind === 'ifv' ? `
      <div class="group"><h3>IFV</h3>
        ${u.passengerId ? `<div class="row">${btn('data-dismount="1"', '経路の終点で下車させる', !!o.dismount)}${btn('data-dismount="0"', '乗せたまま', !o.dismount)}</div>
        <div class="hint">${label({ id: u.passengerId })}が乗っています。止まってから${3}秒で、車体の後ろ5 mに降ります。降りたあとは${label({ id: u.passengerId })}の経路を進みます。</div>` : '<div class="hint">だれも乗っていません。射撃班の「乗車する」で乗せられます。</div>'}
        <div class="hint">小銃は効きません。対戦車火器と機関砲に注意。正面より横・後ろが弱い。土塁などの縁で止まると車体を隠せます(ハルダウン)。小銃で撃たれ続けるとハッチを閉め、視界が狭くなります。</div>
      </div>` : ''}
      ${u.kind === 'fireteam' ? `
      <div class="group"><h3>乗車・対戦車火器</h3>
        ${u.mountedIn !== null ? `<div class="hint">${label({ id: u.mountedIn })}に乗車中です。経路は、降りたあとに進む道になります。</div>` : p.units
          .filter((x) => x.kind === 'ifv' && x.side === 'blue' && x.alive && (x.passengerId === null || x.passengerId === u.id))
          .map((x) => `<div class="row">${btn(`data-mount="${x.id}"`, `${label(x)}に乗車する`, o.mountId === x.id)}${o.mountId ? btn('data-mount=""', '乗車をやめる', false) : ''}</div>`)
          .join('')}
        ${u.atRounds > 0 ? `<div class="row">${btn('data-atuse="1"', `対戦車火器を使う(${u.atRounds}発)`, o.atAllowed !== false)}${btn('data-atuse="0"', '使わない', o.atAllowed === false)}</div>
        <div class="hint">見えている敵の IFV が 10〜150 m にいれば、2秒構えて撃ちます。横か後ろに当てないとほとんど効きません(横から2発で撃破)。撃つと後ろ10 mの味方に爆風が当たります。</div>` : ''}
      </div>` : ''}
      ${u.kind === 'mortar' ? `
      <div class="group"><h3>迫撃砲</h3>
        <div class="row">${btn('data-deploy="1"', '展開する(撃てる状態に)', !!o.deploy)}${btn('data-deploy="0"', '展開しない', !o.deploy)}</div>
        <div class="hint">展開に${MORTAR.deploySec}秒、動くには撤収に${MORTAR.packSec}秒かかります。経路が残っているときは、着いてから展開します。残弾 ${u.rounds}/${MORTAR.rounds}(撃つのは「実行」の間です)。</div>
        ${(o.fireMissions ?? []).length > 0 && !o.deploy ? '<div class="hint" style="color:#ff9f43">⚠ 「展開しない」になっているので撃てません。「展開する」を押してください。</div>' : ''}
        ${(o.fireMissions ?? []).length > 0 && o.deploy && u.mortarState !== 'deployed' && o.route.length === 0 ? `<div class="hint" style="color:#ffe07a">展開に${MORTAR.deploySec}秒かかるので、最初の1発は${MORTAR.deploySec}秒後からになります。</div>` : ''}
        ${(o.fireMissions ?? []).length === 0 ? '<div class="hint">射撃命令なし(「迫撃砲の射撃」で地図をクリック)</div>' : `<ol class="wps">${(o.fireMissions ?? [])
          .map((m, i) => `<li>${i + 1}発目<input type="number" min="0" max="10" step="1" value="${m.atSec}" data-at="${i}" />秒に発射 <button data-delmission="${i}">消す</button></li>`)
          .join('')}</ol>`}
      </div>` : ''}
      <div class="group"><h3>経路(点ごとの待機秒数)</h3>
        ${o.route.length === 0 ? '<div class="hint">経路なし(その場にとどまる)</div>' : `<ol class="wps">${o.route
          .map((w, i) => `<li>点${i + 1}<input type="number" min="0" max="10" step="1" value="${w.waitSec}" data-wait="${i}" />秒待つ</li>`)
          .join('')}</ol>`}
        <div class="row"><button data-act="undoPoint">最後の点を消す</button><button data-act="clearRoute">経路を消す</button>${o.withdrawRoute.length ? '<button data-act="clearWithdraw">離脱経路を消す</button>' : ''}</div>
      </div>
      <div class="group"><h3>${u.kind === 'sniper' ? '射界(向き)' : '向き'}</h3>
        <div class="row">${btn('data-facing="auto"', '進む方向を向く', o.facing === null)}${o.facing !== null ? btn('data-tool="facing"', '指定した向き', true) : ''}</div>
      </div>
      <div class="group"><h3>交戦姿勢</h3>
        <div class="row">${btn('data-fire="free"', '自由射撃', o.fire === 'free')}${btn('data-fire="hold"', '射撃禁止(待ち伏せ)', o.fire === 'hold')}</div>
        <div class="hint">射撃禁止:撃たれるか、敵に見つかるまで撃たない。</div>
      </div>
      <div class="group"><h3>接触後の方針</h3>
        <div class="row">${btn('data-policy="advance"', '前進', o.policy === 'advance')}${btn('data-policy="hold"', '保持', o.policy === 'hold')}${btn('data-policy="withdraw"', '離脱', o.policy === 'withdraw')}</div>
        <div class="hint">${
          o.policy === 'advance' ? '前進:制圧値が40未満になったら経路を再開する。'
          : o.policy === 'hold' ? '保持:その場で撃ち続ける。敵が見えなければ最後に見えた場所を撃つ。'
          : '離脱:釘付けでなければ離脱経路で下がる(速度×0.7)。'
        }</div>
      </div>
      <div class="group"><h3>火力の集中</h3>
        <div class="row">${btn('data-focus=""', '指定しない(近い敵)', o.focusTargetId === null)}${red
          .filter((r) => r.alive && (p.revealAll || p.vision.visible.includes(r.id) || p.vision.lastSeen[r.id]))
          .map((r) => btn(`data-focus="${r.id}"`, label(r), o.focusTargetId === r.id))
          .join('')}</div>
      </div>`;
  } else if (p.mode === 'deploying') {
    html += `<div class="group"><h3>配置する部隊</h3>
      <div class="row units">${blue.filter((x) => x.alive && x.mountedIn === null).map((x) => btn(`data-sel="${x.id}"`, label(x), x.id === p.selected)).join('')}</div>
      <div class="hint">選んだ部隊を、地図の点線の配置エリアの中に置きます。建物や石垣の上には置けません。敵から見える場所に置くと、最初から見つかっています。</div></div>`;
  } else if (p.mode === 'executing') {
    html += `<div class="hint">実行中です。10秒たつと止まり、次の命令を出せます。</div>`;
  }
  html += `
    <div class="group"><h3>地図の見かた</h3>
      <div class="legend">
        <i style="background:#b9b4a6"></i>硬い遮蔽(石垣・土塁・瓦礫):正面から±60°の射撃を×0.2
        <i style="background:#8a6438"></i>軟らかい遮蔽(木柵):正面から±60°の射撃を×0.5。弾は通る
        <i style="background:rgba(52,110,46,.8)"></i>茂み・果樹林:中にいると、半分の距離まで近づかれないと見つからない
        <i style="background:#5b3d34"></i>建物:入れない。弾をさえぎる
        <i style="background:#5aa9ff;border-radius:1px"></i>長方形=IFV(三角が車体の前、線が砲身)。小銃は効かない。IFV の機関砲で撃たれ続けた石垣・土塁は崩れて瓦礫(軟らかい遮蔽)になる
        <i style="background:#ffb36b"></i>オレンジの小さな四角=対戦車火器を持っている班
        <i style="border:2px solid #ffe07a"></i>迫撃砲の着弾範囲:内側の輪(8 m)で被害、外側の輪(15 m)で制圧。伏せると×0.5、遮蔽の内側なら×0.3
        <i style="background:#ffd60a;border-radius:50%"></i>動揺(制圧値40〜)
        <i style="background:#ff9500;border-radius:50%"></i>制圧(70〜):離脱以外では動かない
        <i style="background:#ff3b30;border-radius:50%"></i>釘付け(100):盲射しかできない
      </div>
      <div class="hint">敵は、味方のだれかの視界(扇形)に入っているときだけ見えます。見えなくなった敵は、最後に見えた場所に点線の丸と「○秒前」で表示されます。撃つと2秒間は見つかりやすくなります。視界の外から撃たれると、だいたいの方向が赤くぼんやり表示されます。</div>
      <div class="hint">白い点は班の残り人数。小さな点線の丸は「最後に見えた場所」への制圧射撃です。</div>
    </div>`;
  el.innerHTML = html;

  el.querySelector('[data-act=retry]')?.addEventListener('click', p.onRetry);
  el.querySelector('[data-act=redeploy]')?.addEventListener('click', () => p.onRedeploy?.());
  el.querySelectorAll<HTMLElement>('[data-sel]').forEach((b) => b.addEventListener('click', () => p.onSelect(b.dataset.sel!)));
  el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => p.onTool(b.dataset.tool as Tool)));
  if (!o) return;
  const on = (sel: string, f: (b: HTMLElement) => void) =>
    el.querySelectorAll<HTMLElement>(sel).forEach((b) => b.addEventListener('click', () => {
      f(b);
      p.onChange();
    }));
  on('[data-act=undoPoint]', () => (p.tool === 'withdraw' ? o.withdrawRoute.pop() : o.route.pop()));
  on('[data-deploy]', (b) => (o.deploy = b.dataset.deploy === '1'));
  on('[data-dismount]', (b) => (o.dismount = b.dataset.dismount === '1'));
  on('[data-mount]', (b) => (o.mountId = b.dataset.mount || null));
  on('[data-atuse]', (b) => (o.atAllowed = b.dataset.atuse === '1'));
  on('[data-delmission]', (b) => o.fireMissions?.splice(Number(b.dataset.delmission), 1));
  el.querySelectorAll<HTMLInputElement>('[data-at]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const m = o.fireMissions?.[Number(inp.dataset.at)];
      if (m) m.atSec = Math.max(0, Math.min(10, Math.round(Number(inp.value) || 0)));
      p.onChange();
    }),
  );
  on('[data-act=clearRoute]', () => (o.route = []));
  on('[data-act=clearWithdraw]', () => (o.withdrawRoute = []));
  on('[data-facing=auto]', () => (o.facing = null));
  on('[data-fire]', (b) => (o.fire = b.dataset.fire as Orders['fire']));
  on('[data-policy]', (b) => (o.policy = b.dataset.policy as Orders['policy']));
  on('[data-focus]', (b) => (o.focusTargetId = b.dataset.focus || null));
  el.querySelectorAll<HTMLInputElement>('[data-wait]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const w = o.route[Number(inp.dataset.wait)];
      if (w) w.waitSec = Math.max(0, Math.min(10, Math.round(Number(inp.value) || 0)));
      p.onChange();
    }),
  );
}

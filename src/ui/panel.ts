/** 右側のパネル:選んだ班への命令を入力する */
import { SUPPRESSION, type Orders, type Unit } from '../sim';
import { label } from './orders';

export type Tool = 'route' | 'withdraw' | 'facing' | 'focus';

interface PanelProps {
  mode: 'planning' | 'executing' | 'over';
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
  const status = (u: Unit) => `<div class="hint">${label(u)}:耐久 ${Math.ceil(u.hp)}/100、制圧値 ${Math.round(u.suppression)}(${stateText(u)})</div>`;

  let html = '';
  if (p.mode === 'over') {
    html += `<div class="overlay">${p.outcomeText}<div class="row" style="justify-content:center"><button class="primary" data-act="retry">同じ配置からやり直す</button></div></div>`;
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
          ${btn('data-tool="facing"', '向き', p.tool === 'facing')}
          ${btn('data-tool="withdraw"', '離脱経路', p.tool === 'withdraw')}
          ${btn('data-tool="focus"', '撃つ敵を指定', p.tool === 'focus')}
        </div>
        <div class="hint">${
          p.tool === 'route' ? '地図をクリックすると経路の点を足します。右クリックか「最後の点を消す」で取り消せます。'
          : p.tool === 'facing' ? '向かせたい方向をクリックします(経路の終点から)。'
          : p.tool === 'withdraw' ? '「離脱」のときに下がる経路をクリックで足します。右クリックで消します。'
          : '集中して撃つ敵をクリックします。もう一度クリックで解除。'
        }</div>
      </div>
      <div class="group"><h3>経路(点ごとの待機秒数)</h3>
        ${o.route.length === 0 ? '<div class="hint">経路なし(その場にとどまる)</div>' : `<ol class="wps">${o.route
          .map((w, i) => `<li>点${i + 1}<input type="number" min="0" max="10" step="1" value="${w.waitSec}" data-wait="${i}" />秒待つ</li>`)
          .join('')}</ol>`}
        <div class="row"><button data-act="undoPoint">最後の点を消す</button><button data-act="clearRoute">経路を消す</button>${o.withdrawRoute.length ? '<button data-act="clearWithdraw">離脱経路を消す</button>' : ''}</div>
      </div>
      <div class="group"><h3>向き</h3>
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
          .filter((r) => r.alive)
          .map((r) => btn(`data-focus="${r.id}"`, label(r), o.focusTargetId === r.id))
          .join('')}</div>
      </div>`;
  } else if (p.mode === 'executing') {
    html += `<div class="hint">実行中です。10秒たつと止まり、次の命令を出せます。</div>`;
  }
  html += `
    <div class="group"><h3>地図の見かた</h3>
      <div class="legend">
        <i style="background:#b9b4a6"></i>硬い遮蔽(石垣・土塁・瓦礫):正面から±60°の射撃を×0.2
        <i style="background:#8a6438"></i>軟らかい遮蔽(木柵):正面から±60°の射撃を×0.5。弾は通る
        <i style="background:rgba(52,110,46,.8)"></i>茂み・果樹林(今は効果なし)
        <i style="background:#5b3d34"></i>建物:入れない。弾をさえぎる
        <i style="background:#ffd60a;border-radius:50%"></i>動揺(制圧値40〜)
        <i style="background:#ff9500;border-radius:50%"></i>制圧(70〜):離脱以外では動かない
        <i style="background:#ff3b30;border-radius:50%"></i>釘付け(100):盲射しかできない
      </div>
      <div class="hint">白い点は班の残り人数。点線の丸は「最後に見えた場所」への制圧射撃です。</div>
    </div>`;
  el.innerHTML = html;

  el.querySelector('[data-act=retry]')?.addEventListener('click', p.onRetry);
  el.querySelectorAll<HTMLElement>('[data-sel]').forEach((b) => b.addEventListener('click', () => p.onSelect(b.dataset.sel!)));
  el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => p.onTool(b.dataset.tool as Tool)));
  if (!o) return;
  const on = (sel: string, f: (b: HTMLElement) => void) =>
    el.querySelectorAll<HTMLElement>(sel).forEach((b) => b.addEventListener('click', () => {
      f(b);
      p.onChange();
    }));
  on('[data-act=undoPoint]', () => (p.tool === 'withdraw' ? o.withdrawRoute.pop() : o.route.pop()));
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

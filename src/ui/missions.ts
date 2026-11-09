/** ミッション選択画面 */
import type { StageData } from '../sim';
import { loadBest, starText } from './storage';

export function renderMissionSelect(main: HTMLElement, status: HTMLElement, stages: StageData[]) {
  status.textContent = 'ミッションを選んでください';
  const count = (s: StageData, side: 'blue' | 'red') => s.units.filter((u) => u.side === side);
  const desc = (us: StageData['units']) =>
    us.map((u) => (u.kind === 'sniper' ? '狙撃手' : u.kind === 'mortar' ? '迫撃砲班' : u.kind === 'ifv' ? 'IFV' : '射撃班')).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
  const fmt = (d: Record<string, number>) => Object.entries(d).map(([k, n]) => `${k}×${n}`).join('、');
  main.innerHTML = `
    <section class="missions">
      ${stages
        .map(
          (s, i) => `
        <a class="mission" href="#${s.id}">
          <div class="num">ミッション ${i < 4 ? i + 1 : `5-${'ABC'[i - 4]}`}</div>
          <h2>${s.name}</h2>
          ${s.aiLabel ? `<div class="ai">敵の性格:<b>${s.aiLabel.name}</b> — ${s.aiLabel.description}</div>` : ''}
          <p>${s.description ?? ''}</p>
          <div class="best">${starText(loadBest(s.id))}<span class="hint"> 目標 ${s.par ?? '-'} フェイズ</span></div>
          <div class="hint">地図 ${s.width}×${s.height} m ／ 味方:${fmt(desc(count(s, 'blue')))} ／ 敵:${fmt(desc(count(s, 'red')))}</div>
        </a>`,
        )
        .join('')}
    </section>`;
}

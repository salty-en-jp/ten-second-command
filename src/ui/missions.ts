/** ミッション選択画面 */
import type { StageData } from '../sim';
import { DIFFICULTY } from '../sim';
import { bestId, loadBest, loadDifficulty, saveDifficulty, starText } from './storage';

export function renderMissionSelect(main: HTMLElement, status: HTMLElement, stages: StageData[]) {
  status.textContent = 'ミッションを選んでください';
  const diff = loadDifficulty();
  const count = (s: StageData, side: 'blue' | 'red') => s.units.filter((u) => u.side === side);
  const desc = (us: StageData['units']) =>
    us.map((u) => (u.kind === 'sniper' ? '狙撃手' : u.kind === 'mortar' ? '迫撃砲班' : u.kind === 'ifv' ? 'IFV' : u.kind === 'mg' ? '機関銃班' : '射撃班')).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});
  const fmt = (d: Record<string, number>) => Object.entries(d).map(([k, n]) => `${k}×${n}`).join('、');
  main.innerHTML = `
    <div class="difficulty row">難易度:
      <button data-diff="normal" class="${diff === 'normal' ? 'on' : ''}">ふつう</button>
      <button data-diff="easy" class="${diff === 'easy' ? 'on' : ''}">やさしい</button>
      <span class="hint">やさしい:敵から受ける被害と制圧が ×${DIFFICULTY.easy.incoming}、持ち点 ×${DIFFICULTY.easy.budget}、目標フェイズ +${DIFFICULTY.easy.par}。星は別に記録します。</span>
    </div>
    <section class="missions">
      ${stages
        .map(
          (s, i) => `
        <a class="mission" href="#${s.id}">
          <div class="num">ミッション ${i < 4 ? i + 1 : i < 7 ? `5-${'ABC'[i - 4]}` : i - 1}${s.deployment ? '(配置あり)' : ''}${s.tutorial ? ' <span class="tut-tag">📘 教官のメモつき</span>' : ''}</div>
          <h2>${s.name}</h2>
          ${s.aiLabel ? `<div class="ai">敵の性格:<b>${s.aiLabel.name}</b> — ${s.aiLabel.description}</div>` : ''}
          <p>${s.description ?? ''}</p>
          <div class="best">ふつう ${starText(loadBest(s.id))} ／ やさしい ${starText(loadBest(bestId(s.id, 'easy')))}<span class="hint"> 目標 ${s.par !== undefined ? s.par + (diff === 'easy' ? DIFFICULTY.easy.par : 0) : '-'} フェイズ</span></div>
          <div class="hint">地図 ${s.width}×${s.height} m ／ 味方:${fmt(desc(count(s, 'blue')))} ／ 敵:${fmt(desc(count(s, 'red')))}</div>
        </a>`,
        )
        .join('')}
    </section>`;
  main.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) =>
    b.addEventListener('click', () => {
      saveDifficulty(b.dataset.diff === 'easy' ? 'easy' : 'normal');
      renderMissionSelect(main, status, stages);
    }),
  );
}

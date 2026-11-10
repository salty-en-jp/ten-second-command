import type { StageData } from './sim';
import village from '../stages/mvp.json';
import ridge from '../stages/ridge.json';
import hill from '../stages/hill.json';
import meadow from '../stages/meadow.json';
import outskirtsA from '../stages/outskirts-a.json';
import outskirtsB from '../stages/outskirts-b.json';
import outskirtsC from '../stages/outskirts-c.json';
import crossroads from '../stages/crossroads.json';
import riverside from '../stages/riverside.json';
import kaido from '../stages/kaido.json';
import tani from '../stages/tani.json';
import { App } from './ui/app';
import { renderMissionSelect } from './ui/missions';

const STAGES = [village, ridge, hill, meadow, outskirtsA, outskirtsB, outskirtsC, crossroads, riverside, kaido, tani] as StageData[];
const $ = (id: string) => document.getElementById(id)!;

// URL の #ステージid で直接そのミッションを開く(再読み込みしても同じミッションのまま)
const id = location.hash.slice(1);
const stage = STAGES.find((s) => s.id === id);
if (stage) {
  new App($('map') as HTMLCanvasElement, $('panel'), $('timeline'), $('status'), stage);
} else {
  renderMissionSelect(document.querySelector('main')!, $('status'), STAGES);
}
window.addEventListener('hashchange', () => location.reload());

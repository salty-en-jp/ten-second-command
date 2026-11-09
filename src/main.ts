import type { StageData } from './sim';
import stage from '../stages/mvp.json';
import { App } from './ui/app';

const $ = (id: string) => document.getElementById(id)!;
new App($('map') as HTMLCanvasElement, $('panel'), $('timeline'), $('status'), stage as StageData);

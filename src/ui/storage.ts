/** 成績(ミッションごとの一番よい星の数)をブラウザに保存する。保存できない環境では何もしない */
const key = (id: string) => `ten-second-command:best:${id}`;

export function loadBest(id: string | undefined): number {
  if (!id) return 0;
  try {
    return Number(localStorage.getItem(key(id)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** 今回の星が今までより多ければ保存する。保存後の一番よい星の数を返す */
export function saveBest(id: string | undefined, stars: number): number {
  const best = Math.max(loadBest(id), stars);
  if (!id) return best;
  try {
    localStorage.setItem(key(id), String(best));
  } catch {
    /* 保存できない(プライベートモードなど)ときは何もしない */
  }
  return best;
}

export const starText = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** 地図の描き方(作戦地図/戦術図)をブラウザに覚えておく */
export function loadMapStyle(): 'paper' | 'tactical' {
  try {
    return localStorage.getItem('tsc.mapStyle') === 'tactical' ? 'tactical' : 'paper';
  } catch {
    return 'paper';
  }
}
export function saveMapStyle(m: 'paper' | 'tactical') {
  try {
    localStorage.setItem('tsc.mapStyle', m);
  } catch {
    /* 保存できなくても遊べる */
  }
}

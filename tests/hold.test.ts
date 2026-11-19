import { describe, expect, it } from 'vitest';
import {
  HOLD_COMPLETE_BONUS,
  HOLD_GRACE_MS,
  advanceHold,
  beginHold,
  makePlayNotes,
  releaseHold,
  repressHold,
  validateCharts,
  type PlayNote,
  type SongData,
} from '../src/logic';

/** t=1000 に頭、tick=500ms の長押しノーツを作る */
function holdNote(holdMs = 2000): PlayNote {
  const [n] = makePlayNotes([[1000, 1, holdMs]], 0);
  return n;
}

describe('makePlayNotes（長押しの読み込み）', () => {
  it('3要素目が長押しの長さになり、通常ノーツは 0', () => {
    const notes = makePlayNotes(
      [
        [1000, 0],
        [2000, 1, 1500],
      ],
      100,
    );
    expect(notes[0].holdMs).toBe(0);
    expect(notes[0].holdPhase).toBe('none');
    expect(notes[1].holdMs).toBe(1500);
    expect(notes[1].timeMs).toBe(2100);
    expect(notes[1].headJudge).toBeNull();
  });
});

describe('長押しの状態遷移', () => {
  it('押し続けると拍ごとに tick が入り、尾で完走する', () => {
    const n = holdNote(2000); // 頭1000、尾3000、tick 500ms
    beginHold(n, 'perfect', 500);
    expect(n.holdPhase).toBe('holding');
    expect(advanceHold(n, 1499).ticks).toBe(0);
    expect(advanceHold(n, 1500).ticks).toBe(1);
    expect(advanceHold(n, 2000).ticks).toBe(1);
    const last = advanceHold(n, 3000);
    expect(last.ticks).toBe(2); // 2500 と 3000（尾）の境界
    expect(last.completed).toBe(true);
    expect(n.holdPhase).toBe('done');
    // 完走後はもう何も起きない
    expect(advanceHold(n, 4000)).toEqual({ ticks: 0, completed: false, failed: false });
  });

  it('完走ボーナスは頭の判定で決まる（頭スコアの半分）', () => {
    expect(HOLD_COMPLETE_BONUS.perfect).toBe(500);
    expect(HOLD_COMPLETE_BONUS.great).toBe(350);
    expect(HOLD_COMPLETE_BONUS.good).toBe(200);
  });

  it('途中で離して猶予内に押し直せば復帰し、grace 中に来た tick は入らない', () => {
    const n = holdNote(2000);
    beginHold(n, 'great', 500);
    expect(advanceHold(n, 1500).ticks).toBe(1);
    releaseHold(n, 1950);
    expect(n.holdPhase).toBe('grace');
    // 70ms 後に押し直し。2000 の拍境界は grace の間に来たので捨てられる
    expect(repressHold(n, 2020)).toBe(true);
    expect(n.holdPhase).toBe('holding');
    expect(advanceHold(n, 2100).ticks).toBe(0);
    expect(advanceHold(n, 2500).ticks).toBe(1);
    expect(advanceHold(n, 3000).completed).toBe(true);
  });

  it('grace のまま advance しても、猶予内は失敗にならず tick も入らない', () => {
    const n = holdNote(2000);
    beginHold(n, 'perfect', 500);
    releaseHold(n, 1950);
    const during = advanceHold(n, 1990);
    expect(during).toEqual({ ticks: 0, completed: false, failed: false });
    expect(n.holdPhase).toBe('grace');
  });

  it('猶予を過ぎて押し直しても復帰せず、失敗になる', () => {
    const n = holdNote(2000);
    beginHold(n, 'perfect', 500);
    releaseHold(n, 1600);
    expect(repressHold(n, 1600 + HOLD_GRACE_MS + 1)).toBe(false);
    const ev = advanceHold(n, 1600 + HOLD_GRACE_MS + 1);
    expect(ev.failed).toBe(true);
    expect(n.holdPhase).toBe('failed');
  });

  it('離したまま尾を過ぎても失敗（猶予が尾に届いていない）', () => {
    const n = holdNote(2000); // 尾3000
    beginHold(n, 'perfect', 500);
    releaseHold(n, 1200);
    const ev = advanceHold(n, 3500);
    expect(ev.failed).toBe(true);
    expect(ev.completed).toBe(false);
  });

  it('尾の直前で離した場合は、猶予内に尾へ届けば完走扱い', () => {
    const n = holdNote(2000); // 尾3000
    beginHold(n, 'good', 500);
    releaseHold(n, 2950); // 猶予の終わり 3050 >= 尾 3000
    const ev = advanceHold(n, 3000);
    expect(ev.completed).toBe(true);
    expect(ev.failed).toBe(false);
    expect(n.holdPhase).toBe('done');
  });

  it('未開始のノーツには何も起きない', () => {
    const n = holdNote(2000);
    releaseHold(n, 1500); // holding でないので無視
    expect(n.holdPhase).toBe('none');
    expect(repressHold(n, 1500)).toBe(false);
    expect(advanceHold(n, 5000)).toEqual({ ticks: 0, completed: false, failed: false });
  });
});

describe('validateCharts（長押しの検証）', () => {
  const base = (easy: SongData['charts']['easy']): SongData => ({
    title: 'x',
    durationMs: 100_000,
    bpm: 120,
    fever: [[10, 20]],
    charts: {
      easy,
      normal: [
        [3000, 0],
        [4000, 1],
        [5000, 2],
      ],
      hard: [
        [3000, 0],
        [4000, 1],
        [5000, 2],
        [6000, 3],
      ],
    },
  });

  it('正しい長押しは通る', () => {
    const song = base([
      [3000, 0, 1000],
      [6000, 1],
      [7000, 2],
    ]);
    expect(validateCharts(song)).toEqual([]);
  });

  it('帯の中に同じレーンのノーツがあると検出する', () => {
    const song = base([
      [3000, 0, 2000],
      [4000, 0], // 帯（3000-5000）の内側
      [7000, 2],
    ]);
    const errors = validateCharts(song);
    expect(errors.some((e) => e.includes('帯の中'))).toBe(true);
  });

  it('長押し同士の重なりを検出する', () => {
    const song = base([
      [3000, 0, 2000],
      [4000, 1, 1000], // 別レーンだが時間帯が重なる
      [7000, 2],
    ]);
    const errors = validateCharts(song);
    expect(errors.some((e) => e.includes('重なって'))).toBe(true);
  });

  it('尾が曲の終わりに近すぎると検出する', () => {
    const song = base([
      [3000, 0],
      [6000, 1],
      [98_000, 2, 1800], // 尾 99800 > 100000-500
    ]);
    const errors = validateCharts(song);
    expect(errors.some((e) => e.includes('尾が曲の終わり'))).toBe(true);
  });
});

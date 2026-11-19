import { describe, expect, it } from 'vitest';
import {
  accuracy,
  clampOffset,
  emptyCounts,
  findHit,
  isFever,
  judgeFor,
  makePlayNotes,
  rankFor,
  scoreFor,
  sweepMisses,
  validateCharts,
  type SongData,
} from '../src/logic';
import { SONGS } from '../src/charts';

describe('judgeFor（判定幅）', () => {
  it('±50ms は PERFECT', () => {
    expect(judgeFor(0)).toBe('perfect');
    expect(judgeFor(50)).toBe('perfect');
  });
  it('±100ms は GREAT', () => {
    expect(judgeFor(51)).toBe('great');
    expect(judgeFor(100)).toBe('great');
  });
  it('±160ms は GOOD、それ以上は窓の外', () => {
    expect(judgeFor(101)).toBe('good');
    expect(judgeFor(160)).toBe('good');
    expect(judgeFor(161)).toBeNull();
  });
});

describe('scoreFor / isFever', () => {
  it('基本スコアは 1000/700/400', () => {
    expect(scoreFor('perfect', false)).toBe(1000);
    expect(scoreFor('great', false)).toBe(700);
    expect(scoreFor('good', false)).toBe(400);
  });
  it('FEVER中は2倍、区間は [開始, 終了)', () => {
    const fever: [number, number][] = [[10, 20]];
    expect(isFever(fever, 9.99)).toBe(false);
    expect(isFever(fever, 10)).toBe(true);
    expect(isFever(fever, 19.99)).toBe(true);
    expect(isFever(fever, 20)).toBe(false);
    expect(scoreFor('perfect', true)).toBe(2000);
  });
});

describe('accuracy / rankFor', () => {
  it('精度は PERFECT + GREAT×0.7 + GOOD×0.4 で計算する', () => {
    expect(accuracy({ perfect: 10, great: 0, good: 0, miss: 0 })).toBe(100);
    expect(accuracy({ perfect: 0, great: 10, good: 0, miss: 0 })).toBeCloseTo(70);
    expect(accuracy({ perfect: 0, great: 0, good: 10, miss: 0 })).toBeCloseTo(40);
    expect(accuracy({ perfect: 5, great: 0, good: 0, miss: 5 })).toBe(50);
    expect(accuracy(emptyCounts())).toBe(0);
  });
  it('ランクの境界', () => {
    expect(rankFor(95)).toBe('S');
    expect(rankFor(94.9)).toBe('A');
    expect(rankFor(85)).toBe('A');
    expect(rankFor(84.9)).toBe('B');
    expect(rankFor(70)).toBe('B');
    expect(rankFor(69.9)).toBe('C');
  });
});

describe('clampOffset', () => {
  it('±200ms に丸め、10ms刻みにする', () => {
    expect(clampOffset(0)).toBe(0);
    expect(clampOffset(205)).toBe(200);
    expect(clampOffset(-999)).toBe(-200);
    expect(clampOffset(14)).toBe(10);
    expect(clampOffset(16)).toBe(20);
  });
});

describe('findHit / sweepMisses', () => {
  const chart = [
    [1000, 0],
    [2000, 1],
    [3000, 1],
  ] as const;

  it('同じレーンのいちばん近いノーツを取る', () => {
    const notes = makePlayNotes([...chart], 0);
    const hit = findHit(notes, 1, 2080);
    expect(hit?.note.timeMs).toBe(2000);
    expect(hit?.judge).toBe('great');
  });
  it('レーンが違う・窓の外は取らない', () => {
    const notes = makePlayNotes([...chart], 0);
    expect(findHit(notes, 0, 2080)).toBeNull();
    expect(findHit(notes, 1, 2500)).toBeNull();
  });
  it('オフセットがノーツ時刻に反映される', () => {
    const notes = makePlayNotes([...chart], 100);
    expect(notes[0].timeMs).toBe(1100);
  });
  it('窓を過ぎたノーツはミスになり、消費したノーツは数えない', () => {
    const notes = makePlayNotes([...chart], 0);
    expect(sweepMisses(notes, 1200)).toBe(1);
    expect(notes[0].state).toBe(2);
    expect(sweepMisses(notes, 1300)).toBe(0);
    const hit = findHit(notes, 1, 2000);
    if (hit) hit.note.state = 1;
    expect(sweepMisses(notes, 4000)).toBe(1); // 3000 のノーツだけ
  });
});

describe('譜面データ（生成済み charts.json）', () => {
  it('全曲・全難易度がバリデーションを通る', () => {
    for (const entry of SONGS) {
      expect(validateCharts(entry.data), entry.id).toEqual([]);
    }
  });
  it('曲の長さと BPM が実測の範囲にある', () => {
    // v1.6.0 から音ゲー用ショート編集（約105秒／約128秒）。全長版（約180秒）に戻っていないことも見る
    for (const entry of SONGS) {
      expect(entry.data.durationMs).toBeGreaterThan(95_000);
      expect(entry.data.durationMs).toBeLessThan(135_000);
      expect(entry.data.bpm).toBeGreaterThan(100);
      expect(entry.data.bpm).toBeLessThan(200);
    }
  });
  it('レーンが極端に偏っていない（各レーン 15% 以上）', () => {
    for (const entry of SONGS) {
      for (const diff of ['easy', 'normal', 'hard'] as const) {
        const notes = entry.data.charts[diff];
        for (let lane = 0; lane < 4; lane++) {
          const share = notes.filter((n) => n[1] === lane).length / notes.length;
          expect(share, `${entry.id}/${diff}/lane${lane}`).toBeGreaterThan(0.15);
        }
      }
    }
  });
  it('不正な譜面は validateCharts が検出する', () => {
    const bad: SongData = {
      title: 'x',
      durationMs: 100_000,
      bpm: 120,
      fever: [[10, 5]],
      charts: {
        easy: [[1000, 0]],
        normal: [
          [3000, 9],
          [2500, 0],
        ],
        hard: [[3000, 0]],
      },
    };
    const errors = validateCharts(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('FEVER'))).toBe(true);
  });
});

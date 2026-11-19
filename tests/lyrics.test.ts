import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lyricIndexAt, type LyricLine } from '../src/logic';

// 歌詞データ（src/data/lyrics.json）は scripts/extract-lyrics.py が
// 元動画の mov_text 字幕から抽出したもの。ここでは「時刻→行」の純関数と、
// データ自体の整合（昇順・尺の範囲内・空でない）を検証する。

const LINES: LyricLine[] = [
  { startMs: 0, endMs: 4000, text: 'a' },
  { startMs: 4000, endMs: 8000, text: 'b' },
  { startMs: 12000, endMs: 16000, text: 'c' }, // 8000〜12000 は間奏（行なし）
];

describe('lyricIndexAt（時刻→歌詞行）', () => {
  it('行の範囲内ではその行、開始ちょうどは含み、終了ちょうどは含まない', () => {
    expect(lyricIndexAt(LINES, 0)).toBe(0);
    expect(lyricIndexAt(LINES, 3999)).toBe(0);
    expect(lyricIndexAt(LINES, 4000)).toBe(1);
    expect(lyricIndexAt(LINES, 7999)).toBe(1);
    expect(lyricIndexAt(LINES, 12000)).toBe(2);
    expect(lyricIndexAt(LINES, 15999)).toBe(2);
  });

  it('行と行の間（間奏）と、最後の行のあとは -1', () => {
    expect(lyricIndexAt(LINES, 8000)).toBe(-1);
    expect(lyricIndexAt(LINES, 11999)).toBe(-1);
    expect(lyricIndexAt(LINES, 16000)).toBe(-1);
    expect(lyricIndexAt(LINES, 999999)).toBe(-1);
  });

  it('最初の行より前と、空のデータは -1', () => {
    expect(lyricIndexAt(LINES, -500)).toBe(-1);
    expect(lyricIndexAt([], 0)).toBe(-1);
  });
});

describe('歌詞データ（lyrics.json）の整合', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/lyrics.json', import.meta.url), 'utf8')) as Record<
    string,
    LyricLine[]
  >;
  const charts = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as Record<
    string,
    { durationMs: number }
  >;

  it('両曲とも行があり、昇順で、尺の範囲内にある', () => {
    for (const song of ['highway', 'night']) {
      const lines = raw[song];
      expect(lines.length).toBeGreaterThan(10);
      const duration = charts[song].durationMs;
      let prevStart = -1;
      for (const line of lines) {
        expect(line.text.trim()).not.toBe('');
        expect(line.startMs).toBeGreaterThan(prevStart);
        expect(line.endMs).toBeGreaterThan(line.startMs);
        expect(line.startMs).toBeLessThan(duration);
        expect(line.endMs).toBeLessThanOrEqual(duration);
        prevStart = line.startMs;
      }
    }
  });

  it('抽出結果の行数（highway 18行 / night 36行）', () => {
    expect(raw.highway).toHaveLength(18);
    expect(raw.night).toHaveLength(36);
  });
});

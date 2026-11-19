import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 譜面 v3 の検証: ノーツが実測拍列（charts.json の beats）の細分位置に沿っていること、
// パターン譜面のルール（3連続・同時押し・長押し）が守られていること。
// v1 の固定間隔グリッドでは、周期の推定誤差が累積してグリッドと実拍のズレが
// 曲の中で回転していた（冒頭と終盤で最大半拍近いズレ）。その回帰防止が目的。
// ゲーム本体（src/logic.ts の SongData）は beats を読まないので、ここでは
// charts.json を直接読む。ノーツは [時刻ms, レーン, 長押しms?]。
type RawNote = [number, number, number?];
interface RawSong {
  durationMs: number;
  bpm: number;
  beats: number[];
  charts: Record<'easy' | 'normal' | 'hard', RawNote[]>;
}

const raw = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as Record<string, RawSong>;
const DIFFS = ['easy', 'normal', 'hard'] as const;

/** 拍列（ms）から16分細分位置（ms）を作る。生成スクリプトと同じ補間 */
function subdivisions(beats: number[]): number[] {
  const pos: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const bt = beats[i];
    const nxt = i + 1 < beats.length ? beats[i + 1] : bt + (bt - beats[i - 1]);
    for (let s = 0; s < 4; s++) pos.push(bt + ((nxt - bt) * s) / 4);
  }
  return pos;
}

function nearestDelta(subdiv: number[], t: number): number {
  let best = Infinity;
  for (const p of subdiv) {
    const d = p - t;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** 同じレーンが続く区間 [開始idx, 終了idx] の列 */
function runs(notes: RawNote[]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < notes.length) {
    let j = i;
    while (j + 1 < notes.length && notes[j + 1][1] === notes[i][1]) j++;
    if (j - i + 1 >= 3) out.push([i, j]);
    i = j + 1;
  }
  return out;
}

describe('譜面データ v3（実測拍列との整合とパターンのルール）', () => {
  for (const [id, song] of Object.entries(raw)) {
    describe(id, () => {
      it('実測拍列があり、単調増加で曲全体を覆う', () => {
        expect(Array.isArray(song.beats)).toBe(true);
        expect(song.beats.length).toBeGreaterThan(100);
        for (let i = 1; i < song.beats.length; i++) {
          expect(song.beats[i]).toBeGreaterThan(song.beats[i - 1]);
        }
        expect(song.beats[0]).toBeLessThanOrEqual(0);
        expect(song.beats[song.beats.length - 1]).toBeGreaterThanOrEqual(song.durationMs);
      });

      it('表示 BPM が実測の整数値になっている', () => {
        expect(Number.isInteger(song.bpm)).toBe(true);
        expect(song.bpm).toBeGreaterThanOrEqual(120);
        expect(song.bpm).toBeLessThanOrEqual(170);
      });

      it('全ノーツが拍の細分位置から 70ms 以内にある', () => {
        const subdiv = subdivisions(song.beats);
        for (const diff of DIFFS) {
          for (const [t] of song.charts[diff]) {
            expect(Math.abs(nearestDelta(subdiv, t)), `${diff} @${t}ms`).toBeLessThanOrEqual(70);
          }
        }
      });

      it('3分割した各区間でズレの平均が小さく、回転ドリフトがない', () => {
        const subdiv = subdivisions(song.beats);
        for (const diff of DIFFS) {
          const notes = song.charts[diff];
          for (let s = 0; s < 3; s++) {
            const inThird = notes.filter(([t]) => t >= (song.durationMs * s) / 3 && t < (song.durationMs * (s + 1)) / 3);
            expect(inThird.length).toBeGreaterThan(0);
            const mean = inThird.reduce((acc, [t]) => acc + nearestDelta(subdiv, t), 0) / inThird.length;
            expect(Math.abs(mean), `${diff} 第${s + 1}区間`).toBeLessThanOrEqual(20);
          }
        }
      });

      it('レーン分布が 18〜32% に収まる', () => {
        for (const diff of DIFFS) {
          const notes = song.charts[diff];
          for (let lane = 0; lane < 4; lane++) {
            const share = notes.filter((n) => n[1] === lane).length / notes.length;
            expect(share, `${diff}/lane${lane}`).toBeGreaterThanOrEqual(0.18);
            expect(share, `${diff}/lane${lane}`).toBeLessThanOrEqual(0.32);
          }
        }
      });

      it('同一レーン4連続はなく、3連続は hard の縦連（間隔170ms以上）だけ', () => {
        for (const diff of DIFFS) {
          const notes = song.charts[diff];
          for (const [i0, i1] of runs(notes)) {
            const run = notes.slice(i0, i1 + 1);
            expect(run.length, `${diff} @${run[0][0]}ms`).toBe(3);
            expect(diff).toBe('hard');
            expect(run[1][0] - run[0][0]).toBeGreaterThanOrEqual(170);
            expect(run[2][0] - run[1][0]).toBeGreaterThanOrEqual(170);
          }
        }
      });

      it('同時押しは2つまで。easy にはなく、hard には十分ある', () => {
        for (const diff of DIFFS) {
          const byTime = new Map<number, number>();
          for (const [t] of song.charts[diff]) byTime.set(t, (byTime.get(t) ?? 0) + 1);
          const pairs = [...byTime.values()].filter((c) => c === 2).length;
          expect(Math.max(...byTime.values()), diff).toBeLessThanOrEqual(2);
          if (diff === 'easy') expect(pairs).toBe(0);
          if (diff === 'hard') expect(pairs).toBeGreaterThanOrEqual(8);
        }
      });

      it('長押しが各難易度にあり、帯の中に同じレーンのノーツがなく、重ならない', () => {
        for (const diff of DIFFS) {
          const notes = song.charts[diff];
          const holds = notes.filter((n) => (n[2] ?? 0) > 0);
          expect(holds.length, diff).toBeGreaterThanOrEqual(3);
          for (const [t, lane, hold] of holds) {
            const tail = t + (hold ?? 0);
            expect(hold ?? 0).toBeGreaterThanOrEqual(350);
            expect(tail).toBeLessThanOrEqual(song.durationMs - 500);
            for (const [t2, lane2] of notes) {
              expect(lane2 === lane && t2 > t && t2 <= tail, `${diff} hold@${t}`).toBe(false);
            }
            for (const [t2] of holds) {
              expect(t2 > t && t2 < tail, `${diff} hold@${t}`).toBe(false);
            }
          }
        }
      });

      it('難易度が入れ子になっている（easy ⊆ normal ⊆ hard）', () => {
        const key = (n: RawNote) => `${n[0]}:${n[1]}`;
        const hard = new Set(song.charts.hard.map(key));
        const normal = new Set(song.charts.normal.map(key));
        for (const n of song.charts.normal) expect(hard.has(key(n))).toBe(true);
        for (const n of song.charts.easy) expect(normal.has(key(n))).toBe(true);
      });
    });
  }
});

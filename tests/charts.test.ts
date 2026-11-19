import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 譜面 v2 の検証: ノーツが実測拍列（charts.json の beats）の細分位置に沿っていること。
// v1 の固定間隔グリッドでは、周期の推定誤差が累積してグリッドと実拍のズレが
// 曲の中で回転していた（冒頭と終盤で最大半拍近いズレ）。その回帰防止が目的。
// ゲーム本体（src/logic.ts の SongData）は beats を読まないので、ここでは
// charts.json を直接読む。
interface RawSong {
  durationMs: number;
  bpm: number;
  beats: number[];
  charts: Record<'easy' | 'normal' | 'hard', [number, number][]>;
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

describe('譜面データ v2（実測拍列との整合）', () => {
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

      it('同一レーンの3連続がない', () => {
        for (const diff of DIFFS) {
          const lanes = song.charts[diff].map((n) => n[1]);
          for (let i = 0; i + 2 < lanes.length; i++) {
            expect(lanes[i] === lanes[i + 1] && lanes[i + 1] === lanes[i + 2], `${diff} @${i}`).toBe(false);
          }
        }
      });

      it('難易度が入れ子になっている（easy ⊆ normal ⊆ hard）', () => {
        const key = (n: [number, number]) => `${n[0]}:${n[1]}`;
        const hard = new Set(song.charts.hard.map(key));
        const normal = new Set(song.charts.normal.map(key));
        for (const n of song.charts.normal) expect(hard.has(key(n))).toBe(true);
        for (const n of song.charts.easy) expect(normal.has(key(n))).toBe(true);
      });
    });
  }
});

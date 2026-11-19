// ゲームのルール・計算は DOM に触れない純関数にして、tests/ で単体テストする。
// 元ゲーム（単体HTML版）の仕様を引き継いだもの:
//   判定 PERFECT ±50ms / GREAT ±100ms / GOOD ±160ms、スコア 1000/700/400、FEVER中は2倍
//   精度 = (PERFECT + GREAT×0.7 + GOOD×0.4) / 全ノーツ ×100、ランク S≥95 / A≥85 / B≥70 / C

export type SongId = 'highway' | 'night';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Judge = 'perfect' | 'great' | 'good' | 'miss';

/** 譜面のノーツ。[時刻(ms), レーン(0-3)] */
export type NoteData = readonly [number, number];

export interface ChartSet {
  easy: NoteData[];
  normal: NoteData[];
  hard: NoteData[];
}

export interface SongData {
  title: string;
  durationMs: number;
  bpm: number;
  /** FEVER区間 [開始秒, 終了秒) */
  fever: [number, number][];
  charts: ChartSet;
}

export const DIFFICULTIES: Record<Difficulty, { label: string; fallSeconds: number }> = {
  easy: { label: 'かんたん', fallSeconds: 2.0 },
  normal: { label: 'ふつう', fallSeconds: 1.6 },
  hard: { label: 'むずかしい', fallSeconds: 1.3 },
};

export const LANE_COUNT = 4;
/** レーンの色（左から） */
export const LANE_COLORS = ['#ff6b6b', '#ffd166', '#4ecdc4', '#6c8cff'] as const;

/** 判定幅 (ms) */
export const JUDGE_WINDOWS = { perfect: 50, great: 100, good: 160 } as const;
export const JUDGE_SCORES: Record<Exclude<Judge, 'miss'>, number> = { perfect: 1000, great: 700, good: 400 };
export const FEVER_MULTIPLIER = 2;

/** オフセット調整の範囲 (ms) */
export const OFFSET_MIN = -200;
export const OFFSET_MAX = 200;
export const OFFSET_STEP = 10;

export function clampOffset(ms: number): number {
  const stepped = Math.round(ms / OFFSET_STEP) * OFFSET_STEP;
  return Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, stepped));
}

/** ズレ (ms, 符号なし) から判定を返す。窓の外は null（ノーツを消費しない） */
export function judgeFor(absDeltaMs: number): Exclude<Judge, 'miss'> | null {
  if (absDeltaMs <= JUDGE_WINDOWS.perfect) return 'perfect';
  if (absDeltaMs <= JUDGE_WINDOWS.great) return 'great';
  if (absDeltaMs <= JUDGE_WINDOWS.good) return 'good';
  return null;
}

export function isFever(fever: [number, number][], atSeconds: number): boolean {
  return fever.some(([from, to]) => atSeconds >= from && atSeconds < to);
}

export function scoreFor(judge: Exclude<Judge, 'miss'>, fever: boolean): number {
  return JUDGE_SCORES[judge] * (fever ? FEVER_MULTIPLIER : 1);
}

export interface JudgementCounts {
  perfect: number;
  great: number;
  good: number;
  miss: number;
}

export const emptyCounts = (): JudgementCounts => ({ perfect: 0, great: 0, good: 0, miss: 0 });

export function totalNotes(counts: JudgementCounts): number {
  return counts.perfect + counts.great + counts.good + counts.miss;
}

/** 精度 (%)。ノーツがなければ 0 */
export function accuracy(counts: JudgementCounts): number {
  const total = totalNotes(counts);
  if (total === 0) return 0;
  return ((counts.perfect + counts.great * 0.7 + counts.good * 0.4) / total) * 100;
}

export type Rank = 'S' | 'A' | 'B' | 'C';

export function rankFor(acc: number): Rank {
  if (acc >= 95) return 'S';
  if (acc >= 85) return 'A';
  if (acc >= 70) return 'B';
  return 'C';
}

/** プレイ中のノーツ。state: 0=未判定, 1=ヒット, 2=ミス */
export interface PlayNote {
  timeMs: number;
  lane: number;
  state: 0 | 1 | 2;
}

export function makePlayNotes(chart: NoteData[], offsetMs: number): PlayNote[] {
  return chart.map(([t, lane]) => ({ timeMs: t + offsetMs, lane, state: 0 }));
}

/**
 * タップしたレーンで、いちばん近い未判定ノーツを探す。
 * 判定窓の外なら null。notes は時刻昇順である前提（窓より先のノーツで打ち切る）。
 */
export function findHit(notes: PlayNote[], lane: number, nowMs: number): { note: PlayNote; judge: Exclude<Judge, 'miss'> } | null {
  let best: PlayNote | null = null;
  let bestDelta = Infinity;
  for (const n of notes) {
    if (n.timeMs - nowMs > JUDGE_WINDOWS.good) break;
    if (n.state !== 0 || n.lane !== lane) continue;
    const d = Math.abs(n.timeMs - nowMs);
    if (d < bestDelta) {
      best = n;
      bestDelta = d;
    }
  }
  if (!best) return null;
  const judge = judgeFor(bestDelta);
  return judge ? { note: best, judge } : null;
}

/** 判定窓を過ぎた未判定ノーツをミスにする。ミスにした数を返す */
export function sweepMisses(notes: PlayNote[], nowMs: number): number {
  let missed = 0;
  for (const n of notes) {
    if (n.timeMs - nowMs > JUDGE_WINDOWS.good) break;
    if (n.state === 0 && nowMs - n.timeMs > JUDGE_WINDOWS.good) {
      n.state = 2;
      missed++;
    }
  }
  return missed;
}

/** 譜面データの検証。問題があれば文言の配列を返す（生成スクリプトと同じ規則） */
export function validateCharts(song: SongData): string[] {
  const errors: string[] = [];
  const order: Difficulty[] = ['easy', 'normal', 'hard'];
  let prevCount = -1;
  for (const diff of order) {
    const notes = song.charts[diff];
    if (notes.length === 0) errors.push(`${diff}: ノーツがありません`);
    const seen = new Set<string>();
    let prevTime = -1;
    for (const [t, lane] of notes) {
      if (t < prevTime) errors.push(`${diff}: 時刻が昇順ではありません (${t})`);
      prevTime = t;
      if (lane < 0 || lane >= LANE_COUNT) errors.push(`${diff}: レーンが範囲外です (${lane})`);
      const key = `${t}:${lane}`;
      if (seen.has(key)) errors.push(`${diff}: 同刻・同レーンの重複があります (${key})`);
      seen.add(key);
    }
    if (notes.length > 0) {
      if (notes[0][0] < 2000) errors.push(`${diff}: 最初のノーツがイントロの途中です (${notes[0][0]}ms)`);
      const last = notes[notes.length - 1][0];
      if (last > song.durationMs - 1000) errors.push(`${diff}: 最後のノーツが曲の終わりに近すぎます (${last}ms)`);
    }
    if (notes.length < prevCount) errors.push(`${diff}: ノーツ数が前の難易度より少ないです`);
    prevCount = notes.length;
  }
  for (const [from, to] of song.fever) {
    if (!(from >= 0 && from < to && to <= song.durationMs / 1000)) errors.push(`FEVER区間が不正です [${from}, ${to}]`);
  }
  return errors;
}

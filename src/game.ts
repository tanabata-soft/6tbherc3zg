// ゲーム画面（Canvas 描画と入力）。判定・スコア計算は src/logic.ts の純関数を使う。
// 元ゲームからの改善:
//  (a) 音源は src/audio.ts が曲ごとに保持するので、再プレイで再デコードしない
//  (b) プレイ中にタブ/画面が隠れたら、演奏を止めてメニューに戻す（裏で進んで大量MISSになるのを防ぐ）
import {
  DIFFICULTIES,
  LANE_COLORS,
  emptyCounts,
  findHit,
  isFever,
  makePlayNotes,
  rankFor,
  accuracy,
  scoreFor,
  sweepMisses,
  type Difficulty,
  type Judge,
  type JudgementCounts,
  type PlayNote,
} from './logic';
import type { SongEntry } from './charts';
import { audioContext, loadBuffer, nowSeconds, playBuffer, stopCurrent } from './audio';
import { beep } from './sound';
import { setData } from './debug';

export interface GameResult {
  songTitle: string;
  difficulty: Difficulty;
  score: number;
  counts: JudgementCounts;
  maxCombo: number;
  accuracy: number;
  rank: string;
}

export interface GameCallbacks {
  onFinish(result: GameResult): void;
  /** 中断（左上タップ、または画面が隠れた）でメニューに戻るとき */
  onAbort(): void;
}

const HIT_Y_RATIO = 0.82;
const READY_SECONDS = 2;
const JUDGE_LABEL: Record<Judge, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const JUDGE_COLOR: Record<Judge, string> = { perfect: '#ffd166', great: '#4ecdc4', good: '#9aa8ff', miss: '#ff6b6b' };
const JUDGE_BEEP: Record<Exclude<Judge, 'miss'>, number> = { perfect: 990, great: 880, good: 740 };

interface Particle {
  kind: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  c: string;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private cb: GameCallbacks;
  private raf = 0;
  private playing = false;
  private destroyed = false;

  private entry: SongEntry | null = null;
  private difficulty: Difficulty = 'easy';
  private notes: PlayNote[] = [];
  private counts: JudgementCounts = emptyCounts();
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private startAt = 0; // AudioContext 時刻（秒）
  private durationSec = 0;
  private bg: HTMLImageElement | null = null;
  private flash = [0, 0, 0, 0];
  private particles: Particle[] = [];
  private judgeText = '';
  private judgeColor = '#fff';
  private judgeAlpha = 0;
  private width = 0;
  private height = 0;

  private onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    if (!this.playing) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < 56 && py < 56) {
      this.abort();
      return;
    }
    const lane = Math.min(3, Math.max(0, Math.floor(px / (this.width / 4))));
    this.tap(lane);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.playing) return;
    const lane = 'dfjk'.indexOf(e.key.toLowerCase());
    if (lane >= 0) this.tap(lane);
  };

  private onVisibility = (): void => {
    // プレイ中に画面が隠れたら、その場で演奏を止めてメニューへ（裏で進んで大量MISSにしない）
    if (document.visibilityState === 'hidden' && this.playing) this.abort();
  };

  constructor(canvas: HTMLCanvasElement, cb: GameCallbacks) {
    this.canvas = canvas;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas が使えません');
    this.g = g;
    this.cb = cb;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  destroy(): void {
    this.destroyed = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    stopCurrent();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 曲を読み込んで演奏を始める。読み込み済みなら即座に始まる。 */
  async start(entry: SongEntry, difficulty: Difficulty, offsetMs: number): Promise<void> {
    const buf = await loadBuffer(entry.audioUrl);
    if (this.destroyed) return;
    this.entry = entry;
    this.difficulty = difficulty;
    this.notes = makePlayNotes(entry.data.charts[difficulty], offsetMs);
    this.counts = emptyCounts();
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.particles = [];
    this.flash = [0, 0, 0, 0];
    this.judgeText = '';
    this.judgeAlpha = 0;
    this.durationSec = buf.duration;
    this.bg = new Image();
    this.bg.src = entry.jacketUrl;
    audioContext();
    this.startAt = nowSeconds() + READY_SECONDS;
    playBuffer(buf, this.startAt);
    this.playing = true;
    setData('game', 'playing');
    setData('score', 0);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 演奏を止めてメニューに戻る（結果は残さない） */
  abort(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    stopCurrent();
    setData('game', 'menu');
    this.cb.onAbort();
  }

  /** デバッグ用: いまの成績で結果画面へ進む */
  finishNow(): void {
    if (this.playing) this.finish();
  }

  private tap(lane: number): void {
    this.flash[lane] = 1;
    const nowMs = (nowSeconds() - this.startAt) * 1000;
    const hit = findHit(this.notes, lane, nowMs);
    if (!hit) return;
    hit.note.state = 1;
    const fever = isFever(this.entry?.data.fever ?? [], nowMs / 1000);
    this.counts[hit.judge]++;
    this.score += scoreFor(hit.judge, fever);
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.showJudge(hit.judge);
    this.burst(lane, hit.judge === 'perfect' ? 0 : hit.judge === 'great' ? 1 : 2, fever);
    beep(JUDGE_BEEP[hit.judge], 0.05);
    setData('score', this.score);
  }

  private showJudge(judge: Judge): void {
    this.judgeText = JUDGE_LABEL[judge];
    this.judgeColor = JUDGE_COLOR[judge];
    this.judgeAlpha = 1;
  }

  private burst(lane: number, level: 0 | 1 | 2, fever: boolean): void {
    const lw = this.width / 4;
    const cx = lane * lw + lw / 2;
    const cy = this.height * HIT_Y_RATIO;
    const c = fever ? '#ffd166' : LANE_COLORS[lane];
    this.particles.push({ kind: 0, x: cx, y: cy, vx: 0, vy: 0, r: 10, a: 1, c });
    const n = level === 0 ? 14 : level === 1 ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const an = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * (level === 0 ? 6 : 4);
      this.particles.push({ kind: 1, x: cx, y: cy, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 2, r: 0, a: 1, c });
    }
  }

  private finish(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    stopCurrent();
    const acc = accuracy(this.counts);
    setData('game', 'result');
    this.cb.onFinish({
      songTitle: this.entry?.data.title ?? '',
      difficulty: this.difficulty,
      score: this.score,
      counts: { ...this.counts },
      maxCombo: this.maxCombo,
      accuracy: acc,
      rank: rankFor(acc),
    });
  }

  private fit(): void {
    const d = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w !== this.width || h !== this.height || this.canvas.width !== Math.round(w * d)) {
      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * d);
      this.canvas.height = Math.round(h * d);
      this.g.setTransform(d, 0, 0, d, 0, 0);
    }
  }

  private loop = (): void => {
    if (!this.playing) return;
    this.fit();
    const { g } = this;
    const W = this.width;
    const H = this.height;
    const nowSec = nowSeconds() - this.startAt;
    const nowMs = nowSec * 1000;
    const fever = isFever(this.entry?.data.fever ?? [], nowSec);
    const fall = DIFFICULTIES[this.difficulty].fallSeconds;

    const missed = sweepMisses(this.notes, nowMs);
    if (missed > 0) {
      this.counts.miss += missed;
      this.combo = 0;
      this.showJudge('miss');
    }

    g.fillStyle = '#0e1018';
    g.fillRect(0, 0, W, H);
    if (this.bg?.complete && this.bg.naturalWidth) {
      const s = Math.max(W / this.bg.naturalWidth, H / this.bg.naturalHeight);
      const w = this.bg.naturalWidth * s;
      const hh = this.bg.naturalHeight * s;
      g.drawImage(this.bg, (W - w) / 2, (H - hh) / 2, w, hh);
    }
    g.fillStyle = fever ? 'rgba(30,20,0,.35)' : 'rgba(6,8,16,.62)';
    g.fillRect(0, 0, W, H);
    if (fever) {
      g.strokeStyle = 'rgba(255,209,102,.85)';
      g.lineWidth = 6;
      g.strokeRect(3, 3, W - 6, H - 6);
    }
    const lw = W / 4;
    const hy = H * HIT_Y_RATIO;
    for (let i = 0; i < 4; i++) {
      if (this.flash[i] > 0) {
        g.fillStyle = LANE_COLORS[i] + Math.round(this.flash[i] * 70).toString(16).padStart(2, '0');
        g.fillRect(i * lw, 0, lw, H);
        this.flash[i] = Math.max(0, this.flash[i] - 0.06);
      }
      if (i) {
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(i * lw - 0.5, 0, 1, H);
      }
    }
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(0, hy - 2, W, 4);
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = LANE_COLORS[i];
      g.lineWidth = 3;
      g.strokeRect(i * lw + 8, hy - 14, lw - 16, 28);
    }
    for (const n of this.notes) {
      if (n.state !== 0) continue;
      const y = hy - ((n.timeMs - nowMs) / 1000 / fall) * hy;
      if (y < -30 || y > H + 30) continue;
      g.fillStyle = LANE_COLORS[n.lane];
      g.beginPath();
      g.roundRect(n.lane * lw + 8, y - 14, lw - 16, 28, 8);
      g.fill();
    }
    for (const p of this.particles) {
      if (p.kind === 0) {
        p.r += 4.5;
        p.a -= 0.05;
        g.globalAlpha = Math.max(0, p.a);
        g.strokeStyle = p.c;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, 7);
        g.stroke();
      } else {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25;
        p.a -= 0.035;
        g.globalAlpha = Math.max(0, p.a);
        g.fillStyle = p.c;
        g.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    }
    g.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.a > 0);

    g.textAlign = 'center';
    if (fever) {
      g.fillStyle = '#ffd166';
      g.font = 'bold 24px sans-serif';
      g.fillText('FEVER ×2', W / 2, 72);
    }
    if (nowSec < 0) {
      g.fillStyle = '#fff';
      g.font = 'bold 40px sans-serif';
      g.fillText('READY', W / 2, H * 0.4);
    }
    if (this.combo > 1) {
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.font = 'bold 44px sans-serif';
      g.fillText(String(this.combo), W / 2, H * 0.3);
      g.font = '14px sans-serif';
      g.fillText('COMBO', W / 2, H * 0.3 + 22);
    }
    if (this.judgeAlpha > 0) {
      g.globalAlpha = this.judgeAlpha;
      g.fillStyle = this.judgeColor;
      g.font = 'bold 26px sans-serif';
      g.fillText(this.judgeText, W / 2, H * 0.5);
      g.globalAlpha = 1;
      this.judgeAlpha = Math.max(0, this.judgeAlpha - 0.03);
    }
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.fillText('✕', 20, 34);
    g.textAlign = 'right';
    g.fillText(String(this.score).padStart(7, '0'), W - 14, 34);
    g.fillStyle = 'rgba(255,255,255,.2)';
    g.fillRect(0, 0, W, 3);
    g.fillStyle = '#ffd166';
    g.fillRect(0, 0, W * Math.max(0, Math.min(1, nowSec / this.durationSec)), 3);

    if ((nowMs > this.durationSec * 1000 + 500 && this.notes.every((n) => n.state !== 0)) || nowMs > this.durationSec * 1000 + 2000) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}

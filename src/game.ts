// ゲーム画面（Canvas 描画と入力）。判定・スコア計算は src/logic.ts の純関数を使う。
// 元ゲームからの改善:
//  (a) 音源は src/audio.ts が曲ごとに保持するので、再プレイで再デコードしない
//  (b) プレイ中にタブ/画面が隠れたら、演奏を止めてメニューに戻す（裏で進んで大量MISSになるのを防ぐ）
// 演出（粒子・輪・波紋・判定文字）はすべて経過時間ベースで進める（120Hz でも 60Hz と同じ見え方にする）。
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
import { audioContext, loadBuffer, nowSeconds, playBuffer, resumeAudio, stopCurrent, unlockAudio } from './audio';
import { playHitSound } from './sound';
import { vibrateHit } from './haptics';
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
const GOLD = '#ffd166';

/** 粒子（ヒットで弾ける） */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  c: string;
}
/** 広がる輪（ヒットの衝撃） */
interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  maxR: number;
  c: string;
}
/** ノーツが一瞬膨らんで消える残像 */
interface Pop {
  lane: number;
  age: number;
  life: number;
  c: string;
}
/** タップした場所に出る波紋 */
interface Ripple {
  x: number;
  y: number;
  age: number;
  life: number;
  c: string;
}

const RING_LIFE = 0.32;
const POP_LIFE = 0.18;
const RIPPLE_LIFE = 0.38;
const JUDGE_LIFE = 0.55;

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
  private rings: Ring[] = [];
  private pops: Pop[] = [];
  private ripples: Ripple[] = [];
  private judgeText = '';
  private judgeColor = '#fff';
  private judgeShownAt = -Infinity; // AudioContext 時刻（秒）
  private lastFrameAt = 0; // 前フレームの AudioContext 時刻（秒）。dt の計算用
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
    this.tap(lane, px, py);
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
    // スタート操作のジェスチャの中で呼ばれる前提で、まず音声を unlock する
    unlockAudio();
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
    this.rings = [];
    this.pops = [];
    this.ripples = [];
    this.flash = [0, 0, 0, 0];
    this.judgeText = '';
    this.judgeShownAt = -Infinity;
    this.durationSec = buf.duration;
    this.bg = new Image();
    this.bg.src = entry.jacketUrl;
    // 再生開始の直前にもう一度 resume する（suspended のままだと currentTime が進まず、
    // その場合は復帰した時点でスケジュールどおり鳴り始める）
    await resumeAudio();
    if (this.destroyed) return;
    this.startAt = nowSeconds() + READY_SECONDS;
    this.lastFrameAt = nowSeconds();
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

  private tap(lane: number, rippleX?: number, rippleY?: number): void {
    // 保険: 再生中に AudioContext が止まっていたら（iOS の interrupted など）、タップのついでに戻す
    if (audioContext().state !== 'running') void resumeAudio();
    this.flash[lane] = 1;
    // 押した場所に波紋を出す（キーボードのときはレーンの判定ライン中央）
    const lw = this.width / 4;
    this.ripples.push({
      x: rippleX ?? lane * lw + lw / 2,
      y: rippleY ?? this.height * HIT_Y_RATIO,
      age: 0,
      life: RIPPLE_LIFE,
      c: LANE_COLORS[lane],
    });
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
    playHitSound(hit.judge);
    vibrateHit(hit.judge);
    setData('score', this.score);
  }

  private showJudge(judge: Judge): void {
    this.judgeText = JUDGE_LABEL[judge];
    this.judgeColor = JUDGE_COLOR[judge];
    this.judgeShownAt = nowSeconds();
  }

  /** ヒット演出: ノーツの膨らむ残像＋広がる輪＋粒子。FEVER 中は金色で強める */
  private burst(lane: number, level: 0 | 1 | 2, fever: boolean): void {
    const lw = this.width / 4;
    const cx = lane * lw + lw / 2;
    const cy = this.height * HIT_Y_RATIO;
    const c = fever ? GOLD : LANE_COLORS[lane];
    this.pops.push({ lane, age: 0, life: POP_LIFE, c });
    this.rings.push({ x: cx, y: cy, age: 0, life: RING_LIFE, maxR: fever ? 58 : 46, c });
    const n = (level === 0 ? 22 : level === 1 ? 14 : 8) + (fever ? 6 : 0);
    for (let i = 0; i < n; i++) {
      const an = Math.random() * Math.PI * 2;
      const sp = 140 + Math.random() * (level === 0 ? 380 : 260);
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(an) * sp,
        vy: Math.sin(an) * sp - 70,
        age: 0,
        life: 0.35 + Math.random() * 0.2,
        c,
      });
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
    const frameAt = nowSeconds();
    // 経過時間（秒）。タブ復帰などで大きく飛んだときは 50ms に丸める
    const dt = Math.min(0.05, Math.max(0, frameAt - this.lastFrameAt));
    this.lastFrameAt = frameAt;
    const nowSec = frameAt - this.startAt;
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
        this.flash[i] = Math.max(0, this.flash[i] - dt * 3.6);
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

    // ---- ヒット演出（時間ベースで更新） ----
    for (const p of this.pops) {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) continue;
      const scale = 1 + 0.5 * k;
      const w = (lw - 16) * scale;
      const h = 28 * scale;
      g.globalAlpha = 0.75 * (1 - k);
      g.fillStyle = p.c;
      g.beginPath();
      g.roundRect(p.lane * lw + lw / 2 - w / 2, hy - h / 2, w, h, 8);
      g.fill();
    }
    this.pops = this.pops.filter((p) => p.age < p.life);
    g.globalAlpha = 1;

    for (const r of this.rings) {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) continue;
      const ease = 1 - (1 - k) * (1 - k);
      g.globalAlpha = 0.9 * (1 - k);
      g.strokeStyle = r.c;
      g.lineWidth = 1 + 3.5 * (1 - k);
      g.beginPath();
      g.arc(r.x, r.y, 10 + (r.maxR - 10) * ease, 0, 7);
      g.stroke();
    }
    this.rings = this.rings.filter((r) => r.age < r.life);
    g.globalAlpha = 1;

    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.globalAlpha = 1 - p.age / p.life;
      g.fillStyle = p.c;
      g.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    g.globalAlpha = 1;

    for (const r of this.ripples) {
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) continue;
      g.globalAlpha = 0.7 * (1 - k);
      g.strokeStyle = r.c;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, 6 + 34 * k, 0, 7);
      g.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.age < r.life);
    g.globalAlpha = 1;

    g.textAlign = 'center';
    if (fever) {
      g.fillStyle = GOLD;
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
    // 判定文字: 出た瞬間に大きく、縮みながらフェードする（経過時間ベース）
    const judgeAge = frameAt - this.judgeShownAt;
    if (this.judgeText && judgeAge < JUDGE_LIFE) {
      const popK = Math.min(1, judgeAge / 0.12);
      const scale = 1.35 - 0.35 * popK;
      const alpha = judgeAge < 0.35 ? 1 : 1 - (judgeAge - 0.35) / (JUDGE_LIFE - 0.35);
      g.globalAlpha = Math.max(0, alpha);
      g.fillStyle = this.judgeColor;
      g.font = `bold ${Math.round(28 * scale)}px sans-serif`;
      g.fillText(this.judgeText, W / 2, H * 0.5);
      g.globalAlpha = 1;
    }
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.fillText('✕', 20, 34);
    g.textAlign = 'right';
    g.fillText(String(this.score).padStart(7, '0'), W - 14, 34);
    g.fillStyle = 'rgba(255,255,255,.2)';
    g.fillRect(0, 0, W, 3);
    g.fillStyle = GOLD;
    g.fillRect(0, 0, W * Math.max(0, Math.min(1, nowSec / this.durationSec)), 3);

    if ((nowMs > this.durationSec * 1000 + 500 && this.notes.every((n) => n.state !== 0)) || nowMs > this.durationSec * 1000 + 2000) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}

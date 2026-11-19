// 効果音は Web Audio で合成する（音声ファイルは持たない）。オン/オフ設定は必ず用意する。
// ヒット音は、曲の再生と同じ AudioContext（src/audio.ts）を使い、その場で合成する。
//
// ヒット音の構造（v1.7.0 で作り替え）:
//   アタック … 10〜20ms の短いノイズ（ハイパス）で「パチッ」という打撃感
//   本体     … 三角波が鳴り始めから短時間でピッチダウンし、約90ms で減衰する（木琴・打鍵の感じ）
//   きらめき … PERFECT は 2 倍音を少し足す。GREAT は控えめ、GOOD はなし
// コンボの tier が上がるほど基準ピッチが +1 半音ずつ上がる（上限 +4 半音。logic.ts が正本）。
// ヒット音は専用バス（ゲイン→コンプレッサー）を通し、重なってもクリップしにくくする。
import { audioContext, audioOutput } from './audio';
import { load, save } from './storage';
import { hitPitchMultiplier, type Judge } from './logic';

export type HitJudge = Exclude<Judge, 'miss'>;

/** ヒット音1音分のパラメータ */
export interface HitToneParams {
  /** 本体の鳴り始めの周波数 (Hz)。tier のピッチ補正はここにかかる */
  baseFreq: number;
  /** ピッチダウンの終端（開始周波数に対する比率） */
  endRatio: number;
  /** ピッチが落ちきるまでの時間 (秒) */
  dropSec: number;
  /** 全体の減衰時間 (秒) */
  decaySec: number;
  /** 本体の音量（曲を邪魔しない控えめな値） */
  peak: number;
  /** アタックノイズの音量 */
  noisePeak: number;
  /** アタックノイズの長さ (秒) */
  noiseSec: number;
  /** 倍音（2倍音）の音量比。0 でなし */
  sparkle: number;
}

/** 判定ごとのヒット音。PERFECT は最も明るく高く、GOOD は鈍く短く */
export const HIT_TONE: Record<HitJudge, HitToneParams> = {
  perfect: { baseFreq: 1250, endRatio: 0.56, dropSec: 0.06, decaySec: 0.09, peak: 0.2, noisePeak: 0.17, noiseSec: 0.016, sparkle: 0.35 },
  great: { baseFreq: 1000, endRatio: 0.58, dropSec: 0.055, decaySec: 0.08, peak: 0.15, noisePeak: 0.13, noiseSec: 0.014, sparkle: 0.15 },
  good: { baseFreq: 750, endRatio: 0.6, dropSec: 0.045, decaySec: 0.06, peak: 0.11, noisePeak: 0.09, noiseSec: 0.012, sparkle: 0 },
};

/** 長押しの tick 音。本体より柔らかく短い、同じ仕組みの軽量版 */
export const TICK_TONE: HitToneParams = {
  baseFreq: 1150,
  endRatio: 0.72,
  dropSec: 0.03,
  decaySec: 0.045,
  peak: 0.05,
  noisePeak: 0.02,
  noiseSec: 0.008,
  sparkle: 0,
};

/** 判定と tier から、実際に鳴らすパラメータと開始周波数を決める */
export function hitToneFor(judge: HitJudge, tier: number): { tone: HitToneParams; freq: number } {
  const tone = HIT_TONE[judge];
  return { tone, freq: tone.baseFreq * hitPitchMultiplier(tier) };
}

/** tick 音のパラメータと開始周波数（ピッチはヒット音と同じ規則で tier 連動） */
export function tickToneFor(tier: number): { tone: HitToneParams; freq: number } {
  return { tone: TICK_TONE, freq: TICK_TONE.baseFreq * hitPitchMultiplier(tier) };
}

let enabled = load('sound', true);

export const isSoundOn = (): boolean => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  save('sound', on);
}

// ヒット音専用の出口（ゲイン → コンプレッサー → マスター）。
// 密集したノーツで音が重なってもクリップしにくくする。曲の経路には影響しない。
let bus: AudioNode | undefined;

function hitBus(): AudioNode {
  const ac = audioContext();
  if (!bus) {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    gain.connect(comp).connect(audioOutput());
    bus = gain;
  }
  return bus;
}

// アタック用の短いノイズは使い回す（ヒットのたびに作り直さない）。減衰はゲイン側で付ける
let noiseBuffer: AudioBuffer | undefined;

function getNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const len = Math.max(1, Math.floor(ac.sampleRate * 0.05));
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** 1音を合成して鳴らす（本体＋倍音＋アタックノイズ） */
function playTone(tone: HitToneParams, freq: number): void {
  const ac = audioContext();
  const t = ac.currentTime;
  const out = hitBus();

  // 本体: 三角波が素早くピッチダウンしながら減衰する
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * tone.endRatio, t + tone.dropSec);
  const oscGain = ac.createGain();
  oscGain.gain.setValueAtTime(tone.peak, t);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t + tone.decaySec);
  osc.connect(oscGain).connect(out);
  osc.start(t);
  osc.stop(t + tone.decaySec + 0.02);

  // きらめき: 2倍音を薄く重ねる（PERFECT のみ実質的に聞こえる量）
  if (tone.sparkle > 0) {
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq * 2, t);
    sub.frequency.exponentialRampToValueAtTime(freq * 2 * tone.endRatio, t + tone.dropSec);
    const subGain = ac.createGain();
    const subDecay = tone.decaySec * 0.55;
    subGain.gain.setValueAtTime(tone.peak * tone.sparkle, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + subDecay);
    sub.connect(subGain).connect(out);
    sub.start(t);
    sub.stop(t + subDecay + 0.02);
  }

  // アタック: ハイパスした短いノイズで打撃感を出す
  const noise = ac.createBufferSource();
  noise.buffer = getNoiseBuffer(ac);
  const high = ac.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 3200;
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(tone.noisePeak, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + tone.noiseSec);
  noise.connect(high).connect(noiseGain).connect(out);
  noise.start(t);
  noise.stop(t + tone.noiseSec + 0.02);
}

/** ノーツに当たった瞬間のヒット音。tier が高いほどピッチが上がる */
export function playHitSound(judge: HitJudge, tier = 0): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    // iPhone では操作のあとに resume が必要
    void ac.resume();
    const { tone, freq } = hitToneFor(judge, tier);
    playTone(tone, freq);
    // テストが「どの音が鳴ったか」を確認できるようにイベントを出す
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hit', judge, tier, frequency: freq } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押しの tick 音（拍ごと）。ヒット音より柔らかく短い */
export function playTickSound(tier = 0): void {
  if (!enabled) return;
  try {
    const { tone, freq } = tickToneFor(tier);
    playTone(tone, freq);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'tick', tier, frequency: freq } }));
  } catch {
    // 音が出せなくても続行する
  }
}

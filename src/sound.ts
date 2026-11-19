// 効果音は Web Audio で合成する（音声ファイルは持たない）。オン/オフ設定は必ず用意する。
// ヒット音は、曲の再生と同じ AudioContext（src/audio.ts）を使い、その場で合成する。
//
// ヒット音は v1.8.0 でオーナー決定の「F案（8bit系）」に差し替えた:
//   矩形波の2音「ピロッ」（1音目 1568Hz を約32ms → 2音目 2093Hz を約50ms、
//   全体に速い減衰）。頭に小さなクリックを足して打撃感を出す。
//   判定別: PERFECT は2音とも明るく長め、GREAT は少し短く、
//   GOOD は1音目だけ・少し低く短く鈍く。
// コンボの tier が上がるほど基準ピッチが +1 半音ずつ上がる（上限 +4 半音。logic.ts が正本）。
// ヒット音は専用バス（ゲイン→コンプレッサー）を通し、重なってもクリップしにくくする。
import { audioContext, audioOutput } from './audio';
import { load, save } from './storage';
import { hitPitchMultiplier, type Judge } from './logic';

export type HitJudge = Exclude<Judge, 'miss'>;

/** 8bit系ブリップ1音分のパラメータ */
export interface BlipToneParams {
  /** 1音目の周波数 (Hz)。tier のピッチ補正はここにかかる */
  freq1: number;
  /** 2音目の周波数 (Hz)。0 なら2音目は鳴らさない */
  freq2: number;
  /** 1音目の長さ (秒) */
  dur1: number;
  /** 2音目の長さ (秒) */
  dur2: number;
  /** 減衰の余分 (秒)。全体の長さに足して指数減衰させる */
  decaySec: number;
  /** 音量（曲を邪魔しない控えめな値） */
  peak: number;
  /** 頭のクリックの音量。0 でなし */
  clickPeak: number;
  /** クリックの長さ (秒) */
  clickSec: number;
}

/** 判定ごとのヒット音。PERFECT は最も明るく長く、GOOD は1音だけ低く短く */
export const HIT_BLIP: Record<HitJudge, BlipToneParams> = {
  perfect: { freq1: 1568, freq2: 2093, dur1: 0.032, dur2: 0.05, decaySec: 0.03, peak: 0.22, clickPeak: 0.1, clickSec: 0.006 },
  great: { freq1: 1568, freq2: 2093, dur1: 0.028, dur2: 0.04, decaySec: 0.026, peak: 0.17, clickPeak: 0.08, clickSec: 0.006 },
  good: { freq1: 1397, freq2: 0, dur1: 0.026, dur2: 0, decaySec: 0.018, peak: 0.12, clickPeak: 0.05, clickSec: 0.005 },
};

/** 長押しの tick 音。F案の軽量版（1音だけの短い矩形波、クリックなし） */
export const TICK_BLIP: BlipToneParams = {
  freq1: 1568,
  freq2: 0,
  dur1: 0.03,
  dur2: 0,
  decaySec: 0.016,
  peak: 0.05,
  clickPeak: 0,
  clickSec: 0,
};

/** 判定と tier から、実際に鳴らすパラメータと各音の周波数を決める */
export function hitToneFor(judge: HitJudge, tier: number): { tone: BlipToneParams; freq1: number; freq2: number } {
  const tone = HIT_BLIP[judge];
  const mul = hitPitchMultiplier(tier);
  return { tone, freq1: tone.freq1 * mul, freq2: tone.freq2 * mul };
}

/** tick 音のパラメータと周波数（ピッチはヒット音と同じ規則で tier 連動） */
export function tickToneFor(tier: number): { tone: BlipToneParams; freq: number } {
  return { tone: TICK_BLIP, freq: TICK_BLIP.freq1 * hitPitchMultiplier(tier) };
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

// 頭のクリック用の短いノイズは使い回す（ヒットのたびに作り直さない）。減衰はゲイン側で付ける
let noiseBuffer: AudioBuffer | undefined;

function getNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const len = Math.max(1, Math.floor(ac.sampleRate * 0.05));
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** ブリップを1つ合成して鳴らす（矩形波の1〜2音＋頭のクリック） */
function playBlip(tone: BlipToneParams, freq1: number, freq2: number): void {
  const ac = audioContext();
  const t = ac.currentTime;
  const out = hitBus();
  const total = tone.dur1 + (freq2 > 0 ? tone.dur2 : 0);

  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq1, t);
  if (freq2 > 0) osc.frequency.setValueAtTime(freq2, t + tone.dur1);
  const oscGain = ac.createGain();
  oscGain.gain.setValueAtTime(tone.peak, t);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t + total + tone.decaySec);
  osc.connect(oscGain).connect(out);
  osc.start(t);
  osc.stop(t + total + tone.decaySec + 0.02);

  // 頭のクリック: ハイパスした短いノイズで打撃感を出す
  if (tone.clickPeak > 0) {
    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer(ac);
    const high = ac.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3200;
    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(tone.clickPeak, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + tone.clickSec);
    noise.connect(high).connect(noiseGain).connect(out);
    noise.start(t);
    noise.stop(t + tone.clickSec + 0.02);
  }
}

/** ノーツに当たった瞬間のヒット音。tier が高いほどピッチが上がる */
export function playHitSound(judge: HitJudge, tier = 0): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    // iPhone では操作のあとに resume が必要
    void ac.resume();
    const { tone, freq1, freq2 } = hitToneFor(judge, tier);
    playBlip(tone, freq1, freq2);
    // テストが「どの音が鳴ったか」を確認できるようにイベントを出す
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hit', judge, tier, frequency: freq1 } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押しの tick 音（拍ごと）。ヒット音よりずっと小さく短い */
export function playTickSound(tier = 0): void {
  if (!enabled) return;
  try {
    const { tone, freq } = tickToneFor(tier);
    playBlip(tone, freq, 0);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'tick', tier, frequency: freq } }));
  } catch {
    // 音が出せなくても続行する
  }
}

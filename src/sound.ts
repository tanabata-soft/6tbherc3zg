// 効果音は Web Audio で合成する（音声ファイルは持たない）。オン/オフ設定は必ず用意する。
// ヒット音は、曲の再生と同じ AudioContext（src/audio.ts）を使い、その場で合成する。
//
// 通常タップのヒット音は v1.8.5 でタンバリン音に差し替えた（オーナーが候補 A〜F から
// E案＝短い「シャン」＋きらめく余韻を選択。参照音は ~/workspace/your_files/tamb-e.wav で、
// 合成レシピの数値は TAMB_PARTIALS / TAMB_GRAINS / TAMB_AIR が正本）。
//   金属片の部分音 12本（3.4k〜12.6kHz）が速く減衰し、粒状の帯域ノイズと空気感の
//   帯域ノイズが重なる。アタックは約8ms のランプで柔らかくし、カチッという硬い
//   立ち上がりにしない。判定別: PERFECT はフル、GREAT はやや小さく短く、
//   GOOD は部分音を減らしてさらに小さい。コンボ tier ではピッチを上げず、
//   明るさ（高域の割合）だけを少し上げる。
// ヒット音は専用バス（ゲイン→コンプレッサー）を通し、重なってもクリップしにくくする。
//
// 長押しの連打・完走音は、v1.8.0 でオーナー決定の「F案（8bit系）」のまま据え置き:
//   矩形波の2音「ピロッ」（1音目 1568Hz → 2音目 2093Hz、全体に速い減衰）。
//   コンボの tier が上がるほど基準ピッチが +1 半音ずつ上がる（上限 +4 半音。logic.ts が正本）。
//
// 長押し中は v1.8.3 から「ヒット音の連打」: 頭のヒットと同時に、曲の16分音符の間隔で
// F案ブリップを連続して鳴らす（v1.8.1 の持続オシレータ音はオーナー指示で廃止）。
// ピッチはコンボ tier 連動に加えて、進行に合わせて少しずつ上がる（開始→尾で +2 半音）。
// 周期的な揺れ（ビブラート等）は入れない。拍 tick の音は鳴らさない（tick スコアの計算は logic.ts）。
// 完走時は完走音（F案＋1音）、猶予切れの失敗時は小さく下がる失敗音を鳴らす。
// 空タップ（ノーツのないレーンを押したとき）も、ヒット音と聞き分けられる小さな音を鳴らす。
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
  /** 3音目の周波数 (Hz)。0 なら3音目は鳴らさない（完走音用） */
  freq3: number;
  /** 1音目の長さ (秒) */
  dur1: number;
  /** 2音目の長さ (秒) */
  dur2: number;
  /** 3音目の長さ (秒) */
  dur3: number;
  /** 減衰の余分 (秒)。全体の長さに足して指数減衰させる */
  decaySec: number;
  /** 音量（曲を邪魔しない控えめな値） */
  peak: number;
  /** 頭のクリックの音量。0 でなし */
  clickPeak: number;
  /** クリックの長さ (秒) */
  clickSec: number;
}

/** タンバリンの金属片の部分音1本（周波数・振幅・減衰率 [/s]。exp 減衰で rate が大きいほど速く消える） */
export interface TambPartial {
  freq: number;
  amp: number;
  decay: number;
}

/**
 * 金属片の部分音 12本（E案の合成レシピが正本。振幅 0.25〜0.8、減衰率 6〜14/s ＝ 約70〜160ms で消える）。
 * ランダムにせず固定値にしてある（テストで固定できるように）。
 */
export const TAMB_PARTIALS: TambPartial[] = [
  { freq: 3400, amp: 0.55, decay: 9 },
  { freq: 3950, amp: 0.8, decay: 12 },
  { freq: 4480, amp: 0.45, decay: 7 },
  { freq: 5120, amp: 0.7, decay: 13 },
  { freq: 5760, amp: 0.35, decay: 8 },
  { freq: 6480, amp: 0.62, decay: 11 },
  { freq: 7250, amp: 0.28, decay: 6 },
  { freq: 8100, amp: 0.75, decay: 14 },
  { freq: 9020, amp: 0.4, decay: 9 },
  { freq: 10100, amp: 0.58, decay: 12 },
  { freq: 11300, amp: 0.3, decay: 7 },
  { freq: 12600, amp: 0.5, decay: 10 },
];

/** 粒状の揺れ1粒（帯域ノイズの小バースト。at は開始オフセット [秒]、dur は長さ [秒]、gain は相対音量） */
export interface TambGrain {
  at: number;
  dur: number;
  gain: number;
}

/** 粒状の揺れ: 3〜12kHz の帯域ノイズの小バースト（10〜30ms）を冒頭 100ms 内に散らす（固定値） */
export const TAMB_GRAINS: TambGrain[] = [
  { at: 0.003, dur: 0.018, gain: 0.5 },
  { at: 0.011, dur: 0.012, gain: 0.3 },
  { at: 0.015, dur: 0.016, gain: 0.36 },
  { at: 0.019, dur: 0.025, gain: 0.6 },
  { at: 0.024, dur: 0.014, gain: 0.25 },
  { at: 0.031, dur: 0.02, gain: 0.45 },
  { at: 0.038, dur: 0.011, gain: 0.35 },
  { at: 0.044, dur: 0.028, gain: 0.55 },
  { at: 0.049, dur: 0.016, gain: 0.2 },
  { at: 0.052, dur: 0.02, gain: 0.44 },
  { at: 0.055, dur: 0.013, gain: 0.4 },
  { at: 0.06, dur: 0.022, gain: 0.5 },
  { at: 0.066, dur: 0.017, gain: 0.3 },
  { at: 0.068, dur: 0.013, gain: 0.29 },
  { at: 0.071, dur: 0.026, gain: 0.6 },
  { at: 0.076, dur: 0.012, gain: 0.28 },
  { at: 0.08, dur: 0.019, gain: 0.42 },
  { at: 0.083, dur: 0.018, gain: 0.41 },
  { at: 0.084, dur: 0.015, gain: 0.38 },
  { at: 0.087, dur: 0.024, gain: 0.52 },
  { at: 0.09, dur: 0.01, gain: 0.24 },
  { at: 0.092, dur: 0.021, gain: 0.48 },
  { at: 0.094, dur: 0.014, gain: 0.33 },
  { at: 0.096, dur: 0.027, gain: 0.57 },
];

/** 空気感の帯域ノイズ（5〜14kHz、減衰率 10/s）。gain はピークに対する相対音量 */
export const TAMB_AIR = { loHz: 5000, hiHz: 14000, decay: 10, gain: 0.55 } as const;

/** 粒状の揺れの帯域（Hz） */
export const TAMB_GRAIN_BAND = { loHz: 3000, hiHz: 12000 } as const;

/** アタックのランプ（秒）。硬い立ち上がり（カチッ）にしないため約8ms かけて上げる */
export const TAMB_ATTACK_SEC = 0.008;

/** 高域とみなす境（Hz）。これ以上の部分音と空気感が「明るさ」の対象になる */
const TAMB_BRIGHT_HZ = 7000;

/** tier ごとに明るさが増える割合（ピッチは上げない） */
const TAMB_BRIGHT_PER_TIER = 0.15;

/** 部分音の合計をピークへ寄せるための倍率（非整数倍音は位相が揃わないので、単純な正規化より少し持ち上げる） */
const TAMB_PARTIAL_BOOST = 2.2;

/** 判定ごとのタンバリン音の作り分け。PERFECT はフル、GREAT はやや小さく短く、GOOD は部分音を減らしてさらに小さい */
export const TAMB_JUDGE: Record<HitJudge, { peak: number; partialCount: number; grainCount: number; decayMul: number }> = {
  perfect: { peak: 0.24, partialCount: 12, grainCount: 24, decayMul: 1 },
  great: { peak: 0.19, partialCount: 10, grainCount: 16, decayMul: 1.35 },
  good: { peak: 0.13, partialCount: 7, grainCount: 8, decayMul: 1.7 },
};

/** 実際に鳴らすタンバリン音の仕様（tambourineFor が判定と tier から決める） */
export interface TambourineSpec {
  /** 音量のピーク */
  peak: number;
  /** 使う部分音（明るさの補正込み） */
  partials: TambPartial[];
  /** 使う粒（明るさの補正込みの相対音量） */
  grains: TambGrain[];
  /** 空気感の相対音量と減衰率 */
  air: { gain: number; decay: number };
  /** 明るさの倍率（1 = 補正なし。tier で上がる） */
  brightness: number;
}

/**
 * 判定と tier から、タンバリン音の仕様を決める（純関数）。
 * tier ではピッチを上げず、明るさ（高域の部分音と空気感の割合）だけを少し上げる。
 */
export function tambourineFor(judge: HitJudge, tier: number): TambourineSpec {
  const j = TAMB_JUDGE[judge];
  const brightness = 1 + TAMB_BRIGHT_PER_TIER * Math.min(4, Math.max(0, tier));
  return {
    peak: j.peak,
    partials: TAMB_PARTIALS.slice(0, j.partialCount).map((p) => ({
      freq: p.freq,
      amp: p.freq >= TAMB_BRIGHT_HZ ? p.amp * brightness : p.amp,
      decay: p.decay * j.decayMul,
    })),
    grains: TAMB_GRAINS.slice(0, j.grainCount).map((g) => ({
      at: g.at,
      dur: g.dur,
      gain: g.gain * (1 + (brightness - 1) / 2),
    })),
    air: { gain: TAMB_AIR.gain * brightness, decay: TAMB_AIR.decay * j.decayMul },
    brightness,
  };
}

/**
 * 長押し中の連打の1発の音。F案ヒット音の家族で、通常ヒット音より少し小さく・短い。
 * v1.8.1 の持続音（HOLD_TONE）は、オーナー指示「連続音は今のヒット音を連続で鳴らして」で廃止した。
 */
export const HOLD_BLIP: BlipToneParams = {
  freq1: 1568,
  freq2: 2093,
  freq3: 0,
  dur1: 0.024,
  dur2: 0.034,
  dur3: 0,
  decaySec: 0.018,
  peak: 0.11,
  clickPeak: 0.05,
  clickSec: 0.005,
};

/** 長押し中の連打の進め方 */
export const HOLD_STREAM = {
  /** ホールドの進行（頭→尾）でピッチが上がる量（半音）。v1.8.1 の持続音と同じ気持ちよさを残す */
  riseSemitones: 2,
  /** 同時に鳴らす連打の上限（超えたら古いものから止める） */
  maxVoices: 4,
  /** 先行スケジュールの幅（秒）。AudioContext 時刻で予約するので、フレーム落ちで間隔が潰れない */
  lookaheadSec: 0.12,
  /** スケジューラの確認間隔 (ms) */
  timerMs: 25,
  /** 尾を過ぎても止め忘れた場合に、自分で止まるまでの余分（秒） */
  safetySec: 0.6,
  /** 止めるときの減衰の長さ（秒）。予約済みの音も声ごとの出口を絞ってまとめて消す */
  releaseSec: 0.03,
} as const;

/** 連打の間隔（秒）: 曲の BPM の16分音符（135 → 約111ms、150 → 100ms） */
export function holdStreamIntervalSec(bpm: number): number {
  const b = bpm > 0 ? bpm : 120;
  return 60 / b / 4;
}

/**
 * 空タップ音。ノーツのないレーンを押したときに鳴らし、「タッチすれば何か鳴る」状態にする。
 * ヒット音と聞き分けられるよう、F案の家族で1音だけ・低め（1046Hz）・短い・小さめにする。
 */
export const EMPTY_BLIP: BlipToneParams = {
  freq1: 1046,
  freq2: 0,
  freq3: 0,
  dur1: 0.03,
  dur2: 0,
  dur3: 0,
  decaySec: 0.015,
  peak: 0.08,
  clickPeak: 0.03,
  clickSec: 0.004,
};

/**
 * 長押しの完走音。F案の2音ブリップにもう1音（1オクターブ上）を足した3音。
 * 頭の判定で音色を変え、ピークは通常ヒット音以下に抑える（他のヒット音と重なっても破綻しない）。
 * GOOD は2音目がない代わりに、1音目→オクターブ上の2音にする。
 */
export const COMPLETE_BLIP: Record<HitJudge, BlipToneParams> = {
  perfect: { freq1: 1568, freq2: 2093, freq3: 3136, dur1: 0.03, dur2: 0.04, dur3: 0.08, decaySec: 0.04, peak: 0.2, clickPeak: 0.08, clickSec: 0.006 },
  great: { freq1: 1568, freq2: 2093, freq3: 3136, dur1: 0.028, dur2: 0.036, dur3: 0.06, decaySec: 0.03, peak: 0.16, clickPeak: 0.06, clickSec: 0.006 },
  good: { freq1: 1397, freq2: 0, freq3: 2794, dur1: 0.026, dur2: 0, dur3: 0.05, decaySec: 0.024, peak: 0.12, clickPeak: 0.04, clickSec: 0.005 },
};

/** 長押しの失敗音。短く下がる小さな2音で「切れた」ことを耳でも知らせる */
export const FAIL_BLIP: BlipToneParams = {
  freq1: 784,
  freq2: 523,
  freq3: 0,
  dur1: 0.05,
  dur2: 0.08,
  dur3: 0,
  decaySec: 0.03,
  peak: 0.08,
  clickPeak: 0,
  clickSec: 0,
};



/** 完走音のパラメータと各音の周波数（ピッチはヒット音と同じ規則で tier 連動） */
export function completeToneFor(
  judge: HitJudge,
  tier: number,
): { tone: BlipToneParams; freq1: number; freq2: number; freq3: number } {
  const tone = COMPLETE_BLIP[judge];
  const mul = hitPitchMultiplier(tier);
  return { tone, freq1: tone.freq1 * mul, freq2: tone.freq2 * mul, freq3: tone.freq3 * mul };
}

/**
 * 連打の1発のピッチ。tier 連動（ヒット音と同じ規則）に加えて、
 * ホールドの進行（progress: 0=頭、1=尾）で +riseSemitones 半音まで上がる。
 * 押し直しで再開するときは、経過分の progress から始めるので上がり具合を引き継げる。
 */
export function holdBlipFor(tier: number, progress: number): { tone: BlipToneParams; freq1: number; freq2: number } {
  const p = Math.min(1, Math.max(0, progress));
  const mul = hitPitchMultiplier(tier) * Math.pow(2, (HOLD_STREAM.riseSemitones * p) / 12);
  return { tone: HOLD_BLIP, freq1: HOLD_BLIP.freq1 * mul, freq2: HOLD_BLIP.freq2 * mul };
}

let enabled = load('sound', true);

export const isSoundOn = (): boolean => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  save('sound', on);
  // オフにしたら、鳴っている長押しの連打も止める
  if (!on) stopAllHoldSounds();
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

/** ブリップを1つ合成して鳴らす（矩形波の1〜3音＋頭のクリック） */
function playBlip(tone: BlipToneParams, freq1: number, freq2: number, freq3 = 0): void {
  playBlipAt(tone, freq1, freq2, freq3, audioContext().currentTime, hitBus());
}

/** ブリップを、指定した AudioContext 時刻・出口で鳴らす（長押しの連打の先行スケジュール用） */
function playBlipAt(tone: BlipToneParams, freq1: number, freq2: number, freq3: number, t: number, out: AudioNode): void {
  const ac = audioContext();
  // 鳴らす音の並び（周波数 0 の音は飛ばし、詰めてつなぐ）
  const segs: { f: number; d: number }[] = [{ f: freq1, d: tone.dur1 }];
  if (freq2 > 0) segs.push({ f: freq2, d: tone.dur2 });
  if (freq3 > 0) segs.push({ f: freq3, d: tone.dur3 });
  const total = segs.reduce((s, x) => s + x.d, 0);

  const osc = ac.createOscillator();
  osc.type = 'square';
  let at = t;
  for (const s of segs) {
    osc.frequency.setValueAtTime(s.f, at);
    at += s.d;
  }
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

// タンバリンの空気感・粒に使う長いノイズ（0.5秒）も使い回す
let longNoiseBuffer: AudioBuffer | undefined;

function getLongNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (longNoiseBuffer && longNoiseBuffer.sampleRate === ac.sampleRate) return longNoiseBuffer;
  const len = Math.max(1, Math.floor(ac.sampleRate * 0.5));
  longNoiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = longNoiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return longNoiseBuffer;
}

/** ゲインの包絡: 約8ms の柔らかいランプで上げ、setTargetAtTime で exp 減衰させる（レシピの減衰率 [/s] と一致させる） */
function tambEnvelope(ac: AudioContext, peakValue: number, t: number, decayRate: number): GainNode {
  const gn = ac.createGain();
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakValue), t + TAMB_ATTACK_SEC);
  gn.gain.setTargetAtTime(0, t + TAMB_ATTACK_SEC, 1 / decayRate);
  return gn;
}

/** タンバリン音を合成して鳴らす（部分音＋粒状の帯域ノイズ＋空気感の帯域ノイズ） */
function playTambourine(spec: TambourineSpec): void {
  const ac = audioContext();
  const t = ac.currentTime;
  const out = hitBus();

  // 金属片の部分音: サイン波を本数ぶん重ねる。各音のピークは振幅比で分け、全体で spec.peak に寄せる
  const totalAmp = spec.partials.reduce((s, p) => s + p.amp, 0) || 1;
  for (const p of spec.partials) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = p.freq;
    const gn = tambEnvelope(ac, (spec.peak * p.amp * TAMB_PARTIAL_BOOST) / totalAmp, t, p.decay);
    osc.connect(gn).connect(out);
    osc.start(t);
    osc.stop(t + TAMB_ATTACK_SEC + 6 / p.decay + 0.05);
  }

  // 空気感: 5〜14kHz の帯域ノイズ
  {
    const src = ac.createBufferSource();
    src.buffer = getLongNoiseBuffer(ac);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = TAMB_AIR.loHz;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = TAMB_AIR.hiHz;
    const gn = tambEnvelope(ac, spec.peak * spec.air.gain, t, spec.air.decay);
    src.connect(hp).connect(lp).connect(gn).connect(out);
    src.start(t, 0.13);
    src.stop(t + TAMB_ATTACK_SEC + 6 / spec.air.decay + 0.05);
  }

  // 粒状の揺れ: 3〜12kHz の帯域ノイズの小バーストを、時刻オフセット付きで散らす
  if (spec.grains.length > 0) {
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = TAMB_GRAIN_BAND.loHz;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = TAMB_GRAIN_BAND.hiHz;
    hp.connect(lp).connect(out);
    for (const gr of spec.grains) {
      const src = ac.createBufferSource();
      src.buffer = getLongNoiseBuffer(ac);
      const gn = ac.createGain();
      const gt = t + gr.at;
      gn.gain.setValueAtTime(0.0001, gt);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, spec.peak * gr.gain), gt + 0.003);
      gn.gain.exponentialRampToValueAtTime(0.0001, gt + gr.dur);
      src.connect(gn).connect(hp);
      // バッファ内の読み出し位置は粒ごとに決定的にずらす（同じ粒の並びでも毎回同じ顔つきにしない範囲で）
      src.start(gt, (gr.at * 7) % 0.3);
      src.stop(gt + gr.dur + 0.02);
    }
  }
}

/** ノーツに当たった瞬間のヒット音（タンバリン）。tier が高いほど高域が少し明るくなる（ピッチは上げない） */
export function playHitSound(judge: HitJudge, tier = 0): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    // iPhone では操作のあとに resume が必要
    void ac.resume();
    playTambourine(tambourineFor(judge, tier));
    // テストが「どの音が鳴ったか」を確認できるようにイベントを出す
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hit', judge, tier } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押しを押し切った瞬間の完走音。F案の2音にもう1音足した3音で達成感を出す */
export function playCompleteSound(judge: HitJudge, tier = 0): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    void ac.resume();
    const { tone, freq1, freq2, freq3 } = completeToneFor(judge, tier);
    playBlip(tone, freq1, freq2, freq3);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'complete', judge, tier, frequency: freq1 } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押しが途中で切れた（猶予切れ）瞬間の失敗音。短く下がる小さな音 */
export function playFailSound(): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    void ac.resume();
    playBlip(FAIL_BLIP, FAIL_BLIP.freq1, FAIL_BLIP.freq2);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'fail', frequency: FAIL_BLIP.freq1 } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 空タップ音。ノーツのないレーンを押したときに鳴らす（ヒット音とは別の小さな音） */
export function playEmptySound(): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    void ac.resume();
    playBlip(EMPTY_BLIP, EMPTY_BLIP.freq1, EMPTY_BLIP.freq2);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'empty', frequency: EMPTY_BLIP.freq1 } }));
  } catch {
    // 音が出せなくても続行する
  }
}

// ---- 長押し中の連打。同時保持があり得るので、ホールドごとに独立した声を持ち、上限を設ける ----
// 連打は AudioContext 時刻で先行スケジュールする（lookahead 方式）。フレーム落ちや
// タイマーの揺れで間隔が潰れず、16分音符の間隔を保てる。各声は専用の出口（ゲイン）を持ち、
// 止めるときはその出口を絞ることで、予約済みの音もまとめて消える。

interface HoldStreamVoice {
  /** この声専用の出口（ゲイン）。予約済みの音もここを通る */
  out: GainNode;
  /** スケジューラのタイマー（声を作った直後にセットする） */
  timer: ReturnType<typeof setInterval> | undefined;
  /** 連打を始めた AudioContext 時刻 */
  startAt: number;
  /** 次に予約する1発の AudioContext 時刻 */
  nextAt: number;
  /** 尾の AudioContext 時刻（これ以降の1発は予約しない） */
  endAt: number;
  /** 開始時点のホールド進行（0=頭、1=尾）。押し直し再開時に経過分を引き継ぐ */
  progress0: number;
  /** 開始から尾までの残り時間（秒）。進行の計算に使う */
  durationSec: number;
  /** 開始時点のコンボ tier（ピッチに使う） */
  tier: number;
  /** 連打の間隔（秒） */
  intervalSec: number;
}

/** 鳴っている連打。キーはホールドを識別するオブジェクト（game.ts はノーツ自身を渡す） */
const holdVoices = new Map<object, HoldStreamVoice>();

/**
 * 長押し中の連打を鳴らし始める。頭のヒットと同時に呼ぶ。
 * durationMs は尾までの残り時間、progress は開始時点の進行（0=頭、1=尾）、
 * bpm は曲の BPM（連打の間隔＝16分音符を決める）。
 */
export function startHoldSound(key: object, tier: number, durationMs: number, progress = 0, bpm = 120): void {
  if (!enabled) return;
  try {
    stopHoldSound(key);
    // 上限を超えたら古いものから止める
    while (holdVoices.size >= HOLD_STREAM.maxVoices) {
      const oldest = holdVoices.keys().next().value;
      if (oldest === undefined) break;
      stopHoldSound(oldest);
    }
    const ac = audioContext();
    void ac.resume();
    const out = ac.createGain();
    out.gain.value = 1;
    out.connect(hitBus());
    const now = ac.currentTime;
    const durationSec = Math.max(0.05, durationMs / 1000);
    const voice: HoldStreamVoice = {
      out,
      timer: undefined,
      startAt: now,
      nextAt: now,
      endAt: now + durationSec,
      progress0: Math.min(1, Math.max(0, progress)),
      durationSec,
      tier,
      intervalSec: holdStreamIntervalSec(bpm),
    };
    const schedule = (): void => {
      try {
        const ahead = ac.currentTime + HOLD_STREAM.lookaheadSec;
        while (voice.nextAt < voice.endAt && voice.nextAt < ahead) {
          const elapsed = voice.nextAt - voice.startAt;
          const prog = voice.progress0 + (1 - voice.progress0) * Math.min(1, elapsed / voice.durationSec);
          const { tone, freq1, freq2 } = holdBlipFor(voice.tier, prog);
          playBlipAt(tone, freq1, freq2, 0, voice.nextAt, voice.out);
          document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hold-hit', tier: voice.tier, frequency: freq1 } }));
          voice.nextAt += voice.intervalSec;
        }
        // 安全弁: 通常は尾の時刻に stopHoldSound で止めるが、止め忘れても鳴りっぱなしにしない
        if (ac.currentTime > voice.endAt + HOLD_STREAM.safetySec) stopHoldSound(key);
      } catch {
        // 音が出せなくても続行する
      }
    };
    voice.timer = setInterval(schedule, HOLD_STREAM.timerMs);
    holdVoices.set(key, voice);
    schedule(); // 最初の1発は即座に予約する
    const first = holdBlipFor(tier, voice.progress0);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hold-start', tier, frequency: first.freq1 } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押し中の連打を止める（離した・完走した・失敗した・演奏を止めたとき） */
export function stopHoldSound(key: object): void {
  const v = holdVoices.get(key);
  if (!v) return;
  holdVoices.delete(key);
  clearInterval(v.timer);
  try {
    const ac = audioContext();
    const t = ac.currentTime;
    // 声の出口を絞れば、先行スケジュール済みの音もまとめて消える
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setValueAtTime(Math.max(0.0001, v.out.gain.value), t);
    v.out.gain.exponentialRampToValueAtTime(0.0001, t + HOLD_STREAM.releaseSec);
    window.setTimeout(() => {
      try {
        v.out.disconnect();
      } catch {
        // 切断済みなら何もしない
      }
    }, 100);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hold-stop' } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 鳴っている連打をすべて止める（演奏終了・中止・効果音オフのとき） */
export function stopAllHoldSounds(): void {
  for (const key of [...holdVoices.keys()]) stopHoldSound(key);
}

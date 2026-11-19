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
//
// 長押し中は v1.8.1 から「連続音」: 頭のヒットと同時に持続音が鳴り始め、尾まで途切れない。
// 進行に合わせてピッチが少しずつ上がる（開始→尾で +2 半音）。周期的な揺れ（ビブラート等）は入れない。
// 拍 tick の音は廃止して連続音に一本化した（tick スコアの計算自体は logic.ts に残る）。
// 完走時は完走音（F案＋1音）、猶予切れの失敗時は小さく下がる失敗音を鳴らす。
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

/** 判定ごとのヒット音。PERFECT は最も明るく長く、GOOD は1音だけ低く短く */
export const HIT_BLIP: Record<HitJudge, BlipToneParams> = {
  perfect: { freq1: 1568, freq2: 2093, freq3: 0, dur1: 0.032, dur2: 0.05, dur3: 0, decaySec: 0.03, peak: 0.22, clickPeak: 0.1, clickSec: 0.006 },
  great: { freq1: 1568, freq2: 2093, freq3: 0, dur1: 0.028, dur2: 0.04, dur3: 0, decaySec: 0.026, peak: 0.17, clickPeak: 0.08, clickSec: 0.006 },
  good: { freq1: 1397, freq2: 0, freq3: 0, dur1: 0.026, dur2: 0, dur3: 0, decaySec: 0.018, peak: 0.12, clickPeak: 0.05, clickSec: 0.005 },
};

/** 長押しの連続音のパラメータ */
export interface HoldToneParams {
  /** 開始時の基本周波数 (Hz)。tier のピッチ補正はここにかかる */
  baseFreq: number;
  /** 音量。「鳴っている」と分かるが曲の邪魔にならない水準 */
  peak: number;
  /** 開始→尾でピッチが上がる量（半音） */
  riseSemitones: number;
  /** 矩形波を丸めるローパスのカットオフ (Hz) */
  lowpassHz: number;
  /** 立ち上がりの長さ (秒) */
  attackSec: number;
  /** 止めるときの減衰の長さ (秒) */
  releaseSec: number;
  /** 矩形波の混ぜ具合 (0..1) */
  squareMix: number;
  /** サイン波の混ぜ具合 (0..1) */
  sineMix: number;
  /** 同時に鳴らす連続音の上限（超えたら古いものから止める） */
  maxVoices: number;
}

/**
 * 長押しの連続音: 矩形波をローパスで丸め、サイン波を重ねた持続音。
 * v1.8.0 までは拍ごとの tick 音（peak 0.05）だったが、曲に埋もれて実機で
 * ほぼ聞こえなかったため、v1.8.1 で頭から尾まで途切れない連続音に変えた。
 */
export const HOLD_TONE: HoldToneParams = {
  baseFreq: 784,
  peak: 0.085,
  riseSemitones: 2,
  lowpassHz: 2200,
  attackSec: 0.012,
  releaseSec: 0.04,
  squareMix: 0.6,
  sineMix: 0.4,
  maxVoices: 4,
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

/** 判定と tier から、実際に鳴らすパラメータと各音の周波数を決める */
export function hitToneFor(judge: HitJudge, tier: number): { tone: BlipToneParams; freq1: number; freq2: number } {
  const tone = HIT_BLIP[judge];
  const mul = hitPitchMultiplier(tier);
  return { tone, freq1: tone.freq1 * mul, freq2: tone.freq2 * mul };
}

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
 * 連続音の開始・終了周波数。ピッチは tier 連動（ヒット音と同じ規則）に加えて、
 * ホールドの進行（progress: 0=頭、1=尾）で +riseSemitones 半音まで滑らかに上がる。
 * 押し直しで再開するときは、経過分の progress を渡すと上がり具合を引き継げる。
 */
export function holdToneFor(tier: number, progress: number): { tone: HoldToneParams; freqStart: number; freqEnd: number } {
  const tone = HOLD_TONE;
  const base = tone.baseFreq * hitPitchMultiplier(tier);
  const p = Math.min(1, Math.max(0, progress));
  return {
    tone,
    freqStart: base * Math.pow(2, (tone.riseSemitones * p) / 12),
    freqEnd: base * Math.pow(2, tone.riseSemitones / 12),
  };
}

let enabled = load('sound', true);

export const isSoundOn = (): boolean => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  save('sound', on);
  // オフにしたら、鳴っている長押しの連続音も止める
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
  const ac = audioContext();
  const t = ac.currentTime;
  const out = hitBus();
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

// ---- 長押しの連続音。同時保持があり得るので、ホールドごとに独立した音源を持ち、上限を設ける ----

interface HoldVoice {
  oscs: OscillatorNode[];
  gain: GainNode;
}

/** 鳴っている連続音。キーはホールドを識別するオブジェクト（game.ts はノーツ自身を渡す） */
const holdVoices = new Map<object, HoldVoice>();

/**
 * 長押しの連続音を鳴らし始める。頭のヒットと同時に呼ぶ。
 * durationMs は尾までの残り時間で、ピッチはその間に +riseSemitones 半音まで上がる。
 * progress は押し直し再開時に経過分を引き継ぐためのもの（0=頭、1=尾）。
 */
export function startHoldSound(key: object, tier: number, durationMs: number, progress = 0): void {
  if (!enabled) return;
  try {
    stopHoldSound(key);
    // 上限を超えたら古いものから止める
    while (holdVoices.size >= HOLD_TONE.maxVoices) {
      const oldest = holdVoices.keys().next().value;
      if (oldest === undefined) break;
      stopHoldSound(oldest);
    }
    const ac = audioContext();
    void ac.resume();
    const { tone, freqStart, freqEnd } = holdToneFor(tier, progress);
    const t = ac.currentTime;
    const durSec = Math.max(0.05, durationMs / 1000);

    // 矩形波をローパスで丸め、サイン波を重ねる（F案と相性のよい、角の取れた持続音）
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = tone.lowpassHz;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(tone.peak, t + tone.attackSec);
    filter.connect(gain).connect(hitBus());

    const mkOsc = (type: OscillatorType, mix: number): OscillatorNode => {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freqStart, t);
      // ピッチは直線的に（指数ランプで）少しずつ上げる。周期的な揺れは入れない
      osc.frequency.exponentialRampToValueAtTime(freqEnd, t + durSec);
      const og = ac.createGain();
      og.gain.value = mix;
      osc.connect(og).connect(filter);
      osc.start(t);
      // 安全弁: 通常は尾の時刻に stopHoldSound で止めるが、止め忘れても鳴りっぱなしにしない
      osc.stop(t + durSec + 0.6);
      return osc;
    };
    const oscs = [mkOsc('square', tone.squareMix), mkOsc('sine', tone.sineMix)];
    holdVoices.set(key, { oscs, gain });
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hold-start', tier, frequency: freqStart } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 長押しの連続音を止める（離した・完走した・失敗した・演奏を止めたとき） */
export function stopHoldSound(key: object): void {
  const v = holdVoices.get(key);
  if (!v) return;
  holdVoices.delete(key);
  try {
    const ac = audioContext();
    const t = ac.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + HOLD_TONE.releaseSec);
    for (const o of v.oscs) {
      try {
        o.stop(t + HOLD_TONE.releaseSec + 0.05);
      } catch {
        // 停止予約済みなら何もしない
      }
    }
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hold-stop' } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/** 鳴っている連続音をすべて止める（演奏終了・中止・効果音オフのとき） */
export function stopAllHoldSounds(): void {
  for (const key of [...holdVoices.keys()]) stopHoldSound(key);
}

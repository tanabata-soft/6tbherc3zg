// 効果音は Web Audio で合成するのが基本（音声ファイルは持たない）。オン/オフ設定は必ず用意する。
// 例外はフルコンボ演出のボイスだけ（v1.9.4。音声ファイル1本を src/assets に同梱する。下記）。
// ヒット音は、曲の再生と同じ AudioContext（src/audio.ts）を使い、その場で合成する。
//
// ヒット音は v1.8.0 でオーナー決定の「F案（8bit系）」に差し替えた。
// v1.8.5 でタンバリン音（E案）に差し替えたが、オーナー指示で v1.9.1 に F案へ戻した
// （タンバリンの合成コードは残していない。長押しの連打・完走音はもともと F案の家族）:
//   矩形波の2音「ピロッ」（1音目 1568Hz を約32ms → 2音目 2093Hz を約50ms、
//   全体に速い減衰）。頭に小さなクリックを足して打撃感を出す。
//   判定別: PERFECT は2音とも明るく長め、GREAT は少し短く、
//   GOOD は1音目だけ・少し低く短く鈍く。
// コンボの tier が上がるほど基準ピッチが +1 半音ずつ上がる（上限 +4 半音。logic.ts が正本）。
// ヒット音は専用バス（ゲイン→コンプレッサー）を通し、重なってもクリップしにくくする。
//
// 長押し中は v1.8.3 から「ヒット音の連打」: 頭のヒットと同時に、曲の16分音符の間隔で
// F案ブリップを連続して鳴らす（v1.8.1 の持続オシレータ音はオーナー指示で廃止）。
// ピッチはコンボ tier 連動に加えて、進行に合わせて少しずつ上がる（開始→尾で +2 半音）。
// 周期的な揺れ（ビブラート等）は入れない。拍 tick の音は鳴らさない（tick スコアの計算は logic.ts）。
// 完走時は完走音（F案＋1音）、猶予切れの失敗時は小さく下がる失敗音を鳴らす。
// 空タップ（ノーツのないレーンを押したとき）も、ヒット音と聞き分けられる小さな音を鳴らす。
import { audioContext, audioOutput, loadBuffer } from './audio';
import { load, save } from './storage';
import { hitPitchMultiplier, type Judge } from './logic';
import fullComboVoiceUrl from './assets/fullcombo-voice.mp3';

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

/** 遅延チェックの拍クリック。拍の瞬間がはっきり分かる、短く明るい1音 */
export const LATENCY_CLICK = { freq: 2000, durSec: 0.03, decaySec: 0.02, peak: 0.18 } as const;

/**
 * 遅延チェックの拍クリックを、指定した AudioContext 時刻に鳴らす。
 * 効果音のオン/オフ設定には従わない: 遅延チェックは「音に合わせてタップする」のが
 * 計測の前提で、鳴るのは利用者が計測のスタートを押したときだけだからである
 * （光だけでは、ゲームで実際に効く音の遅れを測れない）。
 * 拍の予定時刻は app:sound（kind: 'latency'、detail.at が AudioContext 時刻）でも出す。
 */
export function playLatencyClickAt(whenSec: number): void {
  try {
    const ac = audioContext();
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = LATENCY_CLICK.freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(LATENCY_CLICK.peak, whenSec);
    gain.gain.exponentialRampToValueAtTime(0.0001, whenSec + LATENCY_CLICK.durSec + LATENCY_CLICK.decaySec);
    osc.connect(gain).connect(hitBus());
    osc.start(whenSec);
    osc.stop(whenSec + LATENCY_CLICK.durSec + LATENCY_CLICK.decaySec + 0.02);
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'latency', at: whenSec } }));
  } catch {
    // 音が出せなくても続行する
  }
}

/**
 * フルコンボ演出のボイス（「FULL COMBO!」の叫び、約1.6秒）。
 * オーナーが候補から選んだ A案（Gemini TTS の男性声 Charon で生成した自作音声）を
 * `src/assets/fullcombo-voice.mp3` に同梱し、曲の音源と同じ経路
 * （ビルドで assets に出力され、Service Worker の precache に入る）で配信する。
 * 合成音ではなく音声ファイルなのは、人の声は合成では作れないため（このファイルだけの例外）。
 *
 * 効果音のオン/オフ設定には従わない: このボイスは効果音ではなく、演奏の締めの
 * 演出そのもの（曲と同じ立場）で、鳴るのはフルコンボを達成した演奏の最後だけだからである
 * （遅延チェックの拍クリックが設定に従わないのと同じ考え方）。
 * 曲の再生管理（audio.ts の current）は触らず、マスターへ直接つないで鳴らす
 * （演奏終了の時点では曲は止まっている）。
 */
export function preloadFullComboVoice(): void {
  // 演奏開始のときに先読みしておく（締めで読み込み待ちにならないように）。
  // 失敗しても演出は続行する（playFullComboVoice 側でも読み直す）
  void loadBuffer(fullComboVoiceUrl).catch(() => undefined);
}

export async function playFullComboVoice(): Promise<void> {
  try {
    const buf = await loadBuffer(fullComboVoiceUrl);
    const ac = audioContext();
    void ac.resume();
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(audioOutput());
    src.start();
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'fullcombo' } }));
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

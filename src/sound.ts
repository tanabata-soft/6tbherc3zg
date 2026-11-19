// 効果音は Web Audio で合成する（音声ファイルは持たない）。オン/オフ設定は必ず用意する。
// ヒット音は、曲の再生と同じ AudioContext（src/audio.ts）を使い、短い打撃音をその場で合成する。
import { audioContext, audioOutput } from './audio';
import { load, save } from './storage';
import type { Judge } from './logic';

export type HitJudge = Exclude<Judge, 'miss'>;

/** 判定ごとのヒット音。PERFECT は高く澄んで、GOOD は低めに。peak は曲を邪魔しない控えめな音量 */
export const HIT_TONE: Record<HitJudge, { freq: number; peak: number }> = {
  perfect: { freq: 1568, peak: 0.2 },
  great: { freq: 1175, peak: 0.15 },
  good: { freq: 784, peak: 0.11 },
};

let enabled = load('sound', true);

export const isSoundOn = (): boolean => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  save('sound', on);
}

/** バックアップの読み込み後に、保存されている値へ合わせ直す */
export function reloadSound(): void {
  enabled = load('sound', true);
}

// アタック用の短いノイズは使い回す（ヒットのたびに作り直さない）
let noiseBuffer: AudioBuffer | undefined;

function getNoiseBuffer(ac: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const len = Math.max(1, Math.floor(ac.sampleRate * 0.03));
  noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  return noiseBuffer;
}

/**
 * ノーツに当たった瞬間の打撃音。芯になるサイン波（周波数が素早く落ちる）＋
 * アタックの「カチッ」という短いノイズで、ただのビープ音にならないようにする。
 */
export function playHitSound(judge: HitJudge): void {
  if (!enabled) return;
  try {
    const ac = audioContext();
    // iPhone では操作のあとに resume が必要
    void ac.resume();
    const t = ac.currentTime;
    const { freq, peak } = HIT_TONE[judge];

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.07);
    const oscGain = ac.createGain();
    oscGain.gain.setValueAtTime(peak, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(oscGain).connect(audioOutput());
    osc.start(t);
    osc.stop(t + 0.1);

    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer(ac);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq * 1.5;
    band.Q.value = 0.9;
    const noiseGain = ac.createGain();
    noiseGain.gain.value = peak * 0.7;
    noise.connect(band).connect(noiseGain).connect(audioOutput());
    noise.start(t);

    // テストが「どの音が鳴ったか」を確認できるようにイベントを出す
    document.dispatchEvent(new CustomEvent('app:sound', { detail: { kind: 'hit', judge, frequency: freq } }));
  } catch {
    // 音が出せなくても続行する
  }
}

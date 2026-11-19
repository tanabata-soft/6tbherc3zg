import { beforeEach, describe, expect, it, vi } from 'vitest';

// Web Audio を偽物に差し替えてから、モジュールを読み直す（AudioContext はモジュール内で保持されるため）
class FakeNode {
  connect = vi.fn((node: unknown) => node);
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeNode[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createBuffer(_channels: number, len: number, sampleRate: number) {
    return { duration: len / sampleRate };
  }
  createBufferSource() {
    const src = new FakeSource();
    this.sources.push(src);
    return src;
  }
  createGain() {
    const gain = new FakeNode() as FakeNode & { gain: { value: number } };
    gain.gain = { value: 0 };
    this.gains.push(gain);
    return gain;
  }
  decodeAudioData = vi.fn(async () => ({ duration: 180 }));
}

let audioSession: { type: string } | undefined;

beforeEach(() => {
  vi.resetModules();
  FakeAudioContext.instances = [];
  audioSession = { type: 'auto' };
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', { audioSession });
});

const latestCtx = (): FakeAudioContext => FakeAudioContext.instances[FakeAudioContext.instances.length - 1];

describe('Audio Session（iPhone のマナーモード対策）', () => {
  it('AudioContext の生成時に audioSession.type が playback になる', async () => {
    const audio = await import('../src/audio');
    audio.audioContext();
    expect(audioSession?.type).toBe('playback');
    // 2回呼んでも Context は1つだけ
    audio.audioContext();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('resume のたびにも playback に設定し直す', async () => {
    const audio = await import('../src/audio');
    audio.audioContext();
    audioSession!.type = 'auto';
    await audio.resumeAudio();
    expect(audioSession?.type).toBe('playback');
    expect(latestCtx().resume).toHaveBeenCalled();
  });

  it('audioSession がない環境でも例外にならない', async () => {
    vi.stubGlobal('navigator', {});
    const audio = await import('../src/audio');
    expect(() => audio.applyAudioSession()).not.toThrow();
    expect(() => audio.audioContext()).not.toThrow();
    await expect(audio.resumeAudio()).resolves.toBeUndefined();
  });
});

describe('unlock（ジェスチャ内での音声の目覚まし）', () => {
  it('resume して、無音バッファを1回だけ再生する', async () => {
    const audio = await import('../src/audio');
    expect(audio.isUnlocked()).toBe(false);
    audio.unlockAudio();
    expect(audio.isUnlocked()).toBe(true);
    const ctx = latestCtx();
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].start).toHaveBeenCalledTimes(1);
    // 無音バッファはマスター Gain 経由でつながる
    expect(ctx.sources[0].connect).toHaveBeenCalledWith(ctx.gains[0]);

    // 2回目は resume だけで、無音バッファは再生し直さない
    audio.unlockAudio();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.resume.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('マスター GainNode（曲と効果音の共通出口）', () => {
  it('audioOutput は1つの GainNode を destination につないで返す', async () => {
    const audio = await import('../src/audio');
    const out1 = audio.audioOutput();
    const out2 = audio.audioOutput();
    expect(out1).toBe(out2);
    const ctx = latestCtx();
    expect(ctx.gains).toHaveLength(1);
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
  });

  it('曲の再生はマスター Gain 経由でつながる', async () => {
    const audio = await import('../src/audio');
    const buf = { duration: 180 } as AudioBuffer;
    const src = audio.playBuffer(buf, 1.5);
    const ctx = latestCtx();
    expect(src.connect).toHaveBeenCalledWith(ctx.gains[0]);
    expect(src.start).toHaveBeenCalledWith(1.5);
    expect(audio.audioState()).toBe(ctx.state);
  });
});

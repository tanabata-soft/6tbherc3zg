import { beforeEach, describe, expect, it, vi } from 'vitest';

// localStorage を差し替えてから、モジュールを読み直す（sound は読み込み時に保存値を読むため）
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', fakeStorage());
});

describe('ヒット音のパラメータ（判定 × tier）', () => {
  it('判定で明るさが変わる: PERFECT は倍音あり・GOOD は倍音なしで短い', async () => {
    const { HIT_TONE } = await import('../src/sound');
    expect(HIT_TONE.perfect.sparkle).toBeGreaterThan(0);
    expect(HIT_TONE.great.sparkle).toBeGreaterThan(0);
    expect(HIT_TONE.great.sparkle).toBeLessThan(HIT_TONE.perfect.sparkle);
    expect(HIT_TONE.good.sparkle).toBe(0);
    expect(HIT_TONE.good.decaySec).toBeLessThan(HIT_TONE.great.decaySec);
    expect(HIT_TONE.great.decaySec).toBeLessThan(HIT_TONE.perfect.decaySec);
    // 本体は約90ms以内の減衰、アタックノイズは10〜20ms
    expect(HIT_TONE.perfect.decaySec).toBeLessThanOrEqual(0.09);
    for (const tone of Object.values(HIT_TONE)) {
      expect(tone.noiseSec).toBeGreaterThanOrEqual(0.01);
      expect(tone.noiseSec).toBeLessThanOrEqual(0.02);
      expect(tone.endRatio).toBeLessThan(1); // ピッチダウンする
    }
  });

  it('tier が上がると開始周波数が +1 半音ずつ上がり、上限で止まる', async () => {
    const { hitToneFor, HIT_TONE } = await import('../src/sound');
    const base = HIT_TONE.perfect.baseFreq;
    expect(hitToneFor('perfect', 0).freq).toBe(base);
    expect(hitToneFor('perfect', 1).freq).toBeCloseTo(base * Math.pow(2, 1 / 12), 6);
    expect(hitToneFor('perfect', 4).freq).toBeCloseTo(base * Math.pow(2, 4 / 12), 6);
    expect(hitToneFor('perfect', 9).freq).toBe(hitToneFor('perfect', 4).freq);
    // 判定の順序はどの tier でも保たれる
    for (const tier of [0, 2, 4]) {
      expect(hitToneFor('perfect', tier).freq).toBeGreaterThan(hitToneFor('great', tier).freq);
      expect(hitToneFor('great', tier).freq).toBeGreaterThan(hitToneFor('good', tier).freq);
    }
  });

  it('tick 音はヒット音より柔らかく（小さく）短い', async () => {
    const { TICK_TONE, HIT_TONE, tickToneFor } = await import('../src/sound');
    expect(TICK_TONE.peak).toBeLessThan(HIT_TONE.good.peak);
    expect(TICK_TONE.decaySec).toBeLessThan(HIT_TONE.good.decaySec);
    expect(TICK_TONE.sparkle).toBe(0);
    // tick も tier でピッチが上がる（同じ規則）
    expect(tickToneFor(2).freq).toBeCloseTo(TICK_TONE.baseFreq * Math.pow(2, 2 / 12), 6);
  });

  it('オフのときは tick も鳴らそうとしない（例外にもならない）', async () => {
    const sound = await import('../src/sound');
    sound.setSound(false);
    expect(() => sound.playTickSound(2)).not.toThrow();
    expect(() => sound.playHitSound('great', 3)).not.toThrow();
  });
});

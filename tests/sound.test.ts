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

describe('ヒット音のパラメータ（F案: 8bit系ブリップ、判定 × tier）', () => {
  it('基本形は矩形波の2音「ピロッ」: 1568Hz 約32ms → 2093Hz 約50ms', async () => {
    const { HIT_BLIP } = await import('../src/sound');
    expect(HIT_BLIP.perfect.freq1).toBe(1568);
    expect(HIT_BLIP.perfect.freq2).toBe(2093);
    expect(HIT_BLIP.perfect.dur1).toBeCloseTo(0.032, 3);
    expect(HIT_BLIP.perfect.dur2).toBeCloseTo(0.05, 3);
    // 頭に小さなクリックがある
    expect(HIT_BLIP.perfect.clickPeak).toBeGreaterThan(0);
    expect(HIT_BLIP.perfect.clickSec).toBeLessThanOrEqual(0.01);
  });

  it('判定で差がつく: GREAT は少し短く、GOOD は1音目だけ・低く短い', async () => {
    const { HIT_BLIP } = await import('../src/sound');
    expect(HIT_BLIP.great.freq2).toBeGreaterThan(0);
    expect(HIT_BLIP.great.dur1 + HIT_BLIP.great.dur2).toBeLessThan(HIT_BLIP.perfect.dur1 + HIT_BLIP.perfect.dur2);
    expect(HIT_BLIP.great.peak).toBeLessThan(HIT_BLIP.perfect.peak);
    expect(HIT_BLIP.good.freq2).toBe(0);
    expect(HIT_BLIP.good.freq1).toBeLessThan(HIT_BLIP.perfect.freq1);
    expect(HIT_BLIP.good.dur1).toBeLessThan(HIT_BLIP.perfect.dur1);
    expect(HIT_BLIP.good.peak).toBeLessThan(HIT_BLIP.great.peak);
  });

  it('tier が上がると両方の音が +1 半音ずつ上がり、上限で止まる', async () => {
    const { hitToneFor, HIT_BLIP } = await import('../src/sound');
    const base = HIT_BLIP.perfect.freq1;
    expect(hitToneFor('perfect', 0).freq1).toBe(base);
    expect(hitToneFor('perfect', 1).freq1).toBeCloseTo(base * Math.pow(2, 1 / 12), 6);
    expect(hitToneFor('perfect', 4).freq1).toBeCloseTo(base * Math.pow(2, 4 / 12), 6);
    expect(hitToneFor('perfect', 9).freq1).toBe(hitToneFor('perfect', 4).freq1);
    // 2音目も同じ倍率で上がる（音程の間隔は保たれる）
    expect(hitToneFor('perfect', 2).freq2).toBeCloseTo(HIT_BLIP.perfect.freq2 * Math.pow(2, 2 / 12), 6);
    // GOOD はどの tier でも1音だけ
    expect(hitToneFor('good', 3).freq2).toBe(0);
  });

  it('tick 音は F案の軽量版（1音だけ、クリックなし、ずっと小さい）', async () => {
    const { TICK_BLIP, HIT_BLIP, tickToneFor } = await import('../src/sound');
    expect(TICK_BLIP.freq2).toBe(0);
    expect(TICK_BLIP.clickPeak).toBe(0);
    expect(TICK_BLIP.peak).toBeLessThan(HIT_BLIP.good.peak);
    expect(TICK_BLIP.dur1).toBeLessThanOrEqual(0.03);
    // tick も tier でピッチが上がる（同じ規則）
    expect(tickToneFor(2).freq).toBeCloseTo(TICK_BLIP.freq1 * Math.pow(2, 2 / 12), 6);
  });

  it('オフのときは tick も鳴らそうとしない（例外にもならない）', async () => {
    const sound = await import('../src/sound');
    sound.setSound(false);
    expect(() => sound.playTickSound(2)).not.toThrow();
    expect(() => sound.playHitSound('great', 3)).not.toThrow();
  });
});

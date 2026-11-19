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

  it('長押しの連続音: 音量は「鳴っていると分かるがヒット音より控えめ」、ピッチは進行で +2 半音', async () => {
    const { HOLD_TONE, HIT_BLIP, holdToneFor } = await import('../src/sound');
    // 音量の目安: 0.07〜0.10、かつヒット音 PERFECT より小さい
    expect(HOLD_TONE.peak).toBeGreaterThanOrEqual(0.07);
    expect(HOLD_TONE.peak).toBeLessThanOrEqual(0.1);
    expect(HOLD_TONE.peak).toBeLessThan(HIT_BLIP.perfect.peak);
    expect(HOLD_TONE.riseSemitones).toBe(2);
    // 同時保持に備えた上限がある
    expect(HOLD_TONE.maxVoices).toBeGreaterThanOrEqual(2);
    // progress 0 では基本周波数、尾では +2 半音。押し直し再開時は経過分から始まる
    expect(holdToneFor(0, 0).freqStart).toBeCloseTo(HOLD_TONE.baseFreq, 6);
    expect(holdToneFor(0, 0).freqEnd).toBeCloseTo(HOLD_TONE.baseFreq * Math.pow(2, 2 / 12), 6);
    expect(holdToneFor(0, 0.5).freqStart).toBeCloseTo(HOLD_TONE.baseFreq * Math.pow(2, 1 / 12), 6);
    expect(holdToneFor(0, 1).freqStart).toBeCloseTo(holdToneFor(0, 0).freqEnd, 6);
    // tier でピッチが上がる（ヒット音と同じ規則）
    expect(holdToneFor(2, 0).freqStart).toBeCloseTo(HOLD_TONE.baseFreq * Math.pow(2, 2 / 12), 6);
  });

  it('完走音は F案＋1音（3音目が最も高い）、失敗音は短く下がる小さな音', async () => {
    const { COMPLETE_BLIP, FAIL_BLIP, HIT_BLIP, completeToneFor } = await import('../src/sound');
    expect(COMPLETE_BLIP.perfect.freq3).toBeGreaterThan(COMPLETE_BLIP.perfect.freq2);
    expect(COMPLETE_BLIP.perfect.freq1).toBe(HIT_BLIP.perfect.freq1);
    // 通常ヒット音と重なっても破綻しないよう、ピークはヒット音以下
    expect(COMPLETE_BLIP.perfect.peak).toBeLessThanOrEqual(HIT_BLIP.perfect.peak);
    // tier で全音が同じ倍率で上がる
    expect(completeToneFor('perfect', 2).freq3).toBeCloseTo(COMPLETE_BLIP.perfect.freq3 * Math.pow(2, 2 / 12), 6);
    expect(FAIL_BLIP.freq2).toBeLessThan(FAIL_BLIP.freq1);
    expect(FAIL_BLIP.peak).toBeLessThan(HIT_BLIP.good.peak);
  });

  it('オフのときはどの音も鳴らそうとしない（例外にもならない）', async () => {
    const sound = await import('../src/sound');
    sound.setSound(false);
    const key = {};
    expect(() => sound.startHoldSound(key, 2, 1000)).not.toThrow();
    expect(() => sound.stopHoldSound(key)).not.toThrow();
    expect(() => sound.stopAllHoldSounds()).not.toThrow();
    expect(() => sound.playCompleteSound('perfect', 2)).not.toThrow();
    expect(() => sound.playFailSound()).not.toThrow();
    expect(() => sound.playHitSound('great', 3)).not.toThrow();
  });
});

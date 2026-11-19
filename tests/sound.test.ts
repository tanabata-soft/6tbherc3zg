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

describe('ヒット音のパラメータ（タンバリン E案、判定 × tier）', () => {
  it('金属片の部分音は12本、E案レシピの周波数・振幅・減衰率の範囲に収まる', async () => {
    const { TAMB_PARTIALS, TAMB_ATTACK_SEC } = await import('../src/sound');
    expect(TAMB_PARTIALS).toHaveLength(12);
    expect(TAMB_PARTIALS.map((p) => p.freq)).toEqual([
      3400, 3950, 4480, 5120, 5760, 6480, 7250, 8100, 9020, 10100, 11300, 12600,
    ]);
    for (const p of TAMB_PARTIALS) {
      expect(p.amp).toBeGreaterThanOrEqual(0.25);
      expect(p.amp).toBeLessThanOrEqual(0.8);
      expect(p.decay).toBeGreaterThanOrEqual(6);
      expect(p.decay).toBeLessThanOrEqual(14);
    }
    // アタックは約8ms の柔らかいランプ（カチッという硬い立ち上がりにしない）
    expect(TAMB_ATTACK_SEC).toBeCloseTo(0.008, 3);
  });

  it('粒状の揺れは冒頭100ms 内に 20〜30 個、空気感は 5〜14kHz で減衰率 10/s', async () => {
    const { TAMB_GRAINS, TAMB_AIR, TAMB_GRAIN_BAND } = await import('../src/sound');
    expect(TAMB_GRAINS.length).toBeGreaterThanOrEqual(20);
    expect(TAMB_GRAINS.length).toBeLessThanOrEqual(30);
    for (const g of TAMB_GRAINS) {
      expect(g.at).toBeGreaterThanOrEqual(0);
      expect(g.at).toBeLessThanOrEqual(0.1);
      expect(g.dur).toBeGreaterThanOrEqual(0.01);
      expect(g.dur).toBeLessThanOrEqual(0.03);
    }
    expect(TAMB_GRAIN_BAND).toEqual({ loHz: 3000, hiHz: 12000 });
    expect(TAMB_AIR.loHz).toBe(5000);
    expect(TAMB_AIR.hiHz).toBe(14000);
    expect(TAMB_AIR.decay).toBe(10);
  });

  it('判定で差がつく: PERFECT はフル、GREAT はやや小さく短く、GOOD は部分音を減らしてさらに小さい', async () => {
    const { tambourineFor } = await import('../src/sound');
    const perfect = tambourineFor('perfect', 0);
    const great = tambourineFor('great', 0);
    const good = tambourineFor('good', 0);
    expect(perfect.peak).toBeCloseTo(0.24, 3);
    expect(great.peak).toBeCloseTo(0.19, 3);
    expect(good.peak).toBeCloseTo(0.13, 3);
    expect(perfect.partials).toHaveLength(12);
    expect(great.partials.length).toBeLessThan(perfect.partials.length);
    expect(good.partials.length).toBeLessThan(great.partials.length);
    expect(great.grains.length).toBeLessThan(perfect.grains.length);
    expect(good.grains.length).toBeLessThan(great.grains.length);
    // 短く = 減衰率が大きい（平均で比べる）
    const avgDecay = (ps: { decay: number }[]) => ps.reduce((s, p) => s + p.decay, 0) / ps.length;
    expect(avgDecay(great.partials)).toBeGreaterThan(avgDecay(perfect.partials));
    expect(avgDecay(good.partials)).toBeGreaterThan(avgDecay(great.partials));
  });

  it('tier ではピッチを上げず、明るさ（高域の割合）だけが少し上がり、上限で止まる', async () => {
    const { tambourineFor } = await import('../src/sound');
    const base = tambourineFor('perfect', 0);
    const t2 = tambourineFor('perfect', 2);
    // 周波数は tier で変わらない
    expect(t2.partials.map((p) => p.freq)).toEqual(base.partials.map((p) => p.freq));
    // 高域（7kHz 以上）の部分音と空気感は明るくなる。低域は変わらない
    const hi = (ps: { freq: number; amp: number }[]) => ps.filter((p) => p.freq >= 7000);
    expect(hi(t2.partials).every((p, i) => p.amp > hi(base.partials)[i].amp)).toBe(true);
    expect(t2.partials.filter((p) => p.freq < 7000)).toEqual(base.partials.filter((p) => p.freq < 7000));
    expect(t2.air.gain).toBeGreaterThan(base.air.gain);
    expect(t2.brightness).toBeGreaterThan(base.brightness);
    // 上限（tier 4）で止まる
    expect(tambourineFor('perfect', 9).brightness).toBe(tambourineFor('perfect', 4).brightness);
  });

  it('長押し中の連打: 1発は通常ヒットより小さく・短く、間隔は曲の BPM の16分音符', async () => {
    const { HOLD_BLIP, HOLD_STREAM, holdStreamIntervalSec, tambourineFor } = await import('../src/sound');
    // 音量の目安: 0.10〜0.12、かつヒット音（タンバリン）PERFECT より小さい
    expect(HOLD_BLIP.peak).toBeGreaterThanOrEqual(0.1);
    expect(HOLD_BLIP.peak).toBeLessThanOrEqual(0.12);
    expect(HOLD_BLIP.peak).toBeLessThan(tambourineFor('perfect', 0).peak);
    // F案の家族（1568→2093Hz の2音）のまま据え置きで、通常ヒットより短い
    expect(HOLD_BLIP.freq1).toBe(1568);
    expect(HOLD_BLIP.freq2).toBe(2093);
    // 間隔は16分音符: 135 → 約111ms、150 → 100ms。不正な BPM は 120 扱い
    expect(holdStreamIntervalSec(135)).toBeCloseTo(60 / 135 / 4, 6);
    expect(holdStreamIntervalSec(150)).toBeCloseTo(0.1, 6);
    expect(holdStreamIntervalSec(0)).toBeCloseTo(60 / 120 / 4, 6);
    // 同時保持に備えた上限がある
    expect(HOLD_STREAM.maxVoices).toBeGreaterThanOrEqual(2);
  });

  it('連打のピッチ: tier 連動に加えて、ホールドの進行で +2 半音まで上がる（F案のまま）', async () => {
    const { HOLD_BLIP, holdBlipFor } = await import('../src/sound');
    expect(holdBlipFor(0, 0).freq1).toBeCloseTo(HOLD_BLIP.freq1, 6);
    // 進行 0.5 で +1 半音、尾（1）で +2 半音。押し直し再開時は経過分から始まる
    expect(holdBlipFor(0, 0.5).freq1).toBeCloseTo(HOLD_BLIP.freq1 * Math.pow(2, 1 / 12), 6);
    expect(holdBlipFor(0, 1).freq1).toBeCloseTo(HOLD_BLIP.freq1 * Math.pow(2, 2 / 12), 6);
    // tier でピッチが上がる（ヒット音と同じ規則）。2音目も同じ倍率で間隔を保つ
    expect(holdBlipFor(2, 0).freq1).toBeCloseTo(HOLD_BLIP.freq1 * Math.pow(2, 2 / 12), 6);
    expect(holdBlipFor(1, 0).freq2).toBeCloseTo(HOLD_BLIP.freq2 * Math.pow(2, 1 / 12), 6);
    // tier と進行は重なる
    expect(holdBlipFor(1, 1).freq1).toBeCloseTo(HOLD_BLIP.freq1 * Math.pow(2, 3 / 12), 6);
  });

  it('空タップ音: F案の家族で1音だけ・低め・短い・小さめ', async () => {
    const { EMPTY_BLIP, HOLD_BLIP, tambourineFor } = await import('../src/sound');
    expect(EMPTY_BLIP.freq2).toBe(0);
    expect(EMPTY_BLIP.freq1).toBe(1046);
    // ヒット音（タンバリン GOOD が最低）より小さく、連打より小さい
    expect(EMPTY_BLIP.peak).toBeLessThan(HOLD_BLIP.peak);
    expect(EMPTY_BLIP.peak).toBeLessThan(tambourineFor('good', 0).peak);
  });

  it('完走音は F案＋1音（3音目が最も高い）、失敗音は短く下がる小さな音', async () => {
    const { COMPLETE_BLIP, FAIL_BLIP, completeToneFor, tambourineFor } = await import('../src/sound');
    expect(COMPLETE_BLIP.perfect.freq3).toBeGreaterThan(COMPLETE_BLIP.perfect.freq2);
    expect(COMPLETE_BLIP.perfect.freq1).toBe(1568);
    // 通常ヒット音と重なっても破綻しないよう、ピークはヒット音（タンバリン）以下
    expect(COMPLETE_BLIP.perfect.peak).toBeLessThanOrEqual(tambourineFor('perfect', 0).peak);
    // tier で全音が同じ倍率で上がる
    expect(completeToneFor('perfect', 2).freq3).toBeCloseTo(COMPLETE_BLIP.perfect.freq3 * Math.pow(2, 2 / 12), 6);
    expect(FAIL_BLIP.freq2).toBeLessThan(FAIL_BLIP.freq1);
    expect(FAIL_BLIP.peak).toBeLessThan(tambourineFor('good', 0).peak);
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
    expect(() => sound.playEmptySound()).not.toThrow();
  });
});

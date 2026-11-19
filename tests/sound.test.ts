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

describe('ヒット音のパラメータ（v1.9.5: オーナー支給クラップ、判定 × tier）', () => {
  it('素材は 0.12 秒の単発クラップで、PERFECT は素材をそのまま全部鳴らす', async () => {
    const { CLAP_DURATION_SEC, CLAP_HIT } = await import('../src/sound');
    expect(CLAP_DURATION_SEC).toBeCloseTo(0.12, 3);
    expect(CLAP_HIT.perfect.durSec).toBe(CLAP_DURATION_SEC);
    // PERFECT が一番大きい
    expect(CLAP_HIT.perfect.peak).toBeGreaterThan(CLAP_HIT.great.peak);
    expect(CLAP_HIT.great.peak).toBeGreaterThan(CLAP_HIT.good.peak);
  });

  it('判定で差がつく: GREAT は少し小さく短く、GOOD はさらに小さく・短く・鈍い', async () => {
    const { CLAP_HIT } = await import('../src/sound');
    expect(CLAP_HIT.great.durSec).toBeLessThan(CLAP_HIT.perfect.durSec);
    expect(CLAP_HIT.good.durSec).toBeLessThan(CLAP_HIT.great.durSec);
    // 鈍さはローパス（明るさ）で付ける
    expect(CLAP_HIT.perfect.lowpassHz).toBeGreaterThan(CLAP_HIT.great.lowpassHz);
    expect(CLAP_HIT.great.lowpassHz).toBeGreaterThan(CLAP_HIT.good.lowpassHz);
  });

  it('tier ではピッチでなく明るさ（ローパス）が上がり、上限で止まる。音量と長さは変わらない', async () => {
    const { CLAP_HIT, CLAP_TIER_BRIGHTNESS, clapToneFor } = await import('../src/sound');
    const base = CLAP_HIT.perfect.lowpassHz;
    expect(clapToneFor('perfect', 0).lowpassHz).toBe(base);
    expect(clapToneFor('perfect', 1).lowpassHz).toBeCloseTo(base * (1 + CLAP_TIER_BRIGHTNESS.perTier), 6);
    expect(clapToneFor('perfect', 4).lowpassHz).toBeCloseTo(base * (1 + CLAP_TIER_BRIGHTNESS.perTier * 4), 6);
    expect(clapToneFor('perfect', 9).lowpassHz).toBe(clapToneFor('perfect', 4).lowpassHz);
    // どの判定でも、tier で変わるのは明るさだけ
    for (const judge of ['perfect', 'great', 'good'] as const) {
      expect(clapToneFor(judge, 3).peak).toBe(CLAP_HIT[judge].peak);
      expect(clapToneFor(judge, 3).durSec).toBe(CLAP_HIT[judge].durSec);
      expect(clapToneFor(judge, 3).lowpassHz).toBeGreaterThan(CLAP_HIT[judge].lowpassHz);
    }
  });

  it('長押し中の連打: 1発は通常ヒットより小さく・短く、間隔は曲の BPM の16分音符', async () => {
    const { CLAP_HIT, CLAP_HOLD, HOLD_STREAM, holdStreamIntervalSec } = await import('../src/sound');
    expect(CLAP_HOLD.peak).toBeLessThan(CLAP_HIT.perfect.peak);
    expect(CLAP_HOLD.durSec).toBeLessThan(CLAP_HIT.good.durSec);
    // 間隔は16分音符: 135 → 約111ms、150 → 100ms。不正な BPM は 120 扱い
    expect(holdStreamIntervalSec(135)).toBeCloseTo(60 / 135 / 4, 6);
    expect(holdStreamIntervalSec(150)).toBeCloseTo(0.1, 6);
    expect(holdStreamIntervalSec(0)).toBeCloseTo(60 / 120 / 4, 6);
    // 同時保持に備えた上限がある
    expect(HOLD_STREAM.maxVoices).toBeGreaterThanOrEqual(2);
  });

  it('連打の明るさ: tier で上がり、ホールドの進行でも尾に向けて上がる（ピッチは変えない）', async () => {
    const { CLAP_HOLD, HOLD_CLAP_RISE, holdClapFor } = await import('../src/sound');
    expect(holdClapFor(0, 0).lowpassHz).toBeCloseTo(CLAP_HOLD.lowpassHz, 6);
    // 進行 0.5 で上昇の半分、尾（1）で HOLD_CLAP_RISE 倍。押し直し再開時は経過分から始まる
    expect(holdClapFor(0, 0.5).lowpassHz).toBeCloseTo(CLAP_HOLD.lowpassHz * (1 + (HOLD_CLAP_RISE - 1) * 0.5), 6);
    expect(holdClapFor(0, 1).lowpassHz).toBeCloseTo(CLAP_HOLD.lowpassHz * HOLD_CLAP_RISE, 6);
    // tier の明るさと進行の明るさは重なる
    expect(holdClapFor(2, 0).lowpassHz).toBeGreaterThan(CLAP_HOLD.lowpassHz);
    expect(holdClapFor(1, 1).lowpassHz).toBeGreaterThan(holdClapFor(1, 0).lowpassHz);
    // 音量と長さは tier・進行で変わらない
    expect(holdClapFor(3, 1).peak).toBe(CLAP_HOLD.peak);
    expect(holdClapFor(3, 1).durSec).toBe(CLAP_HOLD.durSec);
    // 進行は 0..1 に丸める
    expect(holdClapFor(0, 5).lowpassHz).toBe(holdClapFor(0, 1).lowpassHz);
  });

  it('空タップ音: 合成ブリップで1音だけ・低め・短い・小さめ（据え置き）', async () => {
    const { CLAP_HOLD, EMPTY_BLIP } = await import('../src/sound');
    expect(EMPTY_BLIP.freq2).toBe(0);
    expect(EMPTY_BLIP.freq1).toBe(1046);
    // クラップ連打より小さく、長さも短い
    expect(EMPTY_BLIP.peak).toBeLessThan(CLAP_HOLD.peak);
    expect(EMPTY_BLIP.dur1).toBeLessThanOrEqual(0.032);
  });

  it('完走音は旧ヒット音＋1音（3音目が最も高い）のブリップ据え置き、失敗音は短く下がる小さな音', async () => {
    const { COMPLETE_BLIP, FAIL_BLIP, completeToneFor } = await import('../src/sound');
    expect(COMPLETE_BLIP.perfect.freq3).toBeGreaterThan(COMPLETE_BLIP.perfect.freq2);
    expect(COMPLETE_BLIP.perfect.freq1).toBe(1568);
    // tier で全音が同じ倍率で上がる（完走音はブリップなのでピッチ連動のまま）
    expect(completeToneFor('perfect', 2).freq3).toBeCloseTo(COMPLETE_BLIP.perfect.freq3 * Math.pow(2, 2 / 12), 6);
    expect(FAIL_BLIP.freq2).toBeLessThan(FAIL_BLIP.freq1);
    expect(FAIL_BLIP.peak).toBeLessThan(0.12);
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

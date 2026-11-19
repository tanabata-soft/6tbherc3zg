import { describe, expect, it } from 'vitest';
import {
  COMBO_TIER_STARTS,
  MAX_COMBO_TIER,
  comboTier,
  effectiveTier,
  hitPitchMultiplier,
  hitPitchSemitones,
  CAGE_COMBO_INTERVAL,
  isCageBigCombo,
  isCageCombo,
  tierFx,
  tintColor,
} from '../src/logic';

describe('コンボ tier の境界', () => {
  it('境界は 0 / 10 / 25 / 50 / 100 で、tier は 0〜4', () => {
    expect(COMBO_TIER_STARTS).toEqual([0, 10, 25, 50, 100]);
    expect(MAX_COMBO_TIER).toBe(4);
    expect(comboTier(0)).toBe(0);
    expect(comboTier(9)).toBe(0);
    expect(comboTier(10)).toBe(1);
    expect(comboTier(24)).toBe(1);
    expect(comboTier(25)).toBe(2);
    expect(comboTier(49)).toBe(2);
    expect(comboTier(50)).toBe(3);
    expect(comboTier(99)).toBe(3);
    expect(comboTier(100)).toBe(4);
    expect(comboTier(999)).toBe(4);
  });

  it('FEVER 中は +1 tier で、上限を超えない', () => {
    expect(effectiveTier(0, true)).toBe(1);
    expect(effectiveTier(10, true)).toBe(2);
    expect(effectiveTier(50, true)).toBe(4);
    expect(effectiveTier(100, true)).toBe(4);
    expect(effectiveTier(100, false)).toBe(4);
    expect(effectiveTier(9, false)).toBe(0);
  });

  it('ケージ登場は 30 ごと、一段大きい登場は 100 の倍数', () => {
    expect(CAGE_COMBO_INTERVAL).toBe(30);
    expect(isCageCombo(0)).toBe(false);
    expect(isCageCombo(29)).toBe(false);
    expect(isCageCombo(30)).toBe(true);
    expect(isCageCombo(60)).toBe(true);
    expect(isCageCombo(90)).toBe(true);
    expect(isCageCombo(100)).toBe(true); // 100 の倍数も登場タイミング（一段大きい登場）
    expect(isCageCombo(200)).toBe(true);
    expect(isCageCombo(120)).toBe(true);
    expect(isCageCombo(31)).toBe(false);
    expect(isCageBigCombo(0)).toBe(false);
    expect(isCageBigCombo(90)).toBe(false);
    expect(isCageBigCombo(100)).toBe(true);
    expect(isCageBigCombo(200)).toBe(true);
    expect(isCageBigCombo(150)).toBe(false);
  });
});

describe('tier の演出パラメータ', () => {
  it('tier が上がるほど各要素が派手になる（単調増加）', () => {
    const all = [0, 1, 2, 3, 4].map(tierFx);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].particleMul).toBeGreaterThan(all[i - 1].particleMul);
      expect(all[i].particleSize).toBeGreaterThanOrEqual(all[i - 1].particleSize);
      expect(all[i].ringMul).toBeGreaterThan(all[i - 1].ringMul);
      expect(all[i].ringWidthMul).toBeGreaterThan(all[i - 1].ringWidthMul);
      expect(all[i].popMul).toBeGreaterThan(all[i - 1].popMul);
      expect(all[i].judgeMul).toBeGreaterThan(all[i - 1].judgeMul);
      expect(all[i].judgeTint).toBeGreaterThan(all[i - 1].judgeTint);
      expect(all[i].flashMul).toBeGreaterThan(all[i - 1].flashMul);
      expect(all[i].comboScale).toBeGreaterThan(all[i - 1].comboScale);
      expect(all[i].comboColor).not.toBe(all[i - 1].comboColor);
    }
  });

  it('範囲外の tier は丸める', () => {
    expect(tierFx(-1)).toBe(tierFx(0));
    expect(tierFx(99)).toBe(tierFx(4));
  });
});

describe('色のティント', () => {
  it('k=0 で元の色、k=1 で相手の色、途中は中間の色', () => {
    expect(tintColor('#000000', '#ffffff', 0)).toBe('#000000');
    expect(tintColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(tintColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(tintColor('#4ecdc4', '#ffedb0', 0)).toBe('#4ecdc4');
  });
});

describe('ヒット音のピッチ（コンボ連動）', () => {
  it('tier ごとに +1 半音、上限は +4 半音', () => {
    expect(hitPitchSemitones(0)).toBe(0);
    expect(hitPitchSemitones(1)).toBe(1);
    expect(hitPitchSemitones(4)).toBe(4);
    expect(hitPitchSemitones(10)).toBe(4);
    expect(hitPitchMultiplier(0)).toBe(1);
    expect(hitPitchMultiplier(2)).toBeCloseTo(Math.pow(2, 2 / 12), 10);
    expect(hitPitchMultiplier(4)).toBeCloseTo(1.26, 2);
    for (let t = 1; t <= 4; t++) {
      expect(hitPitchMultiplier(t)).toBeGreaterThan(hitPitchMultiplier(t - 1));
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// localStorage を差し替えてから、モジュールを読み直す（設定は読み込み時に保存値を読むため）
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

describe('効果音の設定（sound）', () => {
  it('デフォルトはオンで、切り替えが保存され、読み直しても残る', async () => {
    const sound = await import('../src/sound');
    expect(sound.isSoundOn()).toBe(true);
    sound.setSound(false);
    expect(sound.isSoundOn()).toBe(false);
    expect(localStorage.getItem('kiso-rhythm-game-sound')).toBe('false');

    vi.resetModules();
    const reloaded = await import('../src/sound');
    expect(reloaded.isSoundOn()).toBe(false);
  });

  it('判定ごとの音は PERFECT がいちばん長く、音量も大きい（GOOD は低く短い）', async () => {
    const { HIT_BLIP } = await import('../src/sound');
    const total = (j: 'perfect' | 'great' | 'good') => HIT_BLIP[j].dur1 + HIT_BLIP[j].dur2;
    expect(total('perfect')).toBeGreaterThan(total('great'));
    expect(total('great')).toBeGreaterThan(total('good'));
    expect(HIT_BLIP.good.freq1).toBeLessThan(HIT_BLIP.perfect.freq1);
    expect(HIT_BLIP.perfect.peak).toBeGreaterThan(HIT_BLIP.great.peak);
    expect(HIT_BLIP.great.peak).toBeGreaterThan(HIT_BLIP.good.peak);
    // 曲を邪魔しない控えめな音量
    expect(HIT_BLIP.perfect.peak).toBeLessThanOrEqual(0.25);
  });

  it('オフのときは音を出そうとしない（例外にもならない）', async () => {
    const sound = await import('../src/sound');
    sound.setSound(false);
    expect(() => sound.playHitSound('perfect')).not.toThrow();
  });
});

describe('振動の設定（haptics）', () => {
  it('デフォルトはオンで、切り替えが保存され、読み直しても残る', async () => {
    const haptics = await import('../src/haptics');
    expect(haptics.isVibrateOn()).toBe(true);
    haptics.setVibrate(false);
    expect(localStorage.getItem('kiso-rhythm-game-vibrate')).toBe('false');

    vi.resetModules();
    const reloaded = await import('../src/haptics');
    expect(reloaded.isVibrateOn()).toBe(false);
  });

  it('振動の長さは PERFECT 15ms で、ほかの判定より長い', async () => {
    const { HIT_VIBRATE_MS } = await import('../src/haptics');
    expect(HIT_VIBRATE_MS.perfect).toBe(15);
    expect(HIT_VIBRATE_MS.perfect).toBeGreaterThan(HIT_VIBRATE_MS.great);
    expect(HIT_VIBRATE_MS.great).toBeGreaterThanOrEqual(HIT_VIBRATE_MS.good);
  });

  it('オンで vibrate がある環境では、判定に応じた長さで振動する', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const events: CustomEvent[] = [];
    vi.stubGlobal('document', {
      dispatchEvent: (e: CustomEvent) => {
        events.push(e);
        return true;
      },
    });
    const haptics = await import('../src/haptics');
    haptics.vibrateHit('perfect');
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('app:vibrate');
  });

  it('オフのとき・vibrate がない環境では何もしない', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = await import('../src/haptics');
    haptics.setVibrate(false);
    haptics.vibrateHit('perfect');
    expect(vibrate).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', {});
    const haptics2 = await import('../src/haptics');
    haptics2.setVibrate(true);
    expect(() => haptics2.vibrateHit('great')).not.toThrow();
  });
});

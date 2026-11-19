import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// アプリの ID（package.json の name）。保存データのキーの接頭辞になる
const APP_ID = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string }).name;

/** 設定モーダルを開く（設定ボタンはメニュー下部のフッターにあるので、スクロールしてから押す） */
async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  // 起動（または「なおす」後の再読み込み）が終わってから触る。途中で触ると、再読み込みで要素が外れて失敗する
  await page.waitForFunction(() => (window as unknown as { __appStarted?: boolean }).__appStarted === true);
  const button = page.locator('#settings-open');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

test('メニューが表示され、曲と難易度を選べる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'キソ・ケイジ・ビート' })).toBeVisible();
  await expect(page.getByText('ニコラスケイジと木曽と私')).toBeVisible();
  await expect(page.locator('.carousel-slide')).toHaveCount(4);
  await expect(page.locator('body')).toHaveAttribute('data-song', 'highway');

  await page.locator('.carousel-slide[data-song="night"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-song', 'night');
  await page.getByRole('button', { name: 'むずかしい' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-difficulty', 'hard');

  // 選び直しても記録（ベストスコア表示）が壊れない（設定モーダルの中にある）
  await openSettings(page);
  await expect(page.locator('#menu-best')).toHaveText('0');
});

test('設定ボタンでモーダルが開き、閉じるボタン・Esc・背景タップで閉じられる', async ({ page }) => {
  await page.goto('/');
  const dialog = page.locator('#settings-dialog');
  // メニュー上では設定項目は見えていない（モーダルの中にある）
  await expect(page.locator('#sound-button')).toBeHidden();
  await expect(dialog).toBeHidden();

  await openSettings(page);
  await expect(page.locator('#sound-button')).toBeVisible();
  // 閉じるボタンで閉じる
  await page.getByRole('button', { name: '設定を閉じる' }).click();
  await expect(dialog).toBeHidden();

  // Esc で閉じる
  await openSettings(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // 背景（ダイアログの外側）タップで閉じる
  await openSettings(page);
  await page.mouse.click(206, 30);
  await expect(dialog).toBeHidden();

  // 下部の「閉じる」でも閉じる
  await openSettings(page);
  await page.locator('#settings-close-bottom').click();
  await expect(dialog).toBeHidden();
});

test('オフセット調整が保存される', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: 'オフセットを10ms増やす' }).click();
  await page.getByRole('button', { name: 'オフセットを10ms増やす' }).click();
  await expect(page.locator('#offset-value')).toHaveText('+20ms');
  await page.reload();
  await openSettings(page);
  await expect(page.locator('#offset-value')).toHaveText('+20ms');
  await page.getByRole('button', { name: 'オフセットを10ms減らす' }).click();
  await expect(page.locator('#offset-value')).toHaveText('+10ms');
});

test('遅延チェックで測って、オフセットに反映できる', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?debug=1');
  await openSettings(page);
  await expect(page.locator('#offset-value')).toHaveText('0ms');
  await page.locator('#latency-open').click();
  const dialog = page.locator('#latency-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-latency', 'idle');
  await page.locator('#latency-start').click();
  await expect(page.locator('body')).toHaveAttribute('data-latency', 'running');
  // 拍（1秒間隔）にだいたい合わせて10回タップする
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    await page.locator('#latency-tap').click();
  }
  await expect(page.locator('body')).toHaveAttribute('data-latency', 'done');
  await expect(page.locator('#latency-result')).toBeVisible();
  const mean = Number.parseInt((await page.locator('#latency-mean').textContent()) ?? '0', 10);
  // 反映後のオフセットは、測った平均を clampOffset（±200ms・10ms刻み）したものと一致する
  const expected = Math.min(200, Math.max(-200, Math.round(mean / 10) * 10));
  await page.locator('#latency-apply').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#offset-value')).toHaveText(`${expected > 0 ? '+' : ''}${expected}ms`);
  // 保存もされている（開き直しても同じオフセット）
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __appStarted?: boolean }).__appStarted === true);
  const state = await page.evaluate(
    () => (window as unknown as { __pwaTest: { getState(): { offset: number } } }).__pwaTest.getState(),
  );
  expect(state.offset).toBe(expected);
});

test('遅延チェックを途中でやめると、オフセットは変わらない', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  await page.locator('#latency-open').click();
  await page.locator('#latency-start').click();
  await expect(page.locator('body')).toHaveAttribute('data-latency', 'running');
  await page.waitForTimeout(1100);
  await page.locator('#latency-tap').click();
  await page.locator('#latency-cancel').click();
  await expect(page.locator('#latency-dialog')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-latency', 'idle');
  await expect(page.locator('#offset-value')).toHaveText('0ms');
});

test('ゲームが始まり、Canvas が表示され、左上タップでメニューに戻る', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('#game-screen')).toBeVisible();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  // 左上の ✕ の場所をタップして中断する
  await page.locator('#game-canvas').dispatchEvent('pointerdown', { clientX: 20, clientY: 20 });
  await expect(page.locator('#menu-screen')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'menu');
});

test('カルーセルの表示が、選んだ曲に切り替わる', async ({ page }) => {
  await page.goto('/');
  const active = page.locator('.carousel-slide[data-active="true"]');
  await expect(active).toHaveAttribute('data-song', 'highway');
  await expect(active.locator('.slide-title')).toHaveText('石畳のハイウェイ');
  await expect(active.locator('.slide-chips')).toContainText('BPM');

  await page.locator('.carousel-slide[data-song="night"]').click();
  await expect(page.locator('.carousel-slide[data-active="true"]')).toHaveAttribute('data-song', 'night');
  await expect(page.locator('.carousel-slide[data-song="night"] .slide-title')).toHaveText('Kiso Night Silhouette');
  await expect(page.locator('.carousel-slide[data-song="night"] .slide-album')).toHaveText('Silver Screen Ascent');
});

test('カルーセルをボタン・ドット・スクロールで切り替えて、その曲で始められる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-song', 'highway');

  // 前後ボタンで切り替える
  await page.locator('#carousel-next').click();
  await expect(page.locator('body')).toHaveAttribute('data-song', 'night');
  await page.locator('#carousel-next').click();
  await expect(page.locator('body')).toHaveAttribute('data-song', 'gospel');
  await page.locator('#carousel-prev').click();
  await expect(page.locator('body')).toHaveAttribute('data-song', 'night');

  // ドットで末尾の曲へ飛ぶ
  await page.locator('.carousel-dot[data-song="kira"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-song', 'kira');
  await expect(page.locator('.carousel-slide[data-active="true"]')).toHaveAttribute('data-song', 'kira');
  await expect(page.locator('.carousel-dot[data-song="kira"]')).toHaveAttribute('aria-current', 'true');

  // スワイプ相当: ビューポートをスクロールすると、中央のスライドが選択される
  await page.locator('#carousel-viewport').evaluate((el) => {
    const slide = el.querySelector('.carousel-slide[data-song="gospel"]') as HTMLElement;
    el.scrollTo({ left: slide.offsetLeft - (el.clientWidth - slide.clientWidth) / 2, behavior: 'auto' });
  });
  await expect(page.locator('body')).toHaveAttribute('data-song', 'gospel', { timeout: 5000 });

  // 切り替えた曲（gospel）で演奏を始められる
  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('#game-screen')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-song', 'gospel');
});

test('効果音・振動・歌詞表示のオン/オフが切り替わり、保存される', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  const sound = page.locator('#sound-button');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(sound.locator('.toggle-state')).toHaveText('オン');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(sound.locator('.toggle-state')).toHaveText('オフ');

  const vibrate = page.locator('#vibrate-button');
  await expect(vibrate).toHaveAttribute('aria-pressed', 'true');
  await vibrate.click();
  await expect(vibrate).toHaveAttribute('aria-pressed', 'false');

  const lyrics = page.locator('#lyrics-button');
  await expect(lyrics).toHaveAttribute('aria-pressed', 'true');
  await lyrics.click();
  await expect(lyrics).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).toHaveAttribute('data-lyrics', 'off');
  await expect(page.locator('#lyrics')).toBeHidden();

  // 保存されている（開き直しても戻らない）
  await page.reload();
  await openSettings(page);
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#vibrate-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#lyrics-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).toHaveAttribute('data-sound', 'off');
  await expect(page.locator('body')).toHaveAttribute('data-vibrate', 'off');
  await expect(page.locator('body')).toHaveAttribute('data-lyrics', 'off');
});

test('ゲーム開始で音声が unlock され、AudioContext が running になる', async ({ page }) => {
  await page.goto('/?debug=1');
  type TestState = { audioUnlocked: boolean; audioState: string };
  const readState = () =>
    page.evaluate(() => {
      const api = (window as unknown as { __pwaTest?: { getState?: () => TestState } }).__pwaTest;
      return api?.getState?.() as TestState;
    });
  const before = await readState();
  expect(before.audioUnlocked).toBe(false);
  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  const after = await readState();
  expect(after.audioUnlocked).toBe(true);
  expect(after.audioState).toBe('running');
});

// 実時間のタイミングに依存するテストなので、並行実行で負荷がかかると揺れる。リトライを許可する
test.describe('ヒット判定（実時間）', () => {
  test.describe.configure({ retries: 2 });

  test('ノーツに当たるとスコアが入り、ヒット音のイベントが出る', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: unknown[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
    // ページの中で 4 レーンのキーを順に押し続ける（CDP 経由の実時間合わせは負荷でずれるため）。
    // 各レーンは 240ms ごとに押され、判定窓（±160ms）の中に必ず入る
    await page.evaluate(() => {
      const w = window as unknown as { __spam?: number };
      const keys = ['d', 'f', 'j', 'k'];
      let i = 0;
      w.__spam = window.setInterval(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[i++ % keys.length] }));
      }, 60);
    });
    try {
      await expect(page.locator('body')).not.toHaveAttribute('data-score', '0', { timeout: 25_000 });
    } finally {
      await page.evaluate(() => {
        const w = window as unknown as { __spam?: number };
        if (w.__spam) window.clearInterval(w.__spam);
      });
    }
    const sounds = await page.evaluate(() => (window as unknown as { __sounds: unknown[] }).__sounds);
    expect(sounds.length).toBeGreaterThanOrEqual(1);
  });

  test('長押しを押し続けると完走する', async ({ page }) => {
    // 最初の長押し（石畳のハイウェイ／かんたん）を譜面データから取る
    const charts = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as {
      highway: { charts: { easy: [number, number, number?][] } };
    };
    const first = charts.highway.charts.easy.find((n) => (n[2] ?? 0) > 0);
    if (!first) throw new Error('長押しが譜面にありません');
    const hold = { t: first[0], lane: first[1] };
    await page.goto('/?debug=1');
    // 効果音の発火（連続音の開始・完走音）も app:sound イベントで確かめる
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: { kind?: string }[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    // ゲーム側の songMs を見て、頭の 300ms 前からキーを繰り返し送って押し続ける
    // （keyup しない）。壁時計の setTimeout で頭に合わせる方式は、ゲームの時計
    // （AudioContext 基準）が負荷で壁時計から遅れる環境では窓を外してしまうため、
    // タップのテストと同じく位置を見て押す（長押し中は同じレーンに他のノーツが
    // ないので、余分な押下は無害）。
    await page.evaluate((h) => {
      const key = ['d', 'f', 'j', 'k'][h.lane];
      const api = (window as unknown as { __pwaTest?: { getState?: () => { songMs: number } } }).__pwaTest;
      const iv = window.setInterval(() => {
        if (document.body.dataset.holdsCompleted === '1') {
          window.clearInterval(iv);
          return;
        }
        const ms = api?.getState?.().songMs ?? -1;
        if (document.body.dataset.game === 'playing' && ms >= h.t - 300) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key }));
          if (ms > h.t + 1500) window.clearInterval(iv);
        }
      }, 10);
    }, hold);
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-holds-completed', '1', { timeout: 30_000 });
    // 長押し中はヒット音の連打が鳴り（hold-hit が複数回）、押し切ったら完走音が鳴る。拍 tick の音は出ない
    const kinds = await page.evaluate(() =>
      (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
    );
    expect(kinds).toContain('hold-start');
    expect(kinds.filter((k) => k === 'hold-hit').length).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain('complete');
    expect(kinds).not.toContain('tick');
  });

  test('ノーツのない所をタップすると空タップ音が鳴る', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: { kind?: string }[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    // playing になった直後（READY の2秒間は曲の時刻が負で、どのレーンにもノーツはない）に
    // 1回だけキーを押す。ノーツに当たらないので、空タップ音だけが鳴るはず
    await page.evaluate(() => {
      const obs = new MutationObserver(() => {
        if (document.body.dataset.game === 'playing') {
          obs.disconnect();
          window.setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
          }, 300);
        }
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-game'] });
    });
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
          ),
        { timeout: 10_000 },
      )
      .toContain('empty');
    const kinds = await page.evaluate(() =>
      (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
    );
    expect(kinds).not.toContain('hit');
    expect(kinds).not.toContain('hold-start');
    await expect(page.locator('body')).toHaveAttribute('data-score', '0');
  });

  test('バックグラウンド復帰を模しても、再開後のタップが効く', async ({ page }) => {
    // v1.9.1 の不具合対応の確認: 実機では「バックグラウンドになって復帰すると
    // タッチしても動かなくなる（READY のまま固まる）」が起きた。ブラウザでは
    // 本物のバックグラウンド遷移は作れないので、visibilityState を差し替えて
    // visibilitychange を発火させる模擬で、「隠れたら演奏が止まってメニューへ
    // 戻る」「復帰後に新しく始めた演奏でタップが効く（空タップ音が鳴る）」を見る。
    // 押下状態のリセットや AudioContext の resume の実機での効きは、実機確認が必要。
    await page.goto('/?debug=1');
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: { kind?: string }[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
    // キーを押しっぱなし（keyup しない）にしてから、バックグラウンドへ移る
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    // 演奏は止まり、メニューに戻る（裏で進んで大量ミスにならないための既存仕様）
    await expect(page.locator('#menu-screen')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-game', 'menu');
    // 復帰する
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    // もう一度始めると、READY 中のキー入力で空タップ音が鳴る＝入力が生きている
    await page.evaluate(() => {
      const obs = new MutationObserver(() => {
        if (document.body.dataset.game === 'playing') {
          obs.disconnect();
          window.setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
          }, 300);
        }
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-game'] });
    });
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() =>
            (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
          ),
        { timeout: 10_000 },
      )
      .toContain('empty');
  });

  test('ノーツに当たったタップでは空タップ音が鳴らない', async ({ page }) => {
    // 最初のタップノーツ（長押しでないもの。同レーンに前後 400ms 以内のノーツがないもの）を譜面から取る
    const charts = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as {
      highway: { charts: { easy: [number, number, number?][] } };
    };
    const easy = charts.highway.charts.easy;
    const target = easy.find(
      (n, i) =>
        (n[2] ?? 0) === 0 &&
        easy.every((m, j) => j === i || m[1] !== n[1] || Math.abs(m[0] - n[0]) > 400),
    );
    if (!target) throw new Error('対象のタップノーツが譜面にありません');
    const note = { t: target[0], lane: target[1] };
    await page.goto('/?debug=1');
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: { kind?: string }[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    // テスト用の入口で曲の現在位置（songMs）を読み、ノーツの 50ms 手前に来たら1回だけキーを送る。
    // 壁時計のタイマーで1発合わせる方式は並行実行の負荷で判定窓（±160ms）を外すため、
    // 位置を見て押す（窓の幅 320ms に対して 5ms 間隔の確認なら、負荷時でも必ず窓の中で押せる）
    await page.evaluate((n) => {
      const key = ['d', 'f', 'j', 'k'][n.lane];
      const api = (window as unknown as { __pwaTest?: { getState?: () => { songMs: number } } }).__pwaTest;
      let fired = false;
      const iv = window.setInterval(() => {
        if (fired) return;
        const ms = api?.getState?.().songMs ?? -1;
        if (ms >= n.t - 50) {
          fired = true;
          window.clearInterval(iv);
          window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        }
      }, 5);
    }, note);
    await page.getByRole('button', { name: 'スタート' }).click();
    // 1発の押下で何らかの音イベントが出るまで待つ（出た時点で勝敗が分かるので、長く待たない）
    await expect
      .poll(
        async () =>
          page.evaluate(() => (window as unknown as { __sounds: { kind?: string }[] }).__sounds.length),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const kinds = await page.evaluate(() =>
      (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
    );
    expect(kinds).toContain('hit');
    expect(kinds).not.toContain('empty');
  });

  test('長押しの帯が尾まで見え続ける（尾の間際まで帯が届く）', async ({ page }) => {
    // 実時間再生（尾まで約8秒のゲーム内時間）＋時計が遅れる環境でも収まるよう長めに取る
    test.setTimeout(120_000);
    // v1.7.1 の不具合修正の確認: 帯の描画を頭の仮想位置で打ち切っていたため、
    // 尾がラインに届く前に帯が消えていた（実測では帯の上端がラインの約129px 手前で停止）。
    // 完走するまでの間、帯の上端（＝尾）が判定ラインの 60px 以内まで近づくことを見る。
    // 測定自体は空間（ピクセル）だが、窓の制御は壁時計ではなくゲーム側の songMs で行う。
    // ゲームの時計は AudioContext 基準で、負荷が高い環境では壁時計から大きく遅れる
    // （実測で約0.72倍速まで落ちた）ため、壁時計前提だと窓が外れて帯を測り損ねる。
    const charts = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as {
      highway: { charts: { easy: [number, number, number?][] } };
    };
    // 対象は「最も長い長押し」（帯が長いほど尾の接近を測りやすい。譜面 v4 で
    // 最初の長押しが短いものに変わったため、最初の1本決め打ちはやめた）
    const holds = charts.highway.charts.easy.filter((n) => (n[2] ?? 0) > 0);
    const first = holds.reduce((a, b) => ((b[2] ?? 0) > (a[2] ?? 0) ? b : a), holds[0]);
    if (!first) throw new Error('長押しが譜面にありません');
    const hold = { t: first[0], lane: first[1], tail: first[0] + (first[2] ?? 0) };
    const LANE_HEX = ['#ff6b6b', '#ffd166', '#4ecdc4', '#6c8cff'];
    const rgb = [1, 3, 5].map((i) => parseInt((LANE_HEX[hold.lane] ?? '#ffffff').slice(i, i + 2), 16));
    await page.goto('/?debug=1');
    const sampling = page.evaluate(
      ({ h, rgb }) => {
        return new Promise<{ minGap: number }>((resolve) => {
          const done = { minGap: -1 };
          const api = (window as unknown as { __pwaTest?: { getState?: () => { songMs: number } } }).__pwaTest;
          const gameMs = () => api?.getState?.().songMs ?? -1;
          const obs = new MutationObserver(() => {
            if (document.body.dataset.game !== 'playing') return;
            obs.disconnect();
            // 頭ヒットを確実にするため、頭の 500ms 前（ゲーム側 songMs 基準）から
            // 50ms ごとにキーを流し続ける（どれかは判定窓に入る）。
            // 完走するか、尾を過ぎたら止める。途中の同じレーンのタップノーツに
            // 当たっても無害（長押し中は同じレーンに他のノーツはない）。
            const spam = window.setInterval(() => {
              const songMs = gameMs();
              if (songMs >= h.t - 500) {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: ['d', 'f', 'j', 'k'][h.lane] }));
              }
              if (document.body.dataset.holdsCompleted === '1' || songMs > h.tail + 500) {
                window.clearInterval(spam);
              }
            }, 50);
            const cv = document.getElementById('game-canvas') as HTMLCanvasElement;
            const cg = cv.getContext('2d');
            // 判定ラインの直上（20px 上）から上へ、レーン色が連続する区間の上端までの
            // 距離（CSS px）を測る。長押し中は帯がラインに接して一体に描かれるため、
            // この上端が帯の尾（キャップの上端）になる。帯より上にある後続ノーツは
            // 帯と連続しないので、尾が隠れて測れなくなることはない（従来の「最上端の
            // 一致ピクセル」方式は、後続ノーツが上にある間そちらを拾ってしまい、
            // 尾の接近を捉え損ねた）。判定枠の上端（ラインの 14px 上）に当たらない
            // よう、起点はラインの 20px 上にする。
            // 読み取りは3列を含む細い帯を1回で読む（getImageData は描画と競合して
            // 重いので、毎フレーム・複数回は呼ばない）。
            const bandGapCss = (): number => {
              if (!cg || cv.width === 0) return -1;
              const dsf = cv.height / cv.clientHeight;
              const lw = cv.width / 4;
              const cx = h.lane * lw + lw / 2;
              const hyDev = cv.height * 0.82;
              const yStart = Math.floor(hyDev - 20 * dsf);
              const x0 = Math.max(0, Math.floor(cx - lw * 0.12));
              const x1 = Math.min(cv.width - 1, Math.ceil(cx + lw * 0.12));
              const w = Math.max(1, x1 - x0);
              const img = cg.getImageData(x0, 0, w, cv.height).data;
              const matches = (col: number, y: number): boolean => {
                const i = (y * w + col) * 4;
                return (
                  Math.abs(img[i] - rgb[0]) < 70 &&
                  Math.abs(img[i + 1] - rgb[1]) < 70 &&
                  Math.abs(img[i + 2] - rgb[2]) < 70
                );
              };
              let best = -1;
              for (const x of [cx - lw * 0.12, cx, cx + lw * 0.12]) {
                const col = Math.min(w - 1, Math.max(0, Math.round(x - x0)));
                // ライン直上から上へ連続する間をたどる。短い混色（ヒット演出など）を
                // 拾わないよう、連続が 30 device px 以上続いた列だけを数える
                let y = yStart;
                let run = 0;
                while (y >= 0 && matches(col, y)) {
                  run++;
                  y--;
                }
                if (run >= 30) {
                  const gap = (hyDev - (y + 1)) / dsf;
                  if (best < 0 || gap < best) best = gap;
                }
              }
              return best;
            };
            // 測定は rAF ではなく 40ms 間隔で回す（rAF は負荷時に間隔が大きく開き、
            // 毎フレームの読み取りが描画をさらに圧迫して接近を捉え損ねたため）
            const timer = window.setInterval(() => {
              const songMs = gameMs();
              const completed = document.body.dataset.holdsCompleted === '1';
              // 読み取りは尾の接近区間だけ（尾の 1800ms 前から）
              if (!completed && songMs >= h.tail - 1800) {
                const gap = bandGapCss();
                if (gap >= 0 && (done.minGap < 0 || gap < done.minGap)) done.minGap = gap;
              }
              if (completed || songMs > h.tail + 1500) {
                window.clearInterval(timer);
                resolve(done);
              }
            }, 40);
          });
          obs.observe(document.body, { attributes: true, attributeFilter: ['data-game'] });
        });
      },
      { h: hold, rgb },
    );
    await page.getByRole('button', { name: 'スタート' }).click();
    const res = await sampling;
    // 帯の上端がラインの 60px 以内まで届いた（修正前は約129px 手前で帯が消えた）
    expect(res.minGap).toBeGreaterThanOrEqual(0);
    expect(res.minGap).toBeLessThan(60);
    await expect(page.locator('body')).toHaveAttribute('data-holds-completed', '1', { timeout: 30_000 });
  });
});

test('コンボ tier とケージ登場がテスト用の入口で確認できる', async ({ page }) => {
  await page.goto('/?debug=1');
  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  // コンボを直接セットすると、tier とケージ登場（30 ごと＋100 の倍数）が data 属性に出る
  await page.evaluate(() => {
    const w = window as unknown as { __pwaTest?: { setCombo?: (n: number) => void } };
    w.__pwaTest?.setCombo?.(100);
  });
  await expect(page.locator('body')).toHaveAttribute('data-combo', '100');
  await expect(page.locator('body')).toHaveAttribute('data-combo-tier', '4');
  await expect(page.locator('body')).toHaveAttribute('data-cage', '100');
  // 100 の倍数（big）は ghostrider 優先で、ズームは fast
  await expect(page.locator('body')).toHaveAttribute('data-cage-pattern', 'ghostrider');
  await expect(page.locator('body')).toHaveAttribute('data-cage-zoom', 'fast');
  // ケージのポップが出て、コンボ数とセリフが入っている（100 なので一段大きい big）
  await expect(page.locator('#cage-pop')).toBeVisible();
  await expect(page.locator('#cage-pop')).toHaveClass(/big/);
  await expect(page.locator('#cage-combo-num')).toHaveText('100');
  await expect(page.locator('#cage-line')).not.toHaveText('');
  await page.evaluate(() => {
    const w = window as unknown as { __pwaTest?: { setCombo?: (n: number) => void } };
    w.__pwaTest?.setCombo?.(30);
  });
  await expect(page.locator('body')).toHaveAttribute('data-combo-tier', '2');
  await expect(page.locator('body')).toHaveAttribute('data-cage', '30');
  // 2回目の登場はローテーションの2番目（faceoff）になる
  await expect(page.locator('body')).toHaveAttribute('data-cage-pattern', 'faceoff');
  await expect(page.locator('#cage-combo-num')).toHaveText('30');
});

test('演奏中に歌詞が表示される（現在の行が曲に合わせて出る）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  // READY（2秒）のあと曲が進む。石畳のハイウェイの歌詞は曲頭からあるので、
  // 現在の行に文字が出て、行インデックスが -1 でなくなる
  await expect(page.locator('#lyric-current')).not.toHaveText('', { timeout: 20_000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-lyric-index', '-1');
});

test('manifest と Service Worker が使える', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

test('更新バナーは通常は隠れている', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('更新バナーは「あとで」で閉じられる', async ({ page }) => {
  await page.goto('/');
  // 新しい版がある状態は作れないので、バナーを直接出して確かめる
  await page.evaluate(() => {
    document.getElementById('update-banner')!.hidden = false;
  });
  await page.getByRole('button', { name: 'あとで' }).click();
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('最初の画面からインストール方法を開ける（使っている端末の説明が開いている）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /インストールする方法/ }).click();
  const dialog = page.locator('#install-dialog');
  await expect(dialog).toBeVisible();
  // Pixel 7 のプロファイルなので Android の説明が開いている
  await expect(dialog.locator('details[data-platform="android"]')).toHaveJSProperty('open', true);
  await expect(dialog.locator('details[data-platform="ios"]')).toHaveJSProperty('open', false);
  await expect(dialog.getByText('ホーム画面に追加', { exact: false }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'とじる' }).click();
  await expect(dialog).toBeHidden();
});

test('最初の画面にバージョンが表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#version')).toHaveText(/^\d+\.\d+\.\d+$/);
});

test('起動できないときは「なおす」ボタンが出て、押すと起動できる（記録と、ほかのアプリのキャッシュは消えない）', async ({ page }) => {
  await page.addInitScript((id) => {
    (window as unknown as { __bootWaitMs: number }).__bootWaitMs = 500;
    // 1回目の自動修復は済んだことにして、ボタンが出る側の動きを確かめる
    sessionStorage.setItem(`${id}:repaired-at`, String(Date.now()));
    if (!localStorage.getItem(`${id}-offset`)) localStorage.setItem(`${id}-offset`, '30');
  }, APP_ID);
  // 同じサイトにある、ほかのアプリのキャッシュ（なおすときに消えてはいけない）を用意する
  await page.goto('/');
  await page.evaluate(async () => {
    await caches.open('other-app-v1');
  });
  // メインのスクリプトが読み込めない状況を作る
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#boot-error')).toBeVisible();

  await page.unroute('**/assets/*.js');
  await page.getByRole('button', { name: 'なおす' }).click();
  await openSettings(page);
  await expect(page.locator('#offset-value')).toHaveText('+30ms');
  await expect(page.locator('#boot-error')).toBeHidden();
  // このアプリのキャッシュだけが作り直され、ほかのアプリのキャッシュは残っている
  expect(await page.evaluate(() => caches.has('other-app-v1'))).toBe(true);
});

test('テスト用の入口: ?debug=1 で状態を読めて、data 属性にも出ている', async ({ page }) => {
  await page.goto('/?debug=1');
  const state = await page.evaluate(() => {
    const api = (window as unknown as { __pwaTest?: { getState?: () => unknown } }).__pwaTest;
    return api?.getState?.() as { song: string; difficulty: string; offset: number };
  });
  expect(state.song).toBe('highway');
  expect(state.difficulty).toBe('easy');
  await page.evaluate(() => {
    const api = (window as unknown as { __pwaTest?: { setState?: (patch: Record<string, unknown>) => void } }).__pwaTest;
    api?.setState?.({ song: 'night', difficulty: 'hard', offset: 50 });
  });
  await expect(page.locator('body')).toHaveAttribute('data-song', 'night');
  await openSettings(page);
  await expect(page.locator('#offset-value')).toHaveText('+50ms');
});

test('テスト用の入口は、?debug=1 でないときは出ない', async ({ page }) => {
  await page.goto('/');
  const exposed = await page.evaluate(() => (window as unknown as { __pwaTest?: unknown }).__pwaTest !== undefined);
  expect(exposed).toBe(false);
});

test('設定のデバッグモードでオートプレイでき、結果がベストスコアに残らない', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  // デバッグモードがオフのあいだは、オートプレイの項目は出ていない
  const debugButton = page.locator('#debug-button');
  await expect(debugButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#autoplay-block')).toBeHidden();
  await debugButton.click();
  await expect(debugButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#autoplay-block')).toBeVisible();
  const autoplayButton = page.locator('#autoplay-button');
  await autoplayButton.click();
  await expect(autoplayButton).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-close-bottom').click();
  await expect(page.locator('#settings-dialog')).toBeHidden();

  // 設定は保存されている（開き直しても戻らない）
  await page.reload();
  await openSettings(page);
  await expect(page.locator('#debug-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#autoplay-button')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#settings-close-bottom').click();

  // 途中で結果へ進むために、デバッグパネル（バージョン5回タップ）も出しておく
  for (let i = 0; i < 5; i++) await page.locator('#version-line').click();
  await expect(page.locator('#debug-panel')).toBeVisible();

  await page.getByRole('button', { name: 'スタート' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-game', 'playing', { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-autoplay', 'on');
  // 入力していないのに、オートプレイでスコアとコンボが自動で伸びる
  await expect(page.locator('body')).not.toHaveAttribute('data-score', '0', { timeout: 30_000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-combo', '0');

  // 結果へ進む。オートプレイの印が出て、ベストスコアは 0 のまま（保存されていない）
  await page.getByRole('button', { name: 'プレイ中なら、いまの成績で結果画面へ進む' }).click();
  await expect(page.locator('#result-screen')).toBeVisible();
  await expect(page.locator('#result-autoplay')).toBeVisible();
  await expect(page.locator('#result-autoplay')).toHaveText('オートプレイ');
  await expect(page.locator('#result-best')).toHaveText('0');
  await page.locator('#back-button').click();
  await openSettings(page);
  await expect(page.locator('#menu-best')).toHaveText('0');
});

test('デバッグモード: バージョンを 5 回タップで操作パネルが出る', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#debug-panel');
  await expect(panel).toBeHidden();
  for (let i = 0; i < 5; i++) await page.locator('#version-line').click();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'デバッグモードを終える' }).click();
  await expect(panel).toBeHidden();
});

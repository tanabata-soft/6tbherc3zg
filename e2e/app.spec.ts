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
  await expect(page.getByRole('heading', { name: '木曽ケイジビート' })).toBeVisible();
  await expect(page.getByText('ニコラスケイジと木曽と私')).toBeVisible();
  await expect(page.locator('.song-card')).toHaveCount(2);
  await expect(page.locator('body')).toHaveAttribute('data-song', 'highway');

  await page.locator('.song-card[data-song="night"]').click();
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

test('ヒーロー表示が、選んだ曲に切り替わる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText('石畳のハイウェイ');
  await expect(page.locator('#hero-jacket')).toHaveAttribute('data-song', 'highway');
  await expect(page.locator('#hero-bpm')).toContainText('BPM');

  await page.locator('.song-card[data-song="night"]').click();
  await expect(page.locator('#hero-title')).toHaveText('Kiso Night Silhouette');
  await expect(page.locator('#hero-jacket')).toHaveAttribute('data-song', 'night');
  await expect(page.locator('#hero-album')).toHaveText('Silver Screen Ascent');
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
    await page.goto('/');
    // 効果音の発火（連続音の開始・完走音）も app:sound イベントで確かめる
    await page.evaluate(() => {
      const w = window as unknown as { __sounds: { kind?: string }[] };
      w.__sounds = [];
      document.addEventListener('app:sound', (e) => w.__sounds.push((e as CustomEvent).detail));
    });
    // playing になった瞬間を起点に、頭の前後でキーを繰り返し押して押し続ける（keyup しない）。
    // 曲の時刻は playing の 2 秒後（READY）から進む前提。音声の開始が遅れても
    // 判定窓（±160ms）にどれか1回が入るよう、頭の 300ms 前〜900ms 後まで 100ms ごとに送る
    // （長押し中は同じレーンに他のノーツがないので、余分な押下は無害）。
    await page.evaluate((h) => {
      const key = ['d', 'f', 'j', 'k'][h.lane];
      const obs = new MutationObserver(() => {
        if (document.body.dataset.game === 'playing') {
          obs.disconnect();
          window.setTimeout(() => {
            let n = 0;
            const iv = window.setInterval(() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key }));
              if (++n >= 13 || document.body.dataset.holdsCompleted === '1') window.clearInterval(iv);
            }, 100);
          }, 2000 + h.t - 300);
        }
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-game'] });
    }, hold);
    await page.getByRole('button', { name: 'スタート' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-holds-completed', '1', { timeout: 30_000 });
    // 長押し中は連続音が鳴り始め、押し切ったら完走音が鳴る。拍 tick の音は出ない
    const kinds = await page.evaluate(() =>
      (window as unknown as { __sounds: { kind?: string }[] }).__sounds.map((s) => s.kind),
    );
    expect(kinds).toContain('hold-start');
    expect(kinds).toContain('complete');
    expect(kinds).not.toContain('tick');
  });

  test('長押しの帯が尾まで見え続ける（尾の間際まで帯が届く）', async ({ page }) => {
    // v1.7.1 の不具合修正の確認: 帯の描画を頭の仮想位置で打ち切っていたため、
    // 尾がラインに届く前に帯が消えていた（実測では帯の上端がラインの約129px 手前で停止）。
    // 完走するまでの間、帯の上端（＝尾）が判定ラインの 60px 以内まで近づくことを見る。
    // 時刻ではなく空間で見るので、実時間テストの時計の寄れに左右されない。
    const charts = JSON.parse(readFileSync(new URL('../src/data/charts.json', import.meta.url), 'utf8')) as {
      highway: { charts: { easy: [number, number, number?][] } };
    };
    const first = charts.highway.charts.easy.find((n) => (n[2] ?? 0) > 0);
    if (!first) throw new Error('長押しが譜面にありません');
    const hold = { t: first[0], lane: first[1], tail: first[0] + (first[2] ?? 0) };
    const LANE_HEX = ['#ff6b6b', '#ffd166', '#4ecdc4', '#6c8cff'];
    const rgb = [1, 3, 5].map((i) => parseInt((LANE_HEX[hold.lane] ?? '#ffffff').slice(i, i + 2), 16));
    await page.goto('/');
    const sampling = page.evaluate(
      ({ h, rgb }) => {
        return new Promise<{ minGap: number }>((resolve) => {
          const done = { minGap: -1 };
          const obs = new MutationObserver(() => {
            if (document.body.dataset.game !== 'playing') return;
            obs.disconnect();
            const t0 = performance.now();
            // 頭ヒットを確実にするため、頭より十分前（曲の 3 秒）から 50ms ごとに
            // キーを流し続ける（タイマーが負荷で寄れても、どれかは判定窓に入る）。
            // 完走するか、尾を過ぎたら止める。途中の同じレーンのタップノーツに
            // 当たっても無害（長押し中は同じレーンに他のノーツはない）。
            const spam = window.setInterval(() => {
              const songMs = performance.now() - t0 - 2000;
              if (songMs >= 3000) {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: ['d', 'f', 'j', 'k'][h.lane] }));
              }
              if (document.body.dataset.holdsCompleted === '1' || songMs > h.tail + 500) {
                window.clearInterval(spam);
              }
            }, 50);
            const cv = document.getElementById('game-canvas') as HTMLCanvasElement;
            const cg = cv.getContext('2d');
            // レーン中央付近の3列で、判定ラインの 20px 上より上にある最初のレーン色
            // ピクセルを探し、ラインまでの距離（CSS px）の最小値を記録する。
            // 判定枠の上端（ラインの 14px 上）は混ざるので走査から外す。
            // 読み取りは列単位（全画面コピーはメインスレッドを圧迫するのでしない）。
            const topGapCss = (): number => {
              if (!cg || cv.width === 0) return -1;
              const dsf = cv.height / cv.clientHeight;
              const lw = cv.width / 4;
              const cx = h.lane * lw + lw / 2;
              const hyDev = cv.height * 0.82;
              const yLimit = hyDev - 20 * dsf;
              let best = -1;
              for (const x of [cx - lw * 0.12, cx, cx + lw * 0.12]) {
                const img = cg.getImageData(Math.floor(x), 0, 1, cv.height).data;
                for (let y = 0; y < yLimit; y++) {
                  const r = img[y * 4];
                  const g = img[y * 4 + 1];
                  const b = img[y * 4 + 2];
                  if (Math.abs(r - rgb[0]) < 70 && Math.abs(g - rgb[1]) < 70 && Math.abs(b - rgb[2]) < 70) {
                    const gap = (hyDev - y) / dsf;
                    if (best < 0 || gap < best) best = gap;
                    break;
                  }
                }
              }
              return best;
            };
            let frame = 0;
            const tick = () => {
              const songMs = performance.now() - t0 - 2000;
              const completed = document.body.dataset.holdsCompleted === '1';
              // 読み取りは1フレームおき（負荷を抑える）
              if (!completed && songMs >= 4800 && frame++ % 2 === 0) {
                const gap = topGapCss();
                if (gap >= 0 && (done.minGap < 0 || gap < done.minGap)) done.minGap = gap;
              }
              if (completed || songMs > h.tail + 1500) {
                resolve(done);
                return;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
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

test('デバッグモード: バージョンを 5 回タップで操作パネルが出る', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#debug-panel');
  await expect(panel).toBeHidden();
  for (let i = 0; i < 5; i++) await page.locator('#version-line').click();
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'デバッグモードを終える' }).click();
  await expect(panel).toBeHidden();
});

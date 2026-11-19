// 画面の一括撮影: 主な画面を、スマホの幅・小さい画面（iPhone SE）・ダークモードで撮って、shots/ に保存する。
// 「画面を変えたら、実際に表示して確認する」（CLAUDE.md）を、コマンド 1 つでできるようにするため。
// 使い方: npm run shots（build してから撮る）→ shots/<大きさ>-<画面>.png と、全部を並べた shots/all.png
// 画面を足すときは、下の SCREENS に足す（open で、その画面まで操作する）。
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdirSync, rmSync } from 'node:fs';

/** 撮る画面。open は、ページを開いたあと、その画面を出すための操作。 */
const SCREENS = [
  { name: 'home' },
  {
    name: 'settings',
    open: async (page) => {
      // 設定ボタンはメニュー下部のフッターにあるので、スクロールしてから押す
      await page.locator('#settings-open').scrollIntoViewIfNeeded();
      await page.click('#settings-open');
    },
  },
  { name: 'install', open: async (page) => page.click('#install-open') },
  {
    name: 'game',
    open: async (page) => {
      await page.click('#start-button');
      await page.waitForFunction("document.body.dataset.game === 'playing'", null, { timeout: 30_000 });
      // READY（2秒）＋曲の約5.3秒地点: 最初の長押し（5.6秒・レーン0）の帯が
      // 頭から尾まで画面に入っている頃合い
      await page.waitForTimeout(7300);
    },
  },
  {
    // コンボ連動エフェクトの確認用: テスト用の入口（?debug=1）でコンボを 100 にして、
    // 最高 tier のコンボ表示とケージ登場（100 の倍数＝一段大きい登場）を撮る
    name: 'game-combo',
    open: async (page) => {
      await page.goto(url + '?debug=1');
      await page.waitForFunction(() => globalThis.__appStarted === true);
      await page.click('#start-button');
      await page.waitForFunction("document.body.dataset.game === 'playing'", null, { timeout: 30_000 });
      await page.evaluate(() => globalThis.__pwaTest.setCombo(100));
      // ケージのポップ（約1.25秒）が出ているうちに撮る
      await page.waitForTimeout(250);
    },
  },
];

/** 撮る大きさ。dark はダークモード（端末設定に従う配色のアプリで確認する）。 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'se', width: 375, height: 667 },
  { name: 'phone-dark', width: 390, height: 844, dark: true },
];

const OUT = 'shots';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4174/';
// CHROMIUM_PATH: Playwright のブラウザを入れていない環境で、入っている Chromium を使うとき（ふつうは不要。`npx playwright install chromium`）
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const files = [];
try {
  for (const size of SIZES) {
    // Service Worker は止める（前の撮影のキャッシュが残らないように）。アニメーションは止めて、毎回同じ絵にする
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      colorScheme: size.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    for (const screen of SCREENS) {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${size.name}/${screen.name}: ${e.message}`));
      await page.goto(url);
      await page.waitForFunction(() => globalThis.__appStarted === true);
      if (screen.open) await screen.open(page);
      await page.waitForTimeout(300);
      const file = `${OUT}/${size.name}-${screen.name}.png`;
      await page.screenshot({ path: file });
      files.push(file);
      await page.close();
    }
    await context.close();
  }
  // 全部を 1 枚に並べる（行 = 大きさ、列 = 画面）。見比べやすいように
  const page = await browser.newPage({ viewport: { width: 400 * SCREENS.length, height: 900 } });
  const { readFileSync } = await import('node:fs');
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const rows = SIZES.map((s) => `<tr><th>${s.name}</th>${SCREENS.map((sc) => `<td><img src="${img(`${OUT}/${s.name}-${sc.name}.png`)}" width="${s.width}"><br>${sc.name}</td>`).join('')}</tr>`).join('');
  await page.setContent(`<style>body{margin:8px;font:14px sans-serif;background:#888}td{vertical-align:top;text-align:center;padding:4px}img{border:1px solid #333}</style><table>${rows}</table>`);
  await page.screenshot({ path: `${OUT}/all.png`, fullPage: true });
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

console.log(`${files.length} 枚を ${OUT}/ に保存した（一覧: ${OUT}/all.png）`);
if (errors.length) {
  console.error(`画面でエラーが出た:\n${errors.join('\n')}`);
  process.exit(1);
}

// 内容の整合チェックの中身（scripts/check-content.mjs から呼ばれる）。
// 正本と派生物が食い違っていないかを確かめる検査を、ここに { id, title, run } で足す。
// run はエラーの文言の配列を返す（問題がなければ空）。ctx.root はリポジトリのルートのパス。
// 例（データ駆動のアプリ）: 物語データ ⇔ 読み上げ文・ルビ・音声ファイルの対応、到達できない場面や結末の検出、件数・重複・必須項目。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
/** `const 名前 = '値'` の形で書かれた文字列を取り出す（vite.config.ts の設定用） */
const constString = (text, name) => new RegExp(`const ${name} = '([^']*)'`).exec(text)?.[1];

export const checks = [
  {
    id: 'app-name',
    title: 'アプリ名が vite.config.ts と index.html でそろっている',
    // アプリ名は vite.config.ts の APP_NAME と index.html の2か所に書く決まり（vite.config.ts のコメント参照）。
    // 片方だけ書き換える事故を防ぐ。
    run({ root }) {
      const name = constString(read(root, 'vite.config.ts'), 'APP_NAME');
      if (!name) return ['vite.config.ts に APP_NAME が見つかりません'];
      const html = read(root, 'index.html');
      const errors = [];
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      if (title !== name) errors.push(`index.html の <title>（${title}）が APP_NAME（${name}）と違います`);
      const appleTitle = /name="apple-mobile-web-app-title" content="([^"]*)"/.exec(html)?.[1];
      if (appleTitle !== name) errors.push(`index.html の apple-mobile-web-app-title（${appleTitle}）が APP_NAME（${name}）と違います`);
      return errors;
    },
  },
  {
    id: 'theme-color',
    title: 'テーマカラーが vite.config.ts と index.html でそろっている',
    run({ root }) {
      const color = constString(read(root, 'vite.config.ts'), 'THEME_COLOR');
      if (!color) return ['vite.config.ts に THEME_COLOR が見つかりません'];
      const html = read(root, 'index.html');
      const meta = /name="theme-color" content="([^"]*)"/.exec(html)?.[1];
      return meta === color ? [] : [`index.html の theme-color（${meta}）が THEME_COLOR（${color}）と違います`];
    },
  },
  {
    id: 'charts-assets',
    title: '譜面データ（charts.json）と音源・ジャケット素材が対応している',
    // 正本は src/data/charts.json（scripts/generate-charts.py が生成）。曲IDに対応する素材ファイルが src/assets にあることを確かめる。
    run({ root }) {
      const errors = [];
      let charts;
      try {
        charts = JSON.parse(read(root, 'src/data/charts.json'));
      } catch {
        return ['src/data/charts.json が読めません'];
      }
      for (const id of Object.keys(charts)) {
        for (const ext of ['mp3', 'jpg']) {
          if (!existsSync(join(root, `src/assets/${id}.${ext}`))) errors.push(`src/assets/${id}.${ext} がありません（曲 ${id}）`);
        }
        const song = charts[id];
        for (const diff of ['easy', 'normal', 'hard']) {
          if (!Array.isArray(song.charts?.[diff]) || song.charts[diff].length === 0) errors.push(`曲 ${id} の ${diff} 譜面がありません`);
        }
      }
      return errors;
    },
  },
];

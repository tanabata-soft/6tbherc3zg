# 木曽ケイジビート

木曽を歌う2曲で遊ぶ、4レーン落下式のリズムゲーム（PWA）。副題は「ニコラスケイジと木曽と私」。元は単体HTMLのゲームで、PWAテンプレート（Vite + TypeScript + vite-plugin-pwa）で作り直したものです（v1.1.0 までは『木曽リズムゲーム』という名前でした）。

- 公開 URL: https://tanabata-soft.github.io/6tbherc3zg/
- バージョン: v1.3.0

## 収録曲

| 曲 | アルバム | BPM（実測） | 長さ |
|---|---|---|---|
| 石畳のハイウェイ | 銀の谷間のダンスフロア | 136 | 3:00 |
| Kiso Night Silhouette | Silver Screen Ascent | 152 | 3:00 |

どちらも 90s J-Pop / Eurobeat。曲・ジャケット絵はオーナーの所有物（AI生成曲とそのジャケット）で、このアプリのために提供されたものです。

## 遊び方

1. 曲と難易度（かんたん／ふつう／むずかしい）を選んで「スタート」
2. ノーツが下の枠に重なったらタップ（パソコンは D / F / J / K キー）。長い帯のノーツは長押し: 頭をタップしたら、帯が終わるまで押しっぱなしにする（1拍ごとに小さいスコア、押し切るとボーナス。途中で離しても 100ms 以内に押し直せばセーフ）
3. 判定は PERFECT ±50ms／GREAT ±100ms／GOOD ±160ms。サビは FEVER 区間でスコア2倍
4. 左上の ✕ で中断してメニューに戻れます。プレイ中に画面を隠しても中断になります（裏で進んで大量MISSにはなりません）

タイミング調整（オフセット ±200ms）とベストスコアは、メニュー下部の「設定」ボタンから開く設定モーダルで変更・確認でき、ベストスコアは曲×難易度ごとに端末へ保存されます。記録の保存は端末の中だけです（ファイルへの書き出し／読み込みは、オーナー判断で付けていません）。

ヒットしたときは、判定で音が変わる打撃音（Web Audio で合成）と、対応端末では短い振動で手応えを返します。どちらも設定モーダルでオン/オフでき、設定も記録に含まれます。ノーツの弾ける演出や判定文字の動きは、画面のリフレッシュレートによらず同じ見え方になるよう経過時間で進めています。

ホーム画面に追加するとアプリとして起動でき、オフラインでも遊べます（曲の音源も端末に保存されます）。

## 開発

```bash
npm ci
npm run dev          # 開発サーバー
npm run verify       # lint → test → build → check:dist → check:content
npm run test:e2e     # Playwright（初回は npx playwright install chromium）
npm run shots        # 画面の一括撮影（shots/）
npm run build:preview # 単体HTMLプレビュー（dist-preview/preview.html）
npm run icons        # アイコン再生成（要 ffmpeg。ジャケット絵が元）
```

ルールの詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

### 譜面の作り直し

譜面（`src/data/charts.json`）は音源解析で自動生成しています。手で編集せず、生成スクリプトを再実行してください。

```bash
python3 -m venv .venv && .venv/bin/pip install librosa   # 初回だけ
.venv/bin/python scripts/generate-charts.py
```

ビートグリッド（拍／8分／16分）にオンセット強度の強い位置を割り当て、レーンは音高の四分位で分散させています。FEVER 区間は歌詞字幕のサビ位置と音量（RMS）の盛り上がりから決めています。

## ファイル構成

- `src/logic.ts` — 判定・スコア・精度・ランク・譜面検証（純関数、単体テスト対象）
- `src/game.ts` — Canvas 描画と入力、演奏の進行
- `src/audio.ts` — 曲のデコード保持と再生（再プレイで再デコードしない）。iPhone 対策として Audio Session の 'playback' 設定と unlock（ジェスチャ内での resume＋無音バッファ再生）、曲・効果音共通のマスター GainNode もここ
- `src/charts.ts` / `src/data/charts.json` — 曲と譜面のデータ
- `src/assets/` — 音源（MP3）とジャケット絵
- `src/main.ts` — メニュー／結果画面などの DOM
- `src/sound.ts` — ヒット音（Web Audio 合成。曲と同じ AudioContext を使う）
- `src/haptics.ts` — ヒット時の振動（navigator.vibrate、対応端末のみ）
- そのほか PWA の土台（保存・更新・インストール案内・起動失敗の復旧）はテンプレート由来

## デバッグモード

バージョンの表示（例: v1.3.0）を続けて 5 回タップすると、左下に操作パネル（DEBUG）が出ます。「結果へ」で、プレイ中ならその時点の成績で結果画面へ進めます。もう一度 5 回タップするか、パネルの「終了」で消えます。

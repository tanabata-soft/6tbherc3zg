# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

PWA アプリ(ツール/ゲーム)の共通テンプレート。**新しいアプリはこのテンプレートから作り、下の共通ルールを守る。**

## このアプリの方針(新規作成時に記入)

- アプリの ID(`package.json` の `name`。**ほかのアプリと別の名前**にする。下の「同じサイトに載るアプリ」を参照): `kiso-rhythm-game`（**表示名を変更しても ID は変えない**。保存データのキーとキャッシュの互換が切れるため）
- アプリ名（表示名）: 『キソケイジビート』（副題: ニコラスケイジと木曽と私）。v1.8.5 までは『木曽ケイジビート』、v1.1.0 までは『木曽リズムゲーム』だった。表示名は `vite.config.ts` の `APP_NAME` と `index.html` の2か所。
- アプリの概要: 木曽を歌う2曲（『石畳のハイウェイ』『Kiso Night Silhouette』）で遊ぶ、4レーン落下式のリズムゲーム。元は単体HTML版で、2026-11-19 にこのテンプレートで PWA 化した。
- 配色: 暗い固定（ジャケット絵の深い紺〜ネオンピンクに合わせる。`color-scheme: dark only`、theme-color `#0b0e1d`）
- 公開 URL: https://tanabata-soft.github.io/6tbherc3zg/
- 追加した拡張: なし（UI フレームワーク等は入れていない）。譜面生成だけ Python（librosa）を使う（`scripts/generate-charts.py`、実行環境は `.venv/`、アプリ本体には含まれない）

### このアプリ固有の決まり

- ゲーム仕様の正本は `src/logic.ts`（判定幅・スコア・精度・ランク）と `src/data/charts.json`（譜面）。
- 譜面は手で直さない。`scripts/generate-charts.py` を再実行して作り直す（v4方式: 実測拍列に沿せた16分スロット＋スナップ±38ms、フレーズ単位のパターン割り当てとサビのモチーフ再登場、強い拍への同時押し、持続音への長押し、密度は小節エネルギー連動、難易度は入れ子 hard ⊇ normal ⊇ easy、FEVER は歌詞字幕のサビ位置＋RMS。v1.9.0 から両親指前提のハード制約を追加し、正本は `scripts/check-two-thumb.py`（同時押しは左右ペアだけ、長押しの帯は反対側だけ、16分で同側3連なし、片手トリルは短区間のみ）。生成時に自動検証され、違反があれば書き出されない。設計の根拠は `docs/CHART-DESIGN.md`）。**固定間隔グリッド（位相＋周期の中央値）に戻さない**（周期の推定誤差が累積して拍と回転ズレするため。v1.4.0 で廃止）。
- 音源は MP3（`src/assets/*.mp3`）。AAC/m4a はヘッドレス Chromium がデコードできず E2E が成立しないため使わない。iPhone Safari は MP3 の decodeAudioData に対応する。
- 音源は v1.6.0 から音ゲー用ショート編集（イントロ→1番→サビで終わる編集版）。全長版は `assets-full/` に保管し、dist には入れない。全長版に戻すときは FEVER 区間も全長版の値に戻す（手順は `assets-full/README.md`）。
- **記録のバックアップ機能（ファイルへの書き出し / 読み込み）は、v1.3.0 でオーナー判断により削除した**（テンプレート標準からの意図的な逸脱）。**再追加しない。** 保存は端末内（localStorage）だけ。保存データの版番号（`SCHEMA_VERSION`）は `src/storage.ts` が持つ。
- 音源・ジャケットは `src/assets/` から import する（dist では assets として出力され precache に入る。build:preview では data URI 化される）。public/ に直置きしない。

## 基本方針

- オーナーは Claude Code での開発を学習中。変更は小さく、理由を添えて説明する。
- **実装の前に、要望の解釈を見せて、OK をもらってから進める。** 要望を受けたら、次の4つを短く示す: ①**解釈**（要望をどう受け取ったか、1〜3 行）②**やること / やらないこと**（変える範囲と、変えない範囲）③**決めた仮定**（曖昧なところに置く仮の答え。数値・名前・表示の場所など）④**確認したいこと**（なければ「なし」）。OK が出てから実装に入る。
  - **④ の確認したいことは、選択式（AskUserQuestion のボタン）で聞く**（オーナーがタッチで選んで、すぐ進められるように。おすすめを最初に置き「(Recommended)」を付ける。①〜③ は文章で短く示す）。選択式が使えないときは、「1. ○○ / 2. △△」と番号で並べて、番号で答えてもらう。
  - 例外（確認せずに進める）: 誤字の修正など解釈の余地がないもの、「そのまま進めて」と言われたとき、「マージして」「PR を作って」のような手順の指示。
- **アプリの動作・見た目が変わる実装をしたら、作業中の状態をプレビュー（Artifact）に置いて、リンクを報告に載せる。** 実装のたびに置き直し、オーナーがすぐに触って確認できるようにする。
  - `npm run build:preview` で、アプリを 1 つの HTML（`dist-preview/preview.html`）にまとめて、それを置く（画像・音・アイコンも中に入る。Service Worker は登録しない）。
  - プレビューは、本番とは別のコピーで、保存データも別。マージしたら、最新の `main` を置き直す。
  - ドキュメント（`CLAUDE.md`・README）・テスト・ツール・依存パッケージだけの変更は、置かなくてよい。
- ユーザー向けの文言・説明は日本語。コードの識別子とコミットメッセージは英語(命令形、1コミット1目的)。
- 作業は feature ブランチ → PR → CI が通ったら main にマージ。main に直接 push しない。
- **作業の状態は `docs/HANDOVER.md`(引き継ぎメモ)に残す。** 作業を始めるときに読み、区切りで書き直す(会話の記憶は途中で消えることがあるため)。
- **PR は1つの目的にする。** 他の PR の上に積まない(積むと、マージの順序と向き先の管理が大変になる)。どうしても積むときは、PR の本文に「どの PR の上か」を書き、下の PR から順にマージする。
- **デフォルトブランチは `main`。** `claude/...` などの作業ブランチを既定にしない(公開や CI の対象がずれるため)。
- 配信は GitHub Pages(サブパス配信)。参照パスは相対(`./`)にし、`/` から始めない。

## 技術スタック

Vite + TypeScript + vite-plugin-pwa + Vitest + Playwright + ESLint。UI フレームワークやバックエンドは**必要になるまで入れない**(入れたら上の「追加した拡張」に理由を書く)。

| やりたいこと | コマンド |
|---|---|
| 開発サーバー | `npm run dev` |
| 型チェック + ビルド | `npm run build`(成果物は `dist/`) |
| Lint | `npm run lint` |
| 単体テスト | `npm test` |
| 画面テスト | `npm run test:e2e`(初回は `npx playwright install chromium`) |
| PWA 成立チェック | `npm run check:dist`(build のあと) |
| 内容の整合チェック | `npm run check:content`(正本と派生物の食い違い。検査は `scripts/content-checks.mjs` に足す) |
| まとめて確認 | `npm run verify`(lint → test → build → check:dist → check:content) |
| アイコン再生成 | `npm run icons`(色・形は `scripts/make-icons.mjs` を編集) |
| 画面の一括撮影 | `npm run shots`(`shots/` に、スマホの幅・iPhone SE・ダークモードで撮る。一覧は `shots/all.png`) |
| プレビュー(1 つの HTML) | `npm run build:preview`(`dist-preview/preview.html`。作業中の状態を Artifact に置くとき) |

**変更を終える前に `npm run verify` を通す。** 画面に関わる変更は `npm run test:e2e` も通し、`npm run dev` で実際に動かして確認する。

## 構成

- `src/logic.ts`: ルール・計算。DOM に触れない純関数にして `tests/` で単体テストする。**DOM・時刻(`Date`・`performance`)・乱数(`Math.random`)に触れず、アプリのほかの層を import しないことは、ESLint が強制する**(`eslint.config.js`。対象は `src/logic.ts` と、ロジックが増えたときの `src/logic/`)。強制が効いていること自体は `tests/layer-rules.test.ts` が確かめる。
- `src/main.ts`: DOM の操作だけ。`src/sound.ts`(効果音)、`src/storage.ts`(保存)、`src/pwa.ts`(更新ボタン)、`src/install.ts`(インストール方法の説明)、`src/debug.ts`(デバッグモード)。
- `vite.config.ts`: アプリ名・色・manifest。`index.html` の `theme-color`・タイトルと合わせて書き換える。
- `scripts/check-dist.mjs`: ビルド成果物が PWA として成立しているかの検査。
- `scripts/check-content.mjs` / `scripts/content-checks.mjs`: 内容の整合チェックの枠組みと中身。**正本のデータと、その派生物(コピー・生成物・2か所に書く設定など)が食い違っていないか**を確かめる。検査は `content-checks.mjs` に `{ id, title, run }`(run はエラーの文言の配列を返す)で足す。テンプレートには、アプリ名とテーマカラー(vite.config.ts と index.html の2か所に書く決まり)の一致という見本が入っている。データ駆動のアプリは、データの検証テスト(単体テスト)に加えて、この整合チェックにも検査を足す(例: 物語データ ⇔ 読み上げ文・ルビ・音声ファイルの対応、到達できない場面や結末の検出)。どちらのファイルが正本かを先に決めてから書く。
- `scripts/shots.mjs`: 画面の一括撮影。**画面を足したら、`SCREENS` に足す**(`open` で、その画面まで操作する)。
- `scripts/build-preview.mjs`: プレビュー用に、アプリを 1 つの HTML にまとめる(本番の `dist/` とは別)。
- 画面の部品や機能を足すときは、ファイルを `src/` に分ける。Service Worker のファイル一覧は**自動生成**なので手で更新しない。

## PWA 要件(完了の定義)

- インストール可能(manifest、192/512 アイコン、**本物の maskable**、apple-touch-icon)。`npm run check:dist` が通ること。
- オフラインで起動して遊べる。
- **最初の画面(タイトル/ホーム)に、インストール方法の説明への入口を置く。** iPhone は自動のインストール案内が出ないため、手順を見せる必要がある。
  - iPhone / iPad(Safari: 共有 → ホーム画面に追加)、Android(Chrome: メニュー → アプリをインストール)、パソコン(Chrome / Edge: アドレスバーのインストールのマーク)の3つの手順を載せ、今使っている端末の説明を最初から開いておく。
  - Android / パソコンで `beforeinstallprompt` が使えるときは「今すぐインストール」ボタンも出す。
  - すでにインストールされて開いている(`display-mode: standalone`)ときは、入口を出さない。
  - テンプレートの `src/install.ts` と `index.html` の `#install-open` / `#install-dialog` を使う。`npm run check:dist` が入口の有無を確認する。
- 更新は**「更新」ボタン方式**(`registerType: 'prompt'`)。プレイ中に勝手に切り替えない。「あとで」で閉じられる(次に開いたとき、また出る)。開いたときに加えて、**アプリが前面に戻ったときにも新しい版を確かめる**(ホーム画面アプリは裏で開いたままのことが多く、開いたときだけだと古い版のままになる。`src/pwa.ts`)。
- **タイトル画面(最初の画面)にバージョンを表示する**(例: `v0.1.0`)。更新が反映されたかを、利用者がひと目で確認できるようにするため。
  - バージョンの元は `package.json` の `version` の1か所(`vite.config.ts` が `__APP_VERSION__` として埋め込み、`index.html` の `#version` に表示する)。
  - 公開のたびに `version` を上げる。Service Worker のキャッシュ名は自動生成なので、手で合わせる番号はない。
  - `npm run check:dist` が `#version` の有無を確認する。
- ユーザーデータは `src/storage.ts` 経由(`localStorage` を `try/catch` で囲む)。**保存キー名は変更しない**(記録が消える)。
  - **保存データには版番号(`schemaVersion`、`src/storage.ts` の `SCHEMA_VERSION`)を持たせる。** 保存の形を変えるときは版を上げ、`src/storage.ts` の `migrate()` に移行処理を書く(キー名を変えたまま古い記録を捨てない)。
  - テンプレート標準では「記録を残すアプリは、ファイルへの書き出し / 読み込み(記録のバックアップ)を用意する」が、**このアプリではオーナー判断で削除済み(上の「このアプリ固有の決まり」参照)。再追加しない。**
  - **保存する対象が増えたら(設定・ランキングなど)、対象ごとに store を分ける。** 作法は次のとおり(今の `src/storage.ts` / `src/backup.ts` の分け方を、対象ごとに繰り返す形):
    - `Storage` と現在時刻(`now: () => Date`)は外から渡し、単体テストで差し替えられるようにする(中で `localStorage` や `new Date()` を直接触らない)。
    - 保存の形には、アプリの ID と版(`version`)を持たせる(バックアップファイルの `app` と `schemaVersion` と同じ考え方)。
    - 形が合わない・壊れているデータは「空 / 既定値」として読み、**読み込みのときに保存し直さない**(壊れたデータを既定値で上書きすると、あとから直す手がかりまで消える)。
    - ファイルからの読み込みを作る場合は、「検証だけをする関数(今の記録は変えない)」と「確認後に置き換える関数」を分ける(このアプリではバックアップ自体を削除済みなので、作法だけ残す)。
    - 参照実装: このテンプレートから作られた『ギャラクシーウォーズミニ』の `src/storage/ranking-store.ts` / `settings-store.ts`(https://github.com/tsuku3dayo/mini-galaxywars-game/tree/main/src/storage)。単体テスト付きで、この作法どおりに書かれている。
- **起動に失敗したときの復旧を用意する。** キャッシュ優先の Service Worker は、ファイルが食い違うと起動しなくなることがある。`public/boot.js`(メインとは別の普通のスクリプト)が、起動できなかったとき、キャッシュを消して読み込み直す(1回目は自動、2分以内の2回目は「なおす」ボタン)。保存データは消さない。**消すのは、このアプリの Service Worker とキャッシュだけ**(範囲を絞らないと、同じサイトのほかのアプリのキャッシュまで消える)。`src/main.ts` の最後で `window.__appStarted = true` にする。`npm run check:dist` が確認する。
- **同じサイトに載るアプリ: 名前をアプリごとに別にする。** GitHub Pages では、すべてのアプリが同じサイト(`mmishina-art.github.io`)に載る。`localStorage`・`sessionStorage`・Service Worker・キャッシュは、サイトの単位で共有されるので、アプリの ID(`package.json` の `name`)を、保存データのキーの接頭辞(`src/storage.ts`)・復旧の範囲(`public/boot.js`)に使い、ほかのアプリと混ざらないようにする。**新しいアプリでは `name` を変え、テンプレート用の印 `"pwaTemplate": true` を `package.json` から削除する**(`npm run check:dist` が、どちらも確認する)。
- **外部のリソース(Web フォント、CDN のスクリプトなど)に頼らない。** オフラインで動かなくなるため。フォント・音・画像のファイルは、アプリの中に入れてキャッシュ対象(`vite.config.ts` の `globPatterns`)にし、ライセンスを README に書けば使ってよい。`npm run check:dist` が、成果物(`dist/`)に外部の URL が入っていないことも確認する(許すのは、XML の名前空間など通信しない文字列だけ。アプリごとに許すものは `scripts/check-dist.mjs` の `ALLOWED_URL` に足す)。
- **画像・音・問題文・文章は、自作するか、ライセンスを README に明記する。** 公開するアプリなので、あとで困らないようにする。
- iPhone の安全領域(`env(safe-area-inset-*)`)を考慮する。

## デザイン

- 色は `src/style.css` の `:root` 変数に集約する。色の直書きをしない。
- 配色方針はアプリごとに1つ選ぶ(上の「このアプリの方針」)。中途半端にしない。
  - 端末設定に従う: `prefers-color-scheme: dark` で変数を再定義(テンプレートの既定)
  - 明るい固定: `color-scheme: light only` と `<meta name="color-scheme" content="light only">`
  - 暗い固定: 世界観重視のゲーム向け。`theme-color` / `background_color` も暗い色に
- `[hidden] { display: none !important; }` を残す。
- スマホ縦画面を基準(`max-width` 480px で中央寄せ)。タップ領域は 44px 以上。
- ズーム: ピンチ拡大は許可し、ダブルタップ拡大だけ `touch-action: manipulation` で防ぐ。viewport に `user-scalable=no` / `maximum-scale` を入れない(`check:dist` が検出する)。
- `prefers-reduced-motion: reduce` でアニメーションを無効化する。
- アクセシビリティ: 結果は `aria-live` 領域でも読み上げる。ボタンに `aria-label` / `aria-pressed`。色だけで状態を伝えない。
- 効果音は Web Audio で合成するのが基本(音のファイルを使うなら、上の「外部のリソース」のとおり)。オン/オフ設定を必ず用意する。
- **iPhone の画面の上端(ぼかしの帯)を避ける。** ホーム画面アプリで、ステータスバーの下に内容が入り込むと、iOS がそこをぼかして、上端の文字が読みにくくなる(`simple_chess`・`simple_blackjack`・`simple_shogi` で起きた)。
  - `index.html` の `apple-mobile-web-app-status-bar-style` は、**不透明**にする(暗い固定・端末設定に従う: `black` / 明るい固定: `default`)。**`black-translucent` にしない。**
  - 上端の余白は、`src/style.css` の `--safe-top`(`env(safe-area-inset-top)` + `--top-gap` の 24px)を使う。**`env(safe-area-inset-top)` だけにしない。**
  - `min-height: calc(100dvh - …)` のように、画面の高さから上の余白を引いて計算しているところは、**上端の余白と同じ式で連動させる**(忘れると、ぴったり収まっていた画面がはみ出して、スクロールするようになる)。
  - `npm run check:dist` と `tests/top-edge.test.ts` が確認する。
  - ブラウザでは、ステータスバーまわりを再現できない。**実機の iPhone で、上端の文字がぼやけていないか確認する。** 画面は、小さい画面(iPhone SE の大きさ)と iPhone 14 の大きさで、スクロールが増えていないことも確認する。

## デバッグモード

- 画面の確認やバランス調整のための、隠れた操作(`src/debug.ts`)。**バージョンの表示を続けて 5 回タップ**で切り替わり、オンのあいだだけ左下に操作パネル(DEBUG)が出る。「終了」で消える。
- パネルの操作は、アプリごとに `src/main.ts` の `setupDebug(...)` に足す(例: 所持金を最大にする、すぐ勝つ、次の画面へ飛ぶ)。
- **デバッグの操作を使った回は、記録を残さない**(ふつうに遊んだ記録と混ざらないように。テンプレートの `cheated`)。
- オン/オフの保存キーは `<アプリID>.debug` で、記録(`<アプリID>-...`)とは別にする。
- README に入り方を書く。
- **テスト用の入口(E2E 用)は、パネルとは別に用意する**(`src/debug.ts`)。状態は `setData(...)` で `<body>` の data 属性にいつも出し、状態の読み書きなどの関数は `exposeTestApi(...)` で `?debug=1` のときだけ `window.__pwaTest` に出す(ふだんは出ない)。テスト用の入口で書き換えた回も、記録を残さない。

## 画面の確認

- 画面を変えたら、**スマホの幅**・**小さい画面(iPhone SE の大きさ)**・**ダークモード**(対応しているアプリ)で、実際に表示して確認する(スクリーンショットを見る)。`npm run shots` で、主な画面をまとめて撮れる(`shots/all.png` で見比べる。画面でエラーが出たら失敗する)。文字の折り返し、はみ出し、ボタンの表示崩れは、コードを読むだけでは気づきにくい。
- `hidden` 属性で隠す要素は、`display` を指定したクラスに負けないか確認する(`[hidden] { display: none !important; }` を残す)。
- PR の本文に、確認したこと(画面サイズ、実機か、していないか)を書く。実機で確認できていないことは、そう書く。

## テスト

- ロジックは純関数にして Vitest で単体テストする(`tests/*.test.ts`)。
- 画面操作は Playwright(Pixel 7、`reducedMotion: 'reduce'` が既定)。build 済みの成果物を `vite preview` で配信してテストする。乱数は固定する。アニメーションを見るテストだけ `test.use({ reducedMotion: 'no-preference' })` で解除し、短命な中間状態は直接 assert せず `MutationObserver` で記録する。効果音は `app:sound` イベントで確認する。
- データ駆動のアプリ(クイズなど)は、データの検証テストを書く(件数、重複、必須項目)。
- **E2E の作法**(時間と見た目に揺れるテストを避ける):
  - 時間で変わる表示(1 秒だけ出る、数秒後に出るなど)は、実際の時間に頼らない。テスト用の入口(`?debug=1`)で状態をそろえてから見るか、`page.clock` を止めてから進める。
  - 画面から読めない状態(CANVAS の中身など)は、無理に画面で確かめず、data 属性やテスト用の入口から読む。場面を作るときは、狙うもの以外(ほかの敵・障害物など)を除いて、前提を先に確かめる。
  - 結果の値(点数など)は決め打ちせず、状態から読んで比べる。文字の幅やフォント差に頼るテストは書かない(CI と手元でフォントが違う)。収まりを確かめる要素は、行の高さ(`line-height`)を決めて、フォントが変わっても余裕が残るようにする。
  - 新しい絵や画面は、PR の前にスクリーンショットで形を見る(E2E では形の崩れは分からない)。

## 入力と表示

- **利用者が入力した文字(名前など)は、`textContent` で表示する。`innerHTML` に入れない。** 意図しないタグが動くのを防ぐ。ESLint が `src/` での `innerHTML` / `outerHTML` への代入を止める。固定の HTML を組み立てる必要があるときは、その行に `eslint-disable` と理由を書く。
- 外部へ送信しない。個人情報を扱わない(記録は端末の中だけ)。

## CI(GitHub Actions)

- `test.yml`: main への push と全 PR で lint / 単体テスト / build / check:dist / E2E。
- `pages.yml`: main への push で、**テストが通ったときだけ** `dist/` を公開。作業ブランチは公開されない。
- GitHub の Settings → Pages で Source を「GitHub Actions」にしておく(初回のみ)。
- `main` はブランチ保護(Rulesets)で守る: PR を通すこと、`check` と `e2e` が通ることを必須にする(手順は README の「新しいアプリの作り方」)。
- **依存パッケージと Actions の更新は Dependabot に任せる**(`.github/dependabot.yml`)。更新の PR は、CI が緑なのを確認してからマージする。
  - 同時に更新しないと組み合わせられないパッケージ(`vite`・`vitest`・`vite-plugin-pwa`)は、1つの PR にまとめる設定になっている。別々の PR だと CI が失敗する。
  - `typescript` のメジャー更新は、typescript-eslint が対応する(peer の範囲に入る)まで見送る(`dependabot.yml` の `ignore`。対応したら外す)。`@types/node` のメジャーは、CI の Node のメジャーに合わせる(Node を上げるときにいっしょに上げる)。
  - 更新の PR が失敗したら、閉じる前に、失敗の理由(`gh run view --log-failed`)を確認する。依存の順序の問題のこともある。

## Lint

ESLint(flat config)+ typescript-eslint。フォーマッタは入れない(オーナーの方針)。

## README

アプリの公開 URL、遊び方/機能、起動方法、ファイル構成、デバッグモードの入り方(ある場合)を書く。

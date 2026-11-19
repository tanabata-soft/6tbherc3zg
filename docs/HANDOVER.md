# 引き継ぎメモ

作業の区切りごとに書き直す(次の作業を始める人や AI が、ここだけ読めば再開できるように)。古くなった内容は消し、今の状態だけを残す。

更新: 2026-11-19・版 v1.3.0

## 今の状態

- アプリ名は『木曽ケイジビート』（副題: ニコラスケイジと木曽と私）。v1.2.0 で『木曽リズムゲーム』から表示名だけを変更した。
  - **アプリID（package.json の `name` = `kiso-rhythm-game`）は据え置き**。表示名を変えても ID は変えないこと（保存データのキー接頭辞・復旧範囲・キャッシュが ID 由来で、変えると利用者の記録が消える）。
  - 表示名の正本は `vite.config.ts` の `APP_NAME` と `index.html`（title / apple-mobile-web-app-title / ブランド題字）の2か所。check:content が一致を検査する。
- 曲: 『石畳のハイウェイ』(BPM 136) / 『Kiso Night Silhouette』(BPM 152)、各3分
  - 譜面は `scripts/generate-charts.py`（librosa）で生成。ノーツ数: 石畳 181/343/680、Kiso Night 174/347/680（かんたん/ふつう/むずかしい）
  - FEVER: 石畳 [57,96][144,174]、Kiso Night [44,67][96,128][140,164]（秒）
- v1.2.0 の変更:
  - **iPhone で音が出ない問題への対策**（`src/audio.ts` に集約）:
    - Audio Session API: `applyAudioSession()` が、使える環境では `navigator.audioSession.type = 'playback'` を設定する（iOS 17+。これがないとマナーモードで Web Audio が消音される）。Context 生成時・resume 時・unlock 時に呼ぶ。
    - unlock: `unlockAudio()` がジェスチャの中で Context 生成＋resume＋無音バッファ（0.05秒）を1回だけ再生する。呼び出しは main.ts の初回 pointerdown とスタート操作（startGame の先頭、await より前）、game.ts の start() 先頭。
    - 保険: 再生開始直前に `resumeAudio()`、ゲーム中のタップでも state が running でなければ resume を試みる（game.ts の tap()）。
    - 曲とヒット音は共通のマスター GainNode（`audioOutput()`）経由で destination へ。sound.ts も destination 直結にしないこと。
    - **最終確認は iPhone 実機でのみ可能**（マナーモードの消音や Audio Session の挙動はブラウザ・ヘッドレスでは再現できない）。実機で鳴らない場合は、まずマナーモード OFF／音量／ホーム画面アプリか Safari かを切り分ける。単体テスト（tests/audio.test.ts、モック）と E2E（開始で unlock され state が running になること）は通っている。
  - **設定モーダル**: メニューの設定カードは廃止。「設定」ボタン（`#settings-open`）から `<dialog id="settings-dialog">` を showModal で開く。中身はオフセット調整・効果音／振動トグル・ベストスコア（ID は従来どおり）。背景タップ（dialog 自身への click）・✕・「閉じる」・Esc で閉じ、開いている間は body.dialog-open で背面スクロールを止める。
    - **設定ボタンは v1.3.0 でメニュー下部のフッターへ移した**（題字の右上には置かない。フッターには設定ボタン・インストール案内・バージョン表示を並べる）。ポスター型のファーストビュー（題字→ヒーロー→曲選択→難易度→スタート）は崩さない。
    - E2E の設定操作は `openSettings(page)` ヘルパー経由に統一してある（ボタンが下部にあるため、ヘルパーは起動完了を待ってからスクロールして押す）。
- v1.3.0 の変更:
  - **記録のバックアップ機能を削除した**（オーナー判断「いらない」）。メニューの書き出し／読み込み UI、`src/backup.ts`、`storage.ts` の export/import、バックアップ読み込み後に合わせ直す `reloadSound` / `reloadVibrate`、関連する単体テスト・E2E・shots の backup 画面をすべて撤去。**テンプレート標準からの意図的な逸脱。再追加しない**（CLAUDE.md の「このアプリ固有の決まり」にも明記）。保存データの版番号（`SCHEMA_VERSION`）は `src/storage.ts` が持つよう移した。保存そのもの（ベストスコア・オフセット・効果音/振動）は従来どおり端末内のみ。
  - **設定ボタンをメニュー下部のフッターへ移動**（上の設定モーダルの項を参照）。モーダルの中身と開閉の挙動は不変。
- 公開 URL: https://tanabata-soft.github.io/6tbherc3zg/（リポジトリ: tanabata-soft/6tbherc3zg、public）
- 検証: `npm run verify` 全通過（単体テスト43件）、E2E 17件通過、shots 12枚＋メニュー全画面の撮影でフッターの設定ボタン・バックアップ撤去・設定モーダルを目視確認済み
- 単体プレビュー: `dist-preview/preview.html`（約11.8MB）

## やりかけ

- なし

## 次にやること(優先順)

1. **iPhone 実機で音が出るか再確認する**（v1.2.0 の音声対策の最終確認。マナーモード ON でも鳴るか、ホーム画面アプリでの起動・オフライン・上端のぼやけもあわせて）。更新は「更新」ボタンで切り替わるので、旧版のままになっていないかバージョン表示（v1.3.0）も見る。振動は Android 実機で確認する
2. 遊んだ感触で譜面の密度や FEVER 区間を調整したくなったら、`scripts/generate-charts.py` の LEVELS / FEVER を変えて再生成し、版を上げて公開する
3. ヒット音の音色や演出の強さを調整したくなったら、`src/sound.ts` の HIT_TONE、`src/game.ts` の演出の定数（RING_LIFE など）を変える

## 注意・気づいたこと

- 音源は MP3 にすること。AAC/m4a はヘッドレス Chromium が decodeAudioData できず、E2E のゲーム開始テストが成立しない（iPhone Safari は MP3 可）。
- 音源は約4.3MB×2。precache に入れるため vite.config.ts の workbox `maximumFileSizeToCacheInBytes` を 6MB に上げてある。
- 音源・ジャケットは `src/assets/` から import する方式（public/ 直置きだと build:preview に入らない）。
- 譜面生成の Python 環境は `.venv/`（librosa）。/tmp は tmpfs で容量が小さいので venv を置かない。
- ヒット音・演出はすべて曲と同じ AudioContext と経過時間（dt）ベース。フレーム数ベースに戻さないこと（120Hz で見え方が変わる）。
- E2E のヒットテストは実時間依存で揺れるため、ページ内インターバルでキーを押し続ける方式＋リトライ2回にしてある（`test.describe('ヒット判定（実時間）')`）。CDP 経由でノーツ時刻に1発だけ合わせる方式は、並行実行の負荷で外れるので戻さないこと。

## 再開のときの指示文

```
docs/HANDOVER.md と最近の変更(git log)を読んで、今の状態と最初の作業の案を出して。
```

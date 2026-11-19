# 引き継ぎメモ

作業の区切りごとに書き直す(次の作業を始める人や AI が、ここだけ読めば再開できるように)。古くなった内容は消し、今の状態だけを残す。

更新: 2026-11-19・版 v1.1.0

## 今の状態

- 単体HTML版リズムゲームを pwa-template で PWA 化し、新曲2曲に差し替えて公開した。
  - 曲: 『石畳のハイウェイ』(BPM 136) / 『Kiso Night Silhouette』(BPM 152)、各3分
  - 譜面は `scripts/generate-charts.py`（librosa）で新規生成。ノーツ数: 石畳 181/343/680、Kiso Night 174/347/680（かんたん/ふつう/むずかしい）
  - FEVER: 石畳 [57,96][144,174]、Kiso Night [44,67][96,128][140,164]（秒）
- v1.1.0 でタッチの気持ちよさとメニュー画面を改修した。
  - ヒット音: `src/sound.ts` の `playHitSound`（サイン波の芯＋ノイズのアタックで打撃音を合成。判定で周波数と音量が変わる。曲の再生と同じ AudioContext を使うので、専用の AudioContext は持たない）
  - 振動: `src/haptics.ts`（navigator.vibrate、PERFECT 15ms / GREAT 10ms / GOOD 8ms。iPhone Safari は非対応で何も起きないのが正常）
  - 演出: ノーツの膨らむ残像（Pop）・広がる輪（Ring）・粒子・タップ波紋（Ripple）はすべて `src/game.ts` 内で経過時間（dt）ベースで進める。フレーム数ベースに戻さないこと（120Hz で見え方が変わる）
  - 設定: 「効果音」（保存キー `sound`）と「振動」（保存キー `vibrate`）のトグルがメニューの設定カードにある。どちらも localStorage の接頭辞つきキーなので、記録のバックアップに自動で含まれる。バックアップ読み込み時は `reloadSound` / `reloadVibrate` でモジュール状態を合わせ直す
  - メニュー: ヒーロー表示（選択中の曲のジャケット＋ネオンタイトル＋チップ）が主役。ジャケット内の曲名の位置に合わせて `.hero-jacket[data-song]` で object-position を切り替えている（highway は下寄せ、night は上寄せ）。曲選択はサムネイル横並び（`.song-card`、data-song と aria-pressed は E2E が使う）
- 公開 URL: https://tanabata-soft.github.io/6tbherc3zg/（リポジトリ: tanabata-soft/6tbherc3zg、public）
- 検証: `npm run verify` 全通過、E2E 17件通過、shots で新メニュー／ゲーム画面を目視確認済み
- 単体プレビュー: `dist-preview/preview.html`（約11.8MB）

## やりかけ

- なし

## 次にやること(優先順)

1. 実機（iPhone）でホーム画面追加・オフライン起動・上端のぼやけがないかを確認する（ブラウザでは再現できない部分）。振動は Android 実機で確認する
2. 遊んだ感触で譜面の密度や FEVER 区間を調整したくなったら、`scripts/generate-charts.py` の LEVELS / FEVER を変えて再生成し、版を上げて公開する
3. ヒット音の音色や演出の強さを調整したくなったら、`src/sound.ts` の HIT_TONE、`src/game.ts` の演出の定数（RING_LIFE など）を変える

## 注意・気づいたこと

- 音源は MP3 にすること。AAC/m4a はヘッドレス Chromium が decodeAudioData できず、E2E のゲーム開始テストが成立しない（iPhone Safari は MP3 可）。
- 音源は約4.3MB×2。precache に入れるため vite.config.ts の workbox `maximumFileSizeToCacheInBytes` を 6MB に上げてある。
- 音源・ジャケットは `src/assets/` から import する方式（public/ 直置きだと build:preview に入らない）。
- 譜面生成の Python 環境は `.venv/`（librosa）。/tmp は tmpfs で容量が小さいので venv を置かない。
- 元ゲームの欠点2点は修正済み: 再プレイ時の再デコード（→ `src/audio.ts` が曲ごとに保持）、プレイ中に画面を隠したときの大量MISS（→ 中断してメニューへ戻す）。
- E2E のヒットテストは実時間依存で揺れるため、ページ内インターバルでキーを押し続ける方式＋リトライ2回にしてある（`test.describe('ヒット判定（実時間）')`）。CDP 経由でノーツ時刻に1発だけ合わせる方式は、並行実行の負荷で外れるので戻さないこと。

## 再開のときの指示文

```
docs/HANDOVER.md と最近の変更(git log)を読んで、今の状態と最初の作業の案を出して。
```

# 引き継ぎメモ

作業の区切りごとに書き直す(次の作業を始める人や AI が、ここだけ読めば再開できるように)。古くなった内容は消し、今の状態だけを残す。

更新: 2026-11-19・版 v1.0.0

## 今の状態

- 単体HTML版リズムゲームを pwa-template で PWA 化し、新曲2曲に差し替えて公開した。
  - 曲: 『石畳のハイウェイ』(BPM 136) / 『Kiso Night Silhouette』(BPM 152)、各3分
  - 譜面は `scripts/generate-charts.py`（librosa）で新規生成。ノーツ数: 石畳 181/343/680、Kiso Night 174/347/680（かんたん/ふつう/むずかしい）
  - FEVER: 石畳 [57,96][144,174]、Kiso Night [44,67][96,128][140,164]（秒）
- 公開 URL: https://tanabata-soft.github.io/6tbherc3zg/（リポジトリ: tanabata-soft/6tbherc3zg、public）
- 検証: `npm run verify` 全通過、E2E 15件通過、shots でメニュー／ゲーム画面を目視確認済み
- 単体プレビュー: `dist-preview/preview.html`（約11.6MB、音源2曲の埋め込みを実測確認済み）

## やりかけ

- なし

## 次にやること(優先順)

1. 実機（iPhone）でホーム画面追加・オフライン起動・上端のぼやけがないかを確認する（ブラウザでは再現できない部分）
2. 遊んだ感触で譜面の密度や FEVER 区間を調整したくなったら、`scripts/generate-charts.py` の LEVELS / FEVER を変えて再生成し、版を上げて公開する

## 注意・気づいたこと

- 音源は MP3 にすること。AAC/m4a はヘッドレス Chromium が decodeAudioData できず、E2E のゲーム開始テストが成立しない（iPhone Safari は MP3 可）。
- 音源は約4.3MB×2。precache に入れるため vite.config.ts の workbox `maximumFileSizeToCacheInBytes` を 6MB に上げてある。
- 音源・ジャケットは `src/assets/` から import する方式（public/ 直置きだと build:preview に入らない）。
- 譜面生成の Python 環境は `.venv/`（librosa）。/tmp は tmpfs で容量が小さいので venv を置かない。
- 元ゲームの欠点2点は修正済み: 再プレイ時の再デコード（→ `src/audio.ts` が曲ごとに保持）、プレイ中に画面を隠したときの大量MISS（→ 中断してメニューへ戻す）。

## 再開のときの指示文

```
docs/HANDOVER.md と最近の変更(git log)を読んで、今の状態と最初の作業の案を出して。
```

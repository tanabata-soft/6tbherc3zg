# 進捗メモ（作業用）

更新: 2026-11-19 v1.1.0 公開

## 状態: 完了
- pwa-template で新規構築（git main）、アプリ名「木曽リズムゲーム」、暗い固定テーマ
- 新曲2曲に差し替え: 『石畳のハイウェイ』BPM136 / 『Kiso Night Silhouette』BPM152（音源は MP3 192kbps、ジャケットは動画フレーム）
- 譜面は scripts/generate-charts.py（librosa）で新規生成: 石畳 181/343/680、Kiso Night 174/347/680
- verify 全通過 / E2E 通過 / shots 目視確認済み / 単体プレビュー dist-preview/preview.html（音源埋め込み実測済み）
- 公開: tanabata-soft/6tbherc3zg（public）→ https://tanabata-soft.github.io/6tbherc3zg/

## v1.1.0（2026-11-19）
- タッチの気持ちよさ: ヒット音を打撃音の合成に刷新（判定で音程・音量が変わる、曲と同じ AudioContext を使用）、ヒット時の振動（src/haptics.ts、対応端末のみ）、ノーツの膨らむ残像＋輪＋粒子増量、判定文字のポップ、タップ位置の波紋。演出はすべて経過時間ベース（120Hz 対応）
- 設定に「効果音」「振動」トグルを追加（保存・バックアップ対象）
- メニュー刷新: ジャケット主役のポスター型（ヒーロー表示＋ネオンチップ、サムネイル横並び、難易度ピル、グラデーションのスタートボタン、設定カード）
- 検証: verify 全通過、E2E 17件通過、shots で新メニューを目視確認済み
- 詳細は docs/HANDOVER.md を参照

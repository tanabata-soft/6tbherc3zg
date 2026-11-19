# 進捗メモ（作業用）

更新: 2026-11-19 v1.2.0 公開

## 状態: 完了
- pwa-template で新規構築（git main）、暗い固定テーマ
- 収録曲: 『石畳のハイウェイ』BPM136 / 『Kiso Night Silhouette』BPM152（音源は MP3 192kbps、ジャケットは動画フレーム）
- 譜面は scripts/generate-charts.py（librosa）で生成: 石畳 181/343/680、Kiso Night 174/347/680
- 公開: tanabata-soft/6tbherc3zg（public）→ https://tanabata-soft.github.io/6tbherc3zg/

## v1.2.0（2026-11-19）
- アプリ名を『木曽リズムゲーム』から『木曽ケイジビート』へ変更（表示名のみ。package.json の name＝アプリID `kiso-rhythm-game` は据え置きで、保存データ・キャッシュ互換は維持）。副題「ニコラスケイジと木曽と私」を題字の下に表示
- iPhone で音が出ない問題への対策: Audio Session API（navigator.audioSession.type = 'playback'）でマナーモード消音を回避、ジェスチャ内での unlock（resume＋無音バッファ再生）、再生開始直前とゲーム中のタップでの resume、曲・効果音を共通のマスター GainNode 経由に一元化。**最終確認は iPhone 実機が必要**（ブラウザでは再現できない）
- 設定を設定モーダル化: メニュー右上の「設定」ボタンから開く `<dialog>` に、オフセット調整・効果音／振動トグル・ベストスコアを集約。記録のバックアップは従来どおりメニュー下部
- 検証: verify 全通過（単体49件）、E2E 19件通過、shots 15枚で新題字と設定モーダルを目視確認済み
- 詳細は docs/HANDOVER.md を参照

## v1.1.0（2026-11-19）
- タッチの気持ちよさ: ヒット音を打撃音の合成に刷新、ヒット時の振動、ノーツの膨らむ残像＋輪＋粒子増量、判定文字のポップ、タップ位置の波紋。演出はすべて経過時間ベース
- メニュー刷新: ジャケット主役のポスター型

# 引き継ぎメモ

作業の区切りごとに書き直す(次の作業を始める人や AI が、ここだけ読めば再開できるように)。古くなった内容は消し、今の状態だけを残す。

更新: 2026-11-19・版 v1.9.0

## 今の状態

- アプリ名は『キソケイジビート』（副題: ニコラスケイジと木曽と私）。v1.8.6 で『木曽ケイジビート』から、v1.2.0 で『木曽リズムゲーム』から、表示名だけを変更した。
  - **アプリID（package.json の `name` = `kiso-rhythm-game`）は据え置き**。表示名を変えても ID は変えないこと（保存データのキー接頭辞・復旧範囲・キャッシュが ID 由来で、変えると利用者の記録が消える）。
  - 表示名の正本は `vite.config.ts` の `APP_NAME` と `index.html`（title / apple-mobile-web-app-title / ブランド題字）の2か所。check:content が一致を検査する。
- 曲: 『石畳のハイウェイ』(BPM 135) / 『Kiso Night Silhouette』(BPM 150)。**v1.6.0 から音ゲー用ショート編集**（石畳 104.8秒 / Kiso Night 127.7秒。全長版は `assets-full/` に保管、編集手順は `assets-full/README.md`）
  - 譜面は `scripts/generate-charts.py`（librosa）で生成（v4方式＝両親指前提、下記）。ノーツ数: 石畳 160/276/328、Kiso Night 193/376/476（かんたん/ふつう/むずかしい）
  - FEVER: 石畳 [57,96]、Kiso Night [44,67][96,127]（秒、編集後のタイムライン）
- v1.9.0 の変更:
  - **譜面を全面作り替え（生成方式 v4＝両親指前提）**（オーナー指示「基本両手（両親指）でやることを前提にやりやすい譜面にして」）。レーン 0・1 を左親指、2・3 を右親指が受け持つ前提で、ハード制約を生成器（`scripts/generate-charts.py`）に組み込んだ。制約の正本は新設の `scripts/check-two-thumb.py`、設計の根拠は `docs/CHART-DESIGN.md` の「両親指前提（譜面 v4）」節。要点: C1 同時押しは左右ペア（0+2 / 0+3 / 1+2 / 1+3）だけ（相方は反対側から選ぶ。同側ペア禁止）／C2 長押しの帯の中は反対側のノーツだけ（同時押しの時刻をまたぐ長押しは置かない。帯の中の同側除去はスナップ後の事後修復でも実施）／C3a 16分の連なりで同側3連なし（トリルは左右交互 0↔2・1↔3 系に変更、wave16 は [0,1,3,2,1,0,2,3] に変更、フィット罰金＋導出後の修復で担保）／C3b 片手トリルは8分以下で4連まで／C4 縦連は従来ルール維持。パターン語彙・モチーフ反復・密度連動・入れ子・タイミング合わせ（実測拍列の補間＋スナップ±38ms）は v3 を引き継ぐ。
  - **生成後の検証が組み込みになった**: 生成器は書き出し前に `check-two-thumb.py` の `check_charts()` で全譜面を検証し、違反があれば charts.json を書かずに終了する。単体でも `.venv/bin/python scripts/check-two-thumb.py` で実行できる。v3 譜面では違反112件（hard の同側ペア・帯の中の同側ノーツ・同側3連など）→ v4 では 0 件。
  - ノーツ数: 石畳 146/263/350 → **160/276/328**、Kiso Night 191/383/499 → **193/376/476**。同時押し hard 9組/8組（全て左右ペア）、normal 1組/2組、easy なし。長押し 5/12/15本（石畳）・6/12/15本（Night）。タイミング精度は維持: 平均|ズレ| 全難易度 7.0〜7.9ms、|ズレ|>30ms は最大3.4%、3分割の区間平均は ±3.7ms 以内。レーン分布は検証範囲（18〜32%）内だが、石畳 easy のレーン2（31.9%）と hard のレーン3（18.3%）は際どい（シード固定なので再生成しても同じ値になる）。
  - **オートプレイ全通し確認の専用スクリプト `scripts/verify-autoplay-full.mjs` を追加**（譜面再生成時の完走チェック用。実時間で約4分かかるため通常の E2E には入れない）。v1.9.0 では両曲・hard を最後まで再生し、フルコンボ（石畳 PERFECT 328・MISS 0・最大コンボ 328、Night PERFECT 476・MISS 0・最大コンボ 476）を確認済み。使い方: `npm run build && node scripts/verify-autoplay-full.mjs`。
  - shots の game 画面は従来のタイミング（READY＋約5.3秒）のままで、5.6秒・レーン0・891ms の長押し帯が頭から尾まで写る（v4 では最初の長押しが 3.4秒・レーン3 に変わり、5.6秒は2番目になった。コメントは実態に合わせて更新済み）。
  - **ベストスコアは曲ID（highway/night）単位で端末に残るが、譜面が変わったため参考値になる**（アプリID・曲ID は不変。v1.6.0 の楽曲編集時と同じ扱い）。
- v1.8.6 の変更:
  - **ケージ背景を「完全に置き換わる」濃さにした**（オーナー指示「背景がニコラスに置き換わるぐらい。完全に置き換わって数秒そのまま」）。ピーク不透明度は通常・big とも 1.0（`src/game.ts` の `CAGE_BG_PEAK_ALPHA` 単一定数に整理。旧 0.2 / 0.3 の `CAGE_BG_PEAK_ALPHA_BIG` は廃止）。包絡は絶対時間ベース: フェードイン `CAGE_BG_FADE_IN_SEC` 0.3秒 → 1.0 のままキープ → フェードアウト `CAGE_BG_FADE_OUT_SEC` 0.6秒。滞在は `CAGE_BG_DURATION_SEC` 2.9秒（キープ約2秒）/ `CAGE_BG_DURATION_BIG_SEC` 3.6秒。main.ts の `CAGE_SHOW_MS`（2900）/ `CAGE_SHOW_BIG_MS`（3600）と CSS の cage-fade（2.9秒）/ cage-fade-big（3.6秒、big 専用キーフレームを新設）の3か所を一致させること。push-in ズーム（`CAGE_BG_ZOOM`）は不変でキープ中も寄り続ける。表示中に次の登場が来た場合は、triggerCage が `cageBg` を新しいパターン・shownAt で上書きし、包絡は頭から再生される（main.ts の showCage もアニメーション再起動＋タイマー再設定）。発火条件・パターン割り当て・`cageAppearance`・data 属性は不変。全面カットイン（v1.8.2）と違い、絵は背景として描かれレーン・ノーツ・判定は後にフル不透明度で描くため、視認性は構造的に保たれる。
  - **明るい絵向けの薄い暗幕を追加**: ナショナル・トレジャー（明るい絵）のピーク時に白いレーン線（不透明度 .12）が埋もれるため、ケージ背景の表示中だけ絵の上に `CAGE_BG_VEIL_ALPHA` 0.18 の暗幕を包絡に連動して敷く（通常時のベール .62 よりずっと薄く、置き換わりの印象は損なわない）。一時撮影（setCombo を3回呼んで treasure を出し、ピークで撮影）で落下ノーツ・長押しの帯・判定枠・判定ラインが明瞭なことを確認済み。shots の game-combo は撮影タイミングを登場後 1000ms に変更し、ピーク（キープ中）を撮るようにした。
  - **アプリ名を『キソケイジビート』に変更**（オーナー指示。表示名のみ）。適用箇所: `vite.config.ts` の `APP_NAME`（manifest の name / short_name に伝播）、index.html の `<title>` / apple-mobile-web-app-title / description / 題字 h1、README 見出し、e2e の見出し確認、CLAUDE.md・本書・PROGRESS.md の現行表記（履歴の節は旧名のまま）。サブタイトル「ニコラスケイジと木曽と私」は不変。**アプリID（package.json の `name` = `kiso-rhythm-game`）・保存キー・リポジトリ名・公開 URL は据え置き**。
- v1.8.5 の変更:
  - **通常タップのヒット音をタンバリン音（E案）に差し替え**（オーナーが候補 A〜F から選択。参照音は ~/workspace/your_files/tamb-e.wav で、numpy 合成のレシピを Web Audio で再現した）。正本は `src/sound.ts` の `TAMB_PARTIALS`（金属片の部分音12本: 3400/3950/4480/5120/5760/6480/7250/8100/9020/10100/11300/12600 Hz、振幅 0.25〜0.8、減衰率 6〜14/s）/ `TAMB_GRAINS`（3〜12kHz 帯域ノイズの小バースト 10〜30ms を冒頭100ms 内に24粒）/ `TAMB_AIR`（5〜14kHz、減衰率 10/s）/ `TAMB_ATTACK_SEC`（0.008。柔らかいランプでカチッという硬さにしない）/ `TAMB_JUDGE` と純関数 `tambourineFor(judge, tier)`。ランダム要素は持たず固定値テーブル（テストで固定できる）。再生は `playTambourine`（部分音はサイン波＋setTargetAtTime の exp 減衰、空気感と粒は長いノイズバッファ＋帯域フィルタ）。判定別: PERFECT peak 0.24・部分音12本・粒24個 / GREAT 0.19・10本・16個・減衰×1.35 / GOOD 0.13・7本・8個・減衰×1.7。tier ではピッチを上げず明るさ（7kHz 以上の部分音と空気感を tier ごとに +15%、上限 tier 4）だけ上げる。部分音の音量は合計振幅で正規化し `TAMB_PARTIAL_BOOST`（2.2）で持ち上げ（非整数倍音は位相が揃わないため）。**長押しの連打（HOLD_BLIP、8bit）・完走音（COMPLETE_BLIP）・失敗音・空タップ音（EMPTY_BLIP）は変更なし**（オーナー指示で据え置き）。旧 `HIT_BLIP` / `hitToneFor` は廃止し、`app:sound` の hit イベントの detail から frequency を外した（kind / judge / tier は不変）。聞こえ方の最終確認は実機（ヘッドレスでは音質を判定できない）。
  - **デバッグモード＋オートプレイを設定モーダルに追加**（オーナー指示）。ユーザー向け設定として実装し、?debug=1 のテスト用入口（src/debug.ts）とバージョン5回タップのパネルとは別物（保存キーは storage.ts 経由の `debugMode` / `autoplay`、どちらも既定オフ）。UI は歌詞表示の下: #debug-button（デバッグモード）と、オンのときだけ出る #autoplay-block 内の #autoplay-button。data 属性 `debugMode` / `autoplay` も出す。有効条件は両方オン（main.ts の startGame が `debugModeOn && autoplayOn` を game.start の第4引数へ渡す）。game.ts: loop がミス掃除より先に `autoPlay(nowMs)` で時刻の来たノーツを PERFECT 処理（タップ処理を `hitNote(note, judge, nowMs)` に共用化し、フラッシュ・波紋も出す）。長押しは頭を押したまま離す処理が入らないので、advanceHold が尾で完走させる（tick・完走音も通常どおり）。入力は onPointerDown（左上の中断を除く）と onKeyDown で無効化。結果は `GameResult.autoplay` で main.ts へ渡り、**ベストスコアに保存しない**（表示は保存済みベストのまま）。リザルトには #result-autoplay バッジ（金枠ピル）を出し、aria-live の結果文にも「（オートプレイ）」を足す。E2E で UI 操作からの有効化・コンボ/スコアの伸び・バッジ・ベスト不保存を確認する。
- v1.8.4 の変更:
  - **ケージ登場演出を「背景に薄く全面」に作り替え**（オーナー実機確認で v1.8.2 の全面ズームが「プレイに支障が出る」と却下 → 3案から「背景に薄く全面」を選択）。絵は DOM ではなく **game.ts が Canvas の背景として描く**（地の塗り＋ジャケット絵＋暗いベールの後、レーン・ノーツの前）。Canvas は毎フレーム不透明に塗られるため DOM を canvas の後ろ（z-index）に置いても絵は見えず、Canvas 内で背景として描くことで「ノーツが常に手前」を保証した。実装の正本は game.ts の `cageBg` 状態（triggerCage でセット、loop で描画）と定数 `CAGE_BG_PEAK_ALPHA`（通常 0.20）/ `CAGE_BG_PEAK_ALPHA_BIG`（0.30）/ `CAGE_BG_DURATION_SEC`（1.5）/ `CAGE_BG_DURATION_BIG_SEC`（1.9）/ `CAGE_BG_ZOOM`（種別ごとの from/to/power）。フェードは不透明度の包絡（〜10% でイン、72% からアウト。旧 cage-fade と同じ形）、push-in は scale 0.92→1.06 前後（fast は速く大きく、cinematic は小さく線形。行き過ぎ・小揺れは廃止）。`prefers-reduced-motion` ではズームだけ止める（フェードは残す）。絵の Image は game.ts の `cageBgImage()` がパターンごとに保持し、コンストラクタで全パターンを先読みする。
  - **金枠・ビネット・画面シェイクは廃止**（.cage-frame / .cage-img / .cage-caption / cage-zoom-* / #game-canvas.shake と canvas-shake は削除済み。再追加しない）。紙吹雪は据え置き（通常26粒 / big 70粒、画面中央から）。
  - **セリフ表示は main.ts の #cage-pop（ピル）に分離**。`showCage` はセリフ・コンボ数・data 属性（pattern / zoom）・big クラス・非表示タイマーだけを担当し、絵とシェイクは扱わない。配置は画面上部中央（`top: calc(var(--safe-top) + 52px)`、Canvas のスコア行と FEVER 表示に重ならず、下部の歌詞とも重ならない）。セリフは半透明の暗いピル（.cage-bubble、背景 rgb(0 0 0 / 0.55)＋白系の枠）に入る。滞在時間は main.ts の `CAGE_SHOW_MS` / `CAGE_SHOW_BIG_MS`、CSS の cage-fade、game.ts の `CAGE_BG_DURATION_*` の3か所を一致させること。
  - パターン割り当て（5種ローテーション、big は ghostrider/conair 優先）・セリフ・発火条件（30コンボごと＋100の倍数）・logic.ts の `cageAppearance`・e2e の data-cage-pattern / data-cage-zoom は不変。CageZoom の意味は「背景 push-in の速さ」に変わった（logic.ts のコメントも更新済み）。
- v1.8.3 の変更:
  - **長押し中の音を「持続音」から「ヒット音の連打」に変更**（オーナー指示「連続音は今のタッチ音を連続で鳴らして」）。v1.8.1 の `HOLD_TONE` / `holdToneFor` は廃止。正本は `src/sound.ts` の `HOLD_BLIP`（F案の家族、1568→2093Hz、peak 0.11 で通常ヒットより小さく・短い）/ `HOLD_STREAM` / `holdBlipFor(tier, progress)` / `holdStreamIntervalSec(bpm)` / `startHoldSound(key, tier, durationMs, progress, bpm)` / `stopHoldSound(key)`。間隔は曲の BPM の16分音符（135 → 約111ms、150 → 100ms）で、game.ts が charts の bpm を渡す。ピッチは tier 倍率 × 進行で最大 +2 半音（持続音時代の気持ちよさを引き継ぐ）。スケジューリングは AudioContext 時刻の先行予約（lookahead 0.12秒、25ms 間隔のタイマー）で、フレーム落ちで間隔が潰れない。各声は専用のゲイン出口を持ち、停止時はそれを絞るので予約済みの音もまとめて消える。開始/停止条件は v1.8.1 と同じ（頭で開始、離したら即停止、grace 内の押し直しで再開＝progress 引き継ぎ、尾で停止して完走音へ、失敗時は失敗音、同時保持は上限4、尾+0.6秒の安全停止あり）。`app:sound` の kind は hold-start / hold-stop を維持し、連打1発ごとに hold-hit を追加（E2E で数える）。tick スコア計算は不変で、音だけの変更。
  - **空タップ音を追加**（オーナー指示「ヒットしないときも音を出す。タッチすれば何か音が鳴る」）。`src/sound.ts` の `EMPTY_BLIP`（1046Hz の1音だけ、peak 0.08、短い）/ `playEmptySound()` が正本。発火は game.ts の `pressLane` で、grace 押し直しでもなく `findHit` が null（そのレーンの判定窓 ±160ms 内にノーツがない）ときだけ。ヒットしたタップ・長押しの頭・演奏外（pressLane 自体が演奏中しか呼ばれない）では鳴らない。同じ押下で hit と二重には鳴らない。`app:sound` に kind: 'empty' を追加。
  - **テスト用の入口に曲位置を追加**: `Game.songPositionMs()` を新設し、main.ts の getState に `songMs` を追加（?debug=1 のときだけ）。E2E の「ヒットで空タップ音が鳴らない」は、壁時計タイマーの単発合わせが並行負荷で窓を外したため、この songMs をページ内で 5ms 間隔で読んでノーツの 50ms 手前で押す方式に変えた（単発の時刻合わせに戻さないこと）。
- v1.8.2 の変更:
  - **ケージ登場演出を刷新**（オーナー指示: リアル路線の絵＋主演映画モチーフ、右上からではなく画面奥から全面に拡大、セリフの後はフェード、パターンは何種類も）。v1.8.0 の右上スライドイン＋デフォルメ絵（`src/assets/cage.png`）は廃止・削除。新しい絵は主演映画モチーフのリアル路線イラスト5枚（`src/assets/cage-suit.webp` / `cage-conair.webp` / `cage-faceoff.webp` / `cage-treasure.webp` / `cage-ghostrider.webp`、いずれも 500×1000 前後・28〜87KB、メディア生成）。表示は透過切り抜きではなく矩形のまま cover で、金枠（`.cage-frame`）＋暗いビネットに載せ、画面中央の奥からズームして全面近くまで拡大→セリフ表示→フェードアウトするカットイン（`#cage-pop` が全面オーバーレイ、セリフと「○○ COMBO」は絵の下部の `.cage-caption` に重ねる）。
  - **パターン決定は `src/logic.ts` の純関数 `cageAppearance(combo, count)`**（count は今回を含まない過去の登場回数、演奏ごとに game.ts が数え直す）。通常登場は `CAGE_PATTERN_ROTATION`（suit→faceoff→treasure→conair→ghostrider）のローテーション。big（100の倍数）は `CAGE_BIG_PATTERNS`（ghostrider / conair）を big の回数で交互に優先。ズームは `CAGE_PATTERN_ZOOM` でパターン別に3種（standard / fast＝行き過ぎ＋到達時に小揺れ / cinematic＝ゆっくり寄る）。game.ts の `triggerCage` が data 属性 `cage` / `cagePattern` / `cageZoom` を出し、紙吹雪は画面中央から（通常26粒／big 70粒）。表示は main.ts の `showCage(combo, appearance)` が担当し、セリフはパターンごとに2つを `CAGE_PATTERN_LINES` に持って絵ごとにローテーションする（映画の台詞の直引用はなし）。旧 `CAGE_LINES` / `CAGE_BIG_LINES` は廃止。
  - **滞在時間とフェード**: 全体は CSS の `cage-fade`（フェードイン→静止→フェードアウト）で、通常1.5秒 / big 1.9秒（main.ts の `CAGE_SHOW_MS` / `CAGE_SHOW_BIG_MS` と CSS の animation-duration を一致させること）。ピーク不透明度は 0.97 に抑え、背後のノーツが完全には消えないようにした。big はフレームが大きく（高さ 88dvh、通常は 76dvh）＋ `#game-canvas` の CSS シェイク（従来どおり）。絵は main.ts の起動時に先読み（Image）し、初回登場でちらつかせない。
  - **iPhone の文字選択的な挙動を禁止**（オーナー実機報告「タップや長押しで文字選択のようになる」への対応）。`src/style.css` の `*` に `user-select: none` / `-webkit-user-select: none` / `-webkit-touch-callout: none` を追加（`-webkit-tap-highlight-color: transparent` は既存）。`#game-screen` にも `touch-action: none` を追加（`#game-canvas` は既存）。アプリ内に選択が必要な入力欄（input / select / textarea）が無いことを確認したうえで、main.ts に selectstart / contextmenu の preventDefault も追加した。**最終確認は iPhone 実機**（長押しでコールアウトや選択が出ないこと）。
- v1.8.1 の変更:
  - **長押しの音を拍 tick から「連続音」に変更**（オーナー実機フィードバック「長押し中も音が鳴るようにして」「長押し中は連続でなってる？」→ 連続音に決定）。`src/sound.ts` の `HOLD_TONE` / `holdToneFor(tier, progress)` / `startHoldSound(key, tier, durationMs, progress)` / `stopHoldSound(key)` / `stopAllHoldSounds()` が正本。仕様: 矩形波（mix 0.6）をローパス 2200Hz で丸め＋サイン波（mix 0.4）の持続音、基本 784Hz × tier 倍率、ピーク 0.085、進行で開始→尾に +2 半音まで上昇（周期的な揺れは入れない）。頭のヒットと同時に開始、尾ちょうどで停止して完走音へ接続。離したら即停止、grace 内の押し直しで再開（progress でピッチ上昇を引き継ぐ）。キーはノーツオブジェクトで、ホールドごとに独立音源・上限4つ。演奏終了/中止/開始リセット/効果音オフでも全停止する。
  - **完走音と失敗音を追加**: 完走音は `COMPLETE_BLIP` / `playCompleteSound(judge, tier)`（F案2音＋1オクターブ上の3音目、頭の判定で音色変化、ピークは PERFECT 0.2 / GREAT 0.16 / GOOD 0.12 で通常ヒット音以下）。失敗音は `FAIL_BLIP` / `playFailSound()`（猶予切れ時に 784→523Hz と短く下がる、ピーク 0.08）。
  - **拍 tick の音は廃止**（`playTickSound` / `TICK_BLIP` / `tickToneFor` を削除し連続音に一本化）。tick スコアの計算（logic.ts の advanceHold、HOLD_TICK_SCORE）は判定・スコア仕様として残置し、発火条件（押せている間だけ数える）も不変。`app:sound` イベントの kind は hold-start / hold-stop / complete / fail が増え、tick は出なくなった。E2E の完走テストで hold-start・complete の発火と tick の不在を確認する。
- v1.8.0 の変更:
  - **ヒット音を「F案（8bit系）」に差し替え**（オーナーが6候補から選択）。`src/sound.ts` の `HIT_BLIP` がパラメータの正本: 矩形波の2音「ピロッ」（1音目 1568Hz 約32ms → 2音目 2093Hz 約50ms、指数減衰、頭にハイパスの小さなクリック）。判定別は PERFECT=明るく長め（peak 0.22）/ GREAT=少し短く（0.17）/ GOOD=1音目だけ 1397Hz で短く鈍く（0.12）。`hitToneFor(judge, tier)` は従来どおり tier ごとに +1 半音（上限 +4、logic.ts の hitPitchMultiplier）で、戻り値が { tone, freq1, freq2 } になった。長押し tick は `TICK_BLIP` / `tickToneFor(tier)`（1音だけの短い矩形波、peak 0.05、クリックなし）。旧3層音（HIT_TONE のノイズ＋三角波＋倍音 sparkle）は廃止。ヒット音専用バス（ゲイン→コンプレッサー→マスター）と `app:sound` イベント（detail.frequency は1音目の周波数）は不変。
  - **コンボ節目を「ケージ登場」に置き換え**（オーナー指示「30コンボでも出して」）。発火条件は `src/logic.ts` の `isCageCombo`（30の倍数 ∪ 100の倍数。100 は30の倍数ではないので両方含める）が正本で、`isCageBigCombo`（100の倍数）で一段大きい登場。従来の `isComboMilestone`（50ごと）と Canvas の節目文字は廃止。game.ts の `triggerCage` が data 属性 `cage` と紙吹雪（Canvas 粒子、通常26粒／big 70粒、右上から）を出し、キャラ表示は main.ts の `showCage`（DOM の #cage-pop）が担当: 右上（スコアの下）にスライドインし約1.25秒滞在、吹き出しのセリフは通常6種（CAGE_LINES）＋big専用2種（CAGE_BIG_LINES）をローテーション（映画の台詞の直引用はなし）、コンボ数はケージ側の「○○ COMBO」に出す。big ではキャラ拡大（116px→156px）＋ #game-canvas に CSS シェイク。素材は `src/assets/cage.png`（メディア生成したデフォルメのオリジナルイラスト。白背景を PIL で端からのフラッドフィル透過化し、ステッカーの白フチを残した 440×653、約340KB）。実在俳優の写真は使っていない。テスト用の入口 `setCombo` でも発火する（debugSetCombo 経由）。
  - **歌詞の3行表示**（オーナー指示「画面の上か下に3行程度、他の演出の邪魔にならないように」→ 判定ラインの下の帯に配置）。データは `src/data/lyrics.json`（`scripts/extract-lyrics.py` が元動画2本の mov_text 字幕から生成。再実行で作り直せる）。字幕はカラオケ式のスクロール字幕（各キューが前／今／次の3行ウィンドウ）で、今の行は「3行キューでは中央、2行キューでは最初のキューだけ先頭・それ以外は末尾、『♪』だけのキューは間奏」として再構成した。行の時刻はその行が今の行になるキューの区間。編集は頭からの切り取りのみなので再マッピング不要で、尺（charts.json の durationMs）で切り取り・クランプ済み（石畳 18行 / Kiso Night 36行）。表示は main.ts の `showLyric`（DOM の #lyrics、game.ts が `lyricIndexAt`（logic の純関数、二分探索）の変化を onLyric で通知）: 前=薄く小さい、今=明るく太字、次=薄く小さい。行替わりで今の行にフェード（pop アニメーション）。間奏など行のない区間は3行とも空。設定モーダルに「歌詞表示」トグル（保存キー `lyrics`、既定オン。off で #lyrics を hidden）。data 属性は `lyricIndex` / `lyrics`。
- v1.7.1 の変更:
  - **長押しの帯が尾より先に消える不具合を修正**（オーナー実機報告「長押しが見た目の長さより先に判定が終わるように見える」）。原因は判定ではなく描画: `src/game.ts` の帯描画の画面外カリングが「頭の仮想位置が画面下端+40px を超えたら打ち切り」で、頭は消費後も仮想位置が落下し続けるため、頭の時刻から約0.29×落下時間（実測 915px 画面・easy で約547ms）で帯と尾キャップが丸ごと消えていた。実測（highway/easy 最初の長押し 891ms）では、尾がラインの約120px 上にある時点で帯が消え、最後の約344ms が見えなかった（hard の 1780ms の長押しでは約1.4秒）。判定ロジック（`advanceHold`）の完走は尾ちょうどで正しく、実測でも尾+16ms（1フレーム）で発火していた。修正: カリングを「尾が画面下端を過ぎるまで描く」に変更。帯が消えたところで離すと尾より前に失敗になる、という二次被害もこれで解消。
  - **完走タイミングの定義を明文化**（docs/CHART-DESIGN.md の「長押しの完走タイミング」）。完走は保持中・grace 到達時とも尾の時刻ちょうどで、尾より前に完走表示は出ない。tick はスコア専用で完走を前倒ししない。grace は尾の 100ms 以前の離しへの救済としてのみ働く（完走表示は尾まで出ない）。`tests/hold.test.ts` に完走時刻を固定するテストを3件追加（保持中の尾ちょうど／grace でも尾まで出ない／猶予が尾に届かなければ失敗）。
  - E2E に「長押しの帯が尾まで見え続ける」を追加（完走までの間に帯の上端がラインの 60px 以内まで届くことを Canvas のピクセルで確認。時刻でなく空間で見るので時計の寄れに強い。修正前のコードでは落ちることを確認済み）。頭ヒットの連打は幅広め（-500ms〜+1000ms、50ms 間隔）にしてある。
- v1.7.0 の変更:
  - **コンボ連動エフェクト**（オーナー指示）。コンボ tier は `src/logic.ts` の `COMBO_TIER_STARTS = [0, 10, 25, 50, 100]`（tier 0〜4）が正本で、`comboTier` / `effectiveTier`（FEVER 中 +1、上限あり）/ `tierFx`（tier ごとの演出パラメータ）/ `isComboMilestone`（50 ごと）が純関数。game.ts はヒット時に tier を確定して burst・判定文字・ヒット音へ渡し、フラッシュとコンボ表示はフレームごとの tier で描く。節目表示は「○○ COMBO」を 0.9 秒。MISS（通常・長押し失敗とも）でコンボ 0 ＝ tier 0 に戻る。粒子は上限 `MAX_PARTICLES = 300`＋プール再利用（game.ts の spawnParticle）。data 属性に `combo` / `comboTier` / `milestone` を出し、テスト用の入口に `setCombo(n)`（main.ts → game.debugSetCombo）を追加。shots の `game-combo` 画面が最高 tier の見た目を撮る。
  - **ヒット音を作り替え**（オーナー指示）。`src/sound.ts` の `HIT_TONE` がパラメータの正本: アタック（ハイパス 3200Hz のノイズ 12〜16ms）＋本体（三角波、ピッチダウン endRatio 約0.56〜0.6、減衰 60〜90ms）＋倍音（2倍音、sparkle 比率。perfect 0.35 / great 0.15 / good 0）。`hitToneFor(judge, tier)` が tier ごとに +1 半音（上限 +4、logic.ts の hitPitchMultiplier）。長押し tick は `TICK_TONE` / `playTickSound(tier)`（peak 0.05・減衰 45ms の軽量版。v1.6.0 までは tick 無音だった）。ヒット音は専用バス（ゲイン 0.9 → DynamicsCompressor → マスター）を通す。`app:sound` イベントの detail に tier を追加（kind は hit / tick）。
- v1.6.0 の変更:
  - **楽曲を音ゲー用ショート編集に差し替え**（オーナー指示「曲が長いので1番だけ／音ゲー用に編曲」→ 市販音ゲーの標準形＝イントロ→1番→サビで気持ちよく終わる約2分編集を採用）。構成は元動画の歌詞字幕（mov_text）と小節ごとの RMS で特定し、カットは小節頭に合わせ、末尾にフェードアウトを付けた（ffmpeg で再エンコード、MP3 192kbps）。内部のつなぎ目はなく、編集後の拍トラッキングは全長版の拍列と平均1.5ms以内で一致することを確認済み。
    - 石畳のハイウェイ: 179.6秒 → **104.76秒**。イントロ〜1番（A・Bメロ）〜サビ1（57〜96秒）＋間奏4小節を残し、小節59頭（104.756秒）でカット、最後の2.0秒（102.756秒〜）にフェードアウト。
    - Kiso Night Silhouette: 179.9秒 → **127.73秒**。イントロ〜1番〜サビ1（44〜67秒）〜2番〜サビ2（96〜127.7秒）までを残し、小節80頭（127.730秒＝サビ2終了）でカット、最後の1.6秒（126.130秒〜）にフェードアウト。サビのフレーズを完結させるため、目標の 100〜125秒を少し超える長さにした。
  - **全長版は `assets-full/` に退避**（dist には含まれない）。編集の再現手順と、全長版に戻すときの FEVER 値（石畳 [[57, 96], [144, 174]] / Kiso Night [[44, 67], [96, 128], [140, 164]]）は `assets-full/README.md` に記録。
  - FEVER を編集後のタイムラインに再設定（石畳 [[57, 96]]、Kiso Night [[44, 67], [96, 127]]。logic のバリデーションで FEVER 終端 ≦ 曲の長さ が必須なので、Night の第2区間の終端は 128 ではなく 127）。
  - 譜面は v3方式のまま再生成。内訳: 石畳 146/263/350（同時押し hard 8組・normal 1組、長押し 5/14/15本・合計 3.6/13.8/15.2秒）、Kiso Night 191/383/499（同時押し hard 8組・normal 2組、長押し 6/10/15本・合計 2.4/5.2/11.6秒）。ズレ実測（hard、実拍細分位置との差）: 平均|ズレ| 石畳 7.3ms／Night 7.6ms、|ズレ|>30ms は 2.3%／3.2%、区間ごとの平均ズレは ±3.8ms 以内で v1.5.0 水準を維持。
  - `tests/logic.test.ts` の「曲の長さ」の範囲チェックを全長版（170〜185秒）から編集版（95〜135秒）に更新。メニューの尺表示は charts.json の durationMs 由来なので自動で編集版の尺になる（shots で 1:45 を確認）。shots のゲーム画面のタイミングは、highway の最初の長押し（5.6秒・レーン0・891ms）が再生成後も不変だったため変更なし。
  - ベストスコアは曲ID（highway/night）単位で端末に残るが、譜面が変わったため参考値になる（アプリID・曲ID は不変）。
- v1.5.0 の変更:
  - **長押し（ホールド）を実装**。譜面データは `[時刻ms, レーン, 長押しms?]`（3要素目があれば長押し）。判定仕様の正本は `docs/CHART-DESIGN.md`（調査メモと一体）。要点: 頭は通常タップと同じ判定窓／押し続けると1拍ごとに100点（FEVER中2倍）／押し切ると頭の判定スコアの半分のボーナス／途中で離しても100ms以内の押し直しはセーフ（grace）、過ぎると失敗＝ミス＋コンボリセット／集計は「頭の判定＋完走可否」で PERFECT/GREAT/GOOD/MISS のいずれかに数え、精度の式は不変。
  - 状態遷移は `src/logic.ts` の純関数（`beginHold` / `releaseHold` / `repressHold` / `advanceHold`、定数 `HOLD_GRACE_MS` / `HOLD_TICK_SCORE` / `HOLD_COMPLETE_BONUS`）に分離し、`tests/hold.test.ts`（13件）で検証する。tick は「押せている間」だけ数え、grace 中に来た拍境界は捨てる。離したまま尾を過ぎても、grace の終わりが尾に届いていれば完走扱い。
  - 入力（`src/game.ts`）: ポインタは pointerId ごとにレーンを保持し `setPointerCapture` する。指がレーンをまたいだら旧レーンは離した扱い・新レーンは押した扱い。キーボードは押下状態を保持し、`e.repeat` は無視する（長押し中の他レーンタップがマルチタッチ／キー併用で可能）。描画は判定ラインへ伸びる帯＋頭・尾キャップ、押せている間は帯が光り判定枠も光る、grace 中は帯が明滅する。E2E 用に `data-holds-completed` / `data-holds-failed`（dataset キーは `holdsCompleted` / `holdsFailed`）を出す。
  - **譜面を全面再生成（生成方式 v3）**。一般の音ゲーの譜面論（osu!mania ガイド等）を調査し `docs/CHART-DESIGN.md` にまとめたうえで、選定方式を「強度順の貪欲ピック」から「フレーズ単位のパターン割り当て」に変更した。半小節を単位に型（階段／波／交互／交差／縦連／トリル／ロール／16分波）を割り当て、レーンは型の平行移動・鏡像フィットを流れと分布のコストで選ぶ。サビ（FEVER）のフレーズは最初のサビのパターンの並び（モチーフ）を再登場させ、2回目は鏡像、3回目は末尾の型を変える。サビ内でも後半は前半を繰り返す。
  - 同時押し: サビの小節頭・フレーズの最高エネルギー小節頭・サビ先頭など特に強い拍に2レーン（hard 石畳17組／Night13組、normal 4組／3組、easy はなし）。長押し: 強いオンセットの後に次の強いオンセットまで間が空き、その間 RMS が持続する場所に置き、長さは拍単位に丸める（hard 15本・合計 約12.9秒／約10.8秒、normal 12本／15本、easy 6本・短めのみ）。easy は長押し中に他のノーツがなく、normal は長押し中の他レーンノーツが2個以下、hard は長押し中の他レーンタップあり。
  - 入れ子（easy ⊆ normal ⊆ hard）は (時刻, レーン) で維持。normal は hard の8分位置の骨格＋バーストの先頭だけを残し、レーン往復の間引き（`thin`、総数上限 normal 410 / easy 210）で整える。同一レーン3連続は原則禁止のまま、例外として hard の縦連（間隔170ms以上の3連）のみ許可し、`tests/charts.test.ts` もその規則に更新した。実体化の段階で難易度の部分列（h/n/e）ごとに3連続を作らないようレーンを選ぶ（v2 の assign_lanes の考え方を Realizer に移植）。
  - スナップ窓を ±50ms → ±38ms に狭めた。遠いオンセットピークは別のリズム事象（裏の音など）のことが多く、寄せると拍グリッドから離れてズレ統計が悪化するため。効果（hard）: 平均|ズレ| 石畳 7.1ms／Night 7.7ms、|ズレ|>30ms は 1.6%／3.9%（v2 の 4%／5% から改善）。3分割の区間平均ズレは全難易度 ±3.3ms 以内。
  - 遊び方の説明に長押しを追加（メニューの1行と README）。shots のゲーム画面は、最初の長押しの帯が頭から尾まで見えるタイミング（READY 2秒＋曲の約5.3秒）に調整した。
- v1.4.0 の変更:
  - **譜面を全面再生成（生成方式 v2）**。v1 の「位相＋周期の中央値による固定間隔グリッド」は、周期の推定誤差（石畳 441.18ms vs 実測 444.53ms、Kiso Night 394.74ms vs 399.83ms）が累積し、グリッドと実拍のズレが曲の中で回転していた（グリッド線と実拍の差: 石畳 +604ms→−557ms、Kiso Night +1184ms→−952ms）。「リズムと譜面が合っているか分からない」というオーナー指摘の正体はこれで、実機のズレではない。
  - v2 方式: 実測拍列を「回帰直線＋残差の移動平均」で平滑化し、16分スロットは隣り合う拍間を4等分して補間（累積ドリフトなし）。選んだスロットの ±50ms 内に強いオンセットピークがあればノーツをそのピークへスナップ（石畳 79%、Kiso Night 86% のノーツがスナップされた）。密度は小節ごとの RMS エネルギーに連動し、FEVER境界とエネルギーの落ち際の直前には約半拍の休符を作る。レーンは音高任せをやめ、流れのコスト最小化（隣接ステップ優先、同一レーン3連続禁止は難易度の部分列でも適用、0↔3跳躍は250ms以上＋アクセント時のみ、小節頭アンカー、分布均し）で決定。各レーン 18〜32%。
  - 効果（hard譜面、ノーツと実拍細分位置のズレ）: |ズレ|>30ms のノーツは 石畳 41%→4%、Kiso Night 39%→5%。平均|ズレ| は約26ms→約8〜9ms。3分割した各区間の符号付き平均ズレは全難易度で ±4ms 以内（回転ドリフト解消）。
  - charts.json に実測拍列 `beats`（ms、両端は回帰周期で延長）を保存。ゲーム本体は読まない（互換維持）。単体テスト `tests/charts.test.ts` が「全ノーツが細分位置から70ms以内」「区間ごとの平均ズレ20ms以内」「レーン分布18〜32%」「3連続なし」「入れ子」を検証する。
  - 表示 BPM を実測の整数値に修正（136→135、152→150）。BPM はデータ由来表示なのでエンジン側の変更なし。
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
- 検証: `npm run verify` 全通過（単体テスト101件、うちホールド16件・譜面の整合検証18件・歌詞5件・ケージのパターン決定3件・音まわりはタンバリンのパラメータ検証と連打・空タップの検証を含む）、両親指チェッカー（`scripts/check-two-thumb.py`）で違反 0 件、E2E 24件全通過（今回は flaky リトライなし。実時間テストの従来からの揺れはあり、この VM の全並行実行では長押し系が負荷で落ちることがあるが、直列実行と CI が正）、オートプレイ全通し（`scripts/verify-autoplay-full.mjs`）で両曲・hard がフルコンボ完走、shots 15枚でゲーム画面（5.6秒・レーン0の長押し帯・歌詞3行）・game-combo（100コンボ・ghostrider の背景がピークで完全に置き換わり、判定枠・ラインが明瞭＋上部のセリフピル）・ホーム（タイトル「キソケイジビート」、尺表示 1:45）を目視確認済み（通常登場の treasure 背景のピークでも、暗幕の補正込みでノーツが埋もれないことも追加の一時撮影で確認）。設定モーダルはデバッグ ON 状態も一時撮影で確認（phone は全項目が収まり、SE はダイアログ内スクロールで「閉じる」まで届く）
- 単体プレビュー: `dist-preview/preview.html`（約8.3MB）

## やりかけ

- なし

## 次にやること(優先順)

1. **iPhone 実機で音が出るか再確認する**（v1.2.0 の音声対策の最終確認。マナーモード ON でも鳴るか、ホーム画面アプリでの起動・オフライン・上端のぼやけもあわせて）。v1.8.2 の文字選択禁止（長押しでコールアウトや選択が出ないか）も実機で確認する。更新は「更新」ボタンで切り替わるので、旧版のままになっていないかバージョン表示（v1.3.0）も見る。振動は Android 実機で確認する
2. 遊んだ感触で譜面の密度や FEVER 区間を調整したくなったら、`scripts/generate-charts.py` の SONGS の fever（区間）や定数（HARD_CAP / NORMAL_CAP / EASY_CAP、パターンの確率）を変えて再生成し、版を上げて公開する（生成方式は v4＝両親指前提。固定間隔グリッドに戻さない。両親指制約は `scripts/check-two-thumb.py` が正本で、生成時に自動検証される。設計の根拠は docs/CHART-DESIGN.md）。再生成したら `scripts/verify-autoplay-full.mjs` の全通し確認も回すこと
3. ヒット音の音色や演出の強さを調整したくなったら、`src/sound.ts` の TAMB_PARTIALS / TAMB_GRAINS / TAMB_AIR / TAMB_JUDGE・tambourineFor（通常タップのタンバリン音）/ HOLD_BLIP・HOLD_STREAM（長押しの連打）/ EMPTY_BLIP（空タップ音）/ COMPLETE_BLIP / FAIL_BLIP、コンボ演出は `src/logic.ts` の TIER_FX と COMBO_TIER_STARTS、ケージのパターン・ズーム種別は `src/logic.ts` の CAGE_PATTERN_ROTATION / CAGE_BIG_PATTERNS / CAGE_PATTERN_ZOOM、背景の濃さ・ズーム量・滞在時間は `src/game.ts` の CAGE_BG_* 定数、セリフは `src/main.ts` の CAGE_PATTERN_LINES、滞在時間は `src/main.ts` の CAGE_SHOW_MS と `src/style.css` の cage-fade の duration も合わせる、`src/game.ts` の演出の定数（RING_LIFE など）を変える

## 注意・気づいたこと

- 音源は MP3 にすること。AAC/m4a はヘッドレス Chromium が decodeAudioData できず、E2E のゲーム開始テストが成立しない（iPhone Safari は MP3 可）。
- 音源は編集版で約2.5MB（石畳）＋約3.1MB（Kiso Night）。precache に入れるため vite.config.ts の workbox `maximumFileSizeToCacheInBytes` を 6MB に上げてある（全長版に戻しても入る）。
- 音源・ジャケットは `src/assets/` から import する方式（public/ 直置きだと build:preview に入らない）。
- 譜面生成の Python 環境は `.venv/`（librosa）。/tmp は tmpfs で容量が小さいので venv を置かない。
- ヒット音・演出はすべて曲と同じ AudioContext と経過時間（dt）ベース。フレーム数ベースに戻さないこと（120Hz で見え方が変わる）。
- E2E のヒットテストは実時間依存で揺れるため、ページ内インターバルでキーを押し続ける方式＋リトライ2回にしてある（`test.describe('ヒット判定（実時間）')`）。CDP 経由でノーツ時刻に1発だけ合わせる方式は、並行実行の負荷で外れるので戻さないこと。長押しテストも同じ考え方で、頭の前後（-300ms〜+900ms）に keydown を繰り返し送って判定窓に必ず1回入れる（長押し中は同じレーンに他のノーツがないので無害）。
- `setData`（src/debug.ts）のキーは dataset の制約で「ハイフン＋小文字」が使えない（`dataset['holds-completed']` は SyntaxError になり、start() が落ちて全テストが連鎖失敗する）。キーはキャメルケースで書き、属性名は自動で data-holds-completed の形になる。

## 再開のときの指示文

```
docs/HANDOVER.md と最近の変更(git log)を読んで、今の状態と最初の作業の案を出して。
```

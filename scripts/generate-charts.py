#!/usr/bin/env python3
"""譜面生成 v2: src/assets/*.mp3 を解析して src/data/charts.json を作る。

v1（固定間隔グリッド）からの変更点:
- 拍グリッドは「位相＋周期の中央値」の固定間隔をやめ、librosa の実測拍列に沿わせる。
  固定周期の推定誤差が曲の中で累積し、グリッドと実拍のズレが回転してしまうため
  （v1 実測: 石畳は冒頭 +604ms → 終盤 -557ms、Kiso Night は +1184ms → -952ms）。
  拍列は「全体の回帰直線＋残差の移動平均」で平滑化し、16分スロットは隣り合う拍の
  間を4等分して補間する（累積ドリフトが原理的に出ない）。
- 選んだスロットの近く（±50ms）に強いオンセットピークがあれば、ノーツ時刻を
  そのピークへ寄せる（スナップ）。
- 密度は小節ごとの RMS エネルギーに連動させ、節の切れ目（FEVER境界・エネルギー
  の落ち際）の直前には小さな休符を作る。
- レーンは音高任せをやめ、流れ（隣接ステップ優先・同一レーン3連続禁止・跳躍の
  条件・小節頭のアンカー・分布の均し）をコスト最小化で決める。音高は同点時の参考。
- charts.json に実測拍列（beats、ms。両端は回帰周期で延長）も保存し、単体テストが
  「ノーツと拍細分位置のズレ」「区間ごとの回転ドリフトなし」を検証できるようにする。
  ゲーム側（src/logic.ts の SongData）は beats を無視するので互換性は保たれる。
- 表示 BPM は回帰から求めた実測値（整数）。

使い方: .venv/bin/python scripts/generate-charts.py
前提: .venv に librosa、PATH に ffmpeg（mp3 を wav に変換するため）
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import librosa

ROOT = Path(__file__).resolve().parent.parent
SR = 22050
HOP = 512

SONGS = {
    "highway": {
        "title": "石畳のハイウェイ",
        "audio": "src/assets/highway.mp3",
        # サビ「ニコラス・ケイジ 幻じゃない〜」の繰り返し区間（字幕）と RMS 盛り上がり（-13dB台）の一致区間
        "fever": [[57, 96], [144, 174]],
    },
    "night": {
        "title": "Kiso Night Silhouette",
        "audio": "src/assets/night.mp3",
        # サビ「Kono tokimeki wa nani〜」の繰り返し区間（字幕）と RMS 盛り上がりの一致区間
        "fever": [[44, 67], [96, 128], [140, 164]],
    },
}

START_MS = 2000  # 最初のノーツはイントロ後
END_MARGIN_S = 1.2  # 最後のノーツは曲終了のこれ以上前に置く
# 難易度ごとの (最小間隔ms, 最大ノーツ数)。細分はスロットの sub（拍内位置 0-3）で決める:
# easy は拍位置（sub=0）、normal は8分（sub 偶数）、hard は16分（全部）。入れ子構造。
LEVELS = {
    "hard": {"min_gap_ms": 150, "cap": 680},
    "normal": {"min_gap_ms": 190, "cap": 360},
    "easy": {"min_gap_ms": 300, "cap": 190},
}
SNAP_WINDOW_MS = 50  # オンセットピークへ寄せる範囲
SNAP_MIN_GAP_MS = 100  # スナップ後に許す最小間隔（これ未満は弱い方を落とす）
LANE_MIN_SHARE = 0.18  # レーン分布の下限（単体テストでも検証）
LANE_MAX_SHARE = 0.32  # レーン分布の上限（単体テストでも検証）


def to_wav(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ar", str(SR), "-ac", "1", str(dst)],
        check=True,
    )


def smoothed_beats(y, sr):
    """実測拍列を平滑化して (拍時刻[s], 回帰周期[s], 実測BPM) を返す。

    平滑化は「拍番号→時刻の回帰直線」＋「残差の移動平均（9拍）」。回帰が全体の
    累積位置（端点）を保ち、移動平均が局所的な追随を残す。最後に単調増加を保証する。
    """
    _, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    beats = np.asarray(beats, dtype=float)
    k = np.arange(len(beats), dtype=float)
    slope, intercept = np.polyfit(k, beats, 1)
    resid = beats - (intercept + slope * k)
    w = 9
    pad = w // 2
    smooth_resid = np.convolve(np.pad(resid, pad, mode="edge"), np.ones(w) / w, mode="valid")
    smoothed = intercept + slope * k + smooth_resid
    min_step = slope * 0.5
    for i in range(1, len(smoothed)):
        if smoothed[i] < smoothed[i - 1] + min_step:
            smoothed[i] = smoothed[i - 1] + min_step
    return smoothed, float(slope), 60.0 / float(slope)


def extend_beats(beats, period, duration):
    """拍列の両端を回帰周期で延長し、曲全体（0〜duration）を覆う拍列にする。"""
    pre = []
    t = beats[0] - period
    while t > -period:
        pre.append(t)
        if t <= 0:
            break
        t -= period
    post = []
    t = beats[-1] + period
    while t < duration + period:
        post.append(t)
        t += period
    return np.array(pre[::-1] + list(beats) + post, dtype=float)


def build_slots(ext_beats, period):
    """16分スロット列。各スロットは dict(beat=拍番号, sub=拍内位置0-3, time=秒)。"""
    slots = []
    for i, bt in enumerate(ext_beats):
        nxt = ext_beats[i + 1] if i + 1 < len(ext_beats) else bt + period
        for sub in range(4):
            slots.append({"beat": i, "sub": sub, "time": float(bt + (nxt - bt) * sub / 4)})
    return slots


def bar_energies(y, sr, ext_beats):
    """小節（4拍）ごとの RMS エネルギーを 0..1 に正規化して返す（拍番号//4 がキー）。"""
    raw = {}
    n = len(ext_beats)
    for bar_start in range(0, n - 4, 4):
        t0, t1 = ext_beats[bar_start], ext_beats[bar_start + 4]
        i0 = max(0, int(t0 * sr))
        i1 = min(len(y), int(t1 * sr))
        if i1 <= i0:
            continue
        rms = float(np.sqrt(np.mean(y[i0:i1] ** 2)))
        raw[bar_start // 4] = 20 * np.log10(max(rms, 1e-6))
    if not raw:
        return {}
    vals = np.array(list(raw.values()))
    lo, hi = np.percentile(vals, 10), np.percentile(vals, 95)
    span = max(hi - lo, 1e-9)
    return {bar: float(min(1.0, max(0.0, (v - lo) / span))) for bar, v in raw.items()}


def slot_strengths(onset_env, sr, times):
    """各スロット時刻の前後 ±45ms でのオンセット強度の最大値。"""
    out = []
    for t in times:
        c = int(t * sr / HOP)
        w = max(1, int(0.045 * sr / HOP))
        lo, hi = max(0, c - w), min(len(onset_env), c + w + 1)
        out.append(float(onset_env[lo:hi].max()) if hi > lo else 0.0)
    return np.array(out)


def onset_peaks(onset_env, sr):
    """強いオンセットピークの (時刻[s], 強さ) 列。局所最大かつ高さが局所最大の55%以上。"""
    env = onset_env
    idx = [i for i in range(1, len(env) - 1) if env[i] >= env[i - 1] and env[i] >= env[i + 1] and env[i] > 0]
    if not idx:
        return []
    heights = env[idx]
    thr = np.percentile(heights, 55)
    return [(i * HOP / sr, float(env[i])) for i in idx if env[i] >= thr]


def pick(candidates, min_gap_ms, cap):
    """candidates: [note dict] を score の高い順に、最小間隔を守って選ぶ。"""
    chosen = []
    for note in sorted(candidates, key=lambda c: (-c["score"], c["time_ms"])):
        if len(chosen) >= cap:
            break
        if all(abs(note["time_ms"] - ct["time_ms"]) >= min_gap_ms for ct in chosen):
            chosen.append(note)
    return sorted(chosen, key=lambda c: c["time_ms"])


def snap_notes(notes, peaks):
    """各ノーツを ±SNAP_WINDOW_MS 内の最強オンセットピークへ寄せる。スナップした数を返す。"""
    snapped = 0
    for note in notes:
        t = note["time_ms"] / 1000
        best = None
        for pt, ps in peaks:
            d = abs(pt - t)
            if d * 1000 <= SNAP_WINDOW_MS and (best is None or ps > best[1]):
                best = (pt, ps)
        if best is not None:
            new_ms = int(round(best[0] * 1000))
            if new_ms != note["time_ms"]:
                snapped += 1
            note["time_ms"] = new_ms
    return snapped


def enforce_min_gap(notes, min_gap_ms):
    """スナップ後の間隔を再検証し、近すぎる組は弱い方を落とす。落とした数を返す。"""
    kept = []
    dropped = 0
    for note in sorted(notes, key=lambda c: c["time_ms"]):
        if kept and note["time_ms"] - kept[-1]["time_ms"] < min_gap_ms:
            weaker = note if note["strength"] < kept[-1]["strength"] else kept[-1]
            if weaker is kept[-1]:
                kept[-1] = note
            dropped += 1
            continue
        kept.append(note)
    return kept, dropped


def pitch_lanes(y, sr, times_s):
    """音高（piptrack の中央値）の四分位レーン。レーン決定では同点時の参考にだけ使う。"""
    f0, mag = librosa.piptrack(y=y, sr=sr, fmin=80, fmax=1200)
    midis = []
    for t in times_s:
        c = int(t * sr / HOP)
        lo, hi = max(0, c - 2), min(f0.shape[1], c + 3)
        vals = []
        for j in range(lo, hi):
            k = int(np.argmax(mag[:, j]))
            if mag[k, j] > 0 and f0[k, j] > 0:
                vals.append(librosa.hz_to_midi(f0[k, j]))
        midis.append(float(np.median(vals)) if vals else 60.0)
    q = np.percentile(midis, [25, 50, 75])
    return [int(np.searchsorted(q, m)) for m in midis]


def assign_lanes(notes):
    """流れのコスト最小化でレーンを決める（notes は時刻順、in-place で lane を書く）。

    制約: 同一レーン3連続禁止 / 16分間隔での同一レーン連打は強いアクセント時のみ /
          0<->3 の跳躍は間隔250ms以上かつ強いアクセントのときだけ。
    コスト: 隣接ステップを優遇し、小節頭は小節パリティのアンカーに寄せ、
          レーン分布が偏ると割高になる。音高レーンは同点時の参考程度。
    """
    if not notes:
        return
    strengths = np.array([n["strength"] for n in notes])
    accent_thr = np.percentile(strengths, 75)
    # 難易度は入れ子なので、レーンの制約は hard 全体だけでなく、実際に normal/easy
    # へ残るノーツの部分列でも効かせる（プレイヤーが見るのは各難易度の部分列だから。
    # 部分列から間引かれたノーツは runs をつないでしまうので、所属は選択結果の
    # フラグ in_normal / in_easy で正確に見る）。
    # level: h=全ノーツ, n=normal に残るノーツ, e=easy に残るノーツ
    def levels_of(note):
        lv = ["h"]
        if note.get("in_normal"):
            lv.append("n")
        if note.get("in_easy"):
            lv.append("e")
        return lv

    counts = {"h": [0, 0, 0, 0], "n": [0, 0, 0, 0], "e": [0, 0, 0, 0]}
    totals = {"h": 0, "n": 0, "e": 0}
    last_lane = {"h": None, "n": None, "e": None}
    run = {"h": 0, "n": 0, "e": 0}
    prev_lane = None
    for i, note in enumerate(notes):
        accent = note["strength"] >= accent_thr
        gap = note["time_ms"] - notes[i - 1]["time_ms"] if i > 0 else 10 ** 9
        anchor = 1 if (note["bar"] % 2 == 0) else 2
        my_levels = levels_of(note)

        def choose(strict):
            best_lane, best_cost = None, None
            for lane in range(4):
                if any(last_lane[lv] == lane and run[lv] >= 2 for lv in my_levels):
                    continue  # どの難易度の部分列でも同一レーン3連続は禁止（絶対）
                penalty = 0.0
                if prev_lane is not None:
                    delta = abs(lane - prev_lane)
                    if lane == prev_lane and gap < 200 and not accent:
                        if strict:
                            continue  # 細かい間隔での連打はアクセント時だけ
                        penalty += 3.0
                    if delta == 3 and not (gap >= 250 and accent):
                        if strict:
                            continue  # 端から端への跳躍は条件付き
                        penalty += 2.0
                    move = {0: 0.25 if accent else 0.55, 1: 0.0, 2: 0.5, 3: 0.9}[delta]
                else:
                    move = 0.0
                cost = move + penalty
                cost += 2.2 * (counts["h"][lane] / max(1, totals["h"]))  # 分布の均し
                for lv in my_levels[1:]:
                    cost += 1.2 * (counts[lv][lane] / max(1, totals[lv]))  # 部分列の分布も均す
                cost += 0.06 * abs(lane - note["pitch_lane"])  # 音高は参考程度
                if note["sub"] == 0 and note["beat"] % 4 == 0 and lane == anchor:
                    cost -= 0.35  # 小節頭のアンカー
                if best_cost is None or cost < best_cost:
                    best_lane, best_cost = lane, cost
            return best_lane

        best_lane = choose(strict=True)
        if best_lane is None:
            # 跳躍・連打の条件を緩めても3連続だけは作らない（3連続を禁じるレーンは
            # 最大で難易度の数=3つまでなので、必ず1レーンは空く）
            best_lane = choose(strict=False)
        note["lane"] = best_lane
        for lv in my_levels:
            counts[lv][best_lane] += 1
            totals[lv] += 1
            run[lv] = run[lv] + 1 if best_lane == last_lane[lv] else 1
            last_lane[lv] = best_lane
        prev_lane = best_lane


def subdivision_positions(ext_beats):
    """拍列から作る16分細分位置（秒）の配列。ズレ検証用。"""
    pos = []
    for i, bt in enumerate(ext_beats):
        nxt = ext_beats[i + 1] if i + 1 < len(ext_beats) else bt + (ext_beats[i] - ext_beats[i - 1])
        for sub in range(4):
            pos.append(float(bt + (nxt - bt) * sub / 4))
    return np.array(pos)


def drift_stats(charts, subdiv, duration_ms):
    """難易度ごとに、ノーツと最寄り細分位置の符号付きズレ（ms）の統計を返す。

    曲を3分割した各区間の平均ズレが小さい＝回転ドリフトがないことの確認用。
    """
    stats = {}
    edges = [0, duration_ms / 3, 2 * duration_ms / 3, duration_ms + 1]
    for diff, notes in charts.items():
        deltas = []
        for t_ms, _lane in notes:
            t = t_ms / 1000
            j = int(np.argmin(np.abs(subdiv - t)))
            deltas.append((subdiv[j] - t) * 1000)  # 細分位置 − ノーツ（符号付き）
        deltas = np.array(deltas)
        times = np.array([n[0] for n in notes], dtype=float)
        thirds = []
        for s in range(3):
            mask = (times >= edges[s]) & (times < edges[s + 1])
            d = deltas[mask]
            thirds.append(
                {
                    "mean": round(float(d.mean()), 1) if len(d) else 0.0,
                    "p90abs": round(float(np.percentile(np.abs(d), 90)), 1) if len(d) else 0.0,
                    "n": int(len(d)),
                }
            )
        stats[diff] = {
            "mean": round(float(deltas.mean()), 1),
            "p90abs": round(float(np.percentile(np.abs(deltas), 90)), 1),
            "maxabs": round(float(np.abs(deltas).max()), 1),
            "thirds": thirds,
        }
    return stats


def validate(name, charts, duration_ms):
    counts = {}
    prev = None
    for diff in ("easy", "normal", "hard"):
        notes = charts[diff]
        counts[diff] = len(notes)
        times = [n[0] for n in notes]
        assert times == sorted(times), f"{name}/{diff}: 時刻が昇順でない"
        assert len({(n[0], n[1]) for n in notes}) == len(notes), f"{name}/{diff}: 同刻・同レーン重複"
        assert all(0 <= n[1] <= 3 for n in notes), f"{name}/{diff}: レーン範囲外"
        assert times[0] >= START_MS, f"{name}/{diff}: 最初のノーツが早すぎる {times[0]}"
        assert times[-1] <= duration_ms - int(END_MARGIN_S * 1000), f"{name}/{diff}: 最後のノーツが遅すぎる {times[-1]}"
        # 同一レーン3連続禁止
        lanes = [n[1] for n in notes]
        assert not any(lanes[i] == lanes[i + 1] == lanes[i + 2] for i in range(len(lanes) - 2)), f"{name}/{diff}: 同一レーン3連続"
        # レーン分布 18〜32%
        for lane in range(4):
            share = lanes.count(lane) / len(lanes)
            assert LANE_MIN_SHARE <= share <= LANE_MAX_SHARE, f"{name}/{diff}: レーン{lane}の割合 {share:.2f} が範囲外"
        if prev is not None:
            assert prev <= len(notes), f"{name}: ノーツ数が単調増加でない {counts}"
        prev = len(notes)
    # 入れ子構造: easy ⊆ normal ⊆ hard（時刻・レーンの組で）
    hard_set = {(n[0], n[1]) for n in charts["hard"]}
    normal_set = {(n[0], n[1]) for n in charts["normal"]}
    easy_set = {(n[0], n[1]) for n in charts["easy"]}
    assert easy_set <= normal_set <= hard_set, f"{name}: 入れ子構造が崩れている"
    return counts


def main() -> int:
    out = {}
    report = {}
    with tempfile.TemporaryDirectory() as td:
        for song_id, meta in SONGS.items():
            wav = Path(td) / f"{song_id}.wav"
            to_wav(ROOT / meta["audio"], wav)
            y, sr = librosa.load(str(wav), sr=SR, mono=True)
            duration = float(librosa.get_duration(y=y, sr=sr))
            duration_ms = int(round(duration * 1000))

            beats, period, bpm = smoothed_beats(y, sr)
            ext_beats = extend_beats(beats, period, duration)
            onset_env = librosa.onset.onset_strength(y=y, sr=sr)
            energies = bar_energies(y, sr, ext_beats)

            # 演奏が実質終わる時刻（RMS が -25dB を切る最後の秒）
            rms = [float(np.sqrt(np.mean(y[i:i + sr] ** 2))) for i in range(0, len(y) - sr, sr)]
            loud_secs = [i for i, r in enumerate(rms) if 20 * np.log10(max(r, 1e-6)) > -25]
            eff_end = min(duration - END_MARGIN_S, (loud_secs[-1] + 1) if loud_secs else duration)

            # 節の切れ目: FEVER境界＋エネルギーの落ち際の小節頭。その直前 約半拍に休符を作る
            boundaries = set()
            for f0, f1 in meta["fever"]:
                boundaries.add(float(f0))
                boundaries.add(float(f1))
            bar_list = sorted(energies)
            for a, b in zip(bar_list, bar_list[1:]):
                if energies[a] > 0.45 and energies[b] < energies[a] * 0.55:
                    bar_time = float(ext_beats[b * 4]) if b * 4 < len(ext_beats) else None
                    if bar_time is not None:
                        boundaries.add(bar_time)
            rest_windows = [(b - period * 0.5, b) for b in boundaries if START_MS / 1000 < b < eff_end]

            def in_rest(t):
                return any(lo <= t < hi for lo, hi in rest_windows)

            # 16分スロットに強度とスコア（エネルギー連動）を付ける
            slots = [s for s in build_slots(ext_beats, period) if START_MS / 1000 <= s["time"] < eff_end and not in_rest(s["time"])]
            strengths = slot_strengths(onset_env, sr, [s["time"] for s in slots])
            s95 = np.percentile(strengths, 95) if len(strengths) else 1.0
            floor = np.percentile(strengths, 15)
            notes_all = []
            for s, st in zip(slots, strengths):
                if st < floor:
                    continue
                energy = energies.get(s["beat"] // 4, 0.5)
                notes_all.append(
                    {
                        "beat": s["beat"],
                        "sub": s["sub"],
                        "bar": s["beat"] // 4,
                        "time_ms": int(round(s["time"] * 1000)),
                        "strength": float(st),
                        "score": float(st) / max(s95, 1e-9) * (0.65 + 0.7 * energy),
                    }
                )

            # 入れ子に選ぶ: hard（16分）→ normal（8分位置）→ easy（拍位置）
            hard = pick(notes_all, LEVELS["hard"]["min_gap_ms"], LEVELS["hard"]["cap"])
            # スナップは hard に対して行い、normal/easy はスナップ後の hard から受け継ぐ
            peaks = onset_peaks(onset_env, sr)
            n_snapped = snap_notes(hard, peaks)
            hard, n_dropped = enforce_min_gap(hard, SNAP_MIN_GAP_MS)
            normal = pick([c for c in hard if c["sub"] % 2 == 0], LEVELS["normal"]["min_gap_ms"], LEVELS["normal"]["cap"])
            easy = pick([c for c in normal if c["sub"] == 0], LEVELS["easy"]["min_gap_ms"], LEVELS["easy"]["cap"])
            # レーン制約を各難易度の部分列でも効かせるため、所属をフラグにしておく
            normal_ids = {id(c) for c in normal}
            easy_ids = {id(c) for c in easy}
            for c in hard:
                c["in_normal"] = id(c) in normal_ids
                c["in_easy"] = id(c) in easy_ids

            # レーンは hard で決め、normal/easy は同じノーツのレーンを受け継ぐ
            pl = pitch_lanes(y, sr, [c["time_ms"] / 1000 for c in hard])
            for c, p in zip(hard, pl):
                c["pitch_lane"] = p
            assign_lanes(hard)
            lane_of = {id(c): c["lane"] for c in hard}
            charts = {
                "easy": [[c["time_ms"], lane_of[id(c)]] for c in easy],
                "normal": [[c["time_ms"], lane_of[id(c)]] for c in normal],
                "hard": [[c["time_ms"], lane_of[id(c)]] for c in hard],
            }
            counts = validate(song_id, charts, duration_ms)
            subdiv = subdivision_positions(ext_beats)
            drift = drift_stats(charts, subdiv, duration_ms)
            out[song_id] = {
                "title": meta["title"],
                "durationMs": duration_ms,
                "bpm": int(round(bpm)),
                "beats": [int(round(t * 1000)) for t in ext_beats],
                "fever": meta["fever"],
                "charts": charts,
            }
            lane_dist = {d: [sum(1 for n in charts[d] if n[1] == l) for l in range(4)] for d in charts}
            report[song_id] = {
                "bpm": int(round(bpm)),
                "counts": counts,
                "lanes": lane_dist,
                "snapped": f"{n_snapped}/{len(hard) + n_dropped}",
                "droppedAfterSnap": n_dropped,
                "drift": drift,
                "fever": meta["fever"],
            }
            print(f"{song_id}: BPM={bpm:.2f} -> {int(round(bpm))} counts={counts} lanes={lane_dist}")
            print(f"  snapped={n_snapped} droppedAfterSnap={n_dropped} drift={json.dumps(drift, ensure_ascii=False)}")
    dest = ROOT / "src/data/charts.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

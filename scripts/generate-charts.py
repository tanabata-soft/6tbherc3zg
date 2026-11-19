#!/usr/bin/env python3
"""譜面生成: src/assets/*.mp3 を解析して src/data/charts.json を作る。

手法:
- librosa でビート追跡し、拍グリッド（位相・周期は中央値で安定化）を得る
- 16分グリッドの各スロットでオンセット強度を測り、強度順にノーツを選ぶ
  （難易度は入れ子: hard ⊇ normal ⊇ easy。グリッド位置と最小間隔で絞る）
- レーンは音高（piptrack の中央値）の四分位で決め、同レーン連続と急な跳躍を抑える
- FEVER は歌詞字幕のサビ繰り返し位置＋RMSエネルギーの盛り上がりから決めた区間（下の FEVER 定数）

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
# 難易度ごとの (グリッド細分, 最小間隔ms, 最大ノーツ数)。細分は拍の何分の1か。
LEVELS = {
    "hard": {"div": 16, "min_gap_ms": 150, "cap": 680},
    "normal": {"div": 8, "min_gap_ms": 190, "cap": 450},
    "easy": {"div": 4, "min_gap_ms": 300, "cap": 240},
}


def to_wav(src: Path, dst: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ar", str(SR), "-ac", "1", str(dst)],
        check=True,
    )


def grid_slots(y, sr):
    """拍グリッドの (位相, 周期, BPM) と、オンセット強度列を返す。"""
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    beats = np.asarray(beats, dtype=float)
    period = float(np.median(np.diff(beats)))
    # 位相は「beats - k*period」の中央値で安定化する
    phase = float(np.median(beats - np.arange(len(beats)) * period))
    bpm = 60.0 / period
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    return phase, period, bpm, onset_env


def slot_strengths(onset_env, sr, times):
    """各スロット時刻の前後 ±45ms でのオンセット強度の最大値。"""
    hop = 512
    out = []
    for t in times:
        c = int(t * sr / hop)
        w = max(1, int(0.045 * sr / hop))
        lo, hi = max(0, c - w), min(len(onset_env), c + w + 1)
        out.append(float(onset_env[lo:hi].max()) if hi > lo else 0.0)
    return np.array(out)


def pick(candidates, min_gap_ms, cap):
    """candidates: [(time_ms, strength, grid_index)] を強度順に、最小間隔を守って選ぶ。"""
    chosen = []
    for t, s, gi in sorted(candidates, key=lambda c: -c[1]):
        if len(chosen) >= cap:
            break
        if all(abs(t - ct) >= min_gap_ms for ct, _, _ in chosen):
            chosen.append((t, s, gi))
    return sorted(chosen)


def assign_lanes(y, sr, times_s):
    """音高の四分位でレーンを決め、同レーン4連続と 0<->3 の跳躍を抑える。"""
    f0, mag = librosa.piptrack(y=y, sr=sr, fmin=80, fmax=1200)
    hop = 512
    midis = []
    for t in times_s:
        c = int(t * sr / hop)
        lo, hi = max(0, c - 2), min(f0.shape[1], c + 3)
        vals = []
        for j in range(lo, hi):
            k = int(np.argmax(mag[:, j]))
            if mag[k, j] > 0 and f0[k, j] > 0:
                vals.append(librosa.hz_to_midi(f0[k, j]))
        midis.append(float(np.median(vals)) if vals else 60.0)
    q = np.percentile(midis, [25, 50, 75])
    lanes = [int(np.searchsorted(q, m)) for m in midis]
    # 抑え: 同レーン4連続をずらし、16分間隔での 0<->3 跳躍を和らげる
    fixed = []
    for i, lane in enumerate(lanes):
        if i >= 3 and fixed[-1] == fixed[-2] == fixed[-3] == lane:
            lane = (lane + 1) % 4 if lane in (0, 3) else lane - 1
        if i >= 1 and abs(lane - fixed[-1]) == 3 and (times_s[i] - times_s[i - 1]) < 0.25:
            lane = fixed[-1] + (1 if lane > fixed[-1] else -1)
        fixed.append(lane)
    return fixed


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
        if prev is not None:
            assert prev <= len(notes), f"{name}: ノーツ数が単調増加でない {counts}"
        prev = len(notes)
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
            phase, period, bpm, onset_env = grid_slots(y, sr)
            # 演奏が実質終わる時刻（RMS が -25dB を切る最後の秒）
            rms = [float(np.sqrt(np.mean(y[i:i + sr] ** 2))) for i in range(0, len(y) - sr, sr)]
            loud_secs = [i for i, r in enumerate(rms) if 20 * np.log10(max(r, 1e-6)) > -25]
            eff_end = min(duration - END_MARGIN_S, (loud_secs[-1] + 1) if loud_secs else duration)
            # 16分グリッド
            step = period / 4
            times = []
            t = phase
            while t < eff_end:
                if t * 1000 >= START_MS:
                    times.append(t)
                t += step
            strengths = slot_strengths(onset_env, sr, times)
            floor = np.percentile(strengths, 20)
            base = [(int(round(tt * 1000)), float(s), i) for i, (tt, s) in enumerate(zip(times, strengths)) if s >= floor]
            # 入れ子に選ぶ: hard（16分位置）→ normal（8分位置＝偶数 index）→ easy（拍位置＝4の倍数 index）
            hard = pick(base, LEVELS["hard"]["min_gap_ms"], LEVELS["hard"]["cap"])
            normal = pick([c for c in hard if c[2] % 2 == 0], LEVELS["normal"]["min_gap_ms"], LEVELS["normal"]["cap"])
            easy = pick([c for c in normal if c[2] % 4 == 0], LEVELS["easy"]["min_gap_ms"], LEVELS["easy"]["cap"])
            lanes = assign_lanes(y, sr, [c[0] / 1000 for c in hard])
            lane_of = {c[0]: lanes[i] for i, c in enumerate(hard)}
            charts = {
                "easy": [[c[0], lane_of[c[0]]] for c in easy],
                "normal": [[c[0], lane_of[c[0]]] for c in normal],
                "hard": [[c[0], lane_of[c[0]]] for c in hard],
            }
            counts = validate(song_id, charts, int(duration * 1000))
            out[song_id] = {
                "title": meta["title"],
                "durationMs": int(round(duration * 1000)),
                "bpm": round(bpm, 1),
                "fever": meta["fever"],
                "charts": charts,
            }
            lane_dist = {d: [sum(1 for n in charts[d] if n[1] == l) for l in range(4)] for d in charts}
            report[song_id] = {"bpm": round(bpm, 1), "counts": counts, "lanes": lane_dist, "fever": meta["fever"]}
            print(f"{song_id}: BPM={bpm:.1f} counts={counts} lanes={lane_dist}")
    dest = ROOT / "src/data/charts.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""v5 特徴量レイヤー（V5-1）の照合レポート。

generate-charts.py の compute_layer_features を全曲に実行し、既知のセクション
（歌詞キュー＝ボーカルが歌っている区間、FEVER＝サビ区間）と特徴量が
対応しているかを数値で確かめる。生成の挙動は変えない（読み取り専用）。

照合の観点（調査メモ V5-1 の検証手順）:
- 歌詞キュー区間では有声確率が高く、区間外よりカバー率（voiced>=0.5 の割合）が高い。
- gospel のサビ（FEVER 100〜124秒）で有声確率と中域エネルギーが他区間より高い。
- ハットの多い曲（night / kira）のサビで高域オンセットが立つ。

使い方:
  .venv/bin/python scripts/analyze-layers.py                特徴量レポート（全曲）
  .venv/bin/python scripts/analyze-layers.py metrics A.json B.json
      kira の2つの charts.json を、主レイヤー一致率（V5-2 の指標）と
      音高コンター一致率（V5-3 の指標）で比較する（A=v4、B=v5 の想定）
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import librosa

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "gen", Path(__file__).with_name("generate-charts.py")
)
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

SR = gen.SR


def in_any(t, intervals):
    return any(a <= t < b for a, b in intervals)


def main():
    lyrics = json.loads((ROOT / "src/data/lyrics.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as td:
        for song_id, meta in gen.SONGS.items():
            wav = Path(td) / f"{song_id}.wav"
            gen.to_wav(ROOT / meta["audio"], wav)
            y, sr = librosa.load(str(wav), sr=SR, mono=True)
            duration = float(librosa.get_duration(y=y, sr=sr))
            times = np.arange(0.0, duration, 0.1)
            feat = gen.compute_layer_features(y, sr, list(times))

            cues = [(c["startMs"] / 1000, c["endMs"] / 1000) for c in lyrics[song_id]]
            fever = [(float(a), float(b)) for a, b in meta["fever"]]
            in_cue = np.array([in_any(t, cues) for t in times])
            in_fever = np.array([in_any(t, fever) for t in times])
            voiced = feat["voiced"]

            def p95(x):
                return float(np.percentile(x, 95)) or 1.0

            print(f"== {song_id} ({meta['title']}) dur={duration:.1f}s")
            print(
                f"  voiced: 歌詞区間 mean={voiced[in_cue].mean():.2f} "
                f"cover(>=0.5)={float((voiced[in_cue] >= 0.5).mean()):.2f} / "
                f"区間外 mean={voiced[~in_cue].mean():.2f} "
                f"cover={float((voiced[~in_cue] >= 0.5).mean()):.2f}"
            )
            for name in ("band_low", "band_midlow", "band_mid", "band_high"):
                v = feat[name] / p95(feat[name])
                print(
                    f"  {name}: FEVER内 mean={v[in_fever].mean():.2f} / "
                    f"FEVER外 mean={v[~in_fever].mean():.2f} / "
                    f"歌詞区間 mean={v[in_cue].mean():.2f}"
                )
            for layer in ("drums", "melody", "vocal"):
                v = feat[layer] / p95(feat[layer])
                print(
                    f"  layer {layer}: FEVER内 mean={v[in_fever].mean():.2f} / "
                    f"FEVER外 mean={v[~in_fever].mean():.2f} / "
                    f"歌詞区間 mean={v[in_cue].mean():.2f} / 区間外 mean={v[~in_cue].mean():.2f}"
                )
            f0 = feat["f0"]
            print(
                f"  f0: 検出率（歌詞区間）={float((~np.isnan(f0[in_cue])).mean()):.2f} "
                f"（区間外）={float((~np.isnan(f0[~in_cue])).mean()):.2f}"
            )
    return 0


def kira_slots_and_layers():
    """生成器の process_song 前半（拍・スロット・フレーズ・主レイヤー）を
    kira について再現する。生成器のログに出るフレーズ表と一致する前提。"""
    import bisect  # noqa: F401  （生成器と前提を揃えるための名残。未使用でも残す）

    meta = gen.SONGS["kira"]
    with tempfile.TemporaryDirectory() as td:
        wav = Path(td) / "kira.wav"
        gen.to_wav(ROOT / meta["audio"], wav)
        y, sr = librosa.load(str(wav), sr=SR, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    beats, period, _bpm = gen.smoothed_beats(y, sr)
    ext_beats = gen.extend_beats(beats, period, duration)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    energies = gen.bar_energies(y, sr, ext_beats)
    fever = meta["fever"]
    rms = [float(np.sqrt(np.mean(y[i : i + sr] ** 2))) for i in range(0, len(y) - sr, sr)]
    loud_secs = [i for i, r in enumerate(rms) if 20 * np.log10(max(r, 1e-6)) > -25]
    eff_end = min(duration - gen.END_MARGIN_S, (loud_secs[-1] + 1) if loud_secs else duration)
    boundaries = set()
    for f0, f1 in fever:
        boundaries.add(float(f0))
        boundaries.add(float(f1))
    bar_list = sorted(energies)
    for a, b in zip(bar_list, bar_list[1:]):
        if energies[a] > 0.45 and energies[b] < energies[a] * 0.55:
            if b * 4 < len(ext_beats):
                boundaries.add(float(ext_beats[b * 4]))
    rest_windows = [(b - period * 0.5, b) for b in boundaries if gen.START_MS / 1000 < b < eff_end]

    def in_rest(t):
        return any(lo <= t < hi for lo, hi in rest_windows)

    playable = [
        s
        for s in gen.build_slots(ext_beats, period)
        if gen.START_MS / 1000 <= s["time"] < eff_end and not in_rest(s["time"])
    ]
    strengths = gen.slot_strengths(onset_env, sr, [s["time"] for s in playable])
    for s, st in zip(playable, strengths):
        s["strength"] = float(st)
        s["energy"] = energies.get(s["beat"] // 4, 0.5)
        s["fever"] = any(f0 <= s["time"] < f1 for f0, f1 in fever)
    feat = gen.compute_layer_features(y, sr, [s["time"] for s in playable])
    svals = np.array([s["strength"] for s in playable])
    for layer in ("drums", "melody", "vocal"):
        raw = feat[layer]
        p95 = float(np.percentile(raw, 95)) or 1.0
        lay_n = np.clip(raw / p95, 0.0, 1.5)
        for i, s in enumerate(playable):
            s.setdefault("lay_n", {})[layer] = float(lay_n[i])
    for i, s in enumerate(playable):
        s["f0"] = float(feat["f0"][i])
    slot_map = {(s["beat"], s["sub"]): s for s in playable}

    bar_start_time = {b: float(ext_beats[b * 4]) for b in energies if b * 4 < len(ext_beats)}
    playable_bars = sorted(b for b, t in bar_start_time.items() if gen.START_MS / 1000 <= t < eff_end)
    boundary_bars = set()
    for bt in boundaries:
        if not playable_bars:
            break
        cand = min(playable_bars, key=lambda b: abs(bar_start_time[b] - bt))
        if abs(bar_start_time[cand] - bt) <= period:
            boundary_bars.add(cand)
    phrases = gen.segment_phrases(playable_bars, boundary_bars)
    phrase_is_chorus = []
    for phrase in phrases:
        fever_bars = sum(1 for b in phrase if any(f0 <= bar_start_time[b] < f1 for f0, f1 in fever))
        phrase_is_chorus.append(fever_bars >= max(1, int(len(phrase) * 0.6)))

    def phrase_slots(phrase):
        out = []
        for bar in phrase:
            for half in (0, 1):
                base = bar * 4 + half * 2
                for rel in range(8):
                    s = slot_map.get((base + rel // 4, rel % 4))
                    if s is not None:
                        out.append(s)
        return out

    group_layer = {}
    gi = 0
    while gi < len(phrases):
        if not phrase_is_chorus[gi]:
            gi += 1
            continue
        gj = gi
        gsl = []
        while gj < len(phrases) and phrase_is_chorus[gj]:
            gsl += phrase_slots(phrases[gj])
            gj += 1
        g_layer, _ = gen.assign_layer_for(meta, gsl, True, None)
        for gk in range(gi, gj):
            group_layer[gk] = g_layer
        gi = gj
    layers = []
    prev = None
    for pi, phrase in enumerate(phrases):
        if pi in group_layer:
            layer = group_layer[pi]
        else:
            layer, _ = gen.assign_layer_for(meta, phrase_slots(phrase), phrase_is_chorus[pi], prev)
        if layer != "mixed":
            prev = layer
        layers.append(layer)
    bar_to_phrase = {}
    for pi, phrase in enumerate(phrases):
        for b in phrase:
            bar_to_phrase[b] = pi
    medians = []
    for pi, phrase in enumerate(phrases):
        ps = phrase_slots(phrase)
        layer = layers[pi]
        medians.append(
            {
                "layer": float(np.median([s["lay_n"][layer] for s in ps])) if layer != "mixed" and ps else None,
                "full": float(np.median([s["strength"] for s in ps])) if ps else None,
            }
        )
    return playable, phrases, layers, medians, bar_to_phrase, fever


def metrics(charts_path):
    playable, phrases, layers, medians, bar_to_phrase, fever = kira_slots_and_layers()
    print("phrase layers:", [(p[0], p[-1], layers[i]) for i, p in enumerate(phrases)])
    data = json.loads(Path(charts_path).read_text(encoding="utf-8"))
    notes = data["kira"]["charts"]["hard"]
    slot_times = np.array([s["time"] for s in playable])
    hit_layer, hit_full, tot = 0, 0, 0
    agree, disagree, flat, pairs = 0, 0, 0, 0
    prev_slot, prev_lane = None, None
    fever_notes = 0
    for t_ms, lane, *_ in notes:
        t = t_ms / 1000
        if any(a <= t < b for a, b in fever):
            fever_notes += 1
        j = int(np.argmin(np.abs(slot_times - t)))
        s = playable[j]
        if abs(s["time"] - t) > 0.06:
            prev_slot, prev_lane = None, None
            continue
        pi = bar_to_phrase.get(s["beat"] // 4)
        if pi is None:
            continue
        layer = layers[pi]
        if layer != "mixed":
            tot += 1
            if s["lay_n"][layer] >= medians[pi]["layer"]:
                hit_layer += 1
            if s["strength"] >= medians[pi]["full"]:
                hit_full += 1
            if layer in ("melody", "vocal") and prev_slot is not None:
                a, b = prev_slot["f0"], s["f0"]
                if not (np.isnan(a) or np.isnan(b)) and abs(b - a) >= 1.0:
                    pairs += 1
                    dl = lane - prev_lane
                    if dl == 0:
                        flat += 1
                    elif (b - a > 0) == (dl > 0):
                        agree += 1
                    else:
                        disagree += 1
        prev_slot, prev_lane = s, lane
    dur_fever = sum(b - a for a, b in fever)
    print(f"  notes(hard)={len(notes)} FEVER密度={fever_notes / dur_fever:.2f} notes/s")
    print(
        f"  主レイヤー一致率={hit_layer / tot:.3f} (n={tot}) / "
        f"全帯域基準（v4式）={hit_full / tot:.3f}"
    )
    if pairs:
        print(
            f"  音高コンター: 対象ペア={pairs} 一致={agree / pairs:.3f} "
            f"逆方向={disagree / pairs:.3f} 同レーン={flat / pairs:.3f}"
        )


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "metrics":
        for p in sys.argv[2:]:
            print(f"== metrics for {p}")
            metrics(p)
        sys.exit(0)
    sys.exit(main())

#!/usr/bin/env python3
"""譜面生成 v3: src/assets/*.mp3 を解析して src/data/charts.json を作る。

v2 の土台（維持）:
- 拍グリッドは librosa の実測拍列に沿わせる（回帰直線＋残差の移動平均で平滑化し、
  16分スロットは隣り合う拍の間を4等分して補間。累積ドリフトが出ない）。
- 選んだスロットの近く（±38ms）に強いオンセットピークがあればスナップする
  （v2 は ±50ms。遠いピークは別のリズム事象のことが多く、寄せると拍グリッドから
  離れてズレ統計が悪化するため v3 で狭めた）。
- 密度は小節ごとの RMS エネルギーに連動。節の切れ目（FEVER境界・エネルギーの
  落ち際）の直前には小さな休符を作る。
- charts.json に実測拍列（beats）も保存し、単体テストがズレを検証する。
- 表示 BPM は回帰から求めた実測値（整数）。FEVER 区間は固定値のまま。

v3 の変更点（設計の根拠は docs/CHART-DESIGN.md）:
- ノーツの置き方を「強度順の貪欲ピック」から「フレーズ単位のパターン割り当て」に
  変えた。半小節を単位に、階段／波／交互／交差／縦連／トリル等の型を意図的に
  割り当て、型の連続として譜面を組み立てる。
- サビ（FEVER）のフレーズでは、最初のサビのパターンの並び（モチーフ）を後の
  サビで再登場させる。2回目はレーン鏡像、3回目は末尾も変化させる。サビ内でも
  後半は前半のパターンを繰り返す。
- 同時押し: サビの小節頭など特に強い拍に2レーン同時押し（hard 中心、normal は
  ごく強い拍だけ、easy はなし）。
- 長押し: オンセットが長く空き、その間も音が鳴り続ける場所（持続音）に置く。
  長さは拍単位。easy は短く少数で長押し中は他のノーツなし、normal は長押し中の
  他レーンノーツが少ないものだけ、hard はサビ中心に長押し＋他レーンタップあり。
- 入れ子（easy ⊆ normal ⊆ hard）は (時刻, レーン) で維持する。normal は hard の
  8分位置の骨格、easy は拍位置のみ。
- 同一レーン3連続は原則禁止。例外は hard の縦連（間隔 170ms 以上の3連まで）。

使い方: .venv/bin/python scripts/generate-charts.py
前提: .venv に librosa、PATH に ffmpeg（mp3 を wav に変換するため）
"""
import json
import random
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
    # v1.6.0 から音源は「音ゲー用ショート編集」（イントロ→1番→サビで終わる編集版）。
    # 全長版は assets-full/ に保管（編集の詳細は assets-full/README.md）。
    "highway": {
        "title": "石畳のハイウェイ",
        "audio": "src/assets/highway.mp3",
        # 編集版（104.8秒）: サビ「ニコラス・ケイジ 幻じゃない〜」の繰り返し区間（字幕）と RMS 盛り上がり（-13dB台）の一致区間
        "fever": [[57, 96]],
    },
    "night": {
        "title": "Kiso Night Silhouette",
        "audio": "src/assets/night.mp3",
        # 編集版（127.7秒）: サビ「Kono tokimeki wa nani〜」の繰り返し区間（字幕）と RMS 盛り上がりの一致区間（1番・2番のサビ）
        "fever": [[44, 67], [96, 127]],
    },
}

START_MS = 2000  # 最初のノーツはイントロ後
END_MARGIN_S = 1.2  # 最後のノーツは曲終了のこれ以上前に置く
HARD_CAP = 820  # hard の総ノーツ数の上限（安全弁。パターン＋同時押し＋長押し込み）
NORMAL_CAP = 410  # normal の総ノーツ数の上限（8分の骨格を強さ順に間引く）
EASY_CAP = 210  # easy の総ノーツ数の上限（拍位置のみを強さ順に間引く）
SNAP_WINDOW_MS = 38  # オンセットピークへ寄せる範囲（遠いピークは別のリズム事象なので寄せない）
SNAP_MIN_GAP_MS = 100  # スナップ後に許す同一レーンの最小間隔
LANE_MIN_SHARE = 0.18  # レーン分布の下限（単体テストでも検証）
LANE_MAX_SHARE = 0.32  # レーン分布の上限（単体テストでも検証）
JACK_MIN_GAP_MS = 170  # hard で同一レーン3連（縦連）を許す最小間隔
HOLD_TARGET = 13  # hard の長押し本数の目安
SEED = 20251119

# パターンの語彙。半小節（2拍＝16分スロット8個）を単位に、rel=単位内の16分位置、
# off=レーンの相対オフセット（フィット時に平行移動と鏡像で実レーンへ写す）。
PATTERNS = {
    "stair": {"rel": [0, 2, 4, 6], "off": [0, 1, 2, 3], "burst": False},
    "wave": {"rel": [0, 2, 4, 6], "off": [0, 1, 2, 1], "burst": False},
    "alt": {"rel": [0, 2, 4, 6], "off": [0, 1, 0, 1], "burst": False},
    "cross": {"rel": [0, 2, 4, 6], "off": [0, 2, 1, 3], "burst": False},
    "jack": {"rel": [0, 2, 4], "off": [0, 0, 0], "burst": False},
    "trill": {"rel": [0, 1, 2, 3, 4, 5, 6, 7], "off": [0, 1, 0, 1, 0, 1, 0, 1], "burst": True},
    "roll": {"rel": [0, 1, 2, 3, 4, 5, 6, 7], "off": [0, 1, 2, 3, 0, 1, 2, 3], "burst": True},
    "wave16": {"rel": [0, 1, 2, 3, 4, 5, 6, 7], "off": [0, 1, 2, 3, 2, 1, 0, 1], "burst": True},
    "sparse": {"rel": [], "off": [], "burst": False},
}
BURST_PATTERNS = {name for name, p in PATTERNS.items() if p["burst"]}


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
        for n in notes:
            t = n[0] / 1000
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
            "meanAbs": round(float(np.abs(deltas).mean()), 1),
            "over30": round(float((np.abs(deltas) > 30).mean() * 100), 1),
            "p90abs": round(float(np.percentile(np.abs(deltas), 90)), 1),
            "maxabs": round(float(np.abs(deltas).max()), 1),
            "thirds": thirds,
        }
    return stats


# ---- パターンのフィット（相対オフセット → 実レーン） ----


def pattern_fits(offsets, mirror_only=False):
    """オフセット列の平行移動・鏡像バリエーション（実レーン列の候補）を返す。"""
    if not offsets:
        return [[]]
    mn, mx = min(offsets), max(offsets)
    span = mx - mn
    out = []
    seen = set()
    for mirror in ((True,) if mirror_only else (False, True)):
        base = [(mx - o) if mirror else o for o in offsets]
        base = [o - min(base) for o in base]
        for shift in range(0, 4 - span):
            lanes = tuple(o + shift for o in base)
            if lanes not in seen:
                seen.add(lanes)
                out.append(list(lanes))
    return out


# ---- フレーズと計画 ----


def segment_phrases(playable_bars, boundary_bars):
    """小節列をフレーズ（最大8小節）に分ける。切れ目は boundary_bars。"""
    phrases = []
    cur = []
    for bar in playable_bars:
        if cur and (bar in boundary_bars or len(cur) >= 8):
            phrases.append(cur)
            cur = []
        cur.append(bar)
    if cur:
        phrases.append(cur)
    return phrases


def plan_phrase(rng, phrase, unit_energy, unit_gate, is_chorus):
    """フレーズ内の各半小節にパターン名を割り当てる計画を返す。

    unit_energy(unit) -> 0..1、unit_gate(unit, kind) -> bool（burst/jack を置ける強さか）。
    unit は (bar, half) のタプル。
    """
    units = [(bar, half) for bar in phrase for half in (0, 1)]
    plan = []
    for unit in units:
        e = unit_energy(unit)
        r = rng.random()
        if e < 0.28:
            name = "sparse" if r < 0.45 else rng.choice(["wave", "stair"])
        elif e < 0.62:
            if r < 0.08:
                name = "sparse"
            elif r < 0.115 and unit_gate(unit, "jack"):
                name = "jack"
            else:
                name = rng.choice(["stair", "wave", "alt", "cross", "wave", "stair"])
        else:
            if r < 0.42 and unit_gate(unit, "burst"):
                name = rng.choice(["trill", "roll", "wave16"])
            elif r < 0.465 and unit_gate(unit, "jack"):
                name = "jack"
            elif r < 0.50:
                name = "sparse"
            else:
                name = rng.choice(["stair", "wave", "alt", "cross", "wave", "alt"])
        plan.append(name)
    # サビ内では後半に前半のパターンを繰り返す（モチーフの反復）
    if is_chorus and len(plan) >= 10:
        half = len(plan) // 2
        plan[half:] = plan[: len(plan) - half]
    return units, plan


# ---- 実体化 ----


class Realizer:
    """計画どおりにノーツを置きながら、レーンの流れと分布を保つ。"""

    def __init__(self, slot_map, floor_pat):
        self.slot_map = slot_map
        self.floor_pat = floor_pat
        self.notes = []
        self.counts = [0, 0, 0, 0]
        self.head_counts = [0, 0, 0, 0]  # 単位の頭（rel=0）のノーツだけの分布。easy の偏り対策
        self.total = 0
        self.prev_lanes = []  # 直近のレーン列（末尾が最新）
        # 難易度ごとの部分列のレーン履歴（h=全ノーツ, n=8分位置, e=拍位置）。
        # 部分列でも同一レーン3連続を作らないために使う（v2 の assign_lanes と同じ考え方）
        self.level_last = {"h": [], "n": [], "e": []}
        self.next_id = 0

    def slot(self, unit, rel):
        bar, half = unit
        beat = bar * 4 + half * 2 + rel // 4
        return self.slot_map.get((beat, rel % 4))

    def add_note(self, slot, lane, kind, pattern, unit_rel):
        note = {
            "id": self.next_id,
            "time_ms": int(round(slot["time"] * 1000)),
            "lane": lane,
            "hold_ms": 0,
            "tail_ms": 0,
            "kind": kind,
            "pattern": pattern,
            "unit_rel": unit_rel,
            "sub": slot["sub"],
            "beat": slot["beat"],
            "bar": slot["beat"] // 4,
            "strength": slot["strength"],
            "pitch_lane": slot["pitch_lane"],
            "fever": slot["fever"],
            "energy": slot["energy"],
        }
        self.next_id += 1
        self.notes.append(note)
        self.counts[lane] += 1
        if unit_rel == 0:
            self.head_counts[lane] += 1
        self.total += 1
        self.prev_lanes.append(lane)
        self.level_last["h"].append(lane)
        if slot["sub"] % 2 == 0:
            self.level_last["n"].append(lane)
        if slot["sub"] == 0:
            self.level_last["e"].append(lane)
        return note

    def run_penalty(self, lanes, subs, pattern_name):
        """全難易度の部分列で同一レーン3連続を作る候補への罰金（縦連だけ例外）。"""
        if pattern_name == "jack":
            return 0.0
        pen = 0.0
        for level in ("h", "n", "e"):
            seq = list(self.level_last[level][-2:])
            for lane, sub in zip(lanes, subs):
                if level == "n" and sub % 2 == 1:
                    continue
                if level == "e" and sub != 0:
                    continue
                seq.append(lane)
                if len(seq) >= 3 and seq[-1] == seq[-2] == seq[-3]:
                    pen += 60.0
        return pen

    def fit_cost(self, lanes, pattern_name, pitches, subs):
        """フィット候補のコスト。小さいほど良い。3連続を作る候補は強く避ける。"""
        cost = self.run_penalty(lanes, subs, pattern_name)
        if self.prev_lanes:
            delta = abs(lanes[0] - self.prev_lanes[-1])
            cost += {0: 0.35, 1: 0.0, 2: 0.5, 3: 1.1}[delta]
        for i, lane in enumerate(lanes):
            cost += 2.0 * (self.counts[lane] / max(1, self.total))
            if i == 0:
                # 単位の頭は easy にも残るので、その分布も均す
                cost += 1.6 * (self.head_counts[lane] / max(1, sum(self.head_counts)))
        cost += 0.05 * sum(abs(l - p) for l, p in zip(lanes, pitches))  # 音高は参考程度
        return cost

    def realize_unit(self, unit, pattern_name, mirror_only=False, anchor_floor=0.0):
        pat = PATTERNS[pattern_name]
        placed = []
        if not pat["rel"]:
            # sparse: 小節頭・半小節頭のアンカーだけ（強さが足りる場合）
            slot = self.slot(unit, 0)
            if slot is not None and slot["strength"] >= anchor_floor:
                lane = self._best_single_lane(slot)
                placed.append(self.add_note(slot, lane, "anchor", None, 0))
            return placed
        steps = []
        for rel, off in zip(pat["rel"], pat["off"]):
            slot = self.slot(unit, rel)
            if slot is None or slot["strength"] < self.floor_pat:
                continue
            steps.append((rel, off, slot))
        if not steps:
            return placed
        offs = [o for _r, o, _s in steps]
        pitches = [s["pitch_lane"] for _r, _o, s in steps]
        subs = [s["sub"] for _r, _o, s in steps]
        best_lanes, best_cost = None, None
        for lanes in pattern_fits(offs, mirror_only=mirror_only):
            c = self.fit_cost(lanes, pattern_name, pitches, subs)
            if best_cost is None or c < best_cost:
                best_lanes, best_cost = lanes, c
        for (rel, _off, slot), lane in zip(steps, best_lanes):
            placed.append(self.add_note(slot, lane, "pattern", pattern_name, rel))
        return placed

    def _best_single_lane(self, slot):
        best_lane, best_cost = 0, None
        for lane in range(4):
            cost = (
                2.0 * (self.counts[lane] / max(1, self.total))
                + 1.6 * (self.head_counts[lane] / max(1, sum(self.head_counts)))
                + 0.06 * abs(lane - slot["pitch_lane"])
            )
            for level in ("h", "n", "e"):
                last = self.level_last[level]
                if len(last) >= 2 and last[-1] == lane and last[-2] == lane:
                    cost += 60.0
            if self.prev_lanes:
                cost += {0: 0.35, 1: 0.0, 2: 0.5, 3: 1.1}[abs(lane - self.prev_lanes[-1])]
            if best_cost is None or cost < best_cost:
                best_lane, best_cost = lane, cost
        return best_lane


def enforce_same_lane_gap(notes, min_gap_ms):
    """同一レーンで近すぎる組は弱い方を落とす（同時押しは別レーンなので残る）。"""
    kept = []
    dropped = 0
    by_lane = {}
    for note in sorted(notes, key=lambda c: (c["time_ms"], c["lane"])):
        prev = by_lane.get(note["lane"])
        if prev is not None and note["time_ms"] - prev["time_ms"] < min_gap_ms:
            weaker = note if note["strength"] < prev["strength"] else prev
            if weaker is prev:
                kept = [k for k in kept if k is not prev]
                by_lane[note["lane"]] = note
                kept.append(note)
            dropped += 1
            continue
        by_lane[note["lane"]] = note
        kept.append(note)
    return kept, dropped


def find_runs(notes_sorted):
    """同じレーンが3つ以上続く区間 [(開始idx, 終了idx)] を返す。"""
    runs = []
    i = 0
    while i < len(notes_sorted):
        j = i
        while j + 1 < len(notes_sorted) and notes_sorted[j + 1]["lane"] == notes_sorted[i]["lane"]:
            j += 1
        if j - i + 1 >= 3:
            runs.append((i, j))
        i = j + 1
    return runs


def run_is_allowed(diff, run):
    """同一レーン連続の例外: hard の縦連（間隔 JACK_MIN_GAP_MS 以上の3連）だけ許可。"""
    return (
        diff == "hard"
        and len(run) == 3
        and run[1]["time_ms"] - run[0]["time_ms"] >= JACK_MIN_GAP_MS
        and run[2]["time_ms"] - run[1]["time_ms"] >= JACK_MIN_GAP_MS
    )


def repair_runs(id_sets, notes_by_id):
    """3連続ルールを全難易度で直す。落としたノーツは下位難易度からも落とす（入れ子を保つ）。"""
    order = ["hard", "normal", "easy"]
    for di, diff in enumerate(order):
        while True:
            seq = sorted((notes_by_id[i] for i in id_sets[diff]), key=lambda n: (n["time_ms"], n["lane"]))
            bad = None
            for i0, i1 in find_runs(seq):
                run = seq[i0 : i1 + 1]
                if not run_is_allowed(diff, run):
                    bad = run
                    break
            if bad is None:
                break
            mid = bad[len(bad) // 2]
            for lower in order[di:]:
                id_sets[lower].discard(mid["id"])
    return id_sets


def validate(name, charts, raw, duration_ms):
    """charts: {diff: [[time, lane, hold?], ...]}、raw: {diff: [note dict]}"""
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
        lanes = [n[1] for n in notes]
        for lane in range(4):
            share = lanes.count(lane) / len(lanes)
            assert LANE_MIN_SHARE <= share <= LANE_MAX_SHARE, f"{name}/{diff}: レーン{lane}の割合 {share:.2f} が範囲外"
        # 同時押しは2つまで
        by_time = {}
        for n in notes:
            by_time.setdefault(n[0], []).append(n)
        assert all(len(v) <= 2 for v in by_time.values()), f"{name}/{diff}: 3つ以上の同時押しがある"
        # 3連続ルール（hard の縦連だけ例外）
        seq = raw[diff]
        for i0, i1 in find_runs(seq):
            run = seq[i0 : i1 + 1]
            assert run_is_allowed(diff, run), f"{name}/{diff}: 同一レーン{len(run)}連続（{run[0]['time_ms']}ms〜）"
        # 長押し: 尾の余裕・帯の中の同一レーン・同士の重なり
        holds = [n for n in notes if len(n) > 2]
        for t, lane, hold in holds:
            tail = t + hold
            assert hold >= 350, f"{name}/{diff}: 長押しが短すぎる {hold}ms"
            assert tail <= duration_ms - 500, f"{name}/{diff}: 長押しの尾が曲の終わりに近すぎる"
            for t2, lane2, *_ in notes:
                assert not (lane2 == lane and t < t2 <= tail), f"{name}/{diff}: 長押しの帯の中に同一レーンのノーツ {t2}"
            for t2, _l2, _h2 in holds:
                assert not (t < t2 < tail), f"{name}/{diff}: 長押し同士が重なっている"
        if prev is not None:
            assert prev <= len(notes), f"{name}: ノーツ数が単調増加でない {counts}"
        prev = len(notes)
    hard_set = {(n[0], n[1]) for n in charts["hard"]}
    normal_set = {(n[0], n[1]) for n in charts["normal"]}
    easy_set = {(n[0], n[1]) for n in charts["easy"]}
    assert easy_set <= normal_set <= hard_set, f"{name}: 入れ子構造が崩れている"
    return counts


# ---- 曲ごとの生成 ----


def process_song(song_id, meta, y, sr):
    import bisect

    duration = float(librosa.get_duration(y=y, sr=sr))
    duration_ms = int(round(duration * 1000))
    beats, period, bpm = smoothed_beats(y, sr)
    ext_beats = extend_beats(beats, period, duration)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    energies = bar_energies(y, sr, ext_beats)
    peaks = onset_peaks(onset_env, sr)
    fever = meta["fever"]

    # 演奏が実質終わる時刻（RMS が -25dB を切る最後の秒）
    rms = [float(np.sqrt(np.mean(y[i : i + sr] ** 2))) for i in range(0, len(y) - sr, sr)]
    loud_secs = [i for i, r in enumerate(rms) if 20 * np.log10(max(r, 1e-6)) > -25]
    eff_end = min(duration - END_MARGIN_S, (loud_secs[-1] + 1) if loud_secs else duration)

    # 節の切れ目: FEVER境界＋エネルギーの落ち際の小節頭。その直前 約半拍に休符を作る
    boundaries = set()
    for f0, f1 in fever:
        boundaries.add(float(f0))
        boundaries.add(float(f1))
    bar_list = sorted(energies)
    for a, b in zip(bar_list, bar_list[1:]):
        if energies[a] > 0.45 and energies[b] < energies[a] * 0.55:
            if b * 4 < len(ext_beats):
                boundaries.add(float(ext_beats[b * 4]))
    rest_windows = [(b - period * 0.5, b) for b in boundaries if START_MS / 1000 < b < eff_end]

    def in_rest(t):
        return any(lo <= t < hi for lo, hi in rest_windows)

    # スロット（演奏範囲・休符外）に強度・エネルギー・FEVER・音高を付ける
    playable = [
        s
        for s in build_slots(ext_beats, period)
        if START_MS / 1000 <= s["time"] < eff_end and not in_rest(s["time"])
    ]
    strengths = slot_strengths(onset_env, sr, [s["time"] for s in playable])
    pls = pitch_lanes(y, sr, [s["time"] for s in playable])
    for s, st, pl in zip(playable, strengths, pls):
        s["strength"] = float(st)
        s["pitch_lane"] = int(pl)
        s["energy"] = energies.get(s["beat"] // 4, 0.5)
        s["fever"] = any(f0 <= s["time"] < f1 for f0, f1 in fever)
    slot_map = {(s["beat"], s["sub"]): s for s in playable}
    svals = np.array([s["strength"] for s in playable])
    thr = {p: float(np.percentile(svals, p)) for p in (12, 25, 45, 50, 65, 75, 80, 84, 93)}

    # フレーズ分割
    bar_start_time = {b: float(ext_beats[b * 4]) for b in energies if b * 4 < len(ext_beats)}
    playable_bars = sorted(b for b, t in bar_start_time.items() if START_MS / 1000 <= t < eff_end)
    boundary_bars = set()
    for bt in boundaries:
        if not playable_bars:
            break
        cand = min(playable_bars, key=lambda b: abs(bar_start_time[b] - bt))
        if abs(bar_start_time[cand] - bt) <= period:
            boundary_bars.add(cand)
    phrases = segment_phrases(playable_bars, boundary_bars)

    def unit_energy(unit):
        return energies.get(unit[0], 0.5)

    def unit_slots(unit):
        bar, half = unit
        base = bar * 4 + half * 2
        return [slot_map.get((base + rel // 4, rel % 4)) for rel in range(8)]

    # バースト／縦連の可否は、その曲の中での相対エネルギーで決める（曲の性格差を吸収）
    all_units = [(bar, half) for phrase in phrases for bar in phrase for half in (0, 1)]
    ue = np.array([unit_energy(u) for u in all_units]) if all_units else np.array([0.5])
    ue_p45 = float(np.percentile(ue, 45))
    ue_p60 = float(np.percentile(ue, 60))

    def unit_gate(unit, kind):
        us = unit_slots(unit)
        if kind == "burst":
            odd = [s["strength"] for r, s in enumerate(us) if s is not None and r % 2 == 1]
            return len(odd) >= 3 and float(np.mean(odd)) >= thr[45] and unit_energy(unit) >= ue_p45
        if kind == "jack":
            even = [s["strength"] for r, s in enumerate(us) if s is not None and r in (0, 2, 4)]
            return len(even) == 3 and float(np.mean(even)) >= thr[65] and unit_energy(unit) >= ue_p60
        return False

    # 計画 → 実体化（サビはモチーフを再登場させる）
    rng = random.Random(SEED + (0 if song_id == "highway" else 1))
    realizer = Realizer(slot_map, thr[12])
    motif_plan = None
    chorus_count = 0
    chorus_first_bars = set()
    unit_plan_count = {}
    for phrase in phrases:
        fever_bars = sum(1 for b in phrase if any(f0 <= bar_start_time[b] < f1 for f0, f1 in fever))
        is_chorus = fever_bars >= max(1, int(len(phrase) * 0.6))
        if is_chorus:
            chorus_count += 1
            if phrase:
                chorus_first_bars.add(phrase[0])
            units = [(bar, half) for bar in phrase for half in (0, 1)]
            if motif_plan is None:
                units, plan = plan_phrase(rng, phrase, unit_energy, unit_gate, True)
                motif_plan = plan
            else:
                plan = [motif_plan[i % len(motif_plan)] for i in range(len(units))]
        else:
            units, plan = plan_phrase(rng, phrase, unit_energy, unit_gate, False)
        mirror = is_chorus and chorus_count >= 2
        for ui, (unit, name) in enumerate(zip(units, plan)):
            if is_chorus and chorus_count >= 3 and ui == len(units) - 1:
                name = "wave16" if unit_gate(unit, "burst") else "wave"
            unit_plan_count[name] = unit_plan_count.get(name, 0) + 1
            realizer.realize_unit(unit, name, mirror_only=mirror, anchor_floor=thr[25] if ui == 0 else thr[45])

    # 同時押し: サビの小節頭など特に強い拍に相方を足す（1小節に1組まで）
    notes = realizer.notes
    head_notes = {}
    for n in notes:
        if n["sub"] == 0 and n["beat"] % 4 == 0:
            head_notes.setdefault(n["bar"], n)
    climax_bars = {max(p, key=lambda b: energies.get(b, 0.5)) for p in phrases}
    chord_times = set()
    for bar, head in sorted(head_notes.items()):
        strong_fever = head["fever"] and head["strength"] >= thr[84]
        climax = bar in climax_bars and head["strength"] >= thr[80]
        chorus_start = bar in chorus_first_bars and head["fever"] and head["strength"] >= thr[75]
        if not (strong_fever or climax or chorus_start):
            continue
        slot = slot_map.get((head["beat"], 0))
        if slot is None:
            continue
        partner_lane = min(
            (l for l in range(4) if l != head["lane"]),
            key=lambda l: (realizer.counts[l], -abs(l - head["lane"])),
        )
        partner = realizer.add_note(slot, partner_lane, "chord", None, 0)
        partner["strength"] = head["strength"]
        chord_times.add(head["time_ms"])
    notes = realizer.notes

    # 長押し: 強いオンセットの後、次の強いオンセットまで音が持続する場所に置く
    peak_heights = [p[1] for p in peaks]
    strong_times = sorted(t for t, s in peaks if s >= np.percentile(peak_heights, 70)) if peaks else []

    def seg_rms(t0, t1):
        i0, i1 = int(t0 * sr), min(int(t1 * sr), len(y))
        if i1 <= i0:
            return 0.0
        return float(np.sqrt(np.mean(y[i0:i1] ** 2)))

    candidates = [
        n
        for n in notes
        if n["kind"] in ("pattern", "anchor")
        and n["sub"] == 0
        and n["time_ms"] not in chord_times
        and n["strength"] >= thr[50]
    ]
    candidates.sort(key=lambda n: (-(n["strength"] * (1.25 if n["fever"] else 1.0)), n["time_ms"]))
    accepted = []
    removed_ids = set()
    for n in candidates:
        if len(accepted) >= HOLD_TARGET + 2:
            break
        t = n["time_ms"] / 1000
        i = bisect.bisect_right(strong_times, t + 0.3)
        if i >= len(strong_times):
            continue
        sustain = strong_times[i] - t
        dur_beats = int(min(4, sustain / period))
        if dur_beats < 1 or sustain < period * 1.15:
            continue
        tail_beat = n["beat"] + dur_beats
        if tail_beat >= len(ext_beats):
            continue
        tail_t = float(ext_beats[tail_beat])
        if tail_t > eff_end - 0.3:
            continue
        head_rms = seg_rms(t, t + 0.2)
        mid_rms = seg_rms(t + 0.25, max(t + 0.3, tail_t - 0.05))
        if head_rms <= 0 or mid_rms < head_rms * 0.45:
            continue
        tail_ms = int(round(tail_t * 1000))
        if tail_ms - n["time_ms"] < 380:
            continue
        if any(not (tail_ms <= a0 or n["time_ms"] >= a1) for a0, a1 in accepted):
            continue
        n["hold_ms"] = tail_ms - n["time_ms"]
        n["tail_ms"] = tail_ms
        accepted.append((n["time_ms"], tail_ms))
        for m in notes:
            if m is not n and m["lane"] == n["lane"] and n["time_ms"] < m["time_ms"] < tail_ms + period * 500:
                removed_ids.add(m["id"])
    notes = [n for n in notes if n["id"] not in removed_ids]

    # スナップ → 尾の再計算 → 同一レーン間隔の再検証 → 帯の中・重なりの事後修復
    n_snapped = snap_notes(notes, peaks)
    for n in notes:
        if n["hold_ms"] > 0:
            n["hold_ms"] = n["tail_ms"] - n["time_ms"]
            if n["hold_ms"] < 320:
                n["hold_ms"] = 0
    notes, n_dropped = enforce_same_lane_gap(notes, SNAP_MIN_GAP_MS)
    hold_spans = [(n["time_ms"], n["time_ms"] + n["hold_ms"], n["lane"]) for n in notes if n["hold_ms"] > 0]
    notes = [
        n
        for n in notes
        if n["hold_ms"] > 0
        or not any(lane == n["lane"] and h0 < n["time_ms"] <= h1 for h0, h1, lane in hold_spans)
    ]
    last_tail = -1
    for n in sorted((n for n in notes if n["hold_ms"] > 0), key=lambda n: n["time_ms"]):
        if n["time_ms"] < last_tail:
            n["hold_ms"] = 0
        else:
            last_tail = max(last_tail, n["time_ms"] + n["hold_ms"])
    notes.sort(key=lambda n: (n["time_ms"], n["lane"]))

    # 安全弁: hard の上限を超えたら、低エネルギーのパターンノーツから間引く
    if len(notes) > HARD_CAP:
        drop = set()
        for n in sorted((n for n in notes if n["kind"] == "pattern"), key=lambda n: (n["energy"], n["strength"])):
            if len(notes) - len(drop) <= HARD_CAP:
                break
            drop.add(n["id"])
        notes = [n for n in notes if n["id"] not in drop]

    # 難易度への導出（入れ子）
    notes_by_id = {n["id"]: n for n in notes}
    hard_ids = {n["id"] for n in notes}
    normal_ids = set()
    for n in notes:
        if n["kind"] == "chord":
            if n["strength"] >= thr[93]:
                normal_ids.add(n["id"])
        elif n["pattern"] in BURST_PATTERNS:
            if n["unit_rel"] == 0:
                normal_ids.add(n["id"])
        elif n["sub"] % 2 == 0:
            normal_ids.add(n["id"])

    def thin(ids, cap, min_gap):
        """レーンごとに強さ順の列を持ち、往復で均等に拾って間引く。

        候補プール自体が偏っていても分布が 18〜32% に収まるよう、総数は
        「最も候補の少ないレーンが2割を確保できる量」を上限にする。
        同時押しのペアは同刻なので間隔チェックの対象外。
        """
        by_lane = {
            l: sorted((notes_by_id[i] for i in ids if notes_by_id[i]["lane"] == l), key=lambda n: -n["strength"])
            for l in range(4)
        }
        scarcest = min(len(v) for v in by_lane.values())
        total_target = min(cap, int(scarcest / 0.20)) if scarcest else min(cap, sum(len(v) for v in by_lane.values()))
        ceil_q = int(total_target * 0.305)
        kept = []
        kept_times = []
        lane_kept = [0, 0, 0, 0]
        ptr = {l: 0 for l in range(4)}

        def gap_ok(n):
            return all(t == n["time_ms"] or abs(n["time_ms"] - t) >= min_gap for t in kept_times)

        progress = True
        while len(kept) < total_target and progress:
            progress = False
            for l in range(4):
                if len(kept) >= total_target or lane_kept[l] >= ceil_q:
                    continue
                while ptr[l] < len(by_lane[l]):
                    n = by_lane[l][ptr[l]]
                    ptr[l] += 1
                    if gap_ok(n):
                        kept.append(n)
                        kept_times.append(n["time_ms"])
                        lane_kept[l] += 1
                        progress = True
                        break
        return {n["id"] for n in kept}

    normal_ids = thin(normal_ids, NORMAL_CAP, 150)
    easy_ids = {i for i in normal_ids if notes_by_id[i]["sub"] == 0 and notes_by_id[i]["kind"] != "chord"}
    easy_ids = thin(easy_ids, EASY_CAP, 260)
    id_sets = repair_runs({"hard": hard_ids, "normal": normal_ids, "easy": easy_ids}, notes_by_id)

    def final_notes(diff, ids):
        seq = sorted((notes_by_id[i] for i in ids), key=lambda n: (n["time_ms"], n["lane"]))
        out = []
        for n in seq:
            hold = n["hold_ms"]
            if hold > 0 and diff != "hard":
                tail = n["time_ms"] + hold
                others = [m for m in seq if m is not n and n["time_ms"] < m["time_ms"] < tail]
                if diff == "normal" and len(others) > 2:
                    hold = 0
                elif diff == "easy" and (others or hold > period * 2600):
                    hold = 0
            out.append({"time_ms": n["time_ms"], "lane": n["lane"], "hold_ms": hold, "src": n})
        if diff == "easy":
            hs = sorted((o for o in out if o["hold_ms"] > 0), key=lambda o: -o["src"]["strength"])
            for o in hs[6:]:
                o["hold_ms"] = 0
        return out

    finals = {d: final_notes(d, id_sets[d]) for d in ("easy", "normal", "hard")}
    raw = {d: sorted(finals[d], key=lambda o: (o["time_ms"], o["lane"])) for d in finals}

    def to_tuples(final):
        return [
            [o["time_ms"], o["lane"], o["hold_ms"]] if o["hold_ms"] > 0 else [o["time_ms"], o["lane"]]
            for o in final
        ]

    charts = {d: to_tuples(finals[d]) for d in finals}
    counts = validate(song_id, charts, raw, duration_ms)
    subdiv = subdivision_positions(ext_beats)
    drift = drift_stats(charts, subdiv, duration_ms)

    def diff_report(final):
        by_time = {}
        for o in final:
            by_time[o["time_ms"]] = by_time.get(o["time_ms"], 0) + 1
        holds = [o for o in final if o["hold_ms"] > 0]
        return {
            "total": len(final),
            "taps": len(final) - len(holds),
            "chordPairs": sum(1 for v in by_time.values() if v == 2),
            "holds": len(holds),
            "holdSeconds": round(sum(o["hold_ms"] for o in holds) / 1000, 1),
        }

    pattern_notes = {}
    for n in notes:
        if n["pattern"]:
            pattern_notes[n["pattern"]] = pattern_notes.get(n["pattern"], 0) + 1
    song_json = {
        "title": meta["title"],
        "durationMs": duration_ms,
        "bpm": int(round(bpm)),
        "beats": [int(round(t * 1000)) for t in ext_beats],
        "fever": fever,
        "charts": charts,
    }
    rep = {
        "bpm": int(round(bpm)),
        "counts": counts,
        "diffs": {d: diff_report(finals[d]) for d in finals},
        "lanes": {d: [sum(1 for n in charts[d] if n[1] == l) for l in range(4)] for d in charts},
        "snapped": n_snapped,
        "droppedAfterSnap": n_dropped,
        "patternUnits": unit_plan_count,
        "patternNotes": pattern_notes,
        "drift": drift,
        "fever": fever,
    }
    print(f"{song_id}: BPM={bpm:.2f} -> {int(round(bpm))} counts={counts}")
    print(f"  diffs={json.dumps(rep['diffs'], ensure_ascii=False)} lanes={rep['lanes']}")
    print(f"  patterns(units)={unit_plan_count} patterns(notes)={pattern_notes}")
    print(f"  snapped={n_snapped} droppedAfterSnap={n_dropped} drift={json.dumps(drift, ensure_ascii=False)}")
    return song_json, rep


def main() -> int:
    out = {}
    report = {}
    with tempfile.TemporaryDirectory() as td:
        for song_id, meta in SONGS.items():
            wav = Path(td) / f"{song_id}.wav"
            to_wav(ROOT / meta["audio"], wav)
            y, sr = librosa.load(str(wav), sr=SR, mono=True)
            song_json, rep = process_song(song_id, meta, y, sr)
            out[song_id] = song_json
            report[song_id] = rep
    dest = ROOT / "src/data/charts.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

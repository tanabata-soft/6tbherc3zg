#!/usr/bin/env python3
"""元動画の mov_text 字幕から歌詞行を抽出し、src/data/lyrics.json を作る。

字幕はカラオケ式のスクロール字幕で、各キューは最大3行のウィンドウ
（前の行／今の行／次の行）を表示する。今の行は:
  - 3行キューでは中央の行
  - 2行キューでは、最初のキューだけ先頭の行、それ以外は末尾の行
  - 「♪」だけのキューは間奏（歌詞なし）
行の時刻は、その行が「今の行」になるキューの [開始, 終了) を使う。

音源は v1.6.0 のショート編集（頭から切り取っただけ）なので、時刻の
再マッピングは不要。編集版の尺（charts.json の durationMs）を超える行は
切り捨て、終了時刻は尺でクランプする。

使い方: python3 scripts/extract-lyrics.py
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEO_DIR = Path.home() / "workspace/user/media_library/video/59"

# 曲ID → 元動画ファイル（尺で判別: 石畳 179.6秒 / Kiso Night 180.0秒）
VIDEOS = {
    "highway": VIDEO_DIR / "59b1272e118e4e13d2e2dabc6adfb396b467986c9bef38513fae871821700bff.mp4",
    "night": VIDEO_DIR / "594cf0ddc3047fc0c9be1318b9018462498cc84061e345d9eb18d9c41d2f8e6b.mp4",
}

TIME_RE = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)")


def parse_time(s: str) -> float:
    m = TIME_RE.match(s.strip())
    if not m:
        raise ValueError(f"時刻が読めません: {s}")
    h, mi, sec, ms = (int(x) for x in m.groups())
    return h * 3600 + mi * 60 + sec + ms / 1000


def extract_srt(video: Path) -> str:
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "sub.srt"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-map", "0:s:0", "-f", "srt", str(out)],
            check=True,
        )
        return out.read_text(encoding="utf-8")


def parse_cues(srt: str):
    cues = []
    for block in re.split(r"\n\s*\n", srt.strip()):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if len(lines) < 2 or "-->" not in lines[1]:
            continue
        start_s, end_s = lines[1].split("-->")
        cues.append((parse_time(start_s), parse_time(end_s), lines[2:]))
    return cues


def clean(line: str) -> str:
    """行頭・行末の ♪ 装飾を取り除く"""
    s = line.strip()
    s = re.sub(r"^♪\s*", "", s)
    s = re.sub(r"\s*♪$", "", s)
    return s.strip()


def reconstruct(cues):
    """キュー列から (開始秒, 終了秒, テキスト) の歌詞行列を作る"""
    out = []
    for i, (start, end, raw_lines) in enumerate(cues):
        lines = [clean(ln) for ln in raw_lines]
        lines = [ln for ln in lines if ln]
        if not lines:
            continue  # 間奏（♪ のみ）
        if len(lines) >= 3:
            current = lines[1]
        elif len(lines) == 2:
            current = lines[0] if i == 0 else lines[1]
        else:
            current = lines[0]
        out.append((start, end, current))
    return out


def main() -> int:
    charts = json.loads((ROOT / "src/data/charts.json").read_text(encoding="utf-8"))
    result = {}
    for song_id, video in VIDEOS.items():
        if not video.exists():
            print(f"元動画がありません: {video}", file=sys.stderr)
            return 1
        duration_ms = charts[song_id]["durationMs"]
        rows = reconstruct(parse_cues(extract_srt(video)))
        kept = []
        for start, end, text in rows:
            start_ms = round(start * 1000)
            if start_ms >= duration_ms:
                continue
            kept.append(
                {
                    "startMs": start_ms,
                    "endMs": min(round(end * 1000), duration_ms),
                    "text": text,
                }
            )
        result[song_id] = kept
        print(f"{song_id}: {len(kept)} 行（元 {len(rows)} 行、尺 {duration_ms}ms）")
    dest = ROOT / "src/data/lyrics.json"
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

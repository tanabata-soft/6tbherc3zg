#!/usr/bin/env python3
"""元動画・単体HTML版の mov_text 字幕から歌詞行を抽出し、src/data/lyrics.json を作る。

highway / night の字幕はカラオケ式のスクロール字幕で、各キューは最大3行の
ウィンドウ（前の行／今の行／次の行）を表示する。今の行は:
  - 3行キューでは中央の行
  - 2行キューでは、最初のキューだけ先頭の行、それ以外は末尾の行
  - 「♪」だけのキューは間奏（歌詞なし）
行の時刻は、その行が「今の行」になるキューの [開始, 終了) を使う。

gospel / kira（v1.9.3 で追加）は、単体HTML版に埋め込まれていた MP4 の字幕で、
形式が違う: 歌詞は1行ずつのキューで、節の注記（[Verse 1: …] など）と
掛け声（(Oh, oh) など）は長さ0のキューとして混ざっている。長さ0のキューと
「[」で始まる注記を除き、残りの行をそのまま歌詞行にする（複数行のキューは
区間を均等に割る）。

音源はショート編集（頭から切り取っただけ）なので、時刻の再マッピングは不要。
編集版の尺（charts.json の durationMs）を超える行は切り捨て、終了時刻は
尺でクランプする。

使い方: python3 scripts/extract-lyrics.py
"""
import base64
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

# 曲ID → 単体HTML版の中の曲キー（音源 MP4 が base64 で埋め込まれている）
ORIGINAL_HTML = Path.home() / "workspace/user/files/kiso-rhythm-game_0_1l6e.html"
HTML_SONGS = {
    "gospel": "gospel",
    "kira": "kira",
}
# 単体HTML版の2曲は、編集の切り際で次の節の1行目が尺の内側に少しだけ
# 入り込む（頭だけ見える断片になる）。末尾フェード（1.6秒）の中で始まる行は落とす
HTML_SONG_FADE_MS = 1600

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


def reconstruct_single(cues):
    """単体HTML版の字幕（1行キュー＋長さ0の注記・掛け声）から歌詞行を作る"""
    out = []
    for start, end, raw_lines in cues:
        if end <= start:
            continue  # 節の注記・掛け声は長さ0のキュー。歌詞ではない
        lines = [clean(ln) for ln in raw_lines]
        lines = [ln for ln in lines if ln and not ln.startswith("[")]
        if not lines:
            continue
        step = (end - start) / len(lines)
        for i, text in enumerate(lines):
            out.append((start + step * i, start + step * (i + 1), text))
    return out


def extract_html_song_srt(html: str, key: str) -> str:
    """単体HTML版から曲の MP4（base64）を復元し、字幕を SRT で取り出す"""
    i = html.find(key + ":{name:'")
    if i < 0:
        raise ValueError(f"単体HTML版に曲 {key} が見つかりません")
    s = html.find("src:'", i) + len("src:'")
    e = html.find("'", s)
    data = base64.b64decode(html[s:e])
    with tempfile.TemporaryDirectory() as td:
        mp4 = Path(td) / f"{key}.m4a"
        mp4.write_bytes(data)
        return extract_srt(mp4)


def main() -> int:
    charts = json.loads((ROOT / "src/data/charts.json").read_text(encoding="utf-8"))
    result = {}
    sources = []  # (曲ID, SRT文字列, 再構成関数, 行の開始を許す上限ms)
    for song_id, video in VIDEOS.items():
        if not video.exists():
            print(f"元動画がありません: {video}", file=sys.stderr)
            return 1
        sources.append((song_id, extract_srt(video), reconstruct, charts[song_id]["durationMs"]))
    if HTML_SONGS:
        if not ORIGINAL_HTML.exists():
            print(f"単体HTML版がありません: {ORIGINAL_HTML}", file=sys.stderr)
            return 1
        html = ORIGINAL_HTML.read_text(encoding="utf-8", errors="replace")
        for song_id, key in HTML_SONGS.items():
            limit = charts[song_id]["durationMs"] - HTML_SONG_FADE_MS
            sources.append((song_id, extract_html_song_srt(html, key), reconstruct_single, limit))
    for song_id, srt, rebuild, start_limit_ms in sources:
        duration_ms = charts[song_id]["durationMs"]
        rows = rebuild(parse_cues(srt))
        kept = []
        for start, end, text in rows:
            start_ms = round(start * 1000)
            if start_ms >= start_limit_ms:
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

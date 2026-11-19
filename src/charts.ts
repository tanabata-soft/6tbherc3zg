// 曲と譜面のデータ（正本は src/data/charts.json。scripts/generate-charts.py が音源解析で生成する）。
// 歌詞は src/data/lyrics.json（scripts/extract-lyrics.py が元動画の字幕から抽出）。
import type { LyricLine, SongData, SongId } from './logic';
import raw from './data/charts.json';
import lyricsRaw from './data/lyrics.json';
import highwayAudio from './assets/highway.mp3';
import nightAudio from './assets/night.mp3';
import gospelAudio from './assets/gospel.mp3';
import kiraAudio from './assets/kira.mp3';
import highwayJacket from './assets/highway.jpg';
import nightJacket from './assets/night.jpg';
import gospelJacket from './assets/gospel.jpg';
import kiraJacket from './assets/kira.jpg';

export interface SongEntry {
  id: SongId;
  data: SongData;
  /** 音源ファイルの URL（ビルドで assets に出力され、Service Worker の precache に入る） */
  audioUrl: string;
  /** ジャケット絵の URL */
  jacketUrl: string;
  /** 収録アルバム名（表示用） */
  album: string;
  genre: string;
  /** 歌詞行（編集版の尺まで。scripts/extract-lyrics.py が生成） */
  lyrics: LyricLine[];
}

const songs = raw as unknown as Record<SongId, SongData>;
const lyrics = lyricsRaw as unknown as Record<SongId, LyricLine[]>;

export const SONGS: SongEntry[] = [
  {
    id: 'highway',
    data: songs.highway,
    lyrics: lyrics.highway,
    audioUrl: highwayAudio,
    jacketUrl: highwayJacket,
    album: '銀の谷間のダンスフロア',
    genre: '90s J-Pop / Eurobeat',
  },
  {
    id: 'night',
    data: songs.night,
    lyrics: lyrics.night,
    audioUrl: nightAudio,
    jacketUrl: nightJacket,
    album: 'Silver Screen Ascent',
    genre: '90s J-Pop / Eurobeat',
  },
  {
    // v1.9.3 で追加: 単体HTML版に収録されていた曲。音源・ジャケット・歌詞は同HTMLから抽出
    id: 'gospel',
    data: songs.gospel,
    lyrics: lyrics.gospel,
    audioUrl: gospelAudio,
    jacketUrl: gospelJacket,
    album: '谷底のハレルヤ',
    genre: 'Gospel',
  },
  {
    id: 'kira',
    data: songs.kira,
    lyrics: lyrics.kira,
    audioUrl: kiraAudio,
    jacketUrl: kiraJacket,
    album: 'After the Last Bus',
    genre: 'Synth Pop',
  },
];

export const songById = (id: SongId): SongEntry => SONGS.find((s) => s.id === id) ?? SONGS[0];

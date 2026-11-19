// 曲と譜面のデータ（正本は src/data/charts.json。scripts/generate-charts.py が音源解析で生成する）。
import type { SongData, SongId } from './logic';
import raw from './data/charts.json';
import highwayAudio from './assets/highway.mp3';
import nightAudio from './assets/night.mp3';
import highwayJacket from './assets/highway.jpg';
import nightJacket from './assets/night.jpg';

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
}

const songs = raw as unknown as Record<SongId, SongData>;

export const SONGS: SongEntry[] = [
  {
    id: 'highway',
    data: songs.highway,
    audioUrl: highwayAudio,
    jacketUrl: highwayJacket,
    album: '銀の谷間のダンスフロア',
    genre: '90s J-Pop / Eurobeat',
  },
  {
    id: 'night',
    data: songs.night,
    audioUrl: nightAudio,
    jacketUrl: nightJacket,
    album: 'Silver Screen Ascent',
    genre: '90s J-Pop / Eurobeat',
  },
];

export const songById = (id: SongId): SongEntry => SONGS.find((s) => s.id === id) ?? SONGS[0];

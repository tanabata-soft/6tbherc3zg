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

/**
 * 演奏画面の背景ジャケットの切り抜き方（ジャケット内座標への割合 0..1 で指定する）。
 * 曲選択カルーセルの寄せ方向（style.css の object-position）と同じ知見で決める。
 */
export interface JacketCrop {
  /** 横の寄せ: 0=左端、0.5=中央、1=右端 */
  x: number;
  /** 縦の寄せ: 0=上端、0.5=中央、1=下端 */
  y: number;
  /**
   * 絵の中のタイトルが収まる窓の幅（ジャケット幅への割合）。
   * 指定した曲は、その窓を画面の横幅いっぱいに敷く層を重ねて、タイトルが切れないようにする
   * （縦長の画面では cover 切り抜きの窓がタイトルより狭く、右端が切れてしまうため）
   */
  titleWidth?: number;
}

export interface SongEntry {
  id: SongId;
  data: SongData;
  /** 音源ファイルの URL（ビルドで assets に出力され、Service Worker の precache に入る） */
  audioUrl: string;
  /** ジャケット絵の URL */
  jacketUrl: string;
  /** 演奏画面の背景ジャケットの切り抜き方 */
  bgCrop: JacketCrop;
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
    // タイトル（「石畳のハイウェイ」＋英題）は左上の横 0.02〜0.64、上端寄せで全部収まる
    bgCrop: { x: 0, y: 0, titleWidth: 0.68 },
    album: '銀の谷間のダンスフロア',
    genre: '90s J-Pop / Eurobeat',
  },
  {
    id: 'night',
    data: songs.night,
    lyrics: lyrics.night,
    audioUrl: nightAudio,
    jacketUrl: nightJacket,
    // タイトル（KISO NIGHT SILHOUETTE）は左下の横 0.02〜0.72、下端寄せで全部収まる
    bgCrop: { x: 0, y: 1, titleWidth: 0.76 },
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
    // 文字なしの絵。主役（渓谷で両手を広げる男性、横 0.13〜0.68）に窓の中心を合わせる
    bgCrop: { x: 0.35, y: 0.5 },
    album: '谷底のハレルヤ',
    genre: 'Gospel',
  },
  {
    id: 'kira',
    data: songs.kira,
    lyrics: lyrics.kira,
    audioUrl: kiraAudio,
    jacketUrl: kiraJacket,
    // 文字なしの絵。天の川と2人の人物が中央にあるので中央寄せ（カルーセルと同じ）
    bgCrop: { x: 0.5, y: 0.5 },
    album: 'After the Last Bus',
    genre: 'Synth Pop',
  },
];

export const songById = (id: SongId): SongEntry => SONGS.find((s) => s.id === id) ?? SONGS[0];

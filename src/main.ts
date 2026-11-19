import './style.css';
import { DIFFICULTIES, clampOffset, type Difficulty, type SongId } from './logic';
import { SONGS, songById, type SongEntry } from './charts';
import { Game, type GameResult } from './game';
import { exposeTestApi, setData, setupDebug } from './debug';
import { setupInstallGuide } from './install';
import { setupUpdateBanner } from './pwa';
import { isSoundOn, setSound } from './sound';
import { isVibrateOn, setVibrate } from './haptics';
import { audioState, isUnlocked, unlockAudio } from './audio';
import { load, migrateStorage, requestPersist, save } from './storage';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

migrateStorage();

// ---- 選択と記録 ----
let selectedSong: SongId = load<SongId>('song', 'highway');
if (!SONGS.some((s) => s.id === selectedSong)) selectedSong = 'highway';
let selectedDiff: Difficulty = load<Difficulty>('difficulty', 'easy');
if (!(selectedDiff in DIFFICULTIES)) selectedDiff = 'easy';
let offsetMs = clampOffset(load<number>('offset', 0));
type BestMap = Record<string, number>;
const bestKey = (song: SongId, diff: Difficulty): string => `${song}:${diff}`;
const loadBests = (): BestMap => load<BestMap>('best', {});
const bestOf = (song: SongId, diff: Difficulty): number => loadBests()[bestKey(song, diff)] ?? 0;

// ---- 画面の出し分け ----
type Screen = 'menu' | 'game' | 'result';
let screen: Screen = 'menu';
function show(next: Screen): void {
  screen = next;
  $('menu-screen').hidden = next !== 'menu';
  $('game-screen').hidden = next !== 'game';
  $('result-screen').hidden = next !== 'result';
  setData('screen', next);
}

// ---- メニューの組み立て ----
const songList = $('song-list');
const songButtons = new Map<SongId, HTMLButtonElement>();
for (const entry of SONGS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'song-card';
  b.dataset.song = entry.id;
  b.setAttribute('aria-label', entry.data.title);
  const img = document.createElement('img');
  img.src = entry.jacketUrl;
  img.alt = '';
  const title = document.createElement('span');
  title.className = 'song-thumb-title';
  title.textContent = entry.data.title;
  b.append(img, title);
  b.addEventListener('click', () => {
    selectedSong = entry.id;
    save('song', selectedSong);
    renderMenu();
  });
  songList.append(b);
  songButtons.set(entry.id, b);
}

const diffButtons = [...document.querySelectorAll<HTMLButtonElement>('#diff-row [data-diff]')];
for (const b of diffButtons) {
  b.addEventListener('click', () => {
    selectedDiff = b.dataset.diff as Difficulty;
    save('difficulty', selectedDiff);
    renderMenu();
  });
}

function renderToggle(id: string, on: boolean): void {
  const button = $(id);
  button.setAttribute('aria-pressed', String(on));
  const state = button.querySelector('.toggle-state');
  if (state) state.textContent = on ? 'オン' : 'オフ';
}

function renderMenu(): void {
  for (const [id, b] of songButtons) b.setAttribute('aria-pressed', String(id === selectedSong));
  for (const b of diffButtons) b.setAttribute('aria-pressed', String(b.dataset.diff === selectedDiff));
  // ヒーロー表示を選択中の曲に合わせる（ジャケットの切り取り位置は曲ごとに CSS で指定）
  const entry = songById(selectedSong);
  const heroJacket = $<HTMLImageElement>('hero-jacket');
  heroJacket.src = entry.jacketUrl;
  heroJacket.dataset.song = entry.id;
  $('hero-title').textContent = entry.data.title;
  $('hero-album').textContent = entry.album;
  $('hero-bpm').textContent = `BPM ${Math.round(entry.data.bpm)}`;
  const sec = Math.round(entry.data.durationMs / 1000);
  $('hero-length').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('menu-best').textContent = String(bestOf(selectedSong, selectedDiff));
  $('offset-value').textContent = `${offsetMs > 0 ? '+' : ''}${offsetMs}ms`;
  renderToggle('sound-button', isSoundOn());
  renderToggle('vibrate-button', isVibrateOn());
  setData('song', selectedSong);
  setData('difficulty', selectedDiff);
  setData('offset', offsetMs);
  setData('sound', isSoundOn() ? 'on' : 'off');
  setData('vibrate', isVibrateOn() ? 'on' : 'off');
}

function setOffset(next: number): void {
  offsetMs = clampOffset(next);
  save('offset', offsetMs);
  renderMenu();
}
$('offset-minus').addEventListener('click', () => setOffset(offsetMs - 10));
$('offset-plus').addEventListener('click', () => setOffset(offsetMs + 10));
$('sound-button').addEventListener('click', () => {
  setSound(!isSoundOn());
  renderMenu();
});
$('vibrate-button').addEventListener('click', () => {
  setVibrate(!isVibrateOn());
  renderMenu();
});

// ---- 設定モーダル ----
const settingsDialog = $<HTMLDialogElement>('settings-dialog');
function openSettings(): void {
  renderMenu();
  if (!settingsDialog.open) {
    settingsDialog.showModal();
    // 開いている間は背面のスクロールを止める（閉じたら 'close' イベントで戻す）
    document.body.classList.add('dialog-open');
  }
}
function closeSettings(): void {
  if (settingsDialog.open) settingsDialog.close();
}
$('settings-open').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
$('settings-close-bottom').addEventListener('click', closeSettings);
settingsDialog.addEventListener('click', (e) => {
  // 背景（ダイアログ自身の余白部分）のタップで閉じる
  if (e.target === settingsDialog) closeSettings();
});
settingsDialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
});

// ---- ゲーム ----
const game = new Game($<HTMLCanvasElement>('game-canvas'), {
  onFinish: (result) => showResult(result),
  onAbort: () => {
    show('menu');
    renderMenu();
  },
});

let lastEntry: SongEntry = songById(selectedSong);
let lastDiff: Difficulty = selectedDiff;

async function startGame(): Promise<void> {
  // スタートボタンのタップ（ジェスチャ）の中で、await より先に音声を unlock する（iPhone 対策）
  unlockAudio();
  const entry = songById(selectedSong);
  lastEntry = entry;
  lastDiff = selectedDiff;
  const status = $('start-status');
  const startButton = $<HTMLButtonElement>('start-button');
  startButton.disabled = true;
  status.textContent = '読み込み中…';
  try {
    show('game');
    await game.start(entry, selectedDiff, offsetMs);
    status.textContent = '';
  } catch {
    show('menu');
    status.textContent = '音の読み込みに失敗しました。ページを開き直してください。';
  } finally {
    startButton.disabled = false;
  }
}
$('start-button').addEventListener('click', () => void startGame());

function showResult(result: GameResult): void {
  const bests = loadBests();
  const key = bestKey(lastEntry.id, lastDiff);
  const best = Math.max(bests[key] ?? 0, result.score);
  bests[key] = best;
  save('best', bests);
  $('result-rank').textContent = result.rank;
  $('result-song').textContent = `${result.songTitle}（${DIFFICULTIES[lastDiff].label}）`;
  $('result-score').textContent = String(result.score);
  $('result-best').textContent = String(best);
  $('result-counts').textContent = `PERFECT ${result.counts.perfect} / GREAT ${result.counts.great} / GOOD ${result.counts.good} / MISS ${result.counts.miss}`;
  $('result-accuracy').textContent = result.accuracy.toFixed(1);
  $('result-combo').textContent = String(result.maxCombo);
  $('game-live').textContent = `結果: ランク${result.rank}、スコア${result.score}、精度${result.accuracy.toFixed(1)}%`;
  show('result');
  renderMenu();
}
$('again-button').addEventListener('click', () => {
  selectedSong = lastEntry.id;
  selectedDiff = lastDiff;
  void startGame();
});
$('back-button').addEventListener('click', () => {
  show('menu');
  renderMenu();
});

// 初回のタップで音声を unlock する（iPhone ではジェスチャの中で AudioContext を起こす必要がある）
window.addEventListener('pointerdown', () => unlockAudio());

$('version').textContent = __APP_VERSION__;
// デバッグモード: バージョンの表示を続けて 5 回タップで切り替え
setupDebug($('debug-panel'), $('version-line'), [
  {
    label: '結果へ',
    title: 'プレイ中なら、いまの成績で結果画面へ進む',
    run: () => game.finishNow(),
  },
]);
// テスト用の入口（?debug=1 のときだけ出る）
exposeTestApi({
  getState: () => ({
    screen,
    song: selectedSong,
    difficulty: selectedDiff,
    offset: offsetMs,
    playing: game.isPlaying,
    sound: isSoundOn(),
    vibrate: isVibrateOn(),
    audioUnlocked: isUnlocked(),
    audioState: audioState(),
  }),
  setState: (patch) => {
    if (typeof patch.song === 'string' && SONGS.some((s) => s.id === patch.song)) selectedSong = patch.song as SongId;
    if (typeof patch.difficulty === 'string' && patch.difficulty in DIFFICULTIES) selectedDiff = patch.difficulty as Difficulty;
    if (typeof patch.offset === 'number') offsetMs = clampOffset(patch.offset);
    renderMenu();
  },
  startGame: () => startGame(),
  // 撮影・E2E 用: プレイ中のコンボ数を直接セットする（コンボ連動エフェクトの確認用）
  setCombo: (n: unknown) => {
    if (typeof n === 'number') game.debugSetCombo(n);
  },
});
requestPersist();
setupUpdateBanner($('update-banner'), $<HTMLButtonElement>('update-button'), $('update-later'));
setupInstallGuide($<HTMLButtonElement>('install-open'), $<HTMLDialogElement>('install-dialog'), $<HTMLButtonElement>('install-now'));
show('menu');
renderMenu();

// ここまで来たら起動成功（public/boot.js が見ている）
window.__appStarted = true;

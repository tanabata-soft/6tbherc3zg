// 曲の再生（Web Audio）。デコード済みのバッファは曲ごとに保持し、再プレイで再デコードしない
// （元ゲームは再プレイのたびに数MBをデコードし直していた）。
let ctx: AudioContext | undefined;
const buffers = new Map<string, AudioBuffer>();
let current: AudioBufferSourceNode | undefined;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export function nowSeconds(): number {
  return audioContext().currentTime;
}

/** 曲の音源を読み込んでデコードする。2回目以降は保持したバッファを返す。 */
export async function loadBuffer(url: string): Promise<AudioBuffer> {
  const cached = buffers.get(url);
  if (cached) return cached;
  const ac = audioContext();
  await ac.resume();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`音源を読み込めませんでした (${res.status})`);
  const buf = await ac.decodeAudioData(await res.arrayBuffer());
  buffers.set(url, buf);
  return buf;
}

/** バッファを指定時刻に再生開始する。 */
export function playBuffer(buf: AudioBuffer, when: number): AudioBufferSourceNode {
  stopCurrent();
  const src = audioContext().createBufferSource();
  src.buffer = buf;
  src.connect(audioContext().destination);
  src.start(when);
  current = src;
  return src;
}

export function stopCurrent(): void {
  if (!current) return;
  try {
    current.stop();
  } catch {
    // すでに止まっている
  }
  current = undefined;
}

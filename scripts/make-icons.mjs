// アイコンを生成する: npm run icons
// 出所は『石畳のハイウェイ』のジャケット絵（src/assets/highway.jpg。動画の静止画フレーム）。
// PNG は ffmpeg でジャケット絵から作る（直接編集しない）。生成後に icon-512 を目視確認すること。
// maskable は端末が外側を切り抜くため、絵を中央 80% に収め、周りをテーマ色で埋める。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const jacket = join(root, 'src/assets/highway.jpg');
const outDir = join(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const BG = '0x0b0e1d';
function make(name, size, scaleRatio) {
  const inner = Math.round(size * scaleRatio);
  const pad = Math.round((size - inner) / 2);
  const vf =
    scaleRatio >= 1
      ? `scale=${size}:${size}`
      : `scale=${inner}:${inner},pad=${size}:${size}:${pad}:${pad}:color=${BG}`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', jacket, '-vf', vf, '-frames:v', '1', join(outDir, name)], { stdio: 'inherit' });
}

make('icon-192.png', 192, 1);
make('icon-512.png', 512, 1);
make('icon-maskable-512.png', 512, 0.8);
// apple-touch-icon は iOS が角を丸めるので全面塗りにする
make('apple-touch-icon.png', 180, 1);

// SVG アイコン: 4レーンとノーツを表す図柄（テーマ色の地に、レーン色の帯と金のノーツ）
writeFileSync(
  join(outDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0e1d"/><rect x="86" y="60" width="70" height="392" rx="14" fill="#ff6b6b"/><rect x="172" y="60" width="70" height="392" rx="14" fill="#ffd166"/><rect x="258" y="60" width="70" height="392" rx="14" fill="#4ecdc4"/><rect x="344" y="60" width="70" height="392" rx="14" fill="#6c8cff"/><rect x="60" y="330" width="392" height="52" rx="12" fill="#ffd166"/></svg>\n`,
);
console.log('icons generated from src/assets/highway.jpg');

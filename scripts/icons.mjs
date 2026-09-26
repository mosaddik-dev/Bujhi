// Renders assets/icons/bujhi.svg to the PNG sizes Chrome needs (manifest icons can't be SVG).
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../assets/icons/bujhi.svg', import.meta.url));
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 72 * (size / 128) * 4 })
    .resize(size, size)
    .png()
    .toFile(new URL(`../assets/icons/png/icon-${size}.png`, import.meta.url).pathname);
}
console.log('icons: wrote 16, 32, 48, 128');

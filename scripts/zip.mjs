// Packs dist/ into bujhi-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const file = `bujhi-${version}.zip`;
rmSync(file, { force: true });
execFileSync('zip', ['-qr', `../${file}`, '.'], { cwd: 'dist', stdio: 'inherit' });
console.log(`wrote ${file}`);

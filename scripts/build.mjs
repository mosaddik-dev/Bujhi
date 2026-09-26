// Bundles src/ into dist/ (a loadable, unpacked extension). `--watch` rebuilds on change.
import { cp, mkdir, rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/icons`, { recursive: true });
await cp('static', outdir, { recursive: true });
await cp('assets/icons/png', `${outdir}/icons`, { recursive: true });
await cp('assets/icons/bujhi.svg', `${outdir}/icons/bujhi.svg`);

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  outdir,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  loader: { '.svg': 'text', '.css': 'text' },
  logLevel: 'info',
};

const builds = [
  { entryPoints: { background: 'src/background/index.ts' } },
  {
    entryPoints: { content: 'src/content/index.ts' },
    // The value of the last statement is what chrome.scripting.executeScript reports per frame.
    footer: { js: 'globalThis.__bujhi && globalThis.__bujhi.probe();' },
  },
  { entryPoints: { options: 'src/options/options.ts' } },
  { entryPoints: { popup: 'src/popup/popup.ts' } },
  { entryPoints: { offscreen: 'src/offscreen/offscreen.ts' } },
];

if (watch) {
  for (const b of builds) await (await esbuild.context({ ...common, ...b })).watch();
  console.log('watching… (static/ changes need a restart)');
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
}

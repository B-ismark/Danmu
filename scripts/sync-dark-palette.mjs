// Copies the night-mode palette in app/globals.css into its media-query mirror.
//
// CSS cannot OR `@media (prefers-color-scheme: dark)` with `[data-theme="dark"]`,
// so the palette is declared twice: once under the attribute (the one people
// edit, with its contrast comments) and once under the media query for System on
// a dark device. This rewrites the second from the first — declarations only,
// comments stripped — and `tests/color-tokens.test.ts` fails if the two ever
// disagree, so running this is how that test is made green after a palette edit.
//
//   node scripts/sync-dark-palette.mjs           rewrite the mirror in place
//   node scripts/sync-dark-palette.mjs --check   exit 1 if it is out of date

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'globals.css');
const SOURCE = ':root[data-theme="dark"] {';
const MIRROR_OPEN = '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n';
const MIRROR_CLOSE = '\n  }\n}';

// Worked on with LF and written back with the file's own line ending: a Windows
// checkout with autocrlf hands this CRLF, where every '\n'-anchored marker above
// misses and the script used to throw "no mirror block" on a file that has one.
const raw = readFileSync(FILE, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const css = raw.replace(/\r\n/g, '\n');

const start = css.indexOf(SOURCE);
if (start === -1) throw new Error(`no \`${SOURCE}\` block in globals.css`);
const end = css.indexOf('\n}', start);
const body = css.slice(start + SOURCE.length, end);

const declarations = body
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => `    ${l}`)
  .join('\n');

const at = css.indexOf(MIRROR_OPEN);
if (at === -1) throw new Error('no prefers-color-scheme mirror block in globals.css');
const inner = at + MIRROR_OPEN.length;
const close = css.indexOf(MIRROR_CLOSE, inner);
const next = css.slice(0, inner) + declarations + css.slice(close);

if (process.argv.includes('--check')) {
  if (next !== css) {
    console.error('The dark palette mirror in app/globals.css is out of date. Run: node scripts/sync-dark-palette.mjs');
    process.exit(1);
  }
} else if (next !== css) {
  writeFileSync(FILE, eol === '\n' ? next : next.replace(/\n/g, eol));
  console.log('Rewrote the prefers-color-scheme mirror of the dark palette.');
} else {
  console.log('The dark palette mirror is already in step.');
}

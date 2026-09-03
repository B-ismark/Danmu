import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LayoutId } from '@/lib/footprint';

/** The room sizes onboarding OFFERS, and the ceiling it gives them, parsed from the
 *  only screen that offers them.
 *
 *  **Two files assert things about "a brand-new room" and both used to name their own
 *  numbers.** `tests/scene-seed.test.ts` hand-typed the five presets and
 *  `tests/starter-navigability.test.ts` parsed them, which is worse than either one
 *  alone: resize the `u` preset on the page and the parsing file goes red while the
 *  hand-typed one carries on measuring 6.0 x 5.0 and stays green — two gates over one
 *  property, disagreeing about which room they are gating. They read this instead.
 *
 *  A fixture is a claim about a reachable state, and a hand-copied size is a claim
 *  that has stopped being checked. Parsed the way `tests/shape-contract.test.ts`
 *  parses `scripts/export-detector.py`.
 *
 *  Every failure mode here is loud on purpose. A regex that matches nothing, a regex
 *  that matches four rows of five, a `const PRESETS` that moves or is renamed, a
 *  missing `const HEIGHT` — each throws rather than returning a short list, because
 *  the whole point of deriving is that a fixture cannot silently narrow. */

export type OfferedSize = { id: LayoutId; width: number; depth: number };

const SOURCE = 'app/onboarding/layout-pick/page.tsx';

/** `id: 'x' as const, name: '…', width: N, depth: N` — the shape of one preset row.
 *  `[a-z0-9-]` rather than `[a-z]`: `LayoutId` is derived from `LAYOUT_IDS` and an id
 *  with a digit or a hyphen would otherwise be skipped by a regex that still matches
 *  its neighbours, which is the silent narrowing this file exists to prevent. */
const ROW =
  /id:\s*'([a-z0-9-]+)'\s*as\s*const\s*,\s*name:\s*'[^']*'\s*,\s*width:\s*([\d.]+)\s*,\s*depth:\s*([\d.]+)/g;

function pickerSource(): string {
  return readFileSync(join(process.cwd(), SOURCE), 'utf8');
}

function presetBlock(src: string): string {
  const start = src.indexOf('const PRESETS = [');
  const end = src.indexOf('const HEIGHT');
  // `slice` is forgiving about -1 in both arguments — `slice(-1, …)` reads the last
  // character and `slice(…, -1)` runs to the end of the file — so an unfound marker
  // returns a plausible string rather than failing. Both are checked.
  if (start < 0) throw new Error(`${SOURCE}: no 'const PRESETS = [' — has the picker been rewritten?`);
  if (end < start) throw new Error(`${SOURCE}: no 'const HEIGHT' after PRESETS — the parse has no end`);
  return src.slice(start, end);
}

/** Every `{ id, width, depth }` the picker offers, in the order it offers them. */
export function offeredSizes(): OfferedSize[] {
  const block = presetBlock(pickerSource());
  const out: OfferedSize[] = [];
  ROW.lastIndex = 0;
  for (let m = ROW.exec(block); m !== null; m = ROW.exec(block)) {
    out.push({ id: m[1] as LayoutId, width: Number(m[2]), depth: Number(m[3]) });
  }

  // How many rows the block CONTAINS, against how many were understood. A regex that
  // matches four of five rows passes every downstream assertion while silently
  // dropping a preset from the gate — the count is the only thing that can see it,
  // and it has to be derived from the same text rather than typed here.
  const rows = block.match(/\bid:\s*'/g)?.length ?? 0;
  if (rows === 0) throw new Error(`${SOURCE}: the PRESETS block holds no \`id:\` at all`);
  if (out.length !== rows) {
    throw new Error(`${SOURCE}: ${rows} preset rows, ${out.length} parsed — ROW no longer matches them all`);
  }
  for (const o of out) {
    if (!(o.width > 0) || !(o.depth > 0)) throw new Error(`${SOURCE}: ${o.id} parsed ${o.width} x ${o.depth}`);
  }
  return out;
}

/** The ceiling the picker saves with every room it creates.
 *
 *  Parsed for the same reason as the sizes: it was hand-typed as `2.8` in both test
 *  files, out of the very file being read — and it is also the marker the preset
 *  block ends at, so the two would drift together in the one direction nobody looks. */
export function offeredHeight(): number {
  const src = pickerSource();
  const m = /const HEIGHT\s*=\s*([\d.]+)\s*;/.exec(src);
  if (!m) throw new Error(`${SOURCE}: no \`const HEIGHT = …;\``);
  const h = Number(m[1]);
  if (!(h > 0)) throw new Error(`${SOURCE}: HEIGHT parsed as ${m[1]}`);
  return h;
}

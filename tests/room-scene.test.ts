// A piece's transform lives in two layers, and the fallback between them is written
// exactly once.
//
// `lib/transforms.ts` explains why the layers exist and must not be collapsed. This
// file guards the other half of that bargain: `positions[p.id] ?? p.pos` open-coded
// anywhere else is a silent bug the moment someone forgets a line of it — the piece
// still renders, the numbers still look plausible, and it is simply in the wrong
// place.
//
// `lib/room-scene.ts` had already declared itself the one place the merge happens.
// Four files used it. Twelve wrote the fallback out again, because the un-memoised
// version rebuilt the whole array on every render and the hot paths could not afford
// it. A comment asking to be the single source of truth is not one; a test is.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { hasOverride, resolvePart, resolveParts, type TransformOverrides } from '@/lib/transforms';
import type { ScenePart } from '@/lib/scene-spec';

const part = (over: Partial<ScenePart> = {}): ScenePart =>
  ({
    id: 'sofa-1',
    category: 'sofa',
    name: 'Sofa',
    shape: 'sofa',
    pos: [1, 0, 2],
    rot: 0.5,
    dimMM: [2200, 950, 880],
    locked: false,
    ...over,
  }) as ScenePart;

const NONE: TransformOverrides = { positions: {}, rotations: {}, dims: {} };

describe('resolvePart', () => {
  it('returns the authored transform when nothing overrides it', () => {
    const p = part();
    const r = resolvePart(p, NONE);
    expect(r.pos).toEqual([1, 0, 2]);
    expect(r.rot).toBe(0.5);
    expect(r.dimMM).toEqual([2200, 950, 880]);
  });

  it('returns the very same object when nothing overrides it', () => {
    // Referential equality for the untouched majority is what makes memoising the
    // list worth doing, and it lets a consumer compare by identity to see what moved.
    const p = part();
    expect(resolvePart(p, NONE)).toBe(p);
  });

  it('lets each override win independently', () => {
    const p = part();
    expect(resolvePart(p, { positions: { 'sofa-1': [9, 0, 9] } }).pos).toEqual([9, 0, 9]);
    expect(resolvePart(p, { positions: { 'sofa-1': [9, 0, 9] } }).rot).toBe(0.5);
    expect(resolvePart(p, { rotations: { 'sofa-1': 1.25 } }).rot).toBe(1.25);
    expect(resolvePart(p, { dims: { 'sofa-1': [1800, 900, 800] } }).dimMM).toEqual([1800, 900, 800]);
  });

  it('honours a rotation override of exactly zero', () => {
    // `rot ?? base` and `rot || base` differ here, and only on the one value a user
    // reaches by turning a piece back to square.
    expect(resolvePart(part({ rot: 1.5 }), { rotations: { 'sofa-1': 0 } }).rot).toBe(0);
  });

  it('ignores overrides belonging to other parts', () => {
    expect(resolvePart(part(), { positions: { 'chair-9': [9, 9, 9] } }).pos).toEqual([1, 0, 2]);
  });

  it('never mutates the part it was given', () => {
    const p = part();
    resolvePart(p, { positions: { 'sofa-1': [9, 0, 9] } });
    expect(p.pos).toEqual([1, 0, 2]);
  });

  it('keeps every other field', () => {
    const p = part({ color: '#aabbcc', groupId: 'g1', locked: true });
    const r = resolvePart(p, { positions: { 'sofa-1': [9, 0, 9] } });
    expect(r).toMatchObject({ color: '#aabbcc', groupId: 'g1', locked: true, name: 'Sofa' });
  });
});

describe('resolveParts', () => {
  it('resolves each part against its own id', () => {
    const parts = [part({ id: 'a', pos: [0, 0, 0] }), part({ id: 'b', pos: [1, 0, 1] })];
    const out = resolveParts(parts, { positions: { b: [5, 0, 5] } });
    expect(out[0].pos).toEqual([0, 0, 0]);
    expect(out[1].pos).toEqual([5, 0, 5]);
  });

  it('accepts a partial override record', () => {
    // Callers hand it a `Transforms` from storage, which also carries `hidden`, and a
    // saved layout's transforms — neither is shaped exactly like the store slice.
    expect(() => resolveParts([part()], {})).not.toThrow();
    expect(resolveParts([part()], {})[0].pos).toEqual([1, 0, 2]);
  });
});

describe('hasOverride', () => {
  it('is false for an untouched piece', () => {
    expect(hasOverride('sofa-1', NONE)).toBe(false);
  });

  it('is true for any one of the three', () => {
    expect(hasOverride('sofa-1', { positions: { 'sofa-1': [0, 0, 0] } })).toBe(true);
    expect(hasOverride('sofa-1', { dims: { 'sofa-1': [1, 1, 1] } })).toBe(true);
  });

  it('is true for a rotation turned back to zero', () => {
    // The reason this is a function and not `!!` three times at each call site: a
    // piece squared up to 0 still has an override, and the affordance that drops it
    // has to stay on screen.
    expect(hasOverride('sofa-1', { rotations: { 'sofa-1': 0 } })).toBe(true);
  });
});

// ─── The guard ──────────────────────────────────────────────────────────────

/** Every `.ts`/`.tsx` under these roots. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(join(process.cwd(), root));
  return out;
}

/** The files allowed to write the fallback, and why.
 *
 *  Anything else that needs a piece's effective transform calls `resolvePart` /
 *  `resolveParts`, or the hooks in `lib/room-scene.ts`. */
const ALLOWED = new Set([
  // The merge itself.
  'lib/transforms.ts',
  'lib/room-scene.ts',
  // Declares the maps, and is where `??` against them is the definition rather than
  // a use of it.
  'lib/store.ts',
]);

/** `x[id] ?? y` where x is one of the override maps — the fallback, written by hand. */
const FALLBACK = /\b(positions|rotations|dims)\s*\[[^\]]+\]\s*\?\?/;

describe('the transform fallback is written once', () => {
  it('finds the source files at all', () => {
    // Without this the sweep below could pass by scanning nothing.
    //
    // Separators are normalised before the comparison because `join` emits the
    // platform's own: on Windows these come back as `lib\transforms.ts`, so the
    // check for `lib/transforms.ts` failed there while passing on CI — a guard whose
    // own smoke test only works on one of the two platforms CLAUDE.md documents.
    // The offender scan below already normalises, which is why only this line broke.
    const files = sources().map((f) => f.replace(/\\/g, '/'));
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith('lib/transforms.ts'))).toBe(true);
  });

  it('is not open-coded anywhere else', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // Skip comments — several files legitimately describe the pattern in prose.
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) continue;
        if (FALLBACK.test(line)) offenders.push(`${rel}:${i + 1}`);
      }
    }
    expect(
      offenders,
      `these resolve a transform by hand instead of calling resolvePart/resolveParts ` +
        `or a lib/room-scene hook:\n  ${offenders.join('\n  ')}\n` +
        `If a raw override read is genuinely what you need — Draggable compares a stored ` +
        `dim against the AUTHORED dim to get a scale factor, which the resolved value ` +
        `cannot express — read the map without the ?? and say why.`,
    ).toEqual([]);
  });
});

// ─── …and the merge is not the whole answer ─────────────────────────────────
//
// `resolveParts` answers *"what did the user override"*. A piece standing on a piece
// whose height changed has a stale Y in BOTH layers, because nothing wrote one, so a
// consumer that renders or exports the room wants `resolveScene` (§ 12). The two are
// one character apart and the wrong one is silently wrong — the lamp is simply at the
// height the desk used to be, and from directly above in the plan it looks correct.
//
// So the callers are pinned by name, the way the ceiling clampers are in
// `tests/scene-build.test.ts`: a new one arrives as a decision rather than as a diff
// nobody reads.

/** Where `resolveParts` may be called, and why each is not `resolveScene`.
 *
 *  `lib/room-scene.ts` is NOT here, and its absence is the assertion: it only
 *  re-exports the name (`export { resolveParts } from …`, no parenthesis), so it never
 *  appears in the sweep at all. Listing it would have been a dead entry that made the
 *  set look one longer than the thing it describes. */
const PLAIN_MERGE_IS_RIGHT = new Set([
  'lib/transforms.ts', // declares it — matched by the declaration, not by a call
  'lib/rider-height.ts', // `resolveScene` IS this call plus the correction
  // A saved layout's thumbnail is drawn from directly above, where a footprint is all
  // there is and no Y reaches the picture. The row also has no room height of its own
  // to clamp against — a saved layout stores the two transform layers, not a ceiling.
  'components/studio/RoomTools.tsx',
]);

describe('resolveScene is what a consumer of the whole room calls', () => {
  it('lists every caller of the plain merge, and each one is allowed on purpose', () => {
    const callers: string[] = [];
    for (const file of sources()) {
      const rel = relative(process.cwd(), file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) continue;
        if (/\bresolveParts\s*\(/.test(line) && !callers.includes(rel)) callers.push(rel);
      }
    }
    // The sweep must find the allow-list itself, or an empty result would satisfy the
    // check below. Compared against the SET rather than against a hand-typed number:
    // `toBeGreaterThan(2)` sat exactly on the floor of a three-entry list, so it was a
    // bound and a census at once and neither of them was checked.
    expect([...callers].sort()).toEqual([...PLAIN_MERGE_IS_RIGHT].sort());
    expect(
      callers.filter((c) => !PLAIN_MERGE_IS_RIGHT.has(c)),
      `these call resolveParts where they probably want resolveScene — a rider whose ` +
        `support was resized has a stale Y in both layers. If the plain merge really is ` +
        `right here (a top-down drawing, or a caller with no room height), add the file ` +
        `to PLAIN_MERGE_IS_RIGHT with the reason.`,
    ).toEqual([]);
  });
});

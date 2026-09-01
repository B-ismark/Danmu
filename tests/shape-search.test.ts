import { describe, it, expect } from 'vitest';
import {
  searchLibrary,
  parseDims,
  bestMatch,
  rankLibrary,
  sizeFromQuery,
  queryNamesSize,
} from '@/lib/shape-search';
import { PART_LIBRARY } from '@/lib/scene-spec';

describe('searchLibrary', () => {
  it('finds the sofa via the synonym "couch"', () => {
    const [top] = searchLibrary('big comfy couch');
    expect(top).toBeDefined();
    expect(top.category).toBe('sofa');
  });

  it('finds the wardrobe via "closet"', () => {
    const [top] = searchLibrary('bedroom closet');
    expect(top.category).toBe('wardrobe');
  });

  it('surfaces a specific model by name', () => {
    const r = searchLibrary('french door');
    expect(r.some((i) => i.label.toLowerCase().includes('french door'))).toBe(true);
  });

  it('returns empty for gibberish', () => {
    expect(searchLibrary('zzqqxx')).toEqual([]);
  });
});

describe('parseDims', () => {
  it('parses W×D with one unit', () => {
    expect(parseDims('rug 120x60cm')).toEqual({ w: 1200, d: 600, h: undefined });
  });
  it('parses W×D×H in metres', () => {
    expect(parseDims('2.2 × 0.9 × 0.8 m sofa')).toEqual({ w: 2200, d: 900, h: 800 });
  });
  it('routes a single value to height when worded that way', () => {
    expect(parseDims('mirror 1700mm tall')).toEqual({ h: 1700 });
  });
  it('defaults a single value to width', () => {
    expect(parseDims('desk 140cm')).toEqual({ w: 1400 });
  });
  it('returns empty for no sizes', () => {
    expect(parseDims('a nice armchair')).toEqual({});
  });
});

describe('bestMatch', () => {
  it('applies explicit sizes, clamped into the trustable range', () => {
    const m = bestMatch('bookshelf 90cm');
    expect(m).not.toBeNull();
    expect(m!.shape).toBe('bookshelf');
    expect(m!.dimMM[0]).toBe(900);
  });

  it('clamps absurd sizes back into range', () => {
    const m = bestMatch('tv 9m');
    expect(m).not.toBeNull();
    expect(m!.dimMM[0]).toBeLessThanOrEqual(2000); // tv max width
  });

  it('null on no match', () => {
    expect(bestMatch('xyzzy')).toBeNull();
  });
});

// ── The search box's own three, added when the "Describe it" tab was removed ──
//
// The tab promised models the library does not have, which rule 1 forbids and a
// procedural catalog cannot do. What was real underneath it — synonym scoring and
// a dimension parser — moved onto the ordinary search box, and these are the
// assertions that say the move lost nothing.

describe('rankLibrary', () => {
  it('returns the whole catalog for an empty query', () => {
    // A search box showing nothing before you type would be a worse list than the
    // one it replaced.
    expect(rankLibrary('').length).toBe(PART_LIBRARY.length);
    expect(rankLibrary('   ').length).toBe(PART_LIBRARY.length);
  });

  it('folds a synonym the old substring filter could not', () => {
    // This is the whole reason the picker stopped using `label.includes(q)`: no
    // catalog row contains the word "couch", so the old filter returned nothing.
    const rows = rankLibrary('couch');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].category).toBe('sofa');
    expect(PART_LIBRARY.some((i) => i.label.toLowerCase().includes('couch'))).toBe(false);
  });

  it('falls back to a substring for a half-typed word', () => {
    // "ward" is not a token the scorer recognises — `scoreItem` needs a whole
    // token or a prefix relationship, and it does get this one — but "obe" does
    // not, and it is still a fine substring of Wardrobe. Without the fallback the
    // list empties out mid-word and then refills, which reads as a broken search.
    const rows = rankLibrary('obe');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((i) => `${i.label} ${i.group}`.toLowerCase().includes('obe'))).toBe(true);
  });

  it('is not capped at the suggestion limit', () => {
    // `searchLibrary` defaults to 5, which is right for a short suggestion list and
    // wrong for a box that is showing you the catalog: a list that stops at 5 reads
    // as "that is all there is".
    //
    // "table" because it SCORES more than five rows. A single letter will not do,
    // and that was the first version of this assertion: `tokens()` drops anything of
    // length 1, so 'a' scores nothing at all and falls through to the substring
    // branch, which was never capped — the test passed under a deliberate cap of 5
    // and was therefore checking the fallback while claiming to check the cap.
    //
    // The first expectation is a guard on the FIXTURE, not on the code: if the
    // catalog ever stops giving this word more than five hits, the cap becomes
    // unobservable here and this should say so rather than go quietly green.
    const scored = searchLibrary('table', PART_LIBRARY.length);
    expect(scored.length, 'fixture no longer exercises the cap — pick a broader word').toBeGreaterThan(5);
    expect(rankLibrary('table').length).toBe(scored.length);
  });

  it('returns nothing for words the catalog has never heard of', () => {
    expect(rankLibrary('zzqqxx')).toEqual([]);
  });

  // A bare size used to empty the grid. No token in `160x200cm` is a word, so
  // nothing scores; and no label contains that string, so the substring fallback
  // finds nothing either. The result was a blank catalogue with the resolved-size
  // badge armed and nothing to show it on — reachable by typing the size before the
  // noun, which is exactly what "160x200cm bed" invites. Found in review.
  it('shows the whole catalog for a query that is nothing but a size', () => {
    // Not `.length > 0`: that would pass on a single lucky substring hit. The claim
    // is that the catalogue is UNNARROWED, so it is the full count or nothing.
    expect(rankLibrary('160x200cm').length).toBe(PART_LIBRARY.length);
    expect(rankLibrary('200cm').length).toBe(PART_LIBRARY.length);
    expect(rankLibrary('2.2 × 0.9 m').length).toBe(PART_LIBRARY.length);
    expect(rankLibrary('180cm wide').length).toBe(PART_LIBRARY.length);
  });

  it('but a real word that matched nothing still means nothing', () => {
    // The other half, and the half that makes the branch above narrow rather than a
    // blanket "never show an empty list". A word that matched nothing alongside a
    // size is still a failed search, and answering it with the entire library would
    // be worse than an empty state.
    //
    // Both examples are genuine non-words rather than typos, and that is not
    // fastidiousness: `sofaa` was the first fixture here and it FAILED, because
    // `searchLibrary` fuzzy-matches it to Sofa and returns early. That is the matcher
    // working. A typo is not the case this branch is about — the case is a word the
    // catalogue genuinely does not have, in either order around the size.
    expect(rankLibrary('160x200cm zzqqxx')).toEqual([]);
    expect(rankLibrary('zzqqxx 40cm')).toEqual([]);
  });

  it('a unit with no number is not a size', () => {
    // Both guards on that branch are load-bearing, and this assertion is the only
    // thing that proves the second one. `cm` passes `namesOnlySize` — every word in
    // it IS a size word — but names no size, so without `queryNamesSize` it would
    // show the entire library. Added because dropping that guard killed nothing:
    // the branch had no input that could tell the two conditions apart.
    expect(rankLibrary('cm')).toEqual([]);
    expect(rankLibrary('tall')).toEqual([]);
  });

  it('and a size beside a real word narrows on the word', () => {
    const rows = rankLibrary('wardrobe 40cm');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length, 'the size branch swallowed a real search').toBeLessThan(PART_LIBRARY.length);
    expect(rows.some((r) => /wardrobe/i.test(r.label))).toBe(true);
  });
});

describe('sizeFromQuery', () => {
  const item = (label: string) => {
    const found = PART_LIBRARY.find((i) => i.label === label);
    if (!found) throw new Error('no library item called ' + label);
    return found;
  };

  it('applies a size the words named', () => {
    // A rug, not a bed. `dimMM[0]` is the across-the-front width for most of the
    // catalog, which is what `parseDims` maps its FIRST number to — but not for a
    // bed, where dimMM[0] is the length. See the bed case below; it is a real
    // defect and this is deliberately not the fixture that hides it.
    const rug = PART_LIBRARY.find((i) => i.category === 'rug')!;
    const dim = sizeFromQuery(rug, 'rug 160x200cm');
    expect(dim[0]).toBe(1600);
    expect(dim[1]).toBe(2000);
  });

  it('reads a mattress size as width x length, on the axes the app labels', () => {
    // This assertion used to pin the DEFECT: `expect(dim).toEqual([1800, 2000, 600])`,
    // with a comment blaming `parseDims` for sending the first number to dimMM[0].
    // That was the wrong culprit. `parseDims` is right — five consumers agree dimMM[0]
    // is a bed's WIDTH: `Inspector`'s ['Width','Depth','Height'] labels, `BedGeo`'s
    // headboard spanning dimMM[0] with a double's two pillows side by side across it,
    // the bedroom seed pushing the bed off the wall by half of dimMM[1], and
    // `dimension-ranges.ts`'s own '[W, D, H]' header. The catalog and the range table
    // were the two that disagreed, and the 1800 was a correct 1600 width being clamped
    // up by a transposed floor. Both tables are un-transposed now.
    const q = PART_LIBRARY.find((i) => i.label === 'Queen bed')!;
    expect(q.dimMM).toEqual([1600, 2000, 600]);
    expect(sizeFromQuery(q, 'queen bed 160x200cm')).toEqual([1600, 2000, 600]);
  });

  it('and does it on a single, where a transposition cannot hide', () => {
    // The asymmetric case, and the reason the defect above survived being looked at:
    // 1600x2000 and 2000x1600 are both plausible bed numbers, so a reader checking
    // the queen sees nothing wrong either way. A single is 900 x 2000 — transposed it
    // is 2000 wide and 900 long, which is not a bed at any glance. Same rule as
    // 'verify in the asymmetric case': pick the fixture where the two readings differ
    // by more than plausibility.
    const single = PART_LIBRARY.find((i) => i.label === 'Single bed')!;
    expect(single.dimMM).toEqual([900, 2000, 600]);
    expect(sizeFromQuery(single, 'single bed 90x200cm')).toEqual([900, 2000, 600]);
    // …and the width is the SHORT side, which is the whole claim in one assertion.
    expect(single.dimMM[0]).toBeLessThan(single.dimMM[1]);
  });
  it('keeps the preset on every axis the words did not name', () => {
    // A sofa, whose one legal 1600 is inside its range, so the assertion is about
    // the untouched axes rather than about a clamp.
    const sofa = PART_LIBRARY.find((i) => i.shape === 'sofa')!;
    const dim = sizeFromQuery(sofa, 'sofa 1600mm wide');
    expect(dim[0]).toBe(1600);
    // Depth and height were never mentioned, so they are still the catalog's.
    expect(dim[1]).toBe(sofa.dimMM[1]);
    expect(dim[2]).toBe(sofa.dimMM[2]);
  });

  it('clamps, because a typed number is a request and not a fact', () => {
    // Rule 2's trust boundary does not move because the number came from a text
    // box rather than from a model.
    const tv = PART_LIBRARY.find((i) => i.category === 'tv')!;
    const dim = sizeFromQuery(tv, 'tv 9m');
    expect(dim[0]).toBeLessThan(9000);
  });

  it('gives two rows different answers for one query, and that is the point', () => {
    // The number shown on a row is that row's own clamp, not the text echoed back.
    // A 4 m sofa is legal; a 4 m mirror is not.
    const sofa = PART_LIBRARY.find((i) => i.shape === 'sofa')!;
    const mirror = PART_LIBRARY.find((i) => i.category === 'mirror')!;
    const q = 'something 4000mm wide';
    expect(sizeFromQuery(sofa, q)[0]).not.toBe(sizeFromQuery(mirror, q)[0]);
  });

  it('is the identity when the words name no size', () => {
    const any = item(PART_LIBRARY[0].label);
    expect(sizeFromQuery(any, 'just a nice one')).toEqual(any.dimMM);
  });
});

describe('queryNamesSize', () => {
  it('is true for each axis the parser can reach on its own', () => {
    expect(queryNamesSize('rug 120x60cm')).toBe(true);
    expect(queryNamesSize('mirror 1700mm tall')).toBe(true);
    expect(queryNamesSize('desk 140cm')).toBe(true);
  });

  it('is false for words with no measurement in them', () => {
    // The one thing a caller needs before deciding whether to SHOW a size it did
    // not have to show. A bare number is not a measurement: `parseDims` wants a
    // unit, so "sofa 3" must not turn the size column on.
    expect(queryNamesSize('a nice armchair')).toBe(false);
    expect(queryNamesSize('')).toBe(false);
    expect(queryNamesSize('sofa 3')).toBe(false);
  });
});

describe('the tail of a compound word', () => {
  // The reported defect: "I typed stand but I didn't get nightstand as a suggestion."
  // English puts the head noun last, so a compound's tail is the word naming what the
  // thing IS — and it was the one form neither branch of the scorer could reach.
  // `stand` is not equal to `nightstand`, and neither starts with the other, so the
  // row scored 0 and `searchLibrary` filters to `s > 0`: not ranked low, absent.

  const hayOf = (i: { label: string; group: string; category: string; shape: string }) =>
    `${i.label} ${i.group} ${i.category} ${i.shape}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);

  it('reaches Nightstand for "stand"', () => {
    const labels = searchLibrary('stand', PART_LIBRARY.length).map((i) => i.label);
    expect(labels).toContain('Nightstand');
  });

  it('and a genuine prefix still outranks that tail', () => {
    // The weight decision, visible because both kinds of match exist for this one
    // query: the `desk-standard` shape prefix-matches `stand` at 1.5, Nightstand
    // contains it at 1. Both appear; the prefix is first.
    const labels = searchLibrary('stand', PART_LIBRARY.length).map((i) => i.label);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels[0]).toBe('Dining / desk table');
    expect(labels.indexOf('Nightstand')).toBeGreaterThan(0);
  });

  it('and "outranks" means strictly, which `stand` cannot show', () => {
    // `stand` above is a decorative assertion against the one mutation the weight
    // most plausibly drifts to. At exactly 1.5 the two rows TIE, `sort` is stable,
    // and the desk table is earlier in `PART_LIBRARY` — so it stays first and the
    // test passes while the decision it guards is gone.
    //
    // `achi` is the only query in the catalog's whole substring space where the
    // containment match sits EARLIER than the prefix match, so a tie flips the
    // order: AC unit prefix-matches at 1.5, Washing machine contains it at 1, and
    // Washing machine is row 34 against AC unit's 41. Not a word anyone types —
    // it is a probe for the ordering, and it is the only one the catalog affords.
    const labels = searchLibrary('achi', PART_LIBRARY.length).map((i) => i.label);
    expect(labels).toEqual(['AC unit', 'Washing machine']);
  });

  it('reaches Wardrobe for "robe" and Microwave for "wave"', () => {
    // Two more real English words that are somebody's tail. `stand` alone would be a
    // fixture that could be satisfied by special-casing one row.
    expect(searchLibrary('robe', PART_LIBRARY.length).map((i) => i.label)).toContain('Wardrobe');
    expect(searchLibrary('wave', PART_LIBRARY.length).map((i) => i.label)).toContain('Microwave');
  });

  it('but three letters do not, because "ing" would reach fourteen rows', () => {
    // The floor, pinned as the decision it is. At a floor of 3 the gerund tail `ing`
    // matches Lighting, Seating, Dining and every row in those groups — a query that
    // is not a word anybody typed on purpose, admitting a third of the catalog. This
    // is the assertion that fails if CONTAINS_MIN drops.
    expect(searchLibrary('ing', PART_LIBRARY.length)).toEqual([]);
    const wouldMatch = PART_LIBRARY.filter((i) => hayOf(i).some((h) => h.includes('ing')));
    expect(wouldMatch.length).toBe(14);
  });

  it('and no query in the catalog\'s own substring space becomes a catch-all', () => {
    // The floor was MEASURED rather than picked, so the measurement is the assertion
    // rather than the number 4 sitting alone above it. Every substring of every hay
    // token is a query a user can type; none may reach more than a quarter of the
    // catalog. At a floor of 3 `ing` reaches 14 of 43 and this goes red — which is
    // the same fact as the test above, arrived at without naming `ing`.
    const hay = PART_LIBRARY.map(hayOf);
    const subs = new Set<string>();
    for (const t of new Set(hay.flat())) {
      for (let a = 0; a < t.length; a++) for (let b = a + 1; b <= t.length; b++) subs.add(t.slice(a, b));
    }
    expect(subs.size).toBe(797);

    let worst = { q: '', n: 0 };
    for (const q of subs) {
      const n = searchLibrary(q, PART_LIBRARY.length).length;
      if (n > worst.n) worst = { q, n };
    }
    // 10 = the `Appliances` group, reached by `ance` / `ances` / `iance` and the rest
    // of that word's tails. A real group name, so ten rows is the honest answer.
    expect(worst.n, `widest query was "${worst.q}"`).toBeLessThanOrEqual(10);
  });
});

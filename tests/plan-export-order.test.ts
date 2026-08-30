// @vitest-environment jsdom
//
// **`lib/plan-export.ts` has had no test at all, and the stated reason was wrong.** The
// reason on record — in `docs/visual-check.md`, which is why this file corrects it there
// too — was that the module draws through a real 2D canvas context, `canvas` is not a
// dependency, and jsdom's `getContext('2d')` returns `null`, so line 75's non-null
// assertion would throw. All of that is true and none of it required a dependency: what
// the module does to a context is a SEQUENCE of calls, and a sequence can be recorded.
// Pixels would need `canvas`; draw ORDER does not.
//
// That distinction is the whole point of this file. The defect it guards is invisible to
// any test that asks what the sheet contains, and visible to one that asks in what order:
// footprints and number badges were drawn in ONE loop, per piece, so piece `i + 1`'s fill
// and outline landed on top of piece `i`'s digit. The legend is keyed on that digit and
// has no other join to its row, so an overlap — the thing a floor plan exists to show —
// silently removed a piece's only identifier. It was seen in an exported PNG (a Ceiling
// fan's `1` missing while its legend row was present) and read at the time as the
// numbering being broken.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportPlanPng } from '../lib/plan-export';
import type { ScenePart } from '../lib/scene-spec';
import type { Footprint } from '../lib/footprint';

type Op = { op: string; args: unknown[] };

/** Every call the module makes, in order.
 *
 *  Not a mock of a canvas — a tape. Properties (`fillStyle`, `font`, `textAlign`) are
 *  accepted and ignored because nothing here asserts on style; only the ordered calls
 *  matter, and recording the setters would bury the twelve calls that do in ninety that
 *  do not. */
function recorder(): { ops: Op[]; ctx: CanvasRenderingContext2D } {
  const ops: Op[] = [];
  const call =
    (op: string) =>
    (...args: unknown[]) => {
      ops.push({ op, args });
    };
  const ctx = {
    save: call('save'),
    restore: call('restore'),
    translate: call('translate'),
    rotate: call('rotate'),
    scale: call('scale'),
    beginPath: call('beginPath'),
    closePath: call('closePath'),
    moveTo: call('moveTo'),
    lineTo: call('lineTo'),
    ellipse: call('ellipse'),
    fill: call('fill'),
    stroke: call('stroke'),
    fillRect: call('fillRect'),
    strokeRect: call('strokeRect'),
    fillText: call('fillText'),
    // Real enough to size a legend column: the module ellipsises against this, and a
    // width of 0 would make every row fit and exercise none of that path. 6 px per
    // character is roughly an 11 px sans-serif and does not need to be more than roughly
    // right — no assertion here reads a width.
    measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
  return { ops, ctx };
}

/** What counts as "one piece's footprint was drawn" — exactly one op per floor piece,
 *  whichever branch it takes.
 *
 *  Three exclusions, each of which would have made the counts below measure something
 *  other than furniture. `fill`/`stroke` also draw the room outline and the scale bar.
 *  `fillRect` is the PAPER background (`ctx.fillRect(0, 0, W, H)`), drawn first, so
 *  counting it would inflate every literal here by one and hide it behind an ordering
 *  assertion that still passed. `moveTo`/`lineTo` are the wall ticks and dimension lines.
 *  What is left is furniture-only: `strokeRect` at `plan-export.ts:140` and `ellipse` at
 *  `:135`, one or the other per piece and nowhere else in the module. */
const FOOTPRINT_OPS = new Set(['strokeRect', 'ellipse']);

let getContext: PropertyDescriptor | undefined;
let toBlob: PropertyDescriptor | undefined;

const part = (over: Partial<ScenePart> & Pick<ScenePart, 'id'>): ScenePart => ({
  category: 'sofa',
  name: 'Sofa',
  shape: 'sofa',
  pos: [0, 0.4, 0],
  rot: 0,
  dimMM: [2200, 950, 880],
  locked: false,
  ...over,
});

const ROOM: { footprint: Footprint; width: number; depth: number; height: number } = {
  footprint: [
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ],
  width: 4,
  depth: 4,
  height: 2.4,
};

describe('the exported floor plan draws every footprint before any number badge', () => {
  let ops: Op[];

  beforeEach(() => {
    const rec = recorder();
    ops = rec.ops;
    getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    toBlob = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toBlob');
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => rec.ctx,
    });
    // `null`, so the module's own `if (blob)` short-circuits and nothing tries to
    // download. jsdom's real `toBlob` throws "not implemented" without the `canvas`
    // package, which is the throw that made this module look untestable.
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (cb: (b: Blob | null) => void) => cb(null),
    });
  });

  afterEach(() => {
    if (getContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', getContext);
    if (toBlob) Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', toBlob);
  });

  /** Three floor pieces that overlap in plan, because non-overlapping ones cannot express
   *  the defect: the badge is only lost where a later piece's footprint covers it. Fewer
   *  than ten on purpose — the legend draws its index with `padStart(2, ' ')`, so ` 1`
   *  and `1` are distinguishable strings up to nine pieces and identical from ten. */
  const OVERLAPPING = [
    part({ id: 'a', name: 'Rug', category: 'rug', shape: 'rug', dimMM: [2000, 1400, 12], pos: [0, 0.01, 0] }),
    part({ id: 'b', name: 'Sofa', pos: [0.1, 0.4, 0.1] }),
    part({
      id: 'c',
      name: 'Plant',
      category: 'plant',
      shape: 'plant',
      circle: true,
      dimMM: [600, 600, 900],
      pos: [0.2, 0.45, 0.2],
    }),
  ];

  it('every footprint is drawn before the first badge, so an overlap cannot eat a number', () => {
    exportPlanPng(OVERLAPPING, ROOM, 'm', 'Front Room');

    const footprints = ops.flatMap((o, i) => (FOOTPRINT_OPS.has(o.op) ? [i] : []));
    // A single digit and nothing else. The legend's index for the same piece is
    // `String(i + 1).padStart(2, ' ')` — ` 1` — and its row text is a name, so this
    // matches the badges and only the badges.
    const badges = ops.flatMap((o, i) =>
      o.op === 'fillText' && typeof o.args[0] === 'string' && /^[1-9]$/.test(o.args[0]) ? [i] : [],
    );

    // Counts as literals, both of them, because an ordering assertion over two empty
    // lists is green: `Math.max()` of nothing is `-Infinity`, `Math.min()` of nothing is
    // `Infinity`, and `-Infinity < Infinity`. So a version of this test that recorded no
    // furniture at all — a stub that swallowed the calls, a filter that dropped every
    // piece — would pass its own headline assertion.
    expect(footprints.length, 'one footprint op per floor piece: 2 rects + 1 ellipse').toBe(3);
    expect(badges.length, 'one badge per floor piece').toBe(3);

    expect(
      Math.max(...footprints),
      'the last footprint must be drawn before the first badge',
    ).toBeLessThan(Math.min(...badges));
  });

  it('and the badges are 1..n in the legend order, which is what joins them to their rows', () => {
    exportPlanPng(OVERLAPPING, ROOM, 'm', 'Front Room');
    const badgeText = ops
      .filter((o) => o.op === 'fillText' && typeof o.args[0] === 'string' && /^[1-9]$/.test(o.args[0] as string))
      .map((o) => o.args[0]);
    expect(badgeText).toEqual(['1', '2', '3']);
    // …and each badge sits at its own piece's centre, so pass two did not lose the pairing
    // between the digit and the piece it numbers. The room is 4 m wide with its origin at
    // the centre, so x = MARGIN + (pos.x + 2) * 90.
    const at = ops
      .filter((o) => o.op === 'fillText' && typeof o.args[0] === 'string' && /^[1-9]$/.test(o.args[0] as string))
      .map((o) => Math.round((o.args[1] as number) * 100) / 100);
    expect(at).toEqual([70 + 2 * 90, 70 + 2.1 * 90, 70 + 2.2 * 90]);
  });

  it('a round piece is drawn as an ellipse and a rectangular one is not', () => {
    // The `circle` branch is the other thing about this module that no test could reach,
    // and the browser check written to reach it could not either: it added a Library
    // `Ceiling fan`, and `PART_LIBRARY` sets `circle` on no entry at all, so the piece was
    // square and the branch unvisited. That is a real defect and it is somebody's
    // decision, not this file's — `docs/what-is-still-open.md` § B item 15. What is
    // asserted here is only that the module honours the flag it is given.
    exportPlanPng([part({ id: 'r', name: 'Sofa' })], ROOM, 'm', 'Rect only');
    expect(ops.filter((o) => o.op === 'ellipse')).toHaveLength(0);
    expect(ops.filter((o) => o.op === 'strokeRect')).toHaveLength(1);

    ops.length = 0;
    exportPlanPng(
      [part({ id: 'c', name: 'Plant', category: 'plant', shape: 'plant', circle: true, dimMM: [600, 600, 900] })],
      ROOM,
      'm',
      'Round only',
    );
    expect(ops.filter((o) => o.op === 'ellipse')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'strokeRect')).toHaveLength(0);
  });
});

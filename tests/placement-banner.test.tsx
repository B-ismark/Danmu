// @vitest-environment jsdom
//
// § 37 — the Inspector's placement banner, and the one property it exists to have:
// **it agrees with Room check, because it reads Room check.**
//
// The first attempt at this banner answered the question itself. It ran `collidesAt`
// and `partInsideRoom` beside the room report, which asks the same two questions with
// different bars — `collidesAt` deliberately has no `sharesFloor` exemption while the
// report's rule 2 charges a tucked pair against `TUCKED_CLASH_SHARE`, a divergence
// `lib/clearance.ts` states in its own words with twenty seeded pairs behind it. So a
// dining chair pushed under its table got a red *"Blocked"* while Room check said the
// room was fine, and the advice was to break the app's own seeded arrangement.
//
// Every gate in the repo stayed green through that, including one that mounts this
// very component: the findings were about WHICH number the banner reads, and nothing
// compared one surface's answer to another's. This file is that comparison.
//
// Mounted through the real plan page, like `tests/mount-height-refusal.test.tsx`, so
// the Inspector is reached the way a user reaches it.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { footprintForLayout } from '@/lib/footprint';
import { analyzeRoom } from '@/lib/clearance';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

// See tests/library-click-through.test.tsx for why these two shims are needed.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = function scrollIntoView() {};

vi.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'banner-room' }),
  usePathname: () => '/room/banner-room/plan',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const ROOM = { width: 5, depth: 4, height: 2.6 };

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

/** A dining table with a chair pushed under it — the exact pair the report forgives
 *  and `collidesAt` refuses. `sharesFloor` is keyed on ROLE, and it is what makes this
 *  pair the interesting one rather than any two overlapping boxes. */
const table = part({ id: 'table', category: 'desk', shape: 'desk-standard', dimMM: [1600, 900, 750], pos: [0, 0, 0] });
const tuckedChair = part({
  id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850],
  // HALF under, not fully. `TUCKED_CLASH_SHARE` is 0.85, so a chair entirely inside
  // the table's footprint is a clash by design — "a chair standing where the table is"
  // rather than one pushed under it — and the first version of this fixture put it
  // there, which the premise assertion below caught. The table spans z -0.45…0.45 and
  // the chair is 450 deep, so a centre at 0.45 puts exactly half of it under the top.
  pos: [0, 0, 0.45],
});

function setUp(parts: ScenePart[], selected: string) {
  cleanup();
  useScene.setState({
    parts,
    room: {
      ...useScene.getState().room,
      ...ROOM,
      footprint: footprintForLayout('rect', ROOM.width, ROOM.depth),
      layoutId: 'rect',
    },
  });
  useStudio.setState({ positions: {}, rotations: {}, dims: {}, selection: [selected], selectedPartId: selected });
  useSettings.setState({ dimUnit: 'm' });
}

/** The banner, found by its role rather than by a class or a test id. */
function banner(): HTMLElement {
  const all = screen.getAllByRole('status');
  const hit = all.find((el) => /On |Floating|Wall-mounted|Outside|clash|Blocked/i.test(el.textContent ?? ''));
  if (!hit) throw new Error(`no placement banner among ${all.length} status regions`);
  return hit;
}

describe('the banner agrees with Room check, because it reads Room check', () => {
  beforeEach(() => setUp([table, tuckedChair], 'chair'));

  it('the fixture really is a tucked pair the report forgives, or this proves nothing', () => {
    // The premise, asserted. If `sharesFloor` stopped exempting this pair, or the chair
    // drifted out from under the table, the assertion below would pass for the wrong
    // reason — which is exactly how the defect survived its first review.
    const issues = analyzeRoom([table, tuckedChair], {
      footprint: footprintForLayout('rect', ROOM.width, ROOM.depth),
      height: ROOM.height,
    }).issues.filter((i) => i.partIds.includes('chair') && i.severity !== 'info');
    expect(issues.map((i) => i.rule), 'Room check must be happy with this pair').toEqual([]);
  });

  it('does not call a correctly tucked chair Blocked', () => {
    render(<PlanPage />);
    // The § 37 defect, in one line. `collidesAt` says these two overlap; the report
    // says they do not; the banner must side with the report.
    expect(banner().textContent).not.toMatch(/Blocked/i);
  });

  it('says what it IS doing instead — standing on the floor', () => {
    render(<PlanPage />);
    expect(banner().textContent).toMatch(/On floor/i);
  });

  it('and reports a real finding when the report has one', () => {
    // The other direction, so the test above cannot pass by the banner saying nothing.
    // A chair shoved well outside the room is a finding the report DOES make.
    const outside = part({ ...tuckedChair, pos: [8, 0, 8] });
    setUp([table, outside], 'chair');
    const issues = analyzeRoom([table, outside], {
      footprint: footprintForLayout('rect', ROOM.width, ROOM.depth),
      height: ROOM.height,
    }).issues.filter((i) => i.partIds.includes('chair') && i.severity !== 'info');
    expect(issues.length, 'the premise: the report must flag this one').toBeGreaterThan(0);
    render(<PlanPage />);
    // Its own words, not a paraphrase — that is what "reads the report" means, and a
    // banner writing its own sentence here would be a second source of truth again.
    expect(banner().textContent).toContain(issues[0].title);
  });
});

describe('the resting half, which the report cannot answer', () => {
  // `lib/clearance.ts` skips anything above the floor, so a rider has no finding of its
  // own however far it is floating — which is why § 12's floating rider has never had a
  // gate. `restingOn` is that answer.
  const lamp = (y: number) =>
    part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, y, 0] });

  it('names the piece a lamp is actually standing on', () => {
    setUp([table, lamp(0.75)], 'lamp');
    render(<PlanPage />);
    expect(banner().textContent).toMatch(/On table/i);
  });

  it('calls a lamp hovering above that same table Floating, not "On table"', () => {
    // The finding that held the first version: `findSupportDetailed` takes x and z only
    // and never compares the mover's own y, so it answered "table" here and the banner
    // read "On Table — Supported by Table" about a piece plainly in mid-air. 350 mm is
    // § 12's measured rider gap.
    setUp([table, lamp(0.75 + 0.35)], 'lamp');
    render(<PlanPage />);
    expect(banner().textContent).toMatch(/Floating/i);
    expect(banner().textContent).not.toMatch(/On table/i);
  });

  it('says Wall-mounted for a fixture, rather than Floating', () => {
    // A wall fixture rests on nothing, and `restingOn` truthfully returns null for one.
    // Reporting that as "Floating" would be the same category error one step on.
    const tv = part({
      id: 'tv', category: 'tv', shape: 'tv', dimMM: [1200, 60, 700],
      // Inside the wall plane, not on it: the room is 4 deep, so z = -2 IS the wall
      // and a 60 mm panel centred there hangs 30 mm outside — which the report duly
      // reported, and the premise assertion duly caught.
      pos: [0, 1.4, -1.9], wallMounted: true,
    });
    setUp([table, tv], 'tv');
    render(<PlanPage />);
    expect(banner().textContent).toMatch(/Wall-mounted/i);
    expect(banner().textContent).not.toMatch(/Floating/i);
  });
});

describe('the banner as an announcement', () => {
  it('is a status region without aria-live, so a drag does not narrate itself', () => {
    // `role="status"` already carries an implicit polite live region. The first version
    // added `aria-live="polite"` on top, and the pair re-announces on every selection
    // change and every position write — a drag committed a stream of announcements.
    setUp([table, tuckedChair], 'chair');
    render(<PlanPage />);
    expect(banner().getAttribute('role')).toBe('status');
    expect(banner().getAttribute('aria-live')).toBeNull();
  });
});

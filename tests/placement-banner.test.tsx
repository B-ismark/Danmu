// @vitest-environment jsdom
//
// § 37 — the Inspector's placement banner, and the one property it exists to have:
// **it agrees with Room check, because it reads Room check.**
//
// The first attempt at this banner answered the question itself. It ran `collidesAt`
// and `partInsideRoom` beside the room report, which asks the same two questions with
// different bars — `collidesAt` deliberately has no `tucksUnder` exemption while the
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
import { analyzeRoom, CLASH_SHARE } from '@/lib/clearance';
import { tucksUnder, TUCKED_CLASH_SHARE } from '@/lib/layout-rules';
import { footFromPart, footArea, footIntersectionArea } from '@/lib/geometry';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import type { ScenePart } from '@/lib/scene-spec';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('banner-room'));

const { default: PlanPage } = await import('@/app/room/[roomId]/plan/page');

const ROOM = { width: 5, depth: 4, height: 2.6 };

const part = (o: Partial<ScenePart> & Pick<ScenePart, 'id' | 'category' | 'shape' | 'dimMM' | 'pos'>): ScenePart =>
  ({ name: o.id, rot: 0, locked: false, ...o }) as ScenePart;

/** A dining table with a chair pushed under it — the exact pair the report forgives
 *  and `collidesAt` refuses. `tucksUnder` — the roles, and a seat low enough for the
 *  room under the top — is what makes this pair the interesting one rather than any
 *  two overlapping boxes. */
const table = part({ id: 'table', category: 'desk', shape: 'desk-standard', dimMM: [1600, 900, 750], pos: [0, 0, 0] });
const tuckedChair = part({
  id: 'chair', category: 'chair', shape: 'chair-dining', dimMM: [450, 450, 850],
  // 0.40, and the two digits are the whole test. The chair must be tucked far enough
  // that ONLY the `tucksUnder` exemption forgives it, and not so far that it trips
  // `TUCKED_CLASH_SHARE`:
  //
  //     share < CLASH_SHARE (0.50)          nothing is being forgiven — inert
  //     0.50 … TUCKED_CLASH_SHARE (0.85)    the exemption is load-bearing  ← here
  //     share > 0.85                        a clash by design, whoever the pair is
  //
  // The first version used z = 0.45, which is share **0.4999999999999998** — two
  // ulps below the bar, on the inert side by rounding noise. Deleting the exemption
  // entirely left all eight tests green, so the file's headline claim was decoration.
  // At 0.40 the share is ~0.611 and both bars are live.
  pos: [0, 0, 0.40],
  // Facing the table (its front, local +Z, towards the origin). Back-first, its back
  // would be through the top, and that is not a tuck (`tuckedAt`).
  rot: Math.PI,
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
  useSettings.setState({ dimUnit: 'm', stepFree: false });
}

/** The banner, by its accessible NAME.
 *
 *  The first version searched every `role="status"` for a regex of the words it was
 *  about to assert, which is circular twice over: it selected the element by the answer,
 *  and `On ` is a loose substring — the keyboard announcer's "Drag it to resize the room,
 *  or paint it in the panel **on the** right" matches, as does any piece named
 *  "Ir**on d**esk". With the real room layout mounted there are five status regions, and
 *  on a wall selection this banner does not render at all, so the helper would silently
 *  return the announcer and assert against that.
 *
 *  Locator by identity, assertion by content. */
function banner(): HTMLElement {
  return screen.getByRole('status', { name: 'Placement' });
}

/** The card, or null — it is not drawn for a piece plainly where it looks (the user,
 *  2026-10-01: "On floor" is obvious). */
function maybeBanner(): HTMLElement | null {
  return screen.queryByRole('status', { name: 'Placement' });
}

describe('the banner agrees with Room check, because it reads Room check', () => {
  beforeEach(() => setUp([table, tuckedChair], 'chair'));

  it('the fixture is a tucked pair the EXEMPTION forgives, not one that never overlapped', () => {
    // Two premises, and the second is the one that was missing. The report being happy
    // proves nothing on its own: it is also happy about two pieces that barely touch,
    // and a fixture in that state passes this whole file while testing nothing.
    const room = { footprint: footprintForLayout('rect', ROOM.width, ROOM.depth), height: ROOM.height };
    const issues = analyzeRoom([table, tuckedChair], room).issues
      .filter((i) => i.partIds.includes('chair') && i.severity !== 'info');
    expect(issues.map((i) => i.rule), 'Room check must be happy with this pair').toEqual([]);

    // …and it is happy BECAUSE of `tucksUnder`. The share has to sit above
    // `CLASH_SHARE`, or nothing is being forgiven.
    const foot = (p: ScenePart) => footFromPart(p.pos, p.rot, p.dimMM, p.circle);
    const chairFoot = foot(tuckedChair);
    const share = footIntersectionArea(chairFoot, foot(table)) / footArea(chairFoot);
    expect(share, 'below CLASH_SHARE the exemption is inert and this file tests nothing')
      .toBeGreaterThan(CLASH_SHARE);
    expect(share, 'above TUCKED_CLASH_SHARE it is a clash by design, exemption or not')
      .toBeLessThan(TUCKED_CLASH_SHARE);
    expect(tucksUnder(tuckedChair, table), 'and the pair must be one that tucks')
      .toBe(true);
  });

  it('does not call a correctly tucked chair Blocked', () => {
    render(<PlanPage />);
    // The § 37 defect, in one line. `collidesAt` says these two overlap; the report
    // says they do not; the banner must side with the report.
    // No card at all: nothing to say. The finding test below is what stops this
    // passing by never drawing one.
    expect(maybeBanner()?.textContent ?? '').not.toMatch(/Blocked/i);
    expect(maybeBanner(), 'a chair on the floor with nothing wrong needs no card').toBeNull();
  });

  it('and reports a real finding when the report has one', () => {
    // The other direction, so the test above cannot pass by the banner saying nothing.
    // A chair shoved well outside the room is a finding the report DOES make.
    const outside = part({ ...tuckedChair, pos: [8, 0, 8] });
    setUp([table, outside], 'chair');
    // `{ accessibility: stepFree }` to match `useRoomReport`, which passes it. `setUp`
    // pins `stepFree` false, so the two agree today — and would silently stop agreeing
    // the moment anything turned it on, with nothing asserting the correspondence.
    const issues = analyzeRoom(
      [table, outside],
      { footprint: footprintForLayout('rect', ROOM.width, ROOM.depth), height: ROOM.height },
      { accessibility: useSettings.getState().stepFree },
    ).issues.filter((i) => i.partIds.includes('chair') && i.severity !== 'info');
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

  it('says nothing for a wall fixture — in particular not Floating', () => {
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
    expect(maybeBanner()).toBeNull();
  });
});

describe('what the review found after the first version', () => {
  it('says nothing for a ceiling fixture either, which rests on nothing too', () => {
    // A fan rests on nothing, like a TV, and `restingOn` returns null for both; neither
    // may be reported as Floating.
    const fan = part({
      id: 'fan', category: 'fan', shape: 'fan', dimMM: [1000, 1000, 200],
      pos: [0, 2.48, 0], wallMounted: true, circle: true,
    });
    setUp([table, fan], 'fan');
    render(<PlanPage />);
    expect(maybeBanner()).toBeNull();
  });

  it('does not let an unrelated finding erase the floating state', () => {
    // `placementLabel` used to be `worst ? worst.title : floating ? …`, so ANY non-info
    // finding — a tight walkway, a reach, a zone warn — suppressed the one state this
    // feature was built for. `floating` was computed and thrown away.
    //
    // The finding still leads, because it is the more actionable of the two; what
    // changed is that the detail says both.
    const outside = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [8, 1.4, 8],
    });
    setUp([table, outside], 'lamp');
    const room = { footprint: footprintForLayout('rect', ROOM.width, ROOM.depth), height: ROOM.height };
    const issues = analyzeRoom([table, outside], room, { accessibility: false }).issues
      .filter((i) => i.partIds.includes('lamp') && i.severity !== 'info');
    expect(issues.length, 'the premise: a finding AND a float at once').toBeGreaterThan(0);
    render(<PlanPage />);
    expect(banner().textContent, "the report's finding still leads").toContain(issues[0].title);
    expect(banner().textContent, 'and the float is not silently dropped').toMatch(/not resting on anything/i);
  });

  it('paints a floating piece in the quieter tone, because Room check says nothing about it', () => {
    // `clearance.ts` skips anything above the floor, so a floating rider produces NO
    // finding and the health chip reads "Room checks out". A full danger banner beside
    // a green chip is the contradiction this whole item is about, one surface over. So
    // the state the report cannot see gets `--warn`, not `--danger`.
    const room = { footprint: footprintForLayout('rect', ROOM.width, ROOM.depth), height: ROOM.height };
    const floater = part({
      id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 1.1, 0],
    });
    expect(
      analyzeRoom([table, floater], room, { accessibility: false }).issues.filter((i) => i.severity !== 'info'),
      'the premise: the report genuinely has nothing to say about a floating piece',
    ).toEqual([]);
    setUp([table, floater], 'lamp');
    render(<PlanPage />);
    expect(banner().textContent).toMatch(/Floating/i);
    const border = banner().style.border;
    expect(border, 'a floating piece is a warning, not a fault').toContain('--warn');
    expect(border).not.toContain('--danger');
  });

  it('paints a real error in danger and a warn in warn, which is the report’s own table', () => {
    // Three severities, not a boolean. `RoomTools`' `SEVERITY` maps warn to "A bit
    // tight" in amber; collapsing it to red here would make one finding two colours on
    // two surfaces — the same defect this banner exists to end, in the presentation.
    const outside = part({ ...tuckedChair, pos: [8, 0, 8] });
    setUp([table, outside], 'chair');
    const room = { footprint: footprintForLayout('rect', ROOM.width, ROOM.depth), height: ROOM.height };
    const issues = analyzeRoom([table, outside], room, { accessibility: false }).issues
      .filter((i) => i.partIds.includes('chair') && i.severity !== 'info');
    expect(issues[0].severity, 'the premise: this fixture is an ERROR').toBe('error');
    render(<PlanPage />);
    expect(banner().style.border).toContain('--danger');
  });
});

describe('the banner as an announcement', () => {
  it('is a status region without aria-live, so a drag does not narrate itself', () => {
    // `role="status"` already carries an implicit polite live region. The first version
    // added `aria-live="polite"` on top, and the pair re-announces on every selection
    // change and every position write — a drag committed a stream of announcements.
    setUp([table, part({ id: 'lamp', category: 'lamp', shape: 'lamp-table', dimMM: [250, 250, 500], pos: [0, 0.75, 0] })], 'lamp');
    render(<PlanPage />);
    expect(banner().getAttribute('role')).toBe('status');
    expect(banner().getAttribute('aria-live')).toBeNull();
  });
});

describe('the header: one row, the name and its Library shelf', () => {
  // The user, 2026-10-01: "Bed. Bed. Bed double is also redundant — just keep the name
  // and maybe next to it the category." The shelf is the Library's own word (§ 41), so a
  // radiator reads "Appliances", never its internal category key "fridge".
  const radiator = part({
    id: 'radiator', name: 'Radiator', category: 'fridge', shape: 'radiator', dimMM: [800, 120, 580], pos: [0, 0, -1.9],
  });

  it('puts the shelf on the name’s own row and says neither the category nor the shape', () => {
    setUp([table, radiator], 'radiator');
    render(<PlanPage />);
    const shelf = screen.getByText('Appliances');
    expect(shelf.parentElement?.textContent, 'the shelf sits on the name’s row').toContain('Radiator');
    expect(shelf.parentElement?.parentElement?.textContent).not.toMatch(/fridge/i);
    expect(screen.queryByText(/^Fridge$/i)).toBeNull();
  });

  it('shows no shelf for a shape the Library does not sell, rather than the internal key', () => {
    const single = part({ id: 'bed', name: 'Bed', category: 'bed', shape: 'bed-single', dimMM: [900, 2000, 600], pos: [0, 0, 0] });
    setUp([single], 'bed');
    render(<PlanPage />);
    const row = screen.getByRole('button', { name: /Furniture name/i }).parentElement!;
    expect(row.textContent).toBe('Bed');
  });
});

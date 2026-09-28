'use client';

// What the room is like, and what to do about it. Sits at the top of the left rail
// rather than in the canvas's bottom-right corner, because it is the room's STATE:
// leaving it on the canvas meant the health of the room was chrome you could bury,
// and it cost a corner that also had to hold the camera, the lighting and the grid.
//
// A health chip and Fix / Ideas, plus one "Room" button whose panel carries four
// readings as tabs (Ideas opens its own gallery beside the rail, `IdeasPanel.tsx`):
//   · Check — deterministic ergonomics review (door swings, walkways, storage
//     clearance, bed access, TV distance, crowding). Click a finding to select the
//     pieces involved and fly to them, or offer it a fix where the solver can act.
//   · Will it fit — a real product's W × D × H against THIS room, without moving
//     anything in it. The bridge from playing to buying; see `lib/fit-check.ts`.
//   · List — every piece with its real dimensions in the user's display unit,
//     copyable as plain text. Text, and not a CSV: a spreadsheet of parts minus the
//     prices is the carpenter spec non-negotiable 6 retired, while "paste it into a
//     message" is what actually serves showing someone a plan.
//   · Layouts — named arrangement snapshots with mini floor plans, so competing
//     arrangements can be saved and flipped between.
//
// Check, List and Layouts were three buttons opening three cards that could never
// be open at the same time — a tab strip, spread across the bottom of the canvas.
// Saying so left the room for "Will it fit" to be a fourth reading rather than a
// fourth button.
//
// Layouts are the one feature that stores work OUTSIDE the undo stack (they live
// in IndexedDB), so both of its destructive paths are guarded: deleting a layout
// confirms, and applying one over an arrangement that was never saved offers to
// save it first.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams } from 'next/navigation';
import { TURNING_DIAMETER } from '@/lib/clearance-field';

/** The turning circle for the two places the Step-free control names it, in the unit
 *  the user set.
 *
 *  Derived twice over, and the second derivation was owed. The NUMBER already came
 *  from `TURNING_DIAMETER`, because `lib/clearance.ts` writes the same one into the
 *  finding it produces and a hand-typed "150 cm" here could disagree with the sentence
 *  underneath it while nothing failed. The UNIT was still typed, and § B.12 made that
 *  a live disagreement rather than a latent one: the findings below started speaking
 *  the user's unit and this label did not, so a user on feet read *"Step-free · 150
 *  cm"* three rows above *"A wheelchair needs 4.92 ft to turn on the spot."* Same
 *  quantity, same panel, two units — the exact defect § B.12 was opened for, three
 *  rows up from where it was fixed.
 *
 *  These are functions rather than constants for that reason alone: a module-scope
 *  const cannot see the store, and that is what made the label the last thing in the
 *  panel still hard-coded. */
const turnLabel = (unit: DimUnit) => formatLength(TURNING_DIAMETER * 1000, unit);

const STEP_FREE_DESC_ID = 'step-free-desc';
const stepFreeDesc = (unit: DimUnit) =>
  `Check for the ${turnLabel(unit)} of clear floor a wheelchair needs to turn`;
import { useScene, type RoomShape } from '@/lib/scene-store';
import { currentRoomScene, resolveParts, useRoomScene } from '@/lib/room-scene';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import { analyzeRoom, floorClearPct, type ClearanceIssue, type ClearanceSeverity, type RoomReport } from '@/lib/clearance';
import {
  impossibleClause,
  isWorthOffering,
  lockedForSolve,
  type MoveReason,
  type SolveResult,
  withRiders,
} from '@/lib/layout-solve';
import { RULE_HANDLING, type CostBreakdown } from '@/lib/layout-score';
import { solveOffThread } from '@/lib/layout-offload';
import { sameStamp, stampOf, type SolveStamp } from '@/lib/solve-stamp';
import { roomStore, type LayoutVariant, type Transforms } from '@/lib/storage';
import type { Footprint } from '@/lib/footprint';
import { formatDim, formatLength, fromMM, stepFor, toMM } from '@/lib/units';
import { checkFit, PROBE_ID, type FitCandidate, type FitResult, type FitStatus } from '@/lib/fit-check';
import { clampDims } from '@/lib/dimension-ranges';
import { groundY } from '@/lib/physics';
import { normalizeStoredParts, PART_LIBRARY } from '@/lib/scene-spec';
import { Select } from '@/components/ui/Select';
import { NumberField } from '@/components/ui/NumberField';
import { v4 as uuid } from 'uuid';
import { savedLabel } from '@/lib/dates';
import { Icon } from '@/components/ui/Icon';
import { MiniPlan } from './MiniPlan';
import { IdeasPanel } from './IdeasPanel';
import { useBesideRail } from './useBesideRail';
import { IconButton, Pill, Segmented, Spinner } from '@/components/ui/primitives';
import { useBusyAction } from '@/components/ui/useBusyAction';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { toast, toastWhile } from '@/components/ui/StorageToast';
import { isTypingOrDialog } from './KeyboardShortcuts';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';

type RoomTab = 'check' | 'fit' | 'list' | 'layouts';

/** What the SOLVER last wrote for each piece it moved — not merely which ids.
 *
 *  `LayoutContext.placed` is meant to say "the user put this here", and the store
 *  cannot tell on its own: a drag and a suggestion both land in `useStudio.positions`.
 *  This is the missing half, and it holds the VALUE rather than the id so it needs no
 *  subscription to stay honest: a piece counts as the app's only while its override
 *  is still the one the app wrote. Drag it afterwards and the numbers no longer
 *  match, so it is the user's again from that moment — which is exactly the rule, and
 *  it costs one comparison instead of a listener that could miss a write.
 *
 *  Kept out of the store because it is not state about the room: it is this
 *  session's memory of who moved what, it must not persist, and only the one
 *  function that applies a solve may write it. A ref, because nothing renders from
 *  it.
 *
 *  **Threaded as an argument, and it has to be.** This was a React context, and that
 *  was a silent bug of exactly the kind this map exists to prevent: `useRefitOffer`
 *  is called in `RoomTools`'s BODY, while the provider was created in `RoomTools`'s
 *  returned JSX — and a component is not its own descendant, so `useContext` there
 *  resolved against the tree ABOVE `RoomTools` and got the module-scope default.
 *  `FixButton` and `SuggestButton` sat inside the provider and worked, which is why
 *  it looked right. The re-fit path did not: press Suggest, change a width, accept
 *  the re-fit, and it read an empty map, so every piece the solver had just moved
 *  still counted as hand-placed at `PLACED_INERTIA` × `REFIT_INERTIA` = 56 — the
 *  precise number this was written to stop. It then wrote its own results into that
 *  module-global default, where they outlived the room and were read by nobody.
 *  A prop cannot be wired to the wrong scope; a context can, and did. */
type AppPlacement = { pos: [number, number, number]; rot: number };
export type AppPlacedRef = { current: Map<string, AppPlacement> };

/** THE map. One, at module scope, still threaded as an argument.
 *
 *  It was `useRef(new Map())` in `RoomTools`, which meant it lived exactly as long
 *  as the component — and `RoomTools` unmounts on a tab switch, because 3D Model and
 *  2D Plan are different ROUTES. So: press Suggest in 3D, switch to the plan, change
 *  a width, accept the re-fit, and the map the re-fit reads is empty. That is the
 *  inertia-56 bug in the comment above, restored by a lifetime nobody had thought
 *  about, through a completely different door.
 *
 *  Module scope is safe HERE for the reason the map was designed around: it holds
 *  the VALUE, so a piece counts as the app's only while its override is still the
 *  one the app wrote. Another room's piece would have to carry the same id AND be
 *  standing at the same millimetre and radian to be mistaken for this one's.
 *
 *  What is deliberately NOT undone is the threading. The bug the comment above
 *  describes was never "module scope" — it was TWO maps, a context default written
 *  by one caller and a ref read by another. One map, passed explicitly, cannot
 *  split like that: a prop cannot be wired to the wrong scope. */
const APP_PLACED: AppPlacedRef = { current: new Map() };

/** Is this override still the one the solver wrote? Exact equality is right here —
 *  both sides are the same float that was stored, never recomputed. */
function stillTheApps(
  mine: Map<string, AppPlacement>,
  id: string,
  positions: Record<string, [number, number, number]>,
  rotations: Record<string, number>,
): boolean {
  const was = mine.get(id);
  if (!was) return false;
  const p = positions[id];
  if (!p || p[0] !== was.pos[0] || p[1] !== was.pos[1] || p[2] !== was.pos[2]) return false;
  return rotations[id] === was.rot;
}

/** Widest the report panel gets. Four tab labels and a findings list want this
 *  much; a narrow window gets less, and `useBesideRail` is what decides how much,
 *  because it also has to know the width to keep the panel on screen. */
const PANEL_W = 324;

/** One report per (parts, footprint, height, accessibility), across every component
 *  that asks for it in the same render pass.
 *
 *  A `useMemo` is per hook INSTANCE, so it does not do this: the docblock below used to
 *  say "only one of the two is mounted at a time, so this runs once either way", which
 *  was true while the two were the rail's health chip and the collapsed rail's dot.
 *  § 37 added a third caller — the Inspector's placement banner — which is mounted
 *  ALONGSIDE the rail rather than instead of it, so the same room was being analysed
 *  twice per render at ~3 ms a time. And `PlanView.moveTo` writes `setPosition` on every
 *  `onPointermove`, which the Inspector subscribes to, so on the 2D tab that was a
 *  second full floor raster and BFS per frame of every drag.
 *
 *  A one-entry cache rather than a context, because the sharing wanted here is within a
 *  single render pass and every caller already derives the same four inputs from the
 *  same store: a provider would add a tree-shaped dependency to express something that
 *  is really just "do not compute this twice in a row with the same arguments". Keyed
 *  by identity on all four — `useRoomScene` is itself memoised, so `effParts` is
 *  reference-stable while the scene is, which is what makes identity the right test. */
let reportCache: { key: readonly unknown[]; value: RoomReport } | null = null;

function cachedReport(
  effParts: ScenePart[],
  footprint: Footprint,
  height: number,
  stepFree: boolean,
  dimUnit: DimUnit,
): RoomReport {
  // `dimUnit` is in the key because every finding SENTENCE is written in it (§ B.12).
  // An input that changes the value and not the key is a cache that serves the last
  // user's answer — here, switching Settings to feet and having Room check go on
  // saying centimetres until something else in the room happened to move.
  const key = [effParts, footprint, height, stepFree, dimUnit] as const;
  if (reportCache && key.every((k, i) => Object.is(k, reportCache!.key[i]))) return reportCache.value;
  const value = analyzeRoom(effParts, { footprint, height }, { accessibility: stepFree, dimUnit });
  reportCache = { key, value };
  return value;
}

/**
 * The room's report, derived. Read by the rail's health chip, by the compact dot the
 * rail shows while it is COLLAPSED, and by the Inspector's placement banner — see
 * `cachedReport` above for why that third caller made the memo insufficient.
 */
export function useRoomReport() {
  const room = useScene((s) => s.room);
  const stepFree = useSettings((s) => s.stepFree);
  const dimUnit = useSettings((s) => s.dimUnit);
  // `useRoomScene` is memoised on the same four store slices this used to merge by
  // hand, so sharing it costs nothing and is one fewer copy of the fallback.
  const effParts = useRoomScene();
  const report = useMemo(
    () => cachedReport(effParts, room.footprint, room.height, stepFree, dimUnit),
    [effParts, room.footprint, room.height, stepFree, dimUnit],
  );
  const problems = report.issues.filter((i) => i.severity !== 'info').length;
  return { report, problems, effParts };
}

/** The health chip reduced to what fits a 37px rail. Same number, same colours. */
export function RoomHealthDot() {
  const { problems } = useRoomReport();
  const ok = problems === 0;
  return (
    <div
      title={ok ? 'Room checks out' : `${problems} room ${problems === 1 ? 'issue' : 'issues'}`}
      aria-label={ok ? 'Room checks out' : `${problems} room ${problems === 1 ? 'issue' : 'issues'}`}
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        margin: '0 auto',
        borderRadius: 'var(--r-full)',
        fontSize: 'var(--fs-micro)',
        fontWeight: 700,
        border: `1px solid ${ok ? 'var(--accent-2)' : 'var(--danger)'}`,
        background: ok ? 'var(--accent-2-tint)' : 'var(--danger-tint)',
        color: ok ? 'var(--success-text)' : 'var(--danger-text)',
      }}
    >
      {ok ? <Icon name="check" size={12} /> : <span className="mono">{problems}</span>}
    </div>
  );
}

export function RoomTools() {
  // One panel, four tabs. Three of them were sibling buttons opening three cards
  // that were already mutually exclusive — i.e. a tab strip with the tabs spread
  // along the bottom of the canvas. Saying so costs two buttons of width, makes the
  // later readings discoverable from the first, and left room for a fourth.
  // The room panel and the ideas gallery open in the same place beside the rail,
  // so at most one of them is open.
  const [panel, setPanel] = useState<'room' | 'ideas' | null>(null);
  const open = panel === 'room';
  const [tab, setTab] = useState<RoomTab>('check');
  const anchorRef = useRef<HTMLDivElement>(null);
  // Who moved what — see `APP_PLACED`, which is where it lives and why.
  const appPlaced = APP_PLACED;
  // Placed to the RIGHT of the rail rather than over it, so the room the panel is
  // describing — and that clicking a finding flies to — stays visible.
  const panelPos = useBesideRail(anchorRef, open, { width: PANEL_W });
  const closeIdeas = useCallback(() => setPanel(null), []);

  const room = useScene((s) => s.room);
  const draggingId = useStudio((s) => s.draggingId);
  // `dims` for the re-fit offer only, which watches sizes rather than reading them.
  const dims = useStudio((s) => s.dims);

  // No roomId or roomName here. This component read the room out of IndexedDB on
  // mount for one purpose — naming the furniture CSV — and that download is retired
  // (see lib/exports). The Layouts panel keeps its own `useParams`, because layouts
  // really are stored per room.

  // One derivation, shared with the collapsed rail's dot — see useRoomReport.
  const { report, problems, effParts } = useRoomReport();

  // Step-free findings are opt-in and remembered, because whether a room has to
  // meet them is a fact about the person, not about the room — asking again every
  // time someone opens the panel would be its own small insult.
  const stepFree = useSettings((s) => s.stepFree);
  const setStepFree = useSettings((s) => s.setStepFree);

  // Offer a re-fit when a size change is what broke things. See `useRefitOffer`.
  useRefitOffer(effParts, room.footprint, dims, problems, appPlaced);

  // Close any open panel when a drag starts.
  useEffect(() => {
    if (draggingId) setPanel(null);
  }, [draggingId]);

  // Esc closes the open panel — it was previously only closable by re-clicking
  // the trigger or clicking somewhere harmless.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // A confirm or the save-first dialog can be stacked on top of this panel,
      // and a field can be mid-edit; this listener runs before either sees the
      // key, so it has to yield.
      if (isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setPanel(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div ref={anchorRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Fixed and measured, not absolute: this panel lives in a 260px rail with
          its own scroll box, where an absolutely-positioned card gets clipped.
          Same reason and same fix as ui/Select.tsx's portalled listbox. */}
      {open && (
        <div
          className="ds-card"
          style={{
            position: 'fixed',
            left: panelPos.left,
            top: panelPos.top,
            zIndex: 'var(--z-popover)',
            width: panelPos.width,
            maxHeight: 'min(440px, calc(100vh - 96px))',
            overflow: 'auto',
            padding: 0,
            boxShadow: 'var(--shadow-lift)',
          }}
        >
          <div
            style={{
              position: 'sticky',
              top: 0,
              background: 'var(--paper)',
              borderBottom: '1px solid var(--hairline)',
              // Local to this panel's own scroll box — it lifts the header over the
              // rows sliding under it. Its own rung on the --z-* scale rather than a
              // bare 1, so nothing in the app invents a stacking number.
              zIndex: 'var(--z-sticky-local)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 6px 14px' }}>
              <span style={{ fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--ink)', flex: 1 }}>This room</span>
              <IconButton icon="x" label="Close room panel" onClick={() => setPanel(null)} size={24} iconSize={12} />
            </div>
            <div style={{ padding: '0 12px 10px' }}>
              <Segmented
                ariaLabel="Room panel"
                value={tab}
                onChange={setTab}
                stretch
                size={28}
                options={[
                  { value: 'check', label: problems > 0 ? `Check · ${problems}` : 'Check' },
                  { value: 'fit', label: 'Will it fit' },
                  { value: 'list', label: 'List' },
                  { value: 'layouts', label: 'Layouts' },
                ]}
              />
            </div>
          </div>

          {tab === 'check' && (
            <CheckPanel
              issues={report.issues}
              freeShare={report.freeFloorShare}
              stepFree={stepFree}
              onStepFree={setStepFree}
              appPlaced={appPlaced}
            />
          )}
          {tab === 'fit' && <FitPanel effParts={effParts} room={room} />}
          {tab === 'list' && <ListPanel parts={effParts} />}
          {tab === 'layouts' && <LayoutsPanel effParts={effParts} footprint={room.footprint} />}
        </div>
      )}
      {panel === 'ideas' && <IdeasPanel anchorRef={anchorRef} onClose={closeIdeas} appPlaced={appPlaced} />}

      {/* The room's health, stated — not hidden behind a press.
          `analyzeRoom` already recomputed this on every scene change; the only
          thing wrong with it was that you had to find a dock in the corner of the
          canvas and open a tab before it would tell you. Drafted puts this kind of
          state permanently beside the thing it describes, and that is all this is.

          The severity colour is a FILL, so the text uses the matching -text token:
          --danger / --warn are not legible as type on paper. */}
      <button
        onClick={() => setPanel((v) => (v === 'room' ? null : 'room'))}
        aria-expanded={open}
        className="ds-btn ds-btn--sm"
        title="Room check, the furniture list and saved layouts"
        style={{
          width: '100%',
          justifyContent: 'flex-start',
          gap: 8,
          background: problems > 0 ? 'var(--danger-tint)' : 'var(--accent-2-tint)',
          borderColor: problems > 0 ? 'var(--danger)' : 'var(--accent-2)',
          color: problems > 0 ? 'var(--danger-text)' : 'var(--success-text)',
        }}
      >
        <Icon name={problems > 0 ? 'info' : 'check'} size={13} />
        <span style={{ fontWeight: 700 }}>
          {problems > 0 ? (
            <>
              <span className="mono">{problems}</span> {problems === 1 ? 'issue' : 'issues'}
            </>
          ) : (
            'Room checks out'
          )}
        </span>
        <span style={{ flex: 1 }} />
        <Icon name={open ? 'chevron-up' : 'chevron-right'} size={12} />
      </button>

      {/* Two `.ds-btn`s that fill the row when they fit and WRAP when they do not.
          `.ds-btn` is `white-space: nowrap` with fixed padding, and the rail around
          this row is `overflow: hidden`, so anything past the edge is eaten with no
          scrollbar and no error — the "Look panel" failure CLAUDE.md names by hand.

          This was briefly a `1fr 1fr` grid, for the good reason that Fix and Ideas
          should line up with the room-check button above rather than leave a dead
          strip on the right. It does line them up, and it also truncates both labels
          at every rail width that ships. The budget, from this repo's own numbers:
          `--rail-left-tight` is 208px and this row sits inside `PartTree`'s
          `12px 16px`, so the content box is 176px; a `1fr` column is (176 − 6) / 2 =
          85px; `.ds-btn--sm` spends `0 12px` of padding plus a 12px icon plus a 6px
          gap = 42px of chrome, leaving **43px** for the word. "Fixing…" wants ~41px
          at 11px Nunito — two pixels on an estimate, which is no margin — and the
          busy string is the tell that has to survive `prefers-reduced-motion`, where
          the ring does not turn. (With Shuffle's "Shuffling…", ~59px, it did not fit
          at all.)

          `flex: 1 0 auto` gets the alignment the grid was after without the cost:
          the buttons GROW to fill a line they fit on, and because they may not
          shrink, a line they do not fit on wraps instead of cutting a word. Wrapping
          costs a row of height in the worst case and removes the failure mode
          entirely; `LightingPicker` next door already does exactly this, and
          `tests/reflow.test.ts` holds the arithmetic. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <FixAllButton appPlaced={appPlaced} />
        <IdeasButton open={panel === 'ideas'} onToggle={() => setPanel((v) => (v === 'ideas' ? null : 'ideas'))} />
      </div>
    </div>
  );
}

// ─── Fix: clear what is wrong, moving as little as possible ────────────────
//
// Preview IS applying it: the room is right there, and a thumbnail of a
// suggestion would be a worse view of it than the 3D scene already on screen.
// Rejection is undo, which is the same contract "Apply layout" already offers —
// one history entry, one keystroke back. That is why the whole thing writes
// through `loadTransforms` in a single call rather than looping `setPosition`:
// the history recorder subscribes to those fields, so a loop would push one
// snapshot per piece and take twenty undos to reverse.
//
// The message says WHAT it fixed, not only how many pieces it touched. "Moved 4
// pieces" is indistinguishable from a shuffle, and the shuffle is exactly what
// this was accused of being; `SolveResult` carries the per-term costs before and
// after, so the answer is available rather than guessed at.

/** Which improvement is worth naming, in the order a person would care. */
const FIXED_PHRASE = [
  ['overlap', 'separated pieces that were in the same place'],
  ['outside', 'brought furniture back inside the room'],
  ['door', 'cleared the doorway'],
  // Above `access` on purpose: floor you cannot walk to is not a tight fit, it is a
  // part of the room that has stopped being part of the room. It had no sentence at
  // all, so the one pass that exists to fix it could only ever be reported as
  // something else — see `TERMS` in lib/layout-solve.
  ['navigation', 'opened a way through to the rest of the room'],
  ['access', 'freed up the space each piece needs to be used'],
  ['walkway', 'widened the walkways'],
  ['window', 'uncovered the window'],
  ['relation', 'grouped the pieces that belong together'],
  ['wall', 'moved things back against the walls'],
  ['middle', 'brought the middle of the room together'],
  ['alignment', 'squared things up'],
  ['balance', 'evened out the weight in the room'],
] as const satisfies ReadonlyArray<readonly [keyof CostBreakdown, string]>;

/** The two biggest genuine improvements, as a sentence. Below a whole cost unit a
 *  term has not really changed, and naming it would be flattery. */
function whatChanged(before: CostBreakdown, after: CostBreakdown): string {
  const gains = FIXED_PHRASE.map(([k, phrase]) => ({ gain: before[k] - after[k], phrase }))
    .filter((g) => g.gain > 1)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 2)
    .map((g) => g.phrase);
  if (gains.length === 0) return 'Undo puts the previous arrangement back.';
  return `It ${gains.join(' and ')}. Undo puts the previous arrangement back.`;
}

/** …and the same thing said about ONE piece, which is what a person actually
 *  watches happen. A room-level summary is true and abstract; "the floor lamp moved
 *  beside the sofa it lights" is the sentence that makes a suggestion legible instead
 *  of surprising. `SolveResult.moves` names the term each move bought. */
const MOVE_PHRASE = {
  overlap: 'out of what it was standing in',
  outside: 'back inside the room',
  door: 'clear of the doorway',
  navigation: 'to open a way through to the rest of the room',
  access: 'out of the space another piece needs',
  walkway: 'to widen the way past',
  window: 'clear of the window',
  wall: 'back against the wall',
  middle: 'off the wall',
  alignment: 'square to the room',
  relation: 'beside what it belongs with',
  balance: 'to even out the room',
} satisfies Partial<Record<keyof CostBreakdown, string>>;

/**
 * Compile-time proof that both phrase tables cover every cost term.
 *
 * `navigation` had been missing from both since the weight was added, so the one
 * pass that exists to reconnect a stranded half of the room could never be
 * credited — `whatChanged` filtered it out of the gains list and named the
 * second-best improvement instead, or fell through to the bare "Undo puts the
 * previous arrangement back." on a suggestion that had visibly rearranged the
 * room. Nothing caught it: these are hand-maintained lists keyed on
 * `keyof CostBreakdown`, and a missing key typechecks quite happily. Adding a
 * weight now fails the build here instead, which is the only place that can
 * notice.
 *
 * Two deliberate exceptions. `inertia` is the cost of moving at all, not an
 * improvement anyone can see, so naming it would be nonsense. `total` is the sum of
 * the others, so it is every phrase at once and none of them.
 */
type Nameable = Exclude<keyof CostBreakdown, 'inertia' | 'total'>;
type AssertNever<T extends never> = T;
type _FixedCoversEveryTerm = AssertNever<Exclude<Nameable, (typeof FIXED_PHRASE)[number][0]>>;
type _MoveCoversEveryTerm = AssertNever<Exclude<Nameable, keyof typeof MOVE_PHRASE>>;

/** The single biggest move, named. Null when the answer is better told room-wide —
 *  a piece that only turned, or a term with no sentence for it. */
function biggestMove(moves: MoveReason[], parts: ScenePart[]): string | null {
  const top = [...moves].sort((a, b) => b.gain - a.gain)[0];
  if (!top) return null;
  const phrase = (MOVE_PHRASE as Partial<Record<keyof CostBreakdown, string>>)[top.term];
  const name = parts[top.index]?.name;
  if (!phrase || !name) return null;
  return top.distance < 0.05
    ? `“${name}” turned ${phrase}.`
    : `“${name}” moved ${phrase}.`;
}

/** What a solve reads, as it stands now — see `lib/solve-stamp.ts`. */
function currentStamp(): SolveStamp {
  const t = useStudio.getState();
  const sc = useScene.getState();
  return stampOf({
    parts: sc.parts,
    room: sc.room,
    positions: t.positions,
    rotations: t.rotations,
    dims: t.dims,
    parentIds: t.parentIds,
    pinned: t.pinned,
  });
}

/** The room changed while the worker was searching, so its answer describes a
 *  room that no longer exists. Said rather than swallowed: the button spun, and
 *  a press that ends in silence reads as a press that did nothing. One sentence
 *  for every button, because it is one situation. */
function toastStale() {
  toast({
    title: 'The room changed during the search',
    message: 'Nothing was moved. Press again to use the room as it is now.',
  });
}

type SuggestOutcome =
  | { stale: true }
  | { stale: false; applied: boolean; result: SolveResult; parts: ScenePart[] };

/** Run the solver and write the result as one history entry. Shared, because the
 *  same thing happens whether the user asked for an idea, accepted a re-fit after
 *  resizing something, or asked the room report to clear one finding.
 *
 *  `only` confines the solve to a few pieces by locking everything else. It is what
 *  makes a per-finding fix honest: someone who asks about one tight walkway has not
 *  asked to have their room rearranged, and a fix that moved nine other pieces to
 *  clear it would be answering a question they did not ask. Locking is the whole
 *  mechanism — the solver already understands locked pieces, and still scores them,
 *  because a piece nobody may move is still in the way. */
function useSuggest(appPlaced: AppPlacedRef) {
  const loadTransforms = useStudio((s) => s.loadTransforms);
  return useCallback(
    async (mode: 'arrange' | 'refit', seed: number, only?: string[]): Promise<SuggestOutcome> => {
      const t = useStudio.getState();
      const stamp = currentStamp();
      // The room is read HERE, in the same tick as the stamp, never taken from the
      // caller's render. The Re-fit toast keeps its button for 14 s, and a closure
      // over that render's parts would solve a room from before the user's next drag
      // while the stamp — taken at the press, after the drag — saw nothing change,
      // so the answer landed over the drag. A stamp only guards the inputs it was
      // taken beside. The outcome hands these parts back, because `result` is
      // index-aligned to them and naming a piece off any other array can misname it.
      const effParts = currentRoomScene();
      const footprint = useScene.getState().room.footprint;
      // …and whatever is STANDING ON one of them travels with it, or the fix strands
      // it. `lib/clearance.ts` skips anything above the floor, so a rider can never
      // appear in a finding's `partIds` — which means without this line EVERY
      // confined fix that moves a support leaves its lamp hanging in mid-air, and
      // `carryRiders` cannot rescue it because a confine locks the rest of the room
      // and a lock is a lock there. The confinement is the right place: this is the
      // press deciding what it is allowed to touch, not the solver overruling it.
      // Riders of riders come too — `ridingParents` is one flat map, so the walk is
      // to a fixed point, bounded by the fact that `y` strictly increases along an
      // edge.
      const confined = only && only.length > 0 ? withRiders(new Set(only), effParts) : null;
      // Which pieces the user put where they are, rather than the app. An override in
      // `positions` exists only for a piece that has been moved by hand, so this is the
      // store already answering the question — and it is what stops a suggestion
      // treating "I dragged this here on purpose" and "the seeder guessed" as equal
      // claims on staying put.
      //
      // …MINUS whatever the solver itself wrote there, which is the correction. The
      // solve below stores its answer in the very maps this reads, so after one
      // press every piece it moved was indistinguishable from one the user had
      // dragged and got `PLACED_INERTIA`'s four-times claim on staying put. It
      // compounded: the app kept promoting its own guesses to hand placements, and
      // **Try a fix** — which runs at `REFIT_INERTIA` 14, so 56 effective against a
      // contaminated piece — increasingly answered "moving those didn't clear it"
      // about furniture nobody had ever touched. A hand drag goes through
      // `setPosition`/`setRotation`, never through here, so a piece the user does
      // claim later simply stops being listed (see `AppPlaced`).
      const placed = new Set(
        [...Object.keys(t.positions), ...Object.keys(t.rotations)].filter(
          (id) => !stillTheApps(appPlaced.current, id, t.positions, t.rotations),
        ),
      );
      // Three reasons a piece may not move, composed in one place a test can
      // reach — see `lockedForSolve`. The user's Lock button is the first of them.
      // Off the main thread — `lib/layout-offload.ts`. The window keeps drawing
      // while the search runs, which is also why the stamp check below exists.
      const result = await solveOffThread({
        parts: effParts,
        footprint,
        locked: lockedForSolve(effParts, t.pinned, confined),
        opts: { seed, mode, placed },
      });
      if (!sameStamp(stamp, currentStamp())) return { stale: true };
      // A material gain, not merely a smaller number. `isWorthOffering` is the bar:
      // a solve that trims 3.1 to 2.4 by sliding a sofa 10 cm and a rug 10 cm has
      // found a real improvement and is still not an answer to "give me an idea".
      // Confined fixes are exempt — someone who pressed "Try a fix" on one finding
      // has asked for that finding cleared, however small the room-wide number moves.
      // Three ways to end up applying nothing, and they are three different
      // sentences. `null` used to be all of them, so the toast that fires on the
      // commonest one spoke for the other two as well — see `SolveDecline`.
      if (result.moved.length === 0) return { stale: false, applied: false, result, parts: effParts };
      if (!confined && !isWorthOffering(result.before, result.after)) {
        return { stale: false, applied: false, result, parts: effParts };
      }
      const positions = { ...t.positions };
      const rotations = { ...t.rotations };
      for (const i of result.moved) {
        const p = effParts[i];
        positions[p.id] = [result.placements[i].x, p.pos[1], result.placements[i].z];
        rotations[p.id] = result.placements[i].yaw;
        appPlaced.current.set(p.id, { pos: positions[p.id], rot: rotations[p.id] });
      }
      // dims carried through untouched: the solver moves and turns, and a
      // suggestion that resized the furniture would be the one thing this app
      // refuses to do.
      loadTransforms({ positions, rotations, dims: t.dims });
      return { stale: false, applied: true, result, parts: effParts };  // …and only this path writes.
    },
    [loadTransforms, appPlaced],
  );
}

function FixAllButton({ appPlaced }: { appPlaced: AppPlacedRef }) {
  const suggest = useSuggest(appPlaced);
  // `useBusyAction`, not a bare `useState`. The solve runs in the arranging worker
  // now (`lib/layout-offload.ts`), so the window no longer freezes for it — but the
  // hook still owns the flag, the re-entry guard and the error path, and on the
  // inline fallback (no module workers) the old freeze is back and so is the
  // reason for the yield: a flag set on the same tick as seconds of solving never
  // reaches the screen. See `lib/after-paint.ts`.
  const [busy, run] = useBusyAction();
  // Pressing again asks for a DIFFERENT arrangement rather than recomputing the
  // same one — the solver is deterministic per seed, which is what makes both
  // behaviours possible at once.
  const attempt = useRef(0);

  async function solve() {
    const outcome = await toastWhile({ title: 'Arranging your room…' }, () => suggest('arrange', ++attempt.current));
    if (outcome.stale) return toastStale();
    const { applied, result, parts } = outcome;
    if (!applied) {
      // `declined === 'impossible'` means the search DID find arrangements and every
      // one of them was illegal (§ 31) — `bestCandidate` returns the LEAST impossible
      // finalist, so an illegal winner means every finalist was. It does NOT mean they
      // all failed the same WAY, which is the distinction the body's comment below
      // turns on; this sentence used to assert the shared way and contradicted it
      // twenty-five lines later, in the same function. Saying
      // "this is already a good arrangement" there is not a rounding of the truth, it
      // is the opposite of it — the room may be a mess, and the honest report is that
      // nothing safe was found rather than that nothing was needed.
      // `ttl` is 14000 rather than the 9000 default, matching the re-fit offer below.
      // This is the longest message in the app: 34 words at an ordinary reading rate
      // is most of nine seconds on its own.
      //
      // The remedies are ordered by what costs the user least. Pressing again is free
      // and genuinely different — `attempt` increments per press, so the next press is
      // a different search — and it was missing from the first version of this copy
      // while two expensive remedies were in it.
      toast(
        result.declined === 'impossible'
          ? {
              // No tone: the toast tones here are neutral / danger / success, and this
              // is a refusal rather than a failure. The other two decline paths in this
              // file are untoned for the same reason.
              title: 'No safe arrangement found',
              // **The universal belongs in the title, not in the body.** The body used to
              // open "Every layout tried put a piece …", which was safe while the clause
              // was the DISJUNCTION — every candidate did fail one way or the other. It
              // stops being true once the clause names one condition: `declinedTerms` is
              // derived from the WINNER's breakdown, and `bestCandidate` ranks on the SUM
              // of the two terms, so a runner-up may have failed on the other one. Told
              // "every layout put a piece through a wall", someone concludes the room is
              // too small and never unlocks the wardrobe that was the overlap everywhere
              // else — false in the one direction that misdirects the remedy.
              //
              // `No safe arrangement found` already says nothing worked, so the body is
              // free to say the narrower true thing.
              //
              // **It is not shorter.** This comment claimed it "comes out shorter than
              // the sentence it replaces", and so did `docs/visual-check.md`, off a
              // draft that read "The closest found put a piece" — three characters
              // less than the shipped prefix. Measured from the literal below: 147 with
              // `outside` named, 151 with `overlap`, 169 with both, against the old
              // sentence's 167. So the longest form is two characters LONGER than the
              // string that was seen wrapping to four lines without clipping, and the
              // wrap question is open rather than retired.
              message:
                `The closest it found put a piece ${impossibleClause(result.declinedTerms)}, so nothing was moved. Press Fix again for a different try, or unlock a piece to give it more room.`,
              ttl: 14000,
            }
          : {
              title: 'This is already a good arrangement',
              message: 'Nothing was moved. The pieces are already where the guidelines want them.',
            },
      );
      return;
    }
    // One piece named beats a count. A single move says exactly what happened; a
    // handful still gets the biggest one first, then the room-level summary.
    const lead = biggestMove(result.moves, parts);
    toast({
      title:
        result.moved.length === 1 && lead
          ? lead
          : `Moved ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
      message:
        result.moved.length === 1 || !lead
          ? whatChanged(result.breakdownBefore, result.breakdownAfter)
          : `${lead} ${whatChanged(result.breakdownBefore, result.breakdownAfter)}`,
    });
  }

  return (
    <button
      onClick={() => run(solve)}
      disabled={busy}
      aria-busy={busy}
      className="ds-btn ds-btn--sm"
      title="Clear what’s wrong, moving as little as possible"
      style={{
        fontSize: 'var(--fs-caption)',
        gap: 6,
        background: 'var(--paper)',
        borderColor: 'var(--edge)',
        color: 'var(--ink-2)',
        boxShadow: 'var(--shadow-soft)',
        // Grow to fill the line, never shrink below the word. The no-shrink half is
        // what makes the row wrap rather than truncate — see the note on the row.
        flex: '1 0 auto',
        // `.ds-btn` sets no `justify-content`, so a button that has been grown to
        // fill its share would otherwise sit its glyph and word hard against the
        // left edge with the slack all on the right. Every other stretched `.ds-btn`
        // in the app centres for the same reason.
        justifyContent: 'center',
      }}
    >
      {busy ? <Spinner size={12} /> : <Icon name="sparkles" size={12} />}
      {/* The word changes as well as the glyph. Under `prefers-reduced-motion` the
          ring does not turn, so the label is the tell that survives — and it is the
          only one a screen reader gets from the button's own content. The span is a
          last resort for a rail narrower than one button, not the normal path: the
          row wraps first, so the word is not cut. It does NOT say "the full label is
          in the `title`", because it is not — this button's title never contains the
          word "Fix". */}
      <span className="truncate" style={{ minWidth: 0 }}>
        {busy ? 'Fixing…' : 'Fix'}
      </span>
    </button>
  );
}

// ─── Ideas: other arrangements to try, not a repair ─────────────────────────
//
// `Fix` is anchored to the room it is handed — it pays `inertia` to move anything,
// so a room with nothing wrong has nothing to offer, and pressing it again mostly
// finds the same local minimum. That is correct FOR Fix. Ideas is the other half:
// a gallery of different valid arrangements (`IdeasPanel.tsx`), searched by
// `lib/layout-shuffle.ts` — several independent solves, the faulted ones thrown
// away, the survivors ranked for cost AND variety. It replaced a Shuffle button
// that applied one of those per press and threw the rest away.
//
// What never moves: kept pieces, locked ones, wall-mounted fixtures (doors,
// windows, the ceiling light, the fan). `movableFor` is the one answer to that
// question and both buttons read it.

/** Opens the gallery. A toggle rather than an action, so it carries no busy state:
 *  the search runs inside the panel, which says so. Same row contract as Fix. */
function IdeasButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="ds-btn ds-btn--sm"
      title="Different arrangements to try, whether or not anything is wrong"
      style={{
        fontSize: 'var(--fs-caption)',
        gap: 6,
        background: open ? 'var(--accent-tint)' : 'var(--paper)',
        borderColor: open ? 'var(--accent-text)' : 'var(--edge)',
        color: open ? 'var(--accent-text)' : 'var(--ink-2)',
        boxShadow: 'var(--shadow-soft)',
        // Same contract as Fix; see the note there.
        flex: '1 0 auto',
        justifyContent: 'center',
      }}
    >
      <Icon name="idea" size={12} />
      <span className="truncate" style={{ minWidth: 0 }}>
        Ideas
      </span>
    </button>
  );
}

// ─── Re-fit after a resize ──────────────────────────────────────────────────
//
// Every rule in `lib/layout-rules` is derived from the sizes it is about, so
// nothing needs recalculating when a size changes — the room report is already
// telling the truth about the new numbers on the next render. What is missing is
// the offer: someone who types a real wardrobe's width in wants to hear that it no
// longer fits and to be able to do something about it in one click.
//
// Only ever an OFFER. Moving the user's furniture because they edited a dimension
// would be the app taking a decision that is theirs, and the re-fit mode exists
// precisely so accepting it costs them as little of their arrangement as possible.

function useRefitOffer(
  effParts: ScenePart[],
  footprint: Footprint,
  dims: Record<string, [number, number, number]>,
  problems: number,
  appPlaced: AppPlacedRef,
) {
  const suggest = useSuggest(appPlaced);
  // What the geometry looked like last time, and how many problems it had. Both
  // are needed: a problem count that went up on its own is the user dragging
  // something, and they can see that happening.
  const seen = useRef<{ key: string; problems: number; cast: string } | null>(null);

  useEffect(() => {
    const key = JSON.stringify([footprint, dims]);
    // WHICH pieces are in the room, as distinct from what size they are. A resize
    // never changes this; loading or importing a room changes both at once, and the
    // geometry key alone could not tell the two apart. Opening a room reliably
    // announced "that size change left 5 problems" about a size nobody had touched,
    // because the room's real geometry arrives a render after this mounts.
    const cast = effParts
      .map((p) => p.id)
      .sort()
      .join(',');
    const prev = seen.current;
    seen.current = { key, problems, cast };
    if (!prev || prev.key === key) return;
    if (prev.cast !== cast) return;
    if (problems <= prev.problems) return;
    const added = problems - prev.problems;
    toast({
      title: `That size change left ${added} ${added === 1 ? 'problem' : 'problems'}`,
      message: 'Room check has the details. A re-fit makes the smallest set of moves that clears them.',
      ttl: 14000,
      action: {
        label: 'Re-fit',
        onClick: async () => {
          // The toast carrying this button is gone the moment it is pressed, so the
          // wait would otherwise say nothing at all.
          const outcome = await toastWhile({ title: 'Re-fitting your room…' }, () => suggest('refit', 1));
          if (outcome.stale) return toastStale();
          const { applied, result } = outcome;
          // The third of the three sentences, and it was missed on the first pass: this
          // path is reached straight after a RESIZE, which is the state most likely to
          // leave the search with nothing but illegal answers. Saying "nothing to move"
          // there is the same category of lie the other two branches exist to stop.
          toast(
            applied
              ? {
                  title: `Re-fitted ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
                  message: whatChanged(result.breakdownBefore, result.breakdownAfter),
                }
              : result.declined === 'impossible'
                ? {
                    title: 'No safe way to fit that',
                    message:
                      `The closest it found put a piece ${impossibleClause(result.declinedTerms)}. A smaller size, or unlocking a piece, gives it more room.`,
                    ttl: 14000,
                  }
                : {
                    title: 'Nothing to move',
                    message: 'No arrangement of the unlocked pieces clears this. Try a different size, or unlock more pieces.',
                  },
          );
        },
      },
    });
    // `suggest` closes over the parts, and re-running this effect when they change
    // would re-offer on every drag. The geometry key is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprint, dims, problems]);
}

// ─── Room check ─────────────────────────────────────────────────────────────
//
// The findings used to be badged FIX / TIGHT / NOTE in 8px tracked caps, which
// is a compliance report — on a product whose whole point is that it is not a CAD
// tool. Same information, said the way the rest of the panel already talks, in
// the Pill primitive (tinted background + a *-text foreground, so 11px copy on a
// tint still clears 4.5:1).
//
// That fixed how the panel SOUNDED and left what it could DO: it named a problem,
// offered to select the pieces, and then stopped. The only way to act on any of it
// was the whole-room Suggest button in the toolbar — a bigger move than most
// findings deserve, and one that rearranges nine pieces to answer a question about
// two. So each finding the solver can act on now carries its own fix, confined to
// the pieces it names. Which findings those are is not decided here: `RULE_HANDLING`
// in `lib/layout-score.ts` knows, because it is the same table that says which cost
// term implements each rule, and `tests/layout-conformance.test.ts` holds it to the
// findings `lib/clearance.ts` actually emits.

const SEVERITY: Record<ClearanceSeverity, { tone: 'danger' | 'warn' | 'neutral'; label: string }> = {
  error: { tone: 'danger', label: 'Worth fixing' },
  warn: { tone: 'warn', label: 'A bit tight' },
  info: { tone: 'neutral', label: 'Note' },
};

/** A tab's action row — the buttons that belong to one reading rather than to the
 *  panel as a whole (copy the list, save a layout). They used to live in each
 *  card's own header; the header is shared now, so they sit at the top of the
 *  body they act on. */
function TabActions({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderBottom: '1px solid var(--hairline)',
        background: 'var(--paper-2)',
      }}
    >
      {children}
    </div>
  );
}

/** Offer to clear one finding, by moving only the pieces it names.
 *
 *  Shown only where `RULE_HANDLING` says rearranging could actually help. The three
 *  it stays away from are the ones where a button would be a lie: a piece taller
 *  than the room is a size and the solver cannot resize, a crowded room needs a
 *  piece removed rather than moved, and nothing costs turning space at all.
 *
 *  When the confined solve cannot find anything, it says so and names the wider
 *  move — that is the honest answer, and it is better than a button that silently
 *  does nothing. */
function FixButton({ issue, appPlaced }: { issue: ClearanceIssue; appPlaced: AppPlacedRef }) {
  const suggest = useSuggest(appPlaced);
  // The label below has said "Trying…" since the day it was written and had never
  // been seen: the solve ran on the same tick that set the flag, so the render
  // carrying that word was flushed and replaced before the browser was given a
  // frame to paint it in. `useBusyAction` yields first — see `lib/after-paint.ts`.
  const [busy, run] = useBusyAction();
  // Pressing again asks for a different attempt, the same way Suggest does.
  const attempt = useRef(0);

  // A finding with no pieces named (a cut-off patch of floor is about the floor)
  // has nothing to confine to, so it falls back to the whole room.
  const scope = issue.partIds.length > 0 ? issue.partIds : undefined;

  async function solve() {
    const outcome = await toastWhile({ title: `Trying a fix for “${issue.title}”…` }, () =>
      suggest('refit', ++attempt.current, scope),
    );
    if (outcome.stale) return toastStale();
    const { applied, result, parts } = outcome;
    if (!applied) {
      // Already honest about finding nothing, and now able to say WHY when the reason
      // is the § 31 veto rather than an absent improvement.
      // Both arms keep the scoped/unscoped split, because the escape hatch differs and
      // the more serious refusal must not give LESS guidance than the milder one. The
      // first version of the impossible arm was a single sentence for both and named no
      // next step at all.
      //
      // Reachability, measured rather than assumed: over 212 confined solves — every
      // finding of every preset, scrambled and seeded, four seeds each — this branch
      // declined **zero** times, and so did the `no-gain` sentence that has shipped
      // beside it for months. A confine locks all but the finding's own pieces, so the
      // search has almost no room to exceed the impossibility it was handed. Both are
      // kept: this one guards against a wrong message rather than adding a feature, and
      // deleting it would leave the older sentence covering a case it describes falsely.
      toast({
        title: result.declined === 'impossible' ? 'No safe way to move those' : 'Moving those didn’t clear it',
        message:
          result.declined === 'impossible'
            ? scope
              ? `The closest it found put a piece ${impossibleClause(result.declinedTerms)}. Fix can rearrange the whole room.`
              : `The closest it found put a piece ${impossibleClause(result.declinedTerms)}. Try unlocking a piece, or making some space.`
            : scope
              ? 'Nothing better was found without touching the rest of the room. Fix can rearrange everything.'
              : 'Nothing better was found. Try unlocking a piece, or making some space.',
        ...(result.declined === 'impossible' ? { ttl: 14000 } : null),
      });
      return;
    }
    const lead = biggestMove(result.moves, parts);
    toast({
      tone: 'success',
      title:
        result.moved.length === 1 && lead
          ? lead
          : `Moved ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
      message:
        result.moved.length === 1 || !lead
          ? whatChanged(result.breakdownBefore, result.breakdownAfter)
          : `${lead} ${whatChanged(result.breakdownBefore, result.breakdownAfter)}`,
    });
  }

  return (
    <button
      onClick={() => run(solve)}
      disabled={busy}
      aria-busy={busy}
      className="ds-btn ds-btn--xs"
      title={
        scope
          ? 'Move only the pieces named here'
          : 'Rearrange the unlocked furniture to open the floor up'
      }
      style={{ fontSize: 'var(--fs-micro)', padding: '0 10px', gap: 6, flexShrink: 0, alignSelf: 'flex-start' }}
    >
      {busy && <Spinner size={10} />}
      {busy ? 'Trying…' : 'Try a fix'}
    </button>
  );
}

/** The room's own reading, and the one setting that changes what it reports.
 *
 *  One row rather than two. These were two full-bleed rows with a divider each,
 *  stacked above the findings — so the first thing the tab showed was two lines of
 *  chrome, and the thing it exists for started a third of the way down a 440 px
 *  panel. They are both room-level context, they are both one short phrase, and
 *  `flexWrap` is what lets them share a line honestly: at a squeezed width the
 *  setting drops below the reading instead of printing over it (rule 4 — an element
 *  with no overflow of its own does not clip, it collides). */
function CheckSummary({
  freeShare,
  stepFree,
  onStepFree,
}: {
  freeShare: number;
  stepFree: boolean;
  onStepFree: (on: boolean) => void;
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const turn = turnLabel(dimUnit);
  const desc = stepFreeDesc(dimUnit);
  return (
    <div
      className="t-hint"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 14px',
        borderBottom: '1px solid var(--hairline)',
      }}
    >
      <span>
        <span className="mono" style={{ color: 'var(--ink-2)' }}>
          {floorClearPct(freeShare)}%
        </span>{' '}
        floor clear
      </span>
      <span style={{ flex: 1, minWidth: 0 }} />
      {/* A real checkbox rather than a styled div: this is a persisted preference
          that changes what the panel reports, and it has to be reachable by Tab and
          announce its own state. */}
      <label
        title={desc}
        style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--ink-2)' }}
      >
        <input
          type="checkbox"
          checked={stepFree}
          onChange={(e) => onStepFree(e.target.checked)}
          // The `title` above is a hover affordance and nothing else — it never
          // appears on keyboard focus, which is the whole reason `ui/Tooltip.tsx`
          // exists. A Tooltip is wrong here (this control's name is already visible
          // text, not a glyph); what was missing is the EXPLANATION, so it is given
          // to assistive tech directly and the same string feeds both.
          aria-describedby={STEP_FREE_DESC_ID}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }}
        />
        Step-free <span style={{ color: 'var(--ink-3)' }}>· {turn}</span>
      </label>
      {/* OUTSIDE the label, and that is the whole point. A `<label>`'s text content
          is the checkbox's accessible NAME, so a description nested inside it became
          part of the name — and then `aria-describedby` pointed at the same node, so
          a screen reader read the sentence twice: once as what the control is called
          and again as what it does. The name is "Step-free · <the turning circle>";
          the sentence is the description, and the two must not be the same string.
          The name is written that way here on purpose: it used to read "90 cm", a
          number `TURNING_DIAMETER` has not produced for as long as this comment has
          existed — the label was derived and the COMMENT ABOUT the label was not, so
          the stale copy simply moved one line up. A comment quoting a derived value
          is a second source of truth wearing a comment's clothes. */}
      <span id={STEP_FREE_DESC_ID} className="sr-only">
        {desc}
      </span>
    </div>
  );
}

/** One finding.
 *
 *  ── Why this is three stacked lines and not one row ───────────────────────
 *
 *  It used to be `[pill] [title, flex:1] [Show me] [Try a fix]` on one line with the
 *  detail beneath. In the 324 px panel that leaves the title about 85 px of the
 *  110 px "Doors can't open" wants, so the headline wrapped mid-phrase while a
 *  button sat beside it — four things competing for one line, which is the failure
 *  rule 4 describes: nothing clips, nothing errors, it just prints badly and looks
 *  like a font bug.
 *
 *  Now nothing competes. The severity pill is an INLINE element at the head of the
 *  title's own text block, so the headline wraps around it the way a sentence wraps
 *  — no flex child to squeeze, no `minWidth: 0` to get right, and it is correct at
 *  every width including the 400 px gate's floor. The detail gets the full column.
 *  The actions get their own row.
 *
 *  ── Why "Show me" is a real button now ────────────────────────────────────
 *
 *  The row was one big `<button>` with a hover-revealed "Show me" span inside it and
 *  a second, real button beside it — a button inside a button, which the old comment
 *  correctly called neither valid nor keyboard-reachable, worked around by making
 *  the inner one a span. Two plain buttons on one action row is the version with no
 *  workaround in it: both are reachable by Tab, both say what they do, and neither
 *  is discovered by hovering. */
function IssueRow({
  issue,
  appPlaced,
  onShow,
}: {
  issue: ClearanceIssue;
  appPlaced: AppPlacedRef;
  onShow: (issue: ClearanceIssue) => void;
}) {
  const sev = SEVERITY[issue.severity];
  const canSelect = issue.partIds.length > 0;
  // Whether the solver could plausibly clear this by rearranging. Read from the one
  // table that knows, rather than re-deciding it here.
  const canFix = RULE_HANDLING[issue.rule].movable;
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--hairline)' }}>
      {/* Pill and title are a flex row, not a pill inlined into the title's text flow.
          Two things were wrong with the inline version, and the second is the one the
          user reported as "aren't aligned as they should".

          · `verticalAlign: '-5px'` is a magic number tuned against one pill height and
            one line-height, so it was aligned by coincidence and drifted the moment
            either moved. A baseline row is what "sit on the same line as the text"
            actually means, and it needs no constant.
          · A title long enough to wrap put its SECOND line underneath the pill, flush
            with the pill's left edge instead of with the first line of the title —
            because inline text wraps into the space the pill vacates. "Door can't open
            fully" plus a "Worth fixing" pill is about 150 px, and the rail's content
            box is 176 px at the tight width, so this wrapped as it shipped rather
            than at some hypothetical narrow one.

          `flexShrink: 0` keeps the pill whole (it is two words that must not break),
          and `minWidth: 0` is what lets the title wrap inside its own column instead
          of forcing the row wider than the rail — the ceiling-not-a-promise half of
          rule 4. */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <Pill tone={sev.tone} style={{ flexShrink: 0 }}>
          {sev.label}
        </Pill>
        <div style={{ minWidth: 0, fontSize: 'var(--fs-small)', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.5 }}>
          {issue.title}
        </div>
      </div>
      <div className="t-note" style={{ fontWeight: 400, lineHeight: 1.45, marginTop: 3 }}>
        {issue.detail}
      </div>
      {/* Actions align with the text column above, not with the right edge. Right-aligned
          and wrapping, they stacked into the same visual column the wrapped title had
          just moved out of, which read as a second misalignment on the same row.

          The gap is 8px, not 6: these two sit side by side and one of them
          REARRANGES THE ROOM. 28 × 62 clears WCAG 2.5.8's 24 × 24 minimum with
          room to spare, but spacing is the other half of that criterion and the
          cost of a mis-tap here is asymmetric — "Show me" only moves the camera. */}
      {(canSelect || canFix) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-start', gap: 8, marginTop: 7 }}>
          {canSelect && (
            <button
              onClick={() => onShow(issue)}
              // `--ghost`, not an inline copy of it: `background:'none'` and a
              // transparent border leave `.ds-btn`'s `box-shadow: var(--shadow-soft)`
              // and its hover lift in place, so a borderless label sat on a drop
              // shadow and rose when pointed at.
              className="ds-btn ds-btn--xs ds-btn--ghost"
              title="Select the pieces involved and fly to them"
              style={{ fontSize: 'var(--fs-micro)', padding: '0 10px', color: 'var(--accent-text)' }}
            >
              Show me
            </button>
          )}
          {canFix && <FixButton issue={issue} appPlaced={appPlaced} />}
        </div>
      )}
    </div>
  );
}

function CheckPanel({
  issues,
  freeShare,
  stepFree,
  onStepFree,
  appPlaced,
}: {
  issues: ClearanceIssue[];
  freeShare: number;
  stepFree: boolean;
  onStepFree: (on: boolean) => void;
  appPlaced: AppPlacedRef;
}) {
  const setSelection = useStudio((s) => s.setSelection);
  const frameSelected = useStudio((s) => s.frameSelected);
  const show = useCallback(
    (issue: ClearanceIssue) => {
      setSelection(issue.partIds, issue.partIds[0]);
      frameSelected();
    },
    [setSelection, frameSelected],
  );

  return (
    <div>
      <CheckSummary freeShare={freeShare} stepFree={stepFree} onStepFree={onStepFree} />
      {issues.length === 0 ? (
        <div className="t-small" style={{ padding: '18px 14px', lineHeight: 1.55 }}>
          No problems found. Doors open and walkways are wide enough.
        </div>
      ) : (
        issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            appPlaced={appPlaced}
            onShow={show}
          />
        ))
      )}
    </div>
  );
}

// ─── Will it fit? ───────────────────────────────────────────────────────────
//
// The gap between "I like this layout" and PRODUCT.md's "confidence to commit" is one
// question: does the sofa on the shop page go in THIS room, with what is already in
// it? Every mood-board tool can show you a sofa; none can answer that, and this app
// already has everything needed to — see `lib/fit-check.ts`.
//
// Three numbers off a product page and what kind of thing it is. No backend, no
// scraping, no guessing: the user reads the size, and the geometry engine answers.

/** What the answer looks like, per verdict. Tone comes from the same Pill palette the
 *  room report uses, so a fit answer and a finding read as the same kind of statement. */
const FIT_TONE: Record<FitStatus, { tone: 'sage' | 'warn' | 'danger'; lead: string }> = {
  fits: { tone: 'sage', lead: 'Yes, it fits' },
  tight: { tone: 'warn', lead: 'It goes in, but it is tight' },
  'no-room': { tone: 'danger', lead: 'No room for it' },
  'too-tall': { tone: 'danger', lead: 'Too tall for this room' },
};

/** The kinds someone is most likely to be shopping for, and the shape each maps to.
 *  Deliberately short: this is a fit check, not the catalog, and `lib/scene-spec.ts`
 *  is where the full list lives. */
const FIT_KINDS: Array<{ id: string; label: string; category: ScenePart['category']; shape: ScenePart['shape'] }> = [
  { id: 'sofa', label: 'Sofa', category: 'sofa', shape: 'sofa' },
  { id: 'armchair', label: 'Armchair', category: 'chair', shape: 'chair-armchair' },
  { id: 'bed', label: 'Bed', category: 'bed', shape: 'bed-double' },
  { id: 'wardrobe', label: 'Wardrobe or dresser', category: 'wardrobe', shape: 'wardrobe' },
  { id: 'shelf', label: 'Bookcase', category: 'shelf', shape: 'bookshelf' },
  { id: 'desk', label: 'Desk', category: 'desk', shape: 'desk-standard' },
  { id: 'dining', label: 'Dining table', category: 'table', shape: 'coffee-table' },
  { id: 'coffee', label: 'Coffee table', category: 'table', shape: 'coffee-table' },
  { id: 'chair', label: 'Dining chair', category: 'chair', shape: 'chair-dining' },
  { id: 'fridge', label: 'Fridge', category: 'fridge', shape: 'fridge' },
];

/** Nothing anybody buys is over 6 m on a side; a room's own side is capped at 50. */
const ABSURD_MM = 6000;

/** The unit the numbers were probably read in, when they make no sense as entered.
 *  Null when they are plausible, which is the overwhelmingly common case. */
function misreadUnit(dimMM: [number, number, number], entered: DimUnit): string | null {
  if (!dimMM.every((v) => Number.isFinite(v) && v > 0)) return null;
  if (!dimMM.some((v) => v > ABSURD_MM)) return null;
  // Only worth guessing when the same digits ARE sensible a unit down.
  if (entered === 'm' && dimMM.every((v) => v / 100 <= ABSURD_MM)) return 'centimetres';
  if (entered === 'cm' && dimMM.every((v) => v / 10 <= ABSURD_MM)) return 'millimetres';
  return null;
}

function FitPanel({ effParts, room }: { effParts: ScenePart[]; room: RoomShape }) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [kindId, setKindId] = useState(FIT_KINDS[0].id);
  // Held as strings, like every other measurement field here: a half-typed number is
  // a valid thing to be looking at, and parsing on commit keeps it that way.
  const [w, setW] = useState('');
  const [d, setD] = useState('');
  const [h, setH] = useState('');
  const [result, setResult] = useState<FitResult | null>(null);
  const [busy, run] = useBusyAction();

  const kind = FIT_KINDS.find((k) => k.id === kindId) ?? FIT_KINDS[0];
  const dimMM: [number, number, number] = [
    toMM(parseFloat(w), dimUnit),
    toMM(parseFloat(d), dimUnit),
    toMM(parseFloat(h), dimUnit),
  ];
  const ready = dimMM.every((v) => Number.isFinite(v) && v > 0);

  // Recognisable sizes from the one catalog, so someone can check the answer
  // against something they have seen before trusting it with a size they typed.
  const presets = useMemo(
    () => PART_LIBRARY.filter((p) => p.category === kind.category).slice(0, 4),
    [kind.category],
  );

  function fill(item: LibraryItem) {
    setW(String(fromMM(item.dimMM[0], dimUnit)));
    setD(String(fromMM(item.dimMM[1], dimUnit)));
    setH(String(fromMM(item.dimMM[2], dimUnit)));
    setResult(null);
  }

  function check() {
    if (!ready) return;
    // `checkFit` is synchronous and runs the solver several times — measured at 42 ms
    // for an obvious yes and ~330 ms for a furnished room it has to work at. That is
    // long enough to feel, and setting state alone would not show it: React cannot
    // paint while the same tick is still solving.
    //
    // The yield used to be written out here, which is how the two solve buttons
    // came to be written without one. `useBusyAction` owns it now — including the
    // re-entry guard this had as `busy` in the line above, which could not work
    // during the very gap it was guarding.
    run(() => {
      setResult(checkFit({ category: kind.category, shape: kind.shape, dimMM, name: kind.label }, effParts, room));
    });
  }

  /** Put it in the room, where the check said it goes. This is the one path that
   *  clamps — `clampDims` gates sizes the app STORES, and the check deliberately does
   *  not, so a size the studio cannot represent is brought into range here and the
   *  panel says so rather than letting it happen quietly. */
  function place() {
    if (!result?.placement) return;
    const stored = clampDims(kind.category, kind.shape, dimMM);
    const id = `${kind.category}-${uuid().slice(0, 6)}`;
    useScene.getState().addPart({
      id,
      category: kind.category,
      name: kind.label,
      shape: kind.shape,
      pos: [result.placement.x, groundY(kind.category, kind.shape, stored, room.height), result.placement.z],
      rot: result.placement.yaw,
      dimMM: stored,
      locked: false,
    });
    useStudio.getState().setSelected(id);
    const resized = stored.some((v, i) => v !== dimMM[i]);
    toast({
      tone: 'success',
      title: `${kind.label} placed`,
      message: resized
        ? 'Its size was changed to fit the studio’s range. The fit answer was for the size you entered.'
        : 'Undo puts the room back.',
    });
    setResult(null);
  }

  const label = (t: string) => (
    <span className="t-note" style={{ fontWeight: 600 }}>{t}</span>
  );

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="t-note" style={{ lineHeight: 1.45 }}>
        Checks for space. Nothing in the room moves.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {label('What is it')}
        <Select
          value={kindId}
          onChange={(v) => {
            setKindId(v);
            setResult(null);
          }}
          ariaLabel="What kind of piece"
          options={FIT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          height={30}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {([
          ['Width', w, setW],
          ['Depth', d, setD],
          ['Height', h, setH],
        ] as Array<[string, string, (v: string) => void]>).map(([name, value, set]) => (
          <label key={name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {label(name)}
            <NumberField
              value={value}
              onChange={(v) => {
                set(v);
                setResult(null);
              }}
              min={0}
              step={stepFor(dimUnit)}
              height={30}
              ariaLabel={`${name} in ${dimUnit}`}
            />
          </label>
        ))}
      </div>
      <div className="t-micro">
        W × D × H in <span className="mono">{dimUnit}</span>
      </div>

      {/* The one mistake this panel invites. Shop pages quote centimetres or
          millimetres; the studio's display unit defaults to metres, so the natural
          move is to copy "228" into a field that means metres and be told a sofa is
          too tall for the room. Cheaper to notice than to explain: if the numbers are
          absurd as entered and sensible one unit down, say so. */}
      {misreadUnit(dimMM, dimUnit) && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--warn-text)', lineHeight: 1.4 }}>
          Those look like {misreadUnit(dimMM, dimUnit)}. These fields are in{' '}
          <span className="mono">{dimUnit}</span>. Settings can change the unit.
        </div>
      )}

      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => fill(p)}
              className="ds-chip"
              style={{ cursor: 'pointer', fontSize: 'var(--fs-micro)' }}
              title={`Fill in ${p.dimMM.join(' × ')} mm`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={check}
        disabled={!ready || busy}
        aria-busy={busy}
        className="ds-btn ds-btn--sm ds-btn--primary"
        style={{ fontSize: 'var(--fs-caption)' }}
      >
        {busy ? <Spinner size={12} /> : <Icon name="ruler" size={12} />}
        {busy ? 'Checking…' : 'Check the room'}
      </button>

      {result && (
        <FitAnswer
          result={result}
          candidate={{ category: kind.category, shape: kind.shape, dimMM, name: kind.label }}
          room={room}
          effParts={effParts}
          onPlace={place}
        />
      )}
    </div>
  );
}

function FitAnswer({
  result,
  candidate,
  room,
  effParts,
  onPlace,
}: {
  result: FitResult;
  candidate: FitCandidate;
  room: RoomShape;
  effParts: ScenePart[];
  onPlace: () => void;
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const { tone, lead } = FIT_TONE[result.status];

  // The room with the candidate in it, so the answer is a picture as well as a
  // sentence. Built here rather than in `fit-check`, which stays free of rendering.
  const preview = useMemo(() => {
    if (!result.placement) return null;
    return [
      ...effParts,
      {
        id: PROBE_ID,
        category: candidate.category,
        name: candidate.name ?? 'This piece',
        shape: candidate.shape,
        pos: [result.placement.x, 0, result.placement.z] as [number, number, number],
        rot: result.placement.yaw,
        // The candidate's OWN size. A hard-coded box here drew a 500 mm square where a
        // 2.28 m sofa was supposed to be — a picture whose entire job is showing that
        // the footprint fits, drawn at a size nobody entered. Rule 2's corollary: a
        // displayed measurement is derived, never written next to the thing it
        // describes.
        dimMM: candidate.dimMM,
        locked: false,
      } as ScenePart,
    ];
  }, [effParts, result.placement, candidate]);

  return (
    <div
      style={{
        borderTop: '1px solid var(--hairline)',
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Pill tone={tone}>{lead}</Pill>
        {result.status === 'too-tall' && (
          <span className="t-note">
            by <span className="mono">{formatDim(-result.headroomMM, dimUnit)} {dimUnit}</span>
          </span>
        )}
      </div>

      {result.status === 'fits' && (
        <div className="t-note" style={{ lineHeight: 1.45 }}>
          There is somewhere for it that keeps the doors opening and the walkways clear.
          {result.headroomMM > 0 && (
            <>
              {' '}
              <span className="mono">{formatDim(result.headroomMM, dimUnit)} {dimUnit}</span> under the ceiling.
            </>
          )}
        </div>
      )}

      {result.status === 'too-tall' && (
        <div className="t-note" style={{ lineHeight: 1.45 }}>
          The ceiling here is <span className="mono">{formatDim(room.height * 1000, dimUnit)} {dimUnit}</span>.
        </div>
      )}

      {result.status === 'no-room' && (
        <div className="t-note" style={{ lineHeight: 1.45 }}>
          {result.largestBay ? (
            <>
              The biggest clear rectangle of floor is{' '}
              <span className="mono">
                {formatDim(result.largestBay.width * 1000, dimUnit)} × {formatDim(result.largestBay.depth * 1000, dimUnit)} {dimUnit}
              </span>
              . <b>Fix</b> or <b>Ideas</b> may make room by moving what is already here.
            </>
          ) : (
            <>This room has no clear stretch of floor to put it on.</>
          )}
        </div>
      )}

      {/* The reasons, straight from the room report, so a fit answer and a finding say
          the same thing in the same words. */}
      {result.issues.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {result.issues.map((i) => (
            <li key={i.id} className="t-note" style={{ lineHeight: 1.4 }}>
              {i.title}
            </li>
          ))}
        </ul>
      )}

      {result.outOfRange && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--warn-text)', lineHeight: 1.4 }}>
          That size is outside the studio’s range. The answer is for the size you entered.
          Placing it changes the size to fit the range.
        </div>
      )}

      {preview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MiniPlan parts={preview} footprint={room.footprint} />
          <button onClick={onPlace} className="ds-btn ds-btn--xs" style={{ fontSize: 'var(--fs-micro)' }}>
            <Icon name="plus" size={11} />
            Put it there
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Furniture list ─────────────────────────────────────────────────────────

function ListPanel({ parts }: { parts: ScenePart[] }) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [copied, setCopied] = useState(false);

  // Group identical pieces (same name + dims + colour) into one line with a count.
  // Inline rather than shared: the CSV that was the second consumer is retired, and
  // this is the only thing that reads it now.
  const rows = useMemo(() => {
    const map = new Map<string, { part: ScenePart; count: number }>();
    for (const p of parts) {
      const key = `${p.name}|${p.dimMM.join('x')}|${p.color ?? ''}`;
      const e = map.get(key);
      if (e) e.count += 1;
      else map.set(key, { part: p, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.part.name.localeCompare(b.part.name));
  }, [parts]);

  function asText(): string {
    return rows
      .map(({ part: p, count }) => {
        const dims = `${formatDim(p.dimMM[0], dimUnit)} × ${formatDim(p.dimMM[1], dimUnit)} × ${formatDim(p.dimMM[2], dimUnit)} ${dimUnit} (W×D×H)`;
        return `${count > 1 ? `${count}× ` : ''}${p.name} · ${dims}${p.color ? ` · ${p.color.toUpperCase()}` : ''}`;
      })
      .join('\n');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Naming the recovery matters more than naming the API: some browsers refuse
      // clipboard writes outright, and the list is on screen either way.
      toast({
        tone: 'danger',
        title: 'Your browser blocked the copy',
        message: 'Nothing was copied. Allow clipboard access for this site, or read the list off the panel.',
      });
    }
  }

  return (
    <div>
      <TabActions>
        <span className="t-hint" style={{ flex: 1 }}>Real dimensions, in your unit</span>
        <button onClick={copy} className="ds-btn ds-btn--xs" style={{ fontSize: 'var(--fs-micro)', padding: '0 8px' }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </TabActions>

      {rows.length === 0 ? (
        <div className="t-small" style={{ padding: '16px 14px', lineHeight: 1.55 }}>
          Nothing in the room yet.
        </div>
      ) : (
        rows.map(({ part: p, count }, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--hairline)' }}>
            {p.color ? (
              <span style={{ width: 12, height: 12, borderRadius: 'var(--r-1)', background: p.color, border: '1px solid var(--hairline-strong)', flexShrink: 0 }} />
            ) : (
              <span style={{ width: 12, height: 12, borderRadius: 'var(--r-1)', background: 'var(--paper-2)', border: '1px dashed var(--hairline-strong)', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--ink)' }}>
                {count > 1 && <span style={{ color: 'var(--accent-text)' }}>{count}× </span>}
                {p.name}
              </div>
              <div className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                {formatDim(p.dimMM[0], dimUnit)} × {formatDim(p.dimMM[1], dimUnit)} × {formatDim(p.dimMM[2], dimUnit)} {dimUnit}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Layouts — named arrangement snapshots ─────────────────────────────────

function transformKey(t: Transforms): string {
  return JSON.stringify([t.positions, t.rotations, t.dims]);
}

function LayoutsPanel({ effParts, footprint }: { effParts: ScenePart[]; footprint: Footprint }) {
  const { roomId } = useParams<{ roomId: string }>();
  // Null until the saved list is read, so the tab does not say "No saved layouts
  // yet" about a room that has some.
  const [layouts, setLayouts] = useState<LayoutVariant[] | null>(null);
  const [pendingApply, setPendingApply] = useState<LayoutVariant | null>(null);
  // A plain flag on purpose, and NOT `useBusyAction`: the work here is a real
  // `await` into IndexedDB, so the thread is handed back and the flag paints
  // without any help. The hook exists for the opposite case — synchronous work
  // that never lets go. Converting this would also throw away `saveCurrent`'s
  // return value, which the button needs to name the layout it just wrote.
  const [busy, setBusy] = useState(false);
  const setParts = useScene((s) => s.setParts);
  const baseParts = useScene((s) => s.parts);
  const loadTransforms = useStudio((s) => s.loadTransforms);
  const setParentIds = useStudio((s) => s.setParentIds);
  const confirm = useConfirm();

  useEffect(() => {
    if (!roomId) return;
    roomStore.listLayouts(roomId).then(setLayouts);
  }, [roomId]);

  async function saveCurrent(): Promise<LayoutVariant | null> {
    if (!roomId) return null;
    const t = useStudio.getState();
    const transforms: Transforms = { positions: t.positions, rotations: t.rotations, dims: t.dims, parentIds: t.parentIds };
    const v: LayoutVariant = {
      id: `l-${Date.now().toString(36)}`,
      name: `Layout ${String.fromCharCode(65 + ((layouts?.length ?? 0) % 26))}`,
      createdAt: Date.now(),
      parts: baseParts,
      transforms,
    };
    await roomStore.saveLayout(roomId, v);
    setLayouts((prev) => [...(prev ?? []), v]);
    return v;
  }

  function apply(v: LayoutVariant) {
    // A saved layout is a persisted snapshot too, so it goes through the same
    // re-derivation as the scene load paths.
    setParts(normalizeStoredParts(v.parts as ScenePart[]));
    loadTransforms(v.transforms);
    // Layouts saved before this shipped simply have nothing here — reset
    // rather than leave whatever the room had live before applying.
    setParentIds(v.transforms.parentIds ?? {});
    toast({
      title: `${v.name} applied`,
      message: 'Undo puts the previous arrangement back.',
    });
  }

  /** True when what is on screen right now is already stored somewhere — either
   *  as one of the saved layouts, or because nothing has been moved at all. */
  function currentIsSafe(): boolean {
    const t = useStudio.getState();
    const untouched =
      Object.keys(t.positions).length === 0 &&
      Object.keys(t.rotations).length === 0 &&
      Object.keys(t.dims).length === 0;
    if (untouched) return true;
    const key = transformKey({ positions: t.positions, rotations: t.rotations, dims: t.dims });
    return (layouts ?? []).some((l) => transformKey(l.transforms) === key);
  }

  function requestApply(v: LayoutVariant) {
    // Applying replaces every piece and every transform in the room. If the
    // arrangement on screen was never saved, it is about to be gone.
    if (currentIsSafe()) apply(v);
    else setPendingApply(v);
  }

  async function remove(v: LayoutVariant) {
    if (!roomId) return;
    // Layouts live in IndexedDB, outside the undo stack — this is the one delete
    // in the studio that undo genuinely cannot reverse.
    const ok = await confirm({
      title: `Delete “${v.name}”?`,
      body: (
        <>
          <p style={{ margin: '0 0 8px' }}>
            Saved layouts are not part of the edit history, so <b>undo will not bring this one back</b>.
          </p>
          <p style={{ margin: 0 }}>The furniture in your room stays as it is.</p>
        </>
      ),
      confirmLabel: 'Delete layout',
      danger: true,
    });
    if (!ok) return;
    await roomStore.deleteLayout(roomId, v.id);
    setLayouts((prev) => (prev ?? []).filter((x) => x.id !== v.id));
    toast({ title: `${v.name} deleted`, message: 'Your room is unchanged.' });
  }

  return (
    <div>
      <TabActions>
        <span className="t-hint" style={{ flex: 1 }}>Saved arrangements</span>
        <button onClick={() => void saveCurrent()} className="ds-btn ds-btn--xs" style={{ fontSize: 'var(--fs-micro)', padding: '0 8px' }}>
          <Icon name="plus" size={10} /> Save current
        </button>
      </TabActions>

      {/* Current arrangement, for visual comparison against the saved ones. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper-2)' }}>
        <MiniPlan parts={effParts} footprint={footprint} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-small)', fontWeight: 700 }}>On screen now</div>
          <div className="t-micro">
            <span className="mono">{effParts.length}</span> pieces
            {!currentIsSafe() && ' · not saved yet'}
          </div>
        </div>
      </div>

      {layouts === null ? (
        <div role="status" style={{ padding: '10px 14px', display: 'grid', gap: 8 }}>
          <span className="sr-only">Loading saved layouts</span>
          <div className="ds-skeleton ds-skeleton--row" aria-hidden="true" />
          <div className="ds-skeleton ds-skeleton--row" aria-hidden="true" />
        </div>
      ) : layouts.length === 0 ? (
        <div className="t-small" style={{ padding: '16px 14px', lineHeight: 1.55 }}>
          No saved layouts yet.
        </div>
      ) : (
        layouts.map((v) => {
          // A saved layout stores both layers as they were, so it resolves the same
          // way the live scene does — same helper, different source.
          const vParts = resolveParts(v.parts as ScenePart[], v.transforms);
          return (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--hairline)' }}>
              <MiniPlan parts={vParts} footprint={footprint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: 'var(--fs-small)', fontWeight: 700 }}>{v.name}</span>
                  {/* Kept from the ideas gallery with its heart. Named in words too,
                      since the glyph alone is colour and shape. */}
                  {v.favourite && (
                    <span title="Saved from Ideas" style={{ display: 'inline-flex', color: 'var(--accent-text)', flexShrink: 0 }}>
                      <Icon name="heart" size={10} filled />
                      <span className="sr-only">, saved from Ideas</span>
                    </span>
                  )}
                </div>
                <div className="t-micro">{savedLabel(v.createdAt)}</div>
              </div>
              {/* Plain, not primary: this repeats once per saved layout, and the
                  rule beside the variants in globals.css excludes per-row actions. */}
              <button onClick={() => requestApply(v)} className="ds-btn ds-btn--xs" style={{ fontSize: 'var(--fs-micro)', padding: '0 8px' }}>
                Apply
              </button>
              <IconButton
                icon="trash"
                label={`Delete ${v.name}`}
                title="Delete this saved layout"
                tone="danger"
                onClick={() => void remove(v)}
                size={24}
                iconSize={12}
              />
            </div>
          );
        })
      )}

      {pendingApply && (
        <Modal
          onClose={() => setPendingApply(null)}
          labelledBy="apply-layout-title"
          width={440}
          footer={
            <>
              {/* Disabled while the save is in flight like the other two. It was
                  the one way out of this dialog that stayed live mid-write, so
                  dismissing it left a save running against a room the user had
                  already moved on from. */}
              <button
                onClick={() => setPendingApply(null)}
                disabled={busy}
                className="ds-btn"
                style={{ justifyContent: 'center' }}
              >
                Cancel
              </button>
              <div style={{ flex: 1 }} />
              <button
                disabled={busy}
                onClick={() => {
                  const v = pendingApply;
                  setPendingApply(null);
                  if (v) apply(v);
                }}
                className="ds-btn"
                style={{ justifyContent: 'center' }}
              >
                Apply without saving
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  const v = pendingApply;
                  setBusy(true);
                  const saved = await saveCurrent();
                  setBusy(false);
                  setPendingApply(null);
                  if (v) apply(v);
                  if (saved) toast({ title: `Current arrangement saved as ${saved.name}` });
                }}
                aria-busy={busy}
                className="ds-btn ds-btn--primary"
                style={{ gap: 8, justifyContent: 'center' }}
              >
                {busy && <Spinner size={12} />}
                {busy ? 'Saving…' : 'Save first, then apply'}
              </button>
            </>
          }
        >
          <div id="apply-layout-title" className="t-title" style={{ marginBottom: 6 }}>
            Save this arrangement first?
          </div>
          <div className="t-body" style={{ lineHeight: 1.55 }}>
            Applying <b>{pendingApply.name}</b> replaces every piece in the room and where it sits. The current
            arrangement is not saved as a layout, so only undo could bring it back.
          </div>
        </Modal>
      )}
    </div>
  );
}

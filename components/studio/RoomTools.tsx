'use client';

// What the room is like, and what to do about it. Sits at the top of the left rail
// rather than in the canvas's bottom-right corner, because it is the room's STATE:
// leaving it on the canvas meant the health of the room was chrome you could bury,
// and it cost a corner that also had to hold the camera, the lighting and the grid.
//
// A health chip and Suggest, plus one "Room" button whose panel carries four
// readings as tabs:
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useScene, type RoomShape } from '@/lib/scene-store';
import { resolveParts, useRoomScene } from '@/lib/room-scene';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import { analyzeRoom, type ClearanceIssue, type ClearanceSeverity } from '@/lib/clearance';
import { solveLayout } from '@/lib/layout-solve';
import { RULE_HANDLING, type CostBreakdown } from '@/lib/layout-score';
import { roomStore, type LayoutVariant, type Transforms } from '@/lib/storage';
import { footprintBounds, type Footprint } from '@/lib/footprint';
import { formatDim, fromMM, stepFor, toMM } from '@/lib/units';
import { checkFit, PROBE_ID, type FitCandidate, type FitResult, type FitStatus } from '@/lib/fit-check';
import { clampDims } from '@/lib/dimension-ranges';
import { groundY } from '@/lib/physics';
import { PART_LIBRARY } from '@/lib/scene-spec';
import { Select } from '@/components/ui/Select';
import { NumberField } from '@/components/ui/NumberField';
import { v4 as uuid } from 'uuid';
import { savedLabel } from '@/lib/dates';
import { Icon } from '@/components/ui/Icon';
import { IconButton, Pill, Segmented } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { isTypingOrDialog } from './KeyboardShortcuts';
import type { LibraryItem, ScenePart } from '@/lib/scene-spec';

type RoomTab = 'check' | 'fit' | 'list' | 'layouts';

/** Widest the report panel gets. Four tab labels and a findings list want this
 *  much; a narrow window gets less, and `place()` below is what decides how much,
 *  because it also has to know the width to keep the panel on screen. */
const PANEL_W = 324;

/**
 * The room's report, derived. Shared by the rail's health chip and by the compact
 * dot the rail shows while it is COLLAPSED — the point of surfacing this state was
 * that it is never behind a press, and a closed rail would have put it back there.
 * Only one of the two is mounted at a time, so this runs once either way.
 */
export function useRoomReport() {
  const room = useScene((s) => s.room);
  const stepFree = useSettings((s) => s.stepFree);
  // `useRoomScene` is memoised on the same four store slices this used to merge by
  // hand, so sharing it costs nothing and is one fewer copy of the fallback.
  const effParts = useRoomScene();
  const report = useMemo(
    () => analyzeRoom(effParts, { footprint: room.footprint, height: room.height }, { accessibility: stepFree }),
    [effParts, room.footprint, room.height, stepFree],
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
      title={ok ? 'Room checks out' : `${problems} ${problems === 1 ? 'issue' : 'issues'} — open this panel to see them`}
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
        fontSize: 10,
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
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RoomTab>('check');
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState({ left: 0, top: 0, width: PANEL_W });

  // Measured on open and kept true through resize and scroll. Placed to the RIGHT
  // of the rail rather than over it, so the room the panel is describing — and
  // that clicking a finding flies to — stays visible.
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      // The width is measured, not declared, because `left` is computed from it:
      // a CSS `min()` in the style and a constant here are two answers to one
      // question, and the constant is the one that would be wrong. At the gate's
      // 400px floor a flat 324 still fitted; below it — the gate is dismissible,
      // and browser zoom reaches there too — the panel hung off the left edge,
      // because only the right edge was ever clamped.
      const width = Math.min(PANEL_W, window.innerWidth - 24);
      const left = Math.max(12, Math.min(r.right + 10, window.innerWidth - width - 12));
      const top = Math.max(12, Math.min(r.top, window.innerHeight - 200));
      setPanelPos({ left, top, width });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

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
  useRefitOffer(effParts, room.footprint, dims, problems);

  // Close any open panel when a drag starts.
  useEffect(() => {
    if (draggingId) setOpen(false);
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
      setOpen(false);
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
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>This room</span>
              <IconButton icon="x" label="Close room panel" onClick={() => setOpen(false)} size={24} iconSize={12} />
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
              effParts={effParts}
              footprint={room.footprint}
            />
          )}
          {tab === 'fit' && <FitPanel effParts={effParts} room={room} />}
          {tab === 'list' && <ListPanel parts={effParts} />}
          {tab === 'layouts' && <LayoutsPanel effParts={effParts} footprint={room.footprint} />}
        </div>
      )}

      {/* The room's health, stated — not hidden behind a press.
          `analyzeRoom` already recomputed this on every scene change; the only
          thing wrong with it was that you had to find a dock in the corner of the
          canvas and open a tab before it would tell you. Drafted puts this kind of
          state permanently beside the thing it describes, and that is all this is.

          The severity colour is a FILL, so the text uses the matching -text token:
          --danger / --warn are not legible as type on paper. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ds-btn"
        title="Room check, the furniture list and saved layouts"
        style={{
          height: 34,
          width: '100%',
          justifyContent: 'flex-start',
          gap: 8,
          fontSize: 12,
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

      <SuggestButton effParts={effParts} footprint={room.footprint} />
    </div>
  );
}

// ─── Suggest an arrangement ─────────────────────────────────────────────────
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
const FIXED_PHRASE: Array<[keyof CostBreakdown, string]> = [
  ['overlap', 'separated pieces that were in the same place'],
  ['outside', 'brought furniture back inside the room'],
  ['door', 'cleared the doorway'],
  ['access', 'freed up the space each piece needs to be used'],
  ['walkway', 'widened the walkways'],
  ['window', 'uncovered the window'],
  ['relation', 'grouped the pieces that belong together'],
  ['wall', 'moved things back against the walls'],
  ['middle', 'brought the middle of the room together'],
  ['alignment', 'squared things up'],
  ['balance', 'evened out the weight in the room'],
];

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
function useSuggest(effParts: ScenePart[], footprint: Footprint) {
  const loadTransforms = useStudio((s) => s.loadTransforms);
  return useCallback(
    (mode: 'arrange' | 'refit', seed: number, only?: string[]) => {
      const t = useStudio.getState();
      const confined = only && only.length > 0 ? new Set(only) : null;
      const result = solveLayout(
        effParts,
        footprint,
        effParts.map((p) => p.locked || (confined ? !confined.has(p.id) : false)),
        { seed, mode },
      );
      if (result.moved.length === 0 || result.after >= result.before) return null;
      const positions = { ...t.positions };
      const rotations = { ...t.rotations };
      for (const i of result.moved) {
        const p = effParts[i];
        positions[p.id] = [result.placements[i].x, p.pos[1], result.placements[i].z];
        rotations[p.id] = result.placements[i].yaw;
      }
      // dims carried through untouched: the solver moves and turns, and a
      // suggestion that resized the furniture would be the one thing this app
      // refuses to do.
      loadTransforms({ positions, rotations, dims: t.dims });
      return result;
    },
    [effParts, footprint, loadTransforms],
  );
}

function SuggestButton({ effParts, footprint }: { effParts: ScenePart[]; footprint: Footprint }) {
  const suggest = useSuggest(effParts, footprint);
  const [busy, setBusy] = useState(false);
  // Pressing again asks for a DIFFERENT arrangement rather than recomputing the
  // same one — the solver is deterministic per seed, which is what makes both
  // behaviours possible at once.
  const attempt = useRef(0);

  function run() {
    setBusy(true);
    try {
      const result = suggest('arrange', ++attempt.current);
      if (!result) {
        toast({
          title: 'This is already a good arrangement',
          message: 'Nothing was moved — the pieces are where the guidelines want them.',
        });
        return;
      }
      toast({
        title: `Moved ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
        message: whatChanged(result.breakdownBefore, result.breakdownAfter),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="ds-btn"
      title="Rearrange the unlocked furniture using the same guidelines Room check measures"
      style={{
        height: 30,
        fontSize: 11,
        gap: 6,
        background: 'var(--paper)',
        borderColor: 'var(--edge)',
        color: 'var(--ink-2)',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <Icon name="sparkles" size={12} />
      Suggest
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
) {
  const suggest = useSuggest(effParts, footprint);
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
        onClick: () => {
          const result = suggest('refit', 1);
          toast(
            result
              ? {
                  title: `Re-fitted ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
                  message: whatChanged(result.breakdownBefore, result.breakdownAfter),
                }
              : {
                  title: 'Nothing to move',
                  message: 'No arrangement of the unlocked pieces clears this — try a different size, or unlock more.',
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
  info: { tone: 'neutral', label: 'Just so you know' },
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
function FixButton({
  issue,
  effParts,
  footprint,
}: {
  issue: ClearanceIssue;
  effParts: ScenePart[];
  footprint: Footprint;
}) {
  const suggest = useSuggest(effParts, footprint);
  const [busy, setBusy] = useState(false);
  // Pressing again asks for a different attempt, the same way Suggest does.
  const attempt = useRef(0);

  // A finding with no pieces named (a cut-off patch of floor is about the floor)
  // has nothing to confine to, so it falls back to the whole room.
  const scope = issue.partIds.length > 0 ? issue.partIds : undefined;

  function run() {
    setBusy(true);
    try {
      const result = suggest('refit', ++attempt.current, scope);
      if (!result) {
        toast({
          title: 'Moving those didn’t clear it',
          message: scope
            ? 'Nothing better was found without touching the rest of the room. Suggest can rearrange everything.'
            : 'Nothing better was found. Try unlocking a piece, or making some space.',
        });
        return;
      }
      toast({
        tone: 'success',
        title: `Moved ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
        message: whatChanged(result.breakdownBefore, result.breakdownAfter),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={busy}
      className="ds-btn"
      title={
        scope
          ? 'Move just the pieces named here, leaving the rest of the room alone'
          : 'Rearrange the unlocked furniture to open the floor up'
      }
      style={{ height: 24, fontSize: 10, padding: '0 8px', flexShrink: 0, alignSelf: 'flex-start' }}
    >
      {busy ? 'Trying…' : 'Try a fix'}
    </button>
  );
}

function CheckPanel({
  issues,
  freeShare,
  stepFree,
  onStepFree,
  effParts,
  footprint,
}: {
  issues: ClearanceIssue[];
  freeShare: number;
  stepFree: boolean;
  onStepFree: (on: boolean) => void;
  effParts: ScenePart[];
  footprint: Footprint;
}) {
  const setSelection = useStudio((s) => s.setSelection);
  const frameSelected = useStudio((s) => s.frameSelected);

  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '8px 14px', borderBottom: '1px solid var(--hairline)' }}>
        <span className="mono">{Math.round(freeShare * 100)}%</span> of the floor is still clear to walk on
      </div>

      {/* A real checkbox rather than a styled div: this is a persisted preference
          that changes what the panel reports, and it has to be reachable by Tab
          and announce its own state. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--hairline)',
          fontSize: 11.5,
          color: 'var(--ink-2)',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={stepFree}
          onChange={(e) => onStepFree(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0, cursor: 'pointer' }}
        />
        Check step-free access
        <span style={{ color: 'var(--ink-3)' }}>· 150 cm turning space</span>
      </label>

      {issues.length === 0 ? (
        <div style={{ padding: '18px 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Everything fits — doors open, walkways are comfortable, and seating distances look right.
        </div>
      ) : (
        issues.map((issue) => {
          const sev = SEVERITY[issue.severity];
          const canSelect = issue.partIds.length > 0;
          // Whether the solver could plausibly clear this by rearranging. Read from
          // the one table that knows, rather than re-deciding it here.
          const canFix = RULE_HANDLING[issue.rule].movable;
          return (
            // A row, not a button: it holds two real buttons now — showing the
            // pieces, and offering to move them — and a button inside a button is
            // neither valid nor reachable by keyboard.
            <div
              key={issue.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 14px',
                borderBottom: '1px solid var(--hairline)',
              }}
            >
              <button
                onClick={() => {
                  if (!canSelect) return;
                  setSelection(issue.partIds, issue.partIds[0]);
                  frameSelected();
                }}
                className="list-row"
                title={canSelect ? 'Select the pieces involved and fly to them' : undefined}
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 4,
                  padding: 0,
                  borderRadius: 0,
                  background: 'none',
                  cursor: canSelect ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Pill tone={sev.tone}>{sev.label}</Pill>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', flex: 1, minWidth: 0 }}>
                    {issue.title}
                  </span>
                  {canSelect && (
                    <span className="row-action" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-text)', whiteSpace: 'nowrap' }}>
                      Show me
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45, whiteSpace: 'normal' }}>
                  {issue.detail}
                </div>
              </button>
              {canFix && <FixButton issue={issue} effParts={effParts} footprint={footprint} />}
            </div>
          );
        })
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
  fits: { tone: 'sage', lead: 'Yes — it fits' },
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
  const [busy, setBusy] = useState(false);

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
    if (!ready || busy) return;
    // `checkFit` is synchronous and runs the solver several times — measured at 42 ms
    // for an obvious yes and ~330 ms for a furnished room it has to work at. That is
    // long enough to feel, and setting state alone would not show it: React cannot
    // paint while the same tick is still solving. So yield one turn to let the busy
    // label render, then block.
    setBusy(true);
    setTimeout(() => {
      try {
        setResult(checkFit({ category: kind.category, shape: kind.shape, dimMM, name: kind.label }, effParts, room));
      } finally {
        setBusy(false);
      }
    }, 0);
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
        ? 'Its size was brought into the range the studio works in — the fit answer was about the size you entered.'
        : 'Undo puts the room back.',
    });
    setResult(null);
  }

  const label = (t: string) => (
    <span style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>{t}</span>
  );

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
        Type the size off the shop page. Nothing in your room moves — this only asks
        whether there is somewhere for it.
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
      <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
        W × D × H in <span className="mono">{dimUnit}</span>
      </div>

      {/* The one mistake this panel invites. Shop pages quote centimetres or
          millimetres; the studio's display unit defaults to metres, so the natural
          move is to copy "228" into a field that means metres and be told a sofa is
          too tall for the room. Cheaper to notice than to explain: if the numbers are
          absurd as entered and sensible one unit down, say so. */}
      {misreadUnit(dimMM, dimUnit) && (
        <div style={{ fontSize: 11, color: 'var(--warn-text)', lineHeight: 1.4 }}>
          Those look like {misreadUnit(dimMM, dimUnit)} — these fields are in{' '}
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
              style={{ cursor: 'pointer', fontSize: 10 }}
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
        className="ds-btn ds-btn--primary"
        style={{ height: 30, fontSize: 11.5 }}
      >
        <Icon name="ruler" size={12} />
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
          <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>
            by <span className="mono">{formatDim(-result.headroomMM, dimUnit)} {dimUnit}</span>
          </span>
        )}
      </div>

      {result.status === 'fits' && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
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
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          The ceiling here is <span className="mono">{formatDim(room.height * 1000, dimUnit)} {dimUnit}</span>. Nothing
          about the floor can help with that.
        </div>
      )}

      {result.status === 'no-room' && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          {result.largestBay ? (
            <>
              The biggest clear rectangle of floor is{' '}
              <span className="mono">
                {formatDim(result.largestBay.width * 1000, dimUnit)} × {formatDim(result.largestBay.depth * 1000, dimUnit)} {dimUnit}
              </span>
              . Moving what is already in here might make room — try <b>Suggest</b>.
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
            <li key={i.id} style={{ fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.4 }}>
              {i.title}
            </li>
          ))}
        </ul>
      )}

      {result.outOfRange && (
        <div style={{ fontSize: 11, color: 'var(--warn-text)', lineHeight: 1.4 }}>
          That size is outside the range the studio works in. The answer above is about
          the size you entered; placing it will bring it into range.
        </div>
      )}

      {preview && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MiniPlan parts={preview} footprint={room.footprint} />
          <button onClick={onPlace} className="ds-btn" style={{ height: 26, fontSize: 10.5 }}>
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
        return `${count > 1 ? `${count}× ` : ''}${p.name} — ${dims}${p.color ? ` — ${p.color.toUpperCase()}` : ''}`;
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
        <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-3)' }}>Real dimensions, in your unit</span>
        <button onClick={copy} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </TabActions>

      {rows.length === 0 ? (
        <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          Nothing in the room yet. Open the catalog on the left and drop a piece in.
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
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {count > 1 && <span style={{ color: 'var(--accent-text)' }}>{count}× </span>}
                {p.name}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
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
  const [layouts, setLayouts] = useState<LayoutVariant[]>([]);
  const [pendingApply, setPendingApply] = useState<LayoutVariant | null>(null);
  const [busy, setBusy] = useState(false);
  const setParts = useScene((s) => s.setParts);
  const baseParts = useScene((s) => s.parts);
  const loadTransforms = useStudio((s) => s.loadTransforms);
  const confirm = useConfirm();

  useEffect(() => {
    if (!roomId) return;
    roomStore.listLayouts(roomId).then(setLayouts);
  }, [roomId]);

  async function saveCurrent(): Promise<LayoutVariant | null> {
    if (!roomId) return null;
    const t = useStudio.getState();
    const transforms: Transforms = { positions: t.positions, rotations: t.rotations, dims: t.dims };
    const v: LayoutVariant = {
      id: `l-${Date.now().toString(36)}`,
      name: `Layout ${String.fromCharCode(65 + (layouts.length % 26))}`,
      createdAt: Date.now(),
      parts: baseParts,
      transforms,
    };
    await roomStore.saveLayout(roomId, v);
    setLayouts((prev) => [...prev, v]);
    return v;
  }

  function apply(v: LayoutVariant) {
    setParts(v.parts as ScenePart[]);
    loadTransforms(v.transforms);
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
    return layouts.some((l) => transformKey(l.transforms) === key);
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
            Saved layouts are stored with the room rather than in the edit history, so <b>undo will not bring this
            one back</b>.
          </p>
          <p style={{ margin: 0 }}>The furniture in your room is not touched — only this saved snapshot of it.</p>
        </>
      ),
      confirmLabel: 'Delete layout',
      danger: true,
    });
    if (!ok) return;
    await roomStore.deleteLayout(roomId, v.id);
    setLayouts((prev) => prev.filter((x) => x.id !== v.id));
    toast({ title: `${v.name} deleted`, message: 'Your room is unchanged.' });
  }

  return (
    <div>
      <TabActions>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-3)' }}>Snapshots you can flip between</span>
        <button onClick={() => void saveCurrent()} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
          <Icon name="plus" size={10} /> Save current
        </button>
      </TabActions>

      {/* Current arrangement, for visual comparison against the saved ones. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper-2)' }}>
        <MiniPlan parts={effParts} footprint={footprint} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>On screen now</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
            <span className="mono">{effParts.length}</span> pieces
            {!currentIsSafe() && ' · not saved yet'}
          </div>
        </div>
      </div>

      {layouts.length === 0 ? (
        <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          No saved layouts yet. Arrange the room, then <b>Save current</b> — save a second
          arrangement and flip between them to compare.
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
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{savedLabel(v.createdAt)}</div>
              </div>
              {/* Plain, not primary: this repeats once per saved layout, and the
                  rule beside the variants in globals.css excludes per-row actions. */}
              <button onClick={() => requestApply(v)} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
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
              <button
                onClick={() => setPendingApply(null)}
                className="ds-btn"
                style={{ height: 36, fontSize: 13, justifyContent: 'center' }}
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
                style={{ height: 36, fontSize: 13, justifyContent: 'center' }}
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
                className="ds-btn ds-btn--primary"
                style={{ height: 36, fontSize: 13, justifyContent: 'center' }}
              >
                {busy ? 'Saving…' : 'Save first, then apply'}
              </button>
            </>
          }
        >
          <div id="apply-layout-title" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
            Save this arrangement first?
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            Applying <b>{pendingApply.name}</b> replaces every piece in the room and where it sits. What is on screen
            right now has not been saved as a layout, so it would only be recoverable through undo.
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Tiny top-down floor plan — footprint outline + furniture rectangles. */
function MiniPlan({ parts, footprint }: { parts: ScenePart[]; footprint: Footprint }) {
  const b = footprintBounds(footprint);
  const W = 84;
  const H = Math.max(36, Math.round((W * b.depth) / Math.max(0.1, b.width)));
  const sx = W / b.width;
  const sy = H / b.depth;
  const s = Math.min(sx, sy);
  const px = (x: number) => (x - b.minX) * s + (W - b.width * s) / 2;
  const pz = (z: number) => (z - b.minZ) * s + (H - b.depth * s) / 2;
  return (
    <svg
      width={W}
      height={H}
      aria-hidden="true"
      style={{ flexShrink: 0, background: 'var(--paper)', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-1)' }}
    >
      <polygon
        points={footprint.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}
        fill="var(--paper-2)"
        stroke="var(--ink-3)"
        strokeWidth={1}
      />
      {parts
        .filter((p) => !p.wallMounted)
        .map((p) => {
          const w = (p.dimMM[0] / 1000) * s;
          const d = (p.dimMM[1] / 1000) * s;
          return (
            <rect
              key={p.id}
              x={px(p.pos[0]) - w / 2}
              y={pz(p.pos[2]) - d / 2}
              width={w}
              height={d}
              transform={`rotate(${(-p.rot * 180) / Math.PI} ${px(p.pos[0])} ${pz(p.pos[2])})`}
              fill={p.color ?? 'var(--accent)'}
              fillOpacity={0.55}
              stroke="var(--ink-2)"
              strokeWidth={0.5}
            />
          );
        })}
    </svg>
  );
}

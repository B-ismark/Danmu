'use client';

// The bottom-right dock of the 3D view — one row, two halves.
//
// LEFT (passed in as `leading`): looking at the room — the camera presets and the
// Look popover. RIGHT: changing and checking it — Suggest, and one "Room" button
// whose panel carries three readings as tabs:
//   · Check — deterministic ergonomics review (door swings, walkways, storage
//     clearance, bed access, TV distance, crowding). Click a finding to select the
//     pieces involved and fly to them.
//   · List — every piece with its real dimensions in the user's display unit;
//     copy as text or download a CSV to take shopping.
//   · Layouts — named arrangement snapshots with mini floor plans, so competing
//     arrangements can be saved and flipped between.
//
// Those three were three buttons opening three cards that could never be open at
// the same time — a tab strip, spread across the bottom of the canvas and costing
// three slots in a corner that also had to hold the camera, the lighting, the
// grid and the suggestion button.
//
// Layouts are the one feature that stores work OUTSIDE the undo stack (they live
// in IndexedDB), so both of its destructive paths are guarded: deleting a layout
// confirms, and applying one over an arrangement that was never saved offers to
// save it first.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { analyzeRoom, type ClearanceIssue, type ClearanceSeverity } from '@/lib/clearance';
import { solveLayout } from '@/lib/layout-solve';
import type { CostBreakdown } from '@/lib/layout-score';
import { roomStore, type LayoutVariant, type Transforms } from '@/lib/storage';
import { footprintBounds, type Footprint } from '@/lib/footprint';
import { formatDim } from '@/lib/units';
import { savedLabel } from '@/lib/dates';
import { Icon } from '@/components/ui/Icon';
import { IconButton, Pill, Segmented } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { isTypingOrDialog } from './KeyboardShortcuts';
import type { ScenePart } from '@/lib/scene-spec';

type RoomTab = 'check' | 'list' | 'layouts';

export function RoomTools({ leading }: { leading?: ReactNode }) {
  // One panel, three tabs. These were three sibling buttons opening three cards
  // that were already mutually exclusive — i.e. a tab strip with the tabs spread
  // along the bottom of the canvas. Saying so costs two buttons of width and makes
  // the second and third readings discoverable from the first.
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RoomTab>('check');

  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const draggingId = useStudio((s) => s.draggingId);

  // Effective scene = base parts + user transform overrides. Recomputed on
  // commit (stores don't change during a live drag), so this stays cheap.
  const effParts = useMemo<ScenePart[]>(
    () =>
      parts.map((p) => ({
        ...p,
        pos: positions[p.id] ?? p.pos,
        rot: rotations[p.id] ?? p.rot,
        dimMM: dims[p.id] ?? p.dimMM,
      })),
    [parts, positions, rotations, dims],
  );

  // Step-free findings are opt-in and remembered, because whether a room has to
  // meet them is a fact about the person, not about the room — asking again every
  // time someone opens the panel would be its own small insult.
  const stepFree = useSettings((s) => s.stepFree);
  const setStepFree = useSettings((s) => s.setStepFree);

  const report = useMemo(
    () => analyzeRoom(effParts, { footprint: room.footprint, height: room.height }, { accessibility: stepFree }),
    [effParts, room.footprint, room.height, stepFree],
  );
  const problems = report.issues.filter((i) => i.severity !== 'info').length;

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
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        zIndex: 'var(--z-canvas-ui)',
        // Leaves the selection bar its half of the bottom edge, and wraps rather
        // than reaching into it when the canvas is narrow.
        maxWidth: 'calc(100% - 24px)',
        // Faded rather than unmounted mid-drag: this row hosts the Look popover
        // and the camera presets, and remounting them on every drop would throw
        // away their state for the sake of 30px of chrome.
        opacity: draggingId ? 0 : 1,
        pointerEvents: draggingId ? 'none' : 'auto',
        transition: 'opacity .15s',
      }}
    >
      {open && (
        <div
          className="ds-card"
          style={{ width: 324, maxHeight: 400, overflow: 'auto', padding: 0, boxShadow: 'var(--shadow-lift)' }}
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
            />
          )}
          {tab === 'list' && <ListPanel parts={effParts} />}
          {tab === 'layouts' && <LayoutsPanel effParts={effParts} footprint={room.footprint} />}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {leading}
        {/* Two jobs, two groups: everything to the left of this line is about
            looking at the room, everything to the right changes or checks it. */}
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--hairline-strong)', margin: '0 2px' }} />
        <SuggestButton effParts={effParts} footprint={room.footprint} />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ds-btn"
          title="Room check, the furniture list and saved layouts"
          style={{
            height: 30,
            fontSize: 11,
            gap: 6,
            background: open ? 'var(--accent-tint)' : 'var(--paper)',
            borderColor: problems > 0 ? 'var(--danger)' : open ? 'var(--accent-text)' : 'var(--edge)',
            color: problems > 0 ? 'var(--danger-text)' : open ? 'var(--accent-text)' : 'var(--ink-2)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <Icon name="info" size={12} />
          Room
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 17,
              height: 16,
              padding: '0 5px',
              borderRadius: 'var(--r-full)',
              fontSize: 10,
              fontWeight: 700,
              background: problems > 0 ? 'var(--danger)' : 'var(--accent-ink)',
              color: 'var(--on-accent)',
            }}
          >
            {problems > 0 ? <span className="mono">{problems}</span> : <Icon name="check" size={10} />}
          </span>
        </button>
      </div>
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
 *  same thing happens whether the user asked for an idea or accepted a re-fit
 *  after resizing something. */
function useSuggest(effParts: ScenePart[], footprint: Footprint) {
  const loadTransforms = useStudio((s) => s.loadTransforms);
  return useCallback(
    (mode: 'arrange' | 'refit', seed: number) => {
      const t = useStudio.getState();
      const result = solveLayout(
        effParts,
        footprint,
        effParts.map((p) => p.locked),
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
  const seen = useRef<{ key: string; problems: number } | null>(null);

  useEffect(() => {
    const key = JSON.stringify([footprint, dims]);
    const prev = seen.current;
    seen.current = { key, problems };
    if (!prev || prev.key === key) return;
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

function CheckPanel({
  issues,
  freeShare,
  stepFree,
  onStepFree,
}: {
  issues: ClearanceIssue[];
  freeShare: number;
  stepFree: boolean;
  onStepFree: (on: boolean) => void;
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
          return (
            <button
              key={issue.id}
              onClick={() => {
                if (!canSelect) return;
                setSelection(issue.partIds, issue.partIds[0]);
                frameSelected();
              }}
              className="list-row"
              title={canSelect ? 'Select the pieces involved and fly to them' : undefined}
              style={{
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 4,
                padding: '10px 14px',
                borderRadius: 0,
                borderBottom: '1px solid var(--hairline)',
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
          );
        })
      )}
    </div>
  );
}

// ─── Furniture list ─────────────────────────────────────────────────────────

function ListPanel({ parts }: { parts: ScenePart[] }) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [copied, setCopied] = useState(false);

  // Group identical pieces (same name + dims) into one line with a count.
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
        <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-3)' }}>Real sizes, in your unit</span>
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
          const vParts = (v.parts as ScenePart[]).map((p) => ({
            ...p,
            pos: v.transforms.positions[p.id] ?? p.pos,
            rot: v.transforms.rotations[p.id] ?? p.rot,
            dimMM: v.transforms.dims[p.id] ?? p.dimMM,
          }));
          return (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--hairline)' }}>
              <MiniPlan parts={vParts} footprint={footprint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{savedLabel(v.createdAt)}</div>
              </div>
              <button onClick={() => requestApply(v)} className="ds-btn ds-btn--primary" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
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

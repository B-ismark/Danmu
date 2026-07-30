'use client';

// The bottom-right cluster of the 3D view — "look at it" and "check it over":
//   · View (passed in as `leading`) — lighting, decor, quality.
//   · Room check — deterministic ergonomics review (door swings, walkways,
//     storage clearance, bed access, TV distance, crowding). Click a finding to
//     select the pieces involved and fly to them.
//   · List — every piece with its real dimensions in the user's display unit;
//     copy as text or download a CSV to take shopping.
//   · Layouts — named arrangement snapshots with mini floor plans, so competing
//     arrangements can be saved and flipped between.
//
// Layouts are the one feature that stores work OUTSIDE the undo stack (they live
// in IndexedDB), so both of its destructive paths are guarded: deleting a layout
// confirms, and applying one over an arrangement that was never saved offers to
// save it first.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { analyzeRoom, type ClearanceIssue, type ClearanceSeverity } from '@/lib/clearance';
import { solveLayout } from '@/lib/layout-solve';
import { roomStore, type LayoutVariant, type Transforms } from '@/lib/storage';
import { footprintBounds, type Footprint } from '@/lib/footprint';
import { formatDim } from '@/lib/units';
import { csvBlob } from '@/lib/csv';
import { downloadBlob } from '@/lib/snapshot';
import { savedLabel } from '@/lib/dates';
import { Icon } from '@/components/ui/Icon';
import { IconButton, Pill } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import { isTypingOrDialog } from './KeyboardShortcuts';
import type { ScenePart } from '@/lib/scene-spec';

/** Downloads carry the room's name, so a folder of exports from three rooms is
 *  still readable a week later. */
function fileSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'room'
  );
}

export function RoomTools({ leading }: { leading?: ReactNode }) {
  const [open, setOpen] = useState<'check' | 'list' | 'layouts' | null>(null);
  const { roomId } = useParams<{ roomId: string }>();
  const [roomName, setRoomName] = useState('Room');

  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const draggingId = useStudio((s) => s.draggingId);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r?.name) setRoomName(r.name);
    });
  }, [roomId]);

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

  // Close any open panel when a drag starts.
  useEffect(() => {
    if (draggingId) setOpen(null);
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
      setOpen(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        zIndex: 'var(--z-canvas-ui)',
        // Faded rather than unmounted mid-drag: this row hosts the View popover,
        // which reads the room from IndexedDB on mount — unmounting it would mean
        // a storage read on every drop.
        opacity: draggingId ? 0 : 1,
        pointerEvents: draggingId ? 'none' : 'auto',
        transition: 'opacity .15s',
      }}
    >
      {open === 'check' && (
        <CheckPanel
          issues={report.issues}
          freeShare={report.freeFloorShare}
          stepFree={stepFree}
          onStepFree={setStepFree}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'list' && <ListPanel parts={effParts} roomName={roomName} onClose={() => setOpen(null)} />}
      {open === 'layouts' && (
        <LayoutsPanel effParts={effParts} footprint={room.footprint} onClose={() => setOpen(null)} />
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {leading}
        <SuggestButton effParts={effParts} footprint={room.footprint} />
        <button
          onClick={() => setOpen(open === 'check' ? null : 'check')}
          aria-expanded={open === 'check'}
          className="ds-btn"
          title="Check walkways, door swings, storage clearance and viewing distances"
          style={{
            height: 30,
            fontSize: 11,
            gap: 6,
            background: 'var(--paper)',
            borderColor: problems > 0 ? 'var(--danger)' : 'var(--edge)',
            color: problems > 0 ? 'var(--danger-text)' : 'var(--ink-2)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <Icon name="info" size={12} />
          Room check
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
        <button
          onClick={() => setOpen(open === 'list' ? null : 'list')}
          aria-expanded={open === 'list'}
          className="ds-btn"
          title="Furniture list with real dimensions — copy or download CSV"
          style={{ height: 30, fontSize: 11, gap: 6, background: 'var(--paper)', borderColor: 'var(--edge)', boxShadow: 'var(--shadow-soft)' }}
        >
          <Icon name="layers" size={12} />
          List
        </button>
        <button
          onClick={() => setOpen(open === 'layouts' ? null : 'layouts')}
          aria-expanded={open === 'layouts'}
          className="ds-btn"
          title="Save this arrangement as a layout and flip between saved layouts"
          style={{ height: 30, fontSize: 11, gap: 6, background: 'var(--paper)', borderColor: 'var(--edge)', boxShadow: 'var(--shadow-soft)' }}
        >
          <Icon name="grid" size={12} />
          Layouts
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

function SuggestButton({ effParts, footprint }: { effParts: ScenePart[]; footprint: Footprint }) {
  const loadTransforms = useStudio((s) => s.loadTransforms);
  const [busy, setBusy] = useState(false);
  // Pressing again asks for a DIFFERENT arrangement rather than recomputing the
  // same one — the solver is deterministic per seed, which is what makes both
  // behaviours possible at once.
  const attempt = useRef(0);

  function suggest() {
    setBusy(true);
    try {
      const t = useStudio.getState();
      const result = solveLayout(
        effParts,
        footprint,
        effParts.map((p) => p.locked),
        { seed: ++attempt.current },
      );
      if (result.moved.length === 0 || result.after >= result.before) {
        toast({
          title: 'This is already a good arrangement',
          message: 'Nothing was moved — the pieces are where the guidelines want them.',
        });
        return;
      }
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
      toast({
        title: `Moved ${result.moved.length} ${result.moved.length === 1 ? 'piece' : 'pieces'}`,
        message: 'Undo puts the previous arrangement back. Press again for a different idea.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={suggest}
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

function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '10px 10px 10px 14px',
        borderBottom: '1px solid var(--hairline)',
        position: 'sticky',
        top: 0,
        background: 'var(--paper)',
        // Local to this panel's own scroll box — it lifts the sticky header over
        // the rows sliding under it. Its own rung on the --z-* scale rather than a
        // bare 1, so nothing in the app invents a stacking number.
        zIndex: 'var(--z-sticky-local)',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function CheckPanel({
  issues,
  freeShare,
  stepFree,
  onStepFree,
  onClose,
}: {
  issues: ClearanceIssue[];
  freeShare: number;
  stepFree: boolean;
  onStepFree: (on: boolean) => void;
  onClose: () => void;
}) {
  const setSelection = useStudio((s) => s.setSelection);
  const frameSelected = useStudio((s) => s.frameSelected);

  return (
    <div className="ds-card" style={{ width: 316, maxHeight: 360, overflow: 'auto', padding: 0, boxShadow: 'var(--shadow-lift)' }}>
      <PanelHead title="Room check">
        <IconButton icon="x" label="Close room check" onClick={onClose} size={24} iconSize={12} />
      </PanelHead>

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

function ListPanel({ parts, roomName, onClose }: { parts: ScenePart[]; roomName: string; onClose: () => void }) {
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
      // Naming the recovery matters more than naming the API: some browsers
      // refuse clipboard writes outright, and the CSV is right there.
      toast({
        tone: 'danger',
        title: 'Your browser blocked the copy',
        message: 'Nothing was copied. Download the CSV instead, or allow clipboard access for this site.',
      });
    }
  }

  function downloadCsv() {
    // lib/csv owns the escaping (formula injection, quoting, CRLF) and the BOM.
    // This used to hand-roll quoting only, so a piece named "=HYPERLINK(...)" was
    // written through verbatim and evaluated when the file was opened.
    const blob = csvBlob([
      ['Qty', 'Name', 'Category', `Width (${dimUnit})`, `Depth (${dimUnit})`, `Height (${dimUnit})`, 'Colour'],
      ...rows.map(({ part: p, count }) => [
        count,
        p.name,
        p.category,
        formatDim(p.dimMM[0], dimUnit),
        formatDim(p.dimMM[1], dimUnit),
        formatDim(p.dimMM[2], dimUnit),
        p.color ? p.color.toUpperCase() : '',
      ]),
    ]);
    // The shared helper, which delays revoking the object URL — revoking it
    // synchronously after .click() cancels the download in some browsers.
    downloadBlob(blob, `${fileSlug(roomName)}-furniture.csv`);
  }

  return (
    <div className="ds-card" style={{ width: 320, maxHeight: 360, overflow: 'auto', padding: 0, boxShadow: 'var(--shadow-lift)' }}>
      <PanelHead title="Furniture list">
        <button onClick={copy} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button onClick={downloadCsv} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
          CSV
        </button>
        <IconButton icon="x" label="Close furniture list" onClick={onClose} size={24} iconSize={12} />
      </PanelHead>

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

function LayoutsPanel({
  effParts,
  footprint,
  onClose,
}: {
  effParts: ScenePart[];
  footprint: Footprint;
  onClose: () => void;
}) {
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
    <div className="ds-card" style={{ width: 322, maxHeight: 380, overflow: 'auto', padding: 0, boxShadow: 'var(--shadow-lift)' }}>
      <PanelHead title="Layouts">
        <button onClick={() => void saveCurrent()} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
          <Icon name="plus" size={10} /> Save current
        </button>
        <IconButton icon="x" label="Close layouts" onClick={onClose} size={24} iconSize={12} />
      </PanelHead>

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

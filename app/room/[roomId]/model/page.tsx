'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStudio } from '@/lib/store';
import { ViewPresetChips } from '@/components/studio/ViewPresetChips';
import { ViewOptions } from '@/components/studio/ViewOptions';
import { CatalogPanel, CatalogToggle, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { SelectionBar } from '@/components/studio/SelectionBar';
import { HoverCard } from '@/components/studio/HoverCard';
import { Inspector } from '@/components/studio/Inspector';
import { PartTree } from '@/components/studio/PartTree';
import { TransformToolbar } from '@/components/studio/TransformToolbar';
import { RoomTools } from '@/components/studio/RoomTools';
import { useStackedStudio } from '@/components/studio/NarrowViewportBanner';
import { HelpCard, HelpGroup, HelpLine, Kb } from '@/components/studio/HelpCard';
import { isTypingOrDialog } from '@/components/studio/KeyboardShortcuts';
import { Icon } from '@/components/ui/Icon';

const Room = dynamic(() => import('@/components/three/Room').then((m) => m.Room), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      Loading your 3D room…
    </div>
  ),
});

export default function ModelPage() {
  // Below ~1024px the rails stack under the room instead of squeezing it to
  // nothing. Done in JS rather than CSS because the canvas has to come FIRST in
  // the stacked order and a media query cannot reorder an inline-styled grid.
  //
  // `ready` gates the first paint: without it a narrow viewport laid out the
  // three-column shell, then re-ordered and re-flowed once matchMedia answered.
  const { stacked, ready } = useStackedStudio();
  // In the store, not in this page: the rail's "Add furniture" opens the same
  // panel from the other side of the studio, and on the 2D tab as well.
  const catalogOpen = useStudio((s) => s.catalogOpen);

  const shell: CSSProperties = stacked
    ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: 'minmax(300px, 55vh) auto auto',
        height: '100%',
        overflow: 'auto',
      }
    : { gridTemplateColumns: '260px 1fr 320px', height: '100%' };

  const railStyle: CSSProperties = stacked
    ? {
        minHeight: 0,
        height: 'auto',
        maxHeight: '60vh',
        borderLeft: 0,
        borderRight: 0,
        borderTop: '1px solid var(--hairline)',
      }
    : { minHeight: 0 };

  const tree = (
    <aside key="tree" className="rail rail--left" style={railStyle}>
      <PartTree />
    </aside>
  );

  const inspector = (
    <aside key="inspector" className="rail rail--right" style={railStyle}>
      <Inspector />
    </aside>
  );

  const canvas = (
    <main
      key="canvas"
      id={STUDIO_CANVAS_ID}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--paper-2)',
        minHeight: stacked ? 300 : 0,
      }}
    >
      {/* The room is the page. Its heading is for the document outline and for
          screen readers — putting it on screen would just repeat the top bar. */}
      <h1 className="sr-only">Your room in 3D</h1>
      <Room />

      {/* ── Cluster 1 · top left: everything that puts a piece in the room or
             changes one. What dragging does, how far it snaps, and where new
             furniture comes from — one row, with the catalog opening under it. ── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 'var(--z-canvas-ui)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          maxWidth: 'calc(100% - 24px)',
        }}
      >
        <TransformToolbar />
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--hairline-strong)' }} />
        <CatalogToggle />
      </div>
      {/* Drag lands here and only here: Room's onDrop raycasts the drop point. */}
      {catalogOpen && <CatalogPanel canDrag />}

      <HoverCard />

      {/* ── Cluster 2 · bottom right: one dock. Where you stand and how it looks
             on the left of the divider, what to do about it on the right. The
             camera presets and the floor grid used to be a second row below this
             one, and the room readings were three buttons instead of one. ── */}
      <RoomTools
        leading={
          <>
            <ViewPresetChips />
            <ViewOptions />
          </>
        }
      />

      {/* ── Cluster 3 · bottom left: the only help surface, on --z-canvas-hint so
             no panel can ever paint over it. ── */}
      <HelpDock />

      {/* Not a cluster — it exists only while something is selected. */}
      <SelectionBar />
    </main>
  );

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--paper-2)' }}>
        <span role="status" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          Setting up your studio…
        </span>
      </div>
    );
  }

  return (
    <div className="split split--stack" style={shell}>
      {stacked ? [canvas, tree, inspector] : [tree, canvas, inspector]}
    </div>
  );
}

// ─── Help ───────────────────────────────────────────────────────────────────
//
// Every power feature in this app — scroll-to-spin mid-drag, shift-click + merge,
// click a wall to paint it, drag a wall to resize the room, double-click a
// wardrobe to open it — used to live inside a tooltip that appeared on hover of a
// 32px "?". Hover-only, mouse-only, and gone the moment you moved to try the
// thing you had just read about. It is now two surfaces:
//
//   · a click-to-open, Esc-to-close shortcut card that stays put, and
//   · one-shot coach marks that appear the first time the user does the thing the
//     tip is about (starts a drag, selects a wall) and never again.

type CoachId = 'drag' | 'wall';

const COACH_KEY: Record<CoachId, string> = {
  drag: 'danmu-coach-drag',
  wall: 'danmu-coach-wall',
};

const COACH_COPY: Record<CoachId, { title: string; body: string }> = {
  drag: {
    title: 'While you are dragging',
    body: 'Scroll to spin the piece as it moves, and it will nudge up against whatever it bumps into. Snap, up at the top, keeps it on tidy steps.',
  },
  wall: {
    title: 'Walls move too',
    body: 'Drag a wall to resize the room, or give it a colour in the panel on the right. Every other piece stays where it is.',
  },
};

function HelpDock() {
  const dragging = useStudio((s) => s.draggingId);
  const selectedWall = useStudio((s) => s.selectedWall);

  const [open, setOpen] = useState(false);
  const [coach, setCoach] = useState<CoachId | null>(null);
  const seen = useRef<Partial<Record<CoachId, boolean>>>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    for (const id of Object.keys(COACH_KEY) as CoachId[]) {
      seen.current[id] = localStorage.getItem(COACH_KEY[id]) === '1';
    }
  }, []);

  function fire(id: CoachId) {
    if (seen.current[id]) return;
    seen.current[id] = true;
    localStorage.setItem(COACH_KEY[id], '1');
    setCoach(id);
  }

  // On release, not on grab: appearing mid-gesture would both distract and force
  // a re-render in the middle of a drag.
  const wasDragging = useRef(false);
  useEffect(() => {
    if (!dragging && wasDragging.current) fire('drag');
    wasDragging.current = !!dragging;
  }, [dragging]);

  useEffect(() => {
    if (selectedWall !== null) fire('wall');
  }, [selectedWall]);

  // Esc closes help before it reaches the global "deselect" binding. Capture on
  // window runs first and stops the event from ever bubbling back there.
  useEffect(() => {
    if (!open && !coach) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Escape belongs to a field being edited, or to a dialog in front of us,
      // before it belongs to a hint.
      if (isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      if (coach) setCoach(null);
      else {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, coach]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        // Above the canvas panels, always: this is the only place the studio
        // explains itself, and the catalog used to paint straight over it.
        zIndex: 'var(--z-canvas-hint)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
        maxWidth: 'min(340px, calc(100% - 24px))',
      }}
    >
      {coach && (
        <div
          className="ds-card"
          role="note"
          style={{ padding: '11px 12px 12px 14px', boxShadow: 'var(--shadow-lift)' }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>
              {COACH_COPY[coach].title}
            </span>
            <button
              onClick={() => setCoach(null)}
              className="ds-btn ds-btn--ghost"
              style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--accent-text)' }}
            >
              Got it
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 3 }}>
            {COACH_COPY[coach].body}
          </div>
        </div>
      )}

      {open && <ShortcutCard onClose={() => { setOpen(false); btnRef.current?.focus(); }} />}

      {/* A question mark, not a sentence. This corner shares an edge with the
          centred selection bar, and "How this works" spent 150px saying what the
          universal glyph says in 30 — on a control most people press once. The
          accessible name still carries the words. */}
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="How this works"
        title="How this works"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 'var(--r-full)',
          cursor: 'pointer',
          border: `1px solid ${open ? 'var(--accent-text)' : 'var(--edge)'}`,
          background: open ? 'var(--accent-tint)' : 'var(--paper)',
          color: open ? 'var(--accent-text)' : 'var(--ink-2)',
          boxShadow: 'var(--shadow-soft)',
        }}
      >
        <Icon name="help" size={15} />
      </button>
    </div>
  );
}

function ShortcutCard({ onClose }: { onClose: () => void }) {
  return (
    <HelpCard title="How this works" onClose={onClose}>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to slide it around the floor. It stops against whatever is in the way.</HelpLine>
        <HelpLine>Scroll while you are dragging to spin the piece.</HelpLine>
        <HelpLine>
          Shift-click a second piece, then <b>Merge</b>, and they move as one.
        </HelpLine>
        <HelpLine>Double-click a wardrobe or a nightstand to open its doors and drawers.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Walls and the room">
        <HelpLine>Click a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Getting around">
        <HelpLine>Left-drag to orbit, right-drag to pan, scroll to zoom.</HelpLine>
        <HelpLine>
          <Kb>↑</Kb>
          <Kb>↓</Kb>
          <Kb>←</Kb>
          <Kb>→</Kb> pan the camera · <Kb>Q</Kb>
          <Kb>E</Kb> swing it round
        </HelpLine>
      </HelpGroup>

      <HelpGroup title="Keys" note="Click the room first — these stay quiet while you are using a panel.">
        <HelpLine>
          <Kb>W</Kb> move · <Kb>S</Kb> resize · <Kb>R</Kb> spin
        </HelpLine>
        <HelpLine>
          <Kb>F</Kb> fly to the selection · <Kb>V</Kb> hide it · <Kb>Esc</Kb> deselect
        </HelpLine>
        <HelpLine>
          <Kb>Del</Kb> remove the selection · <Kb>Ctrl</Kb>
          <Kb>D</Kb> duplicate · <Kb>Ctrl</Kb>
          <Kb>A</Kb> select everything
        </HelpLine>
        <HelpLine>
          <Kb>Ctrl</Kb>
          <Kb>Z</Kb> undo · add <Kb>Shift</Kb> to redo
        </HelpLine>
      </HelpGroup>
    </HelpCard>
  );
}

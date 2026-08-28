'use client';

// The studio's one help surface, for both tabs, in the top bar.
//
// It used to hold the canvas's bottom-left corner permanently — a 30px button
// most people press once, defending a slot with `--z-canvas-hint` so no panel
// could bury it. Moving it to the top bar frees that corner and puts it where
// every other tool keeps help.
//
// The risk of moving it is discoverability, so the COACH MARKS now anchor here
// too. They still fire on the first drag and the first wall-selection — the two
// gestures whose power features are otherwise invisible — but they now appear
// under the "?" they are teaching you to find. One hint, two jobs.
//
// Both tabs' shortcut content lives here rather than in either page, because the
// two used to describe the same app differently and nobody comparing them was
// looking at both.

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useStudio } from '@/lib/store';
import { Icon } from '@/components/ui/Icon';
import { HelpCard, HelpGroup, HelpLine, Kb } from './HelpCard';
import { planHelp } from './PlanChrome';
import { isTypingOrDialog } from './KeyboardShortcuts';

type CoachId = 'drag' | 'wall';

const COACH_KEY: Record<CoachId, string> = {
  drag: 'danmu-coach-drag',
  wall: 'danmu-coach-wall',
};

const COACH_COPY: Record<CoachId, { title: string; body: string }> = {
  drag: {
    title: 'While you are dragging',
    body: 'Scroll to spin the piece as it moves, and it will nudge up against whatever it bumps into. Snap, at the top of the room, keeps it on tidy steps.',
  },
  wall: {
    title: 'Walls move too',
    body: 'Drag a wall to resize the room, or give it a colour in the panel on the right. Every other piece stays where it is.',
  },
};

export function StudioHelp() {
  const pathname = usePathname();
  const onModel = pathname?.endsWith('/model') ?? false;

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
      // See ExportMenu: a plain stop still lets a sibling capture listener on
      // window fire, so one Esc closed both popovers.
      e.stopImmediatePropagation();
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
    <div style={{ position: 'relative', display: 'flex' }}>
      {/* A question mark, not a sentence. "How this works" spent 150px saying what
          the universal glyph says in 30, on a control most people press once. The
          accessible name still carries the words. */}
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="How this works"
        title="How this works"
        className="icon-btn"
        style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--r-full)',
          border: `1px solid ${open || coach ? 'var(--accent-text)' : 'var(--edge)'}`,
          background: open || coach ? 'var(--accent-tint)' : 'var(--paper)',
          color: open || coach ? 'var(--accent-text)' : 'var(--ink-2)',
        }}
      >
        <Icon name="help" size={14} />
      </button>

      {coach && (
        <div
          className="ds-card"
          role="note"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            // Anchored to its right edge, so it grows LEFT — and at a flat 300 it
            // grew straight off a narrow window. 100vw rather than 100%, because
            // the trigger it hangs from is a 28px button.
            width: 'min(300px, calc(100vw - 32px))',
            padding: '11px 12px 12px 14px',
            boxShadow: 'var(--shadow-lift)',
            textAlign: 'left',
          }}
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

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            textAlign: 'left',
          }}
        >
          <HelpCard
            title="How this works"
            onClose={() => {
              setOpen(false);
              btnRef.current?.focus();
            }}
          >
            {onModel ? <ModelHelp /> : planHelp()}
          </HelpCard>
        </div>
      )}
    </div>
  );
}

function ModelHelp() {
  return (
    <>
      <HelpGroup title="Moving furniture">
        <HelpLine>Drag a piece to slide it around the floor. It stops against whatever is in the way.</HelpLine>
        <HelpLine>Scroll while you are dragging to spin the piece.</HelpLine>
        <HelpLine>
          Shift-click a second piece and drag either one — the whole selection moves together. <b>Group</b> makes
          that stick: a grouped set comes back as one piece the next time you click it.
        </HelpLine>
        <HelpLine>Double-click a wardrobe or a nightstand to open its doors and drawers.</HelpLine>
        <HelpLine>
          Where pieces overlap, <Kb>Alt</Kb>-click lists everything under the pointer so you can pick the one you
          meant — and <Kb>Alt</Kb>-clicking again steps down through them. Add <Kb>Shift</Kb> to take one into the
          selection instead of replacing it.
        </HelpLine>
      </HelpGroup>

      <HelpGroup title="The lists on the left">
        <HelpLine>
          <b>Catalog</b> is what is in this room; <b>Library</b> is what you can add.
        </HelpLine>
        <HelpLine>
          In either list, <Kb>Shift</Kb>-click picks a run of rows at once, and <Kb>Ctrl</Kb>-click adds that
          piece to the room.
        </HelpLine>
      </HelpGroup>

      <HelpGroup title="Walls and the room">
        <HelpLine>Click a wall to pick a colour for it. Drag it to make the room bigger or smaller.</HelpLine>
      </HelpGroup>

      <HelpGroup title="Getting around">
        <HelpLine>Left-drag to orbit, scroll to zoom.</HelpLine>
        <HelpLine>
          Hold <Kb>Space</Kb> and drag to slide the whole view across.
        </HelpLine>
        <HelpLine>Right-click a piece — or the room — for what you can do to it.</HelpLine>
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
          <Kb>F</Kb> fly to the selection · <Kb>H</Kb> hide it · <Kb>Esc</Kb> put a drag back, or deselect
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
    </>
  );
}

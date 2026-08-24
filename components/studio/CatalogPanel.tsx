'use client';

// Adding pieces — ONE surface, two triggers.
//
// There used to be two. The rail's "Add furniture" opened a 520px modal with a
// Catalog / Describe-it pair over `PART_LIBRARY` + real-product presets; the
// canvas had a floating strip with its own grouped list over `PART_LIBRARY`
// alone. Same feature, two component trees, two item lists — and only the strip
// could drag a piece onto the floor, while only the modal could take a piece
// described in words. Whichever one you found first was missing something.
//
// What is left is the strip, because a modal cannot be dragged out of: it covers
// the room you are placing pieces into, and the drop point is the whole reason
// the canvas accepts a drag at all. It carries the modal's Describe-it tab and the
// modal's full item list, and both triggers (`AddPiecesButton` in the rail,
// `CatalogToggle` on the canvas) open this one panel through `useStudio`.

import { useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { searchLibrary, parseDims } from '@/lib/shape-search';
import { clampDims } from '@/lib/dimension-ranges';
import { placeNewPart, type LibraryItem, type ScenePart } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { LibraryPicker, PickerTabs, DescribeField, type PickerTab } from './LibraryPicker';
import { isTypingOrDialog } from './KeyboardShortcuts';

/** The id the pages put on their canvas element, so the rail's trigger can bring
 *  the panel into view when the studio is stacked and the rail sits below the
 *  room. Without it, pressing Add on a narrow window opens a panel off-screen. */
export const STUDIO_CANVAS_ID = 'studio-canvas';

/** Rail trigger — the labelled one, in the Furniture section. */
export function AddPiecesButton() {
  const open = useStudio((s) => s.catalogOpen);
  const setOpen = useStudio((s) => s.setCatalogOpen);
  return (
    <button
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (!next) return;
        // The CSS reduced-motion block cannot reach a JS-requested smooth scroll.
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document
          .getElementById(STUDIO_CANVAS_ID)
          ?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      }}
      aria-expanded={open}
      title="Browse the catalog, or describe the piece you want"
      className="ds-btn"
      style={{
        width: '100%',
        height: 32,
        fontSize: 12,
        justifyContent: 'center',
        background: 'var(--accent-tint)',
        // --accent as type on --accent-tint measures 2.89:1; --accent-text is
        // the accent-coloured ink that clears 4.5:1 on the same tint.
        borderColor: 'var(--accent-text)',
        color: 'var(--accent-text)',
      }}
    >
      {/* The label says the action, not the state: a button that reads "Catalog is
          open" is a status line you can press. */}
      <Icon name={open ? 'x' : 'plus'} size={12} />
      {open ? 'Close catalog' : 'Browse catalog'}
    </button>
  );
}

/** Canvas trigger — sits in the top-left toolbar with the other controls that
 *  change a piece, rather than floating on its own. */
export function CatalogToggle() {
  const open = useStudio((s) => s.catalogOpen);
  const setOpen = useStudio((s) => s.setCatalogOpen);
  return (
    <button
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className="ds-btn"
      title="Browse furniture — drag a piece into the room, or click to drop it in the centre"
      style={{
        height: 30,
        fontSize: 12,
        fontWeight: 700,
        gap: 6,
        // It sits in `CanvasTools`, which wraps. Holding its width there is what
        // sends it to a row of its own rather than letting it be compressed to
        // an icon and half a word.
        flexShrink: 0,
        background: open ? 'var(--accent-tint)' : 'var(--paper)',
        borderColor: open ? 'var(--accent-text)' : 'var(--edge)',
        color: open ? 'var(--accent-text)' : 'var(--ink-2)',
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      <Icon name="plus" size={12} /> Catalog
    </button>
  );
}

/** Gravity-aware spawn: wall-hung items mount at height, everything else rests on
 *  the floor or on whatever surface is under it. Shared by both tabs — the piece
 *  you picked and the piece you described land the same way. */
function spawn(category: ScenePart['category'], shape: ScenePart['shape'], dimMM: [number, number, number], name: string) {
  const { room, parts, addPart } = useScene.getState();
  const { pos, wallMounted } = placeNewPart(category, shape, dimMM, room, parts);
  const id = `${category}-${uuid().slice(0, 6)}`;
  addPart({ id, category, name, shape, pos, rot: 0, dimMM, locked: false, wallMounted });
  useStudio.getState().setSelected(id);
}

/** Floating, non-blocking model catalog docked on the left edge of the
 *  viewport. Items can be DRAGGED onto the 3D room (Room's onDrop raycasts the
 *  drop point) or CLICKED to drop at room centre. Deliberately a narrow strip so
 *  the rest of the canvas stays a valid drop target. */
export function CatalogPanel({
  /** false on the 2D plan, which has no drop handler — see LibraryPicker. */
  canDrag = false,
  /** How far to stop short of the bottom edge. The 3D tab keeps only the 30px
   *  help button down there; the plan stacks help ON TOP of its zoom toolbar, so
   *  the default clears one control and this panel sat over the other. */
  bottomGap = 56,
}: {
  canDrag?: boolean;
  bottomGap?: number;
}) {
  const setOpen = useStudio((s) => s.setCatalogOpen);
  const [tab, setTab] = useState<PickerTab>('library');
  const [prompt, setPrompt] = useState('');

  // Esc closes it, like every other panel in the studio (Look, Room, help). It
  // yields to a field being edited or a dialog in front — so Esc out of the search
  // box goes to the box, not to the panel around it — and it stops the event from
  // reaching the canvas, whose global Esc means "deselect".
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || isTypingOrDialog(e.target)) return;
      e.stopPropagation();
      setOpen(false);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setOpen]);

  // Live local matches — recomputed as the user types. No network involved.
  const matches = searchLibrary(prompt, 6);

  function addItem(item: LibraryItem) {
    spawn(item.category, item.shape, [...item.dimMM], item.label);
  }

  // Spawn a match with any explicit sizes from the description applied
  // ("queen bed 160x200cm" → those dims, clamped into the trustable range).
  function addMatch(item: LibraryItem) {
    const o = parseDims(prompt);
    const dim = clampDims(item.category, item.shape, [
      o.w ?? item.dimMM[0],
      o.d ?? item.dimMM[1],
      o.h ?? item.dimMM[2],
    ]);
    spawn(item.category, item.shape, dim, item.label);
  }

  return (
    <div
      className="ds-card"
      style={{
        position: 'absolute',
        top: 54,
        left: 12,
        // Stops short of the bottom-left corner: the studio's help button lives
        // there, and this panel used to sit on top of it.
        bottom: bottomGap,
        // Capped against the canvas, not just stated: at 268px flat this covered
        // two thirds of a stacked layout's room, and you cannot drag a piece into
        // a room the panel you are dragging from is sitting on.
        width: 'min(268px, calc(100% - 24px))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 'var(--z-canvas-ui)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 8px' }}>
        <span className="ds-label" style={{ flex: 1 }}>Add pieces</span>
        <IconButton icon="x" label="Close catalog" onClick={() => setOpen(false)} size={24} iconSize={12} />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <PickerTabs tab={tab} onChange={setTab} style={{ width: '100%' }} />
      </div>

      {tab === 'library' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 12px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', margin: '0 0 8px', lineHeight: 1.4 }}>
            {canDrag
              ? 'Drag a piece into the room, or click to drop it in the centre.'
              : 'Click a piece to drop it into the middle of the room.'}
          </div>
          <LibraryPicker onPick={addItem} columns={1} draggable={canDrag} maxHeight={null} />
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px 12px' }}>
          <p style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45, margin: '0 0 8px' }}>
            Type what you want — sizes included (&quot;180cm wide&quot;) carry into the piece.
          </p>
          <DescribeField
            value={prompt}
            onChange={setPrompt}
            label="Describe the piece you want"
            placeholder={'e.g. "tall mirror 1700mm" or "queen bed 160x200cm"'}
          />
          {matches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {matches.map((m) => (
                <button
                  key={m.label}
                  onClick={() => addMatch(m)}
                  className="ds-btn"
                  style={{ height: 32, fontSize: 12, justifyContent: 'space-between', paddingLeft: 10 }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Icon name="plus" size={11} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
                    {m.dimMM[0]}×{m.dimMM[1]}×{m.dimMM[2]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {prompt.trim().length > 1 && matches.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '4px 0', lineHeight: 1.5 }}>
              Nothing matches yet — keep typing, or browse the Catalog tab.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

// The phone app bar's one overflow menu. Apple's toolbar guidance for a compact
// width is to "prioritize only the most important items… create a More menu to
// include additional items"; Material's top app bar does the same with its three
// dots. What lives here is what a phone uses least: the help card and the three
// exports. (The laptop's View gear is the phone toolbar's own View sheet.) Switching rooms is not here at all — the app bar's back button is that
// route, one tap, and a second way to the same place is a row nobody needs.
//
// Snap lives here on a phone too. It is set once and left, which is what this
// menu is for, and on the canvas it took a second row of its own over the room.
// Here it reaches the 2D tab as well, which never had a way to change it.

import { useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/primitives';
import { useStudio } from '@/lib/store';
import { useExportItems } from './ExportMenu';
import { StudioHelp } from './StudioHelp';
import { SNAPS } from './TransformToolbar';
import { usePopoverDismiss } from './usePopoverDismiss';

export function StudioMoreMenu() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const items = useExportItems();
  const snapMode = useStudio((s) => s.snapMode);
  const setSnapMode = useStudio((s) => s.setSnapMode);
  const snap = SNAPS.find((x) => x.id === snapMode)!;
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  usePopoverDismiss(open, () => setOpen(false), wrapRef, btnRef);

  return (
    <div ref={wrapRef} className="popover-anchor">
      <button
        ref={btnRef}
        type="button"
        className="icon-btn app-bar__btn"
        aria-label="More"
        title="More"
        aria-expanded={open}
        onClick={() => {
          setHelp(false);
          setOpen((v) => !v);
        }}
      >
        <Icon name="more" size={20} />
      </button>
      {/* Mounted with no trigger of its own: the card opens from the row below. */}
      <StudioHelp hideTrigger open={help} onOpenChange={setHelp} />
      {/* A group of buttons, not role="menu" — the same decision, for the same
          reason, as ExportMenu's: a menu promises arrow-key roving focus. */}
      {open && (
        <div role="group" aria-label="More" className="popover more-menu">
          <button
            type="button"
            className="menu-row"
            onClick={() => {
              setOpen(false);
              setHelp(true);
            }}
          >
            <Icon name="help" size={18} />
            <span className="menu-row__text">
              <span className="menu-row__label">How this works</span>
            </span>
          </button>
          <div className="ds-label more-menu__heading">Snap when dragging</div>
          <div className="more-menu__field">
            <Segmented
              ariaLabel="Snap when dragging"
              options={SNAPS.map((x) => ({ value: x.id, label: x.label }))}
              value={snapMode}
              onChange={setSnapMode}
              size={44}
              stretch
            />
            <span className="t-hint">{snapHint(snap.id, snap.sub)}</span>
          </div>
          <div className="ds-label more-menu__heading">Export</div>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              className="menu-row"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} size={18} />
              <span className="menu-row__text">
                <span className="menu-row__label">{it.label}</span>
                <span className="t-hint">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "10mm · 15°" as a sentence, from the same table the laptop's chip reads. */
function snapHint(id: string, sub: string): string {
  if (id === 'off') return 'Pieces go exactly where you let go.';
  const [move, turn] = sub.split(' · ');
  return `Moves in ${move} steps, turns in ${turn}.`;
}

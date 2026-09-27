'use client';

// The phone app bar's one overflow menu. Apple's toolbar guidance for a compact
// width is to "prioritize only the most important items… create a More menu to
// include additional items"; Material's top app bar does the same with its three
// dots. What lives here is what a phone uses least: the help card and the three
// exports. Switching rooms is not here at all — the app bar's back button is that
// route, one tap, and a second way to the same place is a row nobody needs.

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useExportItems } from './ExportMenu';
import { StudioHelp } from './StudioHelp';

export function StudioMoreMenu() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const items = useExportItems();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // See ExportMenu: a plain stop still lets a sibling capture listener fire.
      e.stopImmediatePropagation();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex' }}>
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
      {/* Mounted with no trigger of its own: the card opens from the row below, and
          the component is also what shows the one-time coach notes. */}
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

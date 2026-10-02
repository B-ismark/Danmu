'use client';

// How the room is DRAWN, behind a gear in the top bar.
//
// These four controls (floor grid, decor, sounds, quality) were the right rail's
// last section, "View". They were set once and then left alone, and they sat in the
// panel whose job is the selected piece. With a piece selected they were pushed
// below the fold; with nothing selected they were the only thing in the panel, so
// an empty Inspector looked like a settings page. Neither is what the panel is for.
//
// A top-bar gear is where every tool people already know keeps this kind of thing:
// Figma's View menu, Spline's and Blender's viewport overlays, a browser's page
// settings. It is next to Help, the other control you use once and walk away from,
// and it is on BOTH tabs, where the rail's View section only ever reached the tab
// that had a rail open.
//
// It is a popover and not a rail section, and that does not break the rule in
// Design.md that a rail section's body is inline. That rule is about a card opened
// INSIDE a rail's clipping box. This one hangs from the top bar the way Export's
// does, over nothing that clips it.
//
// A phone has no room in its top bar for a second trigger, so there the same
// `ViewOptions` is its own sheet, opened from the toolbar's View button
// (`SheetShell`).

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { ViewOptions } from './ViewOptions';
import { usePopoverDismiss } from './usePopoverDismiss';
import { settingsHref } from '@/lib/settings-return';

export function ViewMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, () => setOpen(false), wrapRef, btnRef);

  return (
    <div ref={wrapRef} className="popover-anchor">
      {/* Drawn as Help's twin, the round outlined button beside it, because the
          two are the same kind of control: one you open, read, and close. No
          aria-haspopup, for ExportMenu's reason: this is a group of controls, not a
          menu with roving focus. */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="View settings"
        title="View settings"
        className="icon-btn icon-btn--round"
      >
        <Icon name="eye" size={14} />
      </button>

      {open && (
        <div role="group" aria-label="View settings" className="popover view-menu">
          <div className="view-menu__head">
            <span className="section-title">View</span>
          </div>
          <div className="view-menu__body">
            <ViewOptions />
          </div>
          {/* Units and the detection key live on the settings page. They are app
              settings rather than view settings, and a second copy of them here
              would be a second place to keep in step. */}
          <Link href={settingsHref(pathname)} className="view-menu__foot" onClick={() => setOpen(false)}>
            <span>Units, detection and storage</span>
            <Icon name="arrow-right" size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, type ReactNode } from 'react';
import { useStudio } from '@/lib/store';
import { TopBar } from '@/components/studio/TopBar';
import { StudioTabs } from '@/components/studio/StudioTabs';
import { RoomSync } from '@/components/studio/RoomSync';
import {
  KeyboardShortcuts,
  StudioAnnouncer,
  studioSurfaceProps,
} from '@/components/studio/KeyboardShortcuts';
import { RoomSwitcher } from '@/components/studio/RoomSwitcher';
import { StudioHelp } from '@/components/studio/StudioHelp';
import { ExportMenu } from '@/components/studio/ExportMenu';
import { NarrowViewportBanner } from '@/components/studio/NarrowViewportBanner';
import { DemoBanner } from '@/components/studio/DemoBanner';

export default function StudioLayout({ children }: { children: ReactNode }) {
  const surface = studioSurfaceProps();

  // The catalog is open state, not a preference, and it lives in a store that
  // outlives the route. Without this, opening the catalog in one room and leaving
  // meant the next room you opened had a panel over its canvas that you never
  // asked for. Cleared here rather than in a page so switching 3D ↔ 2D — which
  // keeps this layout mounted — leaves it open, which is the point of it being
  // shared in the first place.
  useEffect(() => () => useStudio.getState().setCatalogOpen(false), []);
  return (
    // dvh, not vh: on mobile browsers vh includes the collapsing URL bar, so the
    // bottom row of studio chrome sat under it.
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <TopBar
        // flexShrink: 0 — the bar wraps rather than squeezes, and these two are
        // the studio's whole navigation; they move to a second row intact before
        // they give up a pixel of label.
        centerSlot={<div style={{ marginLeft: 2, flexShrink: 0 }}><StudioTabs /></div>}
        // Five controls became three, and none of them claims to be the primary
        // action any more. Undo/redo moved to the canvas's top-right with the view
        // controls (where Drafted groups it); Rescan moved into the rail's Room
        // section, because it changes what is IN the room rather than how the app
        // is framed; and Snapshot, the plan PNG and the scene file are all items
        // inside Export — downloading a PNG is not the primary verb of a
        // decoration app, and sibling download buttons are how you end up not
        // knowing the other ones exist.
        right={
          <>
            <StudioHelp />
            <RoomSwitcher />
            <ExportMenu />
          </>
        }
      />
      {/* A full-width strip under the top bar, so it can never overlap the
          canvas toolbars the way the old floating pill did. */}
      <DemoBanner />
      {/* The work surface. It is focusable and takes focus on a press that isn't
          on a control — that is what scopes the studio's single-character
          shortcuts to the room instead of the whole window. */}
      <div {...surface} style={{ ...surface.style, flex: 1, minHeight: 0 }}>
        {children}
      </div>
      <RoomSync />
      <KeyboardShortcuts />
      <StudioAnnouncer />
      <NarrowViewportBanner />
    </div>
  );
}

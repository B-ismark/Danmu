'use client';

import type { ReactNode } from 'react';
import { TopBar } from '@/components/studio/TopBar';
import { StudioTabs } from '@/components/studio/StudioTabs';
import { RoomSync } from '@/components/studio/RoomSync';
import {
  KeyboardShortcuts,
  StudioAnnouncer,
  studioSurfaceProps,
} from '@/components/studio/KeyboardShortcuts';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { RoomSwitcher } from '@/components/studio/RoomSwitcher';
import { NarrowViewportBanner } from '@/components/studio/NarrowViewportBanner';
import { DemoBanner } from '@/components/studio/DemoBanner';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSnapshot } from '@/lib/snapshot';

export default function StudioLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onModel = pathname?.endsWith('/model') ?? false;
  const surface = studioSurfaceProps();
  return (
    // dvh, not vh: on mobile browsers vh includes the collapsing URL bar, so the
    // bottom row of studio chrome sat under it.
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <TopBar
        centerSlot={<div style={{ marginLeft: 16 }}><StudioTabs /></div>}
        right={
          <>
            <UndoRedo />
            <RoomSwitcher />
            <Link href="/onboarding/detect" className="ds-btn" style={{ height: 28, fontSize: 12 }}>
              <Icon name="refresh" size={12} />
              Rescan
            </Link>
            {onModel && (
              <button
                onClick={() => useSnapshot.getState().request()}
                className="ds-btn ds-btn--primary"
                style={{ height: 28, fontSize: 12 }}
                title="Download a PNG of the current 3D view"
              >
                <Icon name="image" size={12} />
                Snapshot
              </button>
            )}
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

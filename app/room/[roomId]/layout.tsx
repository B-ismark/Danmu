'use client';

import type { ReactNode } from 'react';
import { TopBar } from '@/components/studio/TopBar';
import { StudioTabs } from '@/components/studio/StudioTabs';
import { RoomSync } from '@/components/studio/RoomSync';
import { KeyboardShortcuts } from '@/components/studio/KeyboardShortcuts';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { RoomSwitcher } from '@/components/studio/RoomSwitcher';
import { NarrowViewportBanner } from '@/components/studio/NarrowViewportBanner';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function StudioLayout({ children }: { children: ReactNode }) {
  const { roomId } = useParams<{ roomId: string }>();
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
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
            <Link
              href={`/room/${roomId}/compose`}
              className="ds-btn ds-btn--primary"
              style={{ height: 28, fontSize: 12 }}
            >
              <Icon name="image" size={12} />
              Preview
            </Link>
          </>
        }
      />
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      <RoomSync />
      <KeyboardShortcuts />
      <NarrowViewportBanner />
    </div>
  );
}

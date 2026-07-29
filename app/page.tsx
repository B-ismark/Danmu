'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { roomStore } from '@/lib/storage';

// Entry: route on whether the user has any rooms — NOT on whether they have an
// AI key. The 3D studio is the product; AI detection is optional. A first-time
// visitor (no rooms) sees the intro; a returning one drops straight into their
// workspace. Key presence never blocks entry.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hasRooms = false;
      try {
        const rooms = await roomStore.listRooms();
        hasRooms = rooms.length > 0;
      } catch {
        hasRooms = false;
      }
      if (cancelled) return;
      router.replace(hasRooms ? '/workspace' : '/onboarding/welcome');
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return (
    <div
      // role=status so the redirect is announced instead of leaving a screen
      // reader on a silent blank page. 13px/--ink-2 rather than a whisper: this
      // is the very first thing a visitor sees, and it has to be legible.
      role="status"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-2)',
        fontSize: 13,
      }}
    >
      Danmu · Opening your rooms…
    </div>
  );
}

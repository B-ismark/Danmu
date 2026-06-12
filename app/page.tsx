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
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-3)',
        fontSize: 11,
      }}
    >
      Danmu · Loading…
    </div>
  );
}

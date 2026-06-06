'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRoom, useSettings } from '@/lib/store';

// Entry: route based on user state.
// No key → /onboarding/welcome. Key + roomId → /room/[id]/model. Key, no roomId → /workspace.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const hasKey = !!useSettings.getState().apiKey;
    if (!hasKey) router.replace('/onboarding/welcome');
    else router.replace('/workspace');
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

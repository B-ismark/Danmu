'use client';

import { useEffect } from 'react';
import { useRouter, usePathname, useParams } from 'next/navigation';

import { Icon, type IconName } from '@/components/ui/Icon';

const TABS: Array<{ id: 'plan' | 'model'; label: string; icon: IconName }> = [
  { id: 'plan', label: '2D Plan', icon: 'grid' },
  { id: 'model', label: '3D Model', icon: 'cube' },
];

export function StudioTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ roomId: string }>();
  const active = TABS.find((t) => pathname?.includes(`/${t.id}`))?.id ?? 'model';

  // Prefetch BOTH tabs, not just the inactive one.
  //
  // These are routes, not panels: switching unmounts one page and mounts the other,
  // and `router.push` on a route whose chunk is not in memory pays for the fetch
  // before anything can render. `<Link>` would have prefetched on its own — these are
  // buttons because the switcher used to be one and `aria-current` is the right
  // affordance for "the page you are on" — so the prefetch has to be asked for.
  //
  // This is the cheap half of the tab-switch cost and it is honest about being that:
  // the expensive half is that leaving `/model` destroys the WebGL context, every
  // geometry and material, and every compiled shader, and a prefetch does nothing
  // about any of it. Fixing that means the canvas outliving the route, which is a
  // structural change and wants its own diff.
  useEffect(() => {
    const id = params.roomId;
    if (!id) return;
    for (const t of TABS) router.prefetch(`/room/${id}/${t.id}`);
  }, [router, params.roomId]);

  return (
    <nav
      aria-label="Studio views"
      style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--paper-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-2)' }}
    >
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => router.push(`/room/${params.roomId}/${t.id}`)}
            // These navigate — they are not toggles. aria-pressed told a screen
            // reader the button was "not pressed" while it was the page you were
            // already on.
            aria-current={isActive ? 'page' : undefined}
            style={{
              height: 28,
              padding: '0 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isActive ? 'var(--ink)' : 'transparent',
              color: isActive ? 'var(--paper)' : 'var(--ink-2)',
              border: 'none',
              borderRadius: 'var(--r-1)',
              fontFamily: 'var(--font-sans)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

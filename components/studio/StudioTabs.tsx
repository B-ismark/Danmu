'use client';

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
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--paper-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-2)' }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => router.push(`/room/${params.roomId}/${t.id}`)}
          aria-pressed={active === t.id}
          style={{
            height: 28,
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: active === t.id ? 'var(--ink)' : 'transparent',
            color: active === t.id ? 'var(--paper)' : 'var(--ink-2)',
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
      ))}
    </div>
  );
}

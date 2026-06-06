'use client';

// Listens for `danmu:storage-full` (dispatched from lib/storage.ts when IndexedDB
// throws QuotaExceededError) and shows a dismissible banner with cleanup guidance.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

export function StorageToast() {
  const [visible, setVisible] = useState(false);
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    function onFull(e: Event) {
      const ce = e as CustomEvent<string>;
      setDetail(ce.detail ?? '');
      setVisible(true);
    }
    window.addEventListener('danmu:storage-full', onFull);
    return () => window.removeEventListener('danmu:storage-full', onFull);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background: 'var(--paper)',
          border: '1px solid var(--danger)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          maxWidth: 560,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        <span className="ds-label" style={{ color: 'var(--danger)', marginTop: 3 }}>
          ⚠ Storage full
        </span>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>
          Browser ran out of room. Delete unused rooms or render variants to make space.
          {detail && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', marginTop: 4 }}>
              {detail.slice(0, 140)}
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <Link
              href="/workspace"
              onClick={() => setVisible(false)}
              className="ds-btn"
              style={{ height: 26, fontSize: 11 }}
            >
              Manage rooms
            </Link>
            <button
              onClick={() => setVisible(false)}
              className="ds-btn"
              style={{ height: 26, fontSize: 11 }}
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  );
}

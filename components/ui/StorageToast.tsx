'use client';

// The app's single toast host. Two jobs:
//
//  1. The storage-full banner — listens for `danmu:storage-full`, dispatched
//     from lib/storage.ts when IndexedDB throws QuotaExceededError.
//  2. A generic `toast()` any surface can call. This is what makes an *undoable*
//     delete possible: now that roomStore.clearRoom soft-deletes, the reversal
//     needs somewhere to be offered, and a confirmation of what happened needs
//     somewhere to appear that isn't a full page reload.
//
// Mounted once in app/layout.tsx (still exported as `StorageToast`, its original
// name, so the layout doesn't have to change).
//
// The live region is the only one in the app, and it is deliberately mounted at
// all times even when empty: a screen reader announces *changes* inside an
// existing live region, so injecting the region and its content in the same
// commit — which is what `if (!visible) return null` used to do — is unreliable.

import { useEffect } from 'react';
import { create } from 'zustand';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconButton } from './primitives';

export type ToastTone = 'neutral' | 'danger' | 'success';

export type ToastSpec = {
  tone?: ToastTone;
  /** short lead, e.g. "Room deleted" — carries the outcome on its own */
  title: string;
  message?: string;
  /** raw technical text (an exception). Small, wrapped, never the main message. */
  detail?: string;
  /** one recovery action, e.g. Undo */
  action?: { label: string; onClick: () => void };
  link?: { label: string; href: string };
  /** ms before auto-dismiss. 0 = sticky — an error the user hasn't read yet
   *  must not vanish on a timer. Defaults: danger sticky, everything else 9s. */
  ttl?: number;
};

type Toast = ToastSpec & { id: number; tone: ToastTone; ttl: number };

let seq = 0;

type ToastState = {
  items: Toast[];
  push: (t: ToastSpec) => number;
  dismiss: (id: number) => void;
};

const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    const tone = t.tone ?? 'neutral';
    const ttl = t.ttl ?? (tone === 'danger' ? 0 : 9000);
    // Cap the stack: a cleanup session that deletes twenty rooms should not
    // bury the page under twenty banners.
    set((s) => ({ items: [...s.items, { ...t, id, tone, ttl }].slice(-3) }));
    if (ttl > 0) setTimeout(() => get().dismiss(id), ttl);
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Imperative entry point — callable straight from an event handler or an async
 *  function, no hook and no prop-drilling. */
export function toast(spec: ToastSpec): number {
  return useToasts.getState().push(spec);
}

export function dismissToast(id: number) {
  useToasts.getState().dismiss(id);
}

const TONE: Record<ToastTone, { border: string; lead: string }> = {
  neutral: { border: 'var(--edge)', lead: 'var(--ink)' },
  danger: { border: 'var(--danger)', lead: 'var(--danger-text)' },
  success: { border: 'var(--success)', lead: 'var(--success-text)' },
};

export function StorageToast() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  // The studio parks its dock along the bottom of the canvas (camera presets,
  // Look, Suggest, Room — one row, two when the canvas is narrow enough to wrap
  // it). At the default offset a toast sat on top of it and, because the card
  // takes pointer events, swallowed its clicks — which every delete now raises a
  // toast over. 88 clears the wrapped case, which is the tall one.
  const pathname = usePathname();
  const bottom = pathname?.startsWith('/room/') ? 88 : 16;

  useEffect(() => {
    function onFull(e: Event) {
      const ce = e as CustomEvent<string>;
      toast({
        tone: 'danger',
        title: 'Storage full',
        message: 'Your browser ran out of room, so the last change was not saved. Delete a room you no longer need, then try again.',
        detail: ce.detail ?? '',
        link: { label: 'Manage rooms', href: '/workspace' },
      });
    }
    window.addEventListener('danmu:storage-full', onFull);
    return () => window.removeEventListener('danmu:storage-full', onFull);
  }, []);

  return (
    <div
      aria-live="polite"
      role="status"
      style={{
        position: 'fixed',
        bottom,
        left: 16,
        right: 16,
        zIndex: 'var(--z-toast)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              width: '100%',
              maxWidth: 560,
              background: 'var(--paper)',
              border: `1px solid ${tone.border}`,
              borderRadius: 'var(--r-3)',
              padding: '10px 12px 10px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              boxShadow: 'var(--shadow-lift)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: tone.lead }}>{t.title}</div>
              {t.message && (
                <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 2 }}>
                  {t.message}
                </div>
              )}
              {t.detail && (
                // A 140-char IndexedDB message has no spaces to break on, so it
                // needs an explicit wrap rule or it pushes the card off-screen.
                <div
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    color: 'var(--ink-3)',
                    marginTop: 5,
                    lineHeight: 1.4,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {t.detail.slice(0, 140)}
                </div>
              )}
              {(t.action || t.link) && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {t.action && (
                    <button
                      onClick={() => {
                        dismiss(t.id);
                        t.action?.onClick();
                      }}
                      className="ds-btn"
                      style={{ height: 28, fontSize: 11.5, padding: '0 12px' }}
                    >
                      {t.action.label}
                    </button>
                  )}
                  {t.link && (
                    <Link
                      href={t.link.href}
                      onClick={() => dismiss(t.id)}
                      className="ds-btn"
                      style={{ height: 28, fontSize: 11.5, padding: '0 12px' }}
                    >
                      {t.link.label}
                    </Link>
                  )}
                </div>
              )}
            </div>
            {/* IconButton, not a bare 24px button: .icon-btn::after lifts the hit
                area to 44px without growing the glyph. */}
            <IconButton icon="x" label="Dismiss" onClick={() => dismiss(t.id)} size={24} iconSize={12} />
          </div>
        );
      })}
    </div>
  );
}

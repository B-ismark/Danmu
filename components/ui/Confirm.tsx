'use client';

// Replaces window.confirm() with a branded modal. Promise-based — drop-in usable
// anywhere via the useConfirm() hook. Single host mounted at root layout.

import { create } from 'zustand';
import { Icon } from './Icon';

type ConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger styling on confirm button */
  danger?: boolean;
};

type ConfirmState = {
  pending: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
  open: (req: ConfirmRequest) => Promise<boolean>;
  close: (ok: boolean) => void;
};

const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  open: (req) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { ...req, resolve } });
    }),
  close: (ok) => {
    const p = get().pending;
    if (p) p.resolve(ok);
    set({ pending: null });
  },
}));

export function useConfirm() {
  return useConfirmStore((s) => s.open);
}

export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const close = useConfirmStore((s) => s.close);

  if (!pending) return null;

  const accent = pending.danger ? 'var(--danger)' : 'var(--accent)';
  const confirmStyle: React.CSSProperties = pending.danger
    ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }
    : {};

  return (
    <div
      onClick={() => close(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(19,19,17,0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
        padding: 20,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        style={{
          width: 'min(440px, 92vw)',
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ height: 4, background: accent }} />
        <div style={{ padding: '20px 24px' }}>
          <div
            className="ds-kicker"
            style={{
              color: accent,
              marginBottom: 8,
            }}
          >
            {pending.danger ? '⚠ Confirm' : 'Confirm'}
          </div>
          <div id="confirm-title" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
            {pending.title}
          </div>
          {pending.body && (
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>{pending.body}</p>
          )}
        </div>
        <div
          style={{
            padding: '14px 24px',
            background: 'var(--paper-2)',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            gap: 8,
          }}
        >
          <button
            onClick={() => close(false)}
            className="ds-btn"
            style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}
          >
            <Icon name="x" size={11} />
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={() => close(true)}
            className="ds-btn ds-btn--primary"
            style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center', ...confirmStyle }}
          >
            <Icon name="check" size={11} color="#fff" />
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

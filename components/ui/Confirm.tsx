'use client';

// Replaces window.confirm() with a branded modal. Promise-based — drop-in usable
// anywhere via the useConfirm() hook. Single host mounted at root layout.

import { create } from 'zustand';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Modal } from './Modal';

type ConfirmRequest = {
  title: string;
  /** ReactNode, not string: a destructive confirm has to be able to *enumerate*
   *  what it destroys, and a single run-on sentence is the reason people click
   *  through these dialogs without reading them. */
  body?: ReactNode;
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

/** The same dialog, raised from module scope.
 *
 *  `useConfirm` is a hook and a keyboard accelerator is not a component: the
 *  Delete/Backspace handler lives in a `useEffect` that is installed once and
 *  must not be re-bound, so it cannot close over a hook result without either a
 *  ref dance or re-running the effect. The store underneath is already global —
 *  a single host, a single `pending` — so reading it directly is not a second
 *  source of truth, it is the same one without React in the way.
 *
 *  Deliberately NOT the general escape hatch. Anything rendering a component
 *  should keep using `useConfirm`; this exists for the accelerator layer. */
export function confirmDialog(req: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().open(req);
}

// The room-delete confirm lives here, once, because it is raised from two
// surfaces (a workspace card and Settings) and the two must not drift: on a grid
// of near-identical cards the room's *name* is the only thing preventing a
// wrong-target click, and the blast radius is the only thing that makes the
// dialog worth reading. The previous version named nothing and omitted saved
// layouts entirely.
export function useConfirmDeleteRooms() {
  const confirm = useConfirm();
  return (names: string[]) => {
    const many = names.length > 1;
    return confirm({
      title: many ? `Delete ${names.length} rooms?` : `Delete “${names[0]}”?`,
      body: (
        <>
          <p style={{ margin: '0 0 8px' }}>
            {many ? 'They lose' : 'It loses'} everything saved about {many ? 'them' : 'it'}:
          </p>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18, display: 'grid', gap: 2 }}>
            <li>the shape, size and wall colours</li>
            <li>every wall photo, and everything detected in them</li>
            <li>every piece of furniture and where you put it</li>
            <li>every saved layout variant</li>
          </ul>
          {many && (
            <p style={{ margin: '0 0 8px', color: 'var(--ink-3)' }}>{names.slice(0, 6).join(', ')}{names.length > 6 ? `, and ${names.length - 6} more` : ''}.</p>
          )}
          <p style={{ margin: 0 }}>
            You can undo this straight afterwards, and it stays recoverable for 30 days. After that it is deleted
            permanently.
          </p>
        </>
      ),
      confirmLabel: many ? `Delete ${names.length} rooms` : 'Delete room',
      danger: true,
    });
  };
}

export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const close = useConfirmStore((s) => s.close);

  if (!pending) return null;

  // Destructive confirm = a --danger fill with --on-accent type (4.78:1). Both
  // sides come from tokens so a brand change can't produce white-on-light here.
  const confirmStyle: React.CSSProperties = pending.danger
    ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--on-accent)' }
    : {};

  return (
    <Modal
      onClose={() => close(false)}
      labelledBy="confirm-title"
      width={440}
      blur
      footer={
        <>
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
            {/* no explicit colour — the glyph inherits the button's own
                --on-ink / --on-accent foreground */}
            <Icon name={pending.danger ? 'trash' : 'check'} size={11} />
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div id="confirm-title" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.01em' }}>
        {pending.title}
      </div>
      {pending.body && (
        // div, not p: the body may be a list of what is about to be removed.
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>{pending.body}</div>
      )}
    </Modal>
  );
}

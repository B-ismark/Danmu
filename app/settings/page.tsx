'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSettings, useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { validateKey, type KeyFailure, type KeyResult } from '@/lib/validate-key';
import { UNIT_OPTIONS } from '@/lib/units';
import { quotaLimit, useQuota } from '@/lib/quota';
import { Icon } from '@/components/ui/Icon';
import { Dot, IconButton, Segmented } from '@/components/ui/primitives';
import { useConfirm, useConfirmDeleteRooms } from '@/components/ui/Confirm';
import { DocShell } from '@/components/ui/DocShell';
import { toast } from '@/components/ui/StorageToast';

// Authored copy per failure code. The old screen printed the raw exception,
// `.slice(0, 80)` — which told a user with a perfect key on a flaky connection
// to go replace it, and could echo the provider's request URL (model id and all)
// onto a screen that must never carry one. Each entry names the problem *and*
// the recovery, and says whether the stored key was touched.
const KEY_FAILURE: Record<KeyFailure, { lead: string; help: string }> = {
  empty: {
    lead: 'Nothing to test',
    help: 'Paste your key into the field first.',
  },
  'bad-key': {
    lead: 'Key was rejected',
    help: 'The service did not accept this key. Check it was copied whole — keys are long and easy to truncate — then test again.',
  },
  offline: {
    lead: 'Could not reach the service',
    help: 'Your key was not changed. Check your connection, then test again.',
  },
  'rate-limited': {
    lead: 'Too many checks just now',
    help: 'Nothing is wrong with your key. Wait a minute and test again.',
  },
  unknown: {
    lead: 'Could not finish the check',
    help: 'The service answered in a way Danmu did not expect. Your key was not changed — try again in a moment.',
  },
};

/** A hung request used to leave the button reading "Testing…" for good, because
 *  validateKey takes no abort signal. The UI owns the deadline instead. */
const TEST_TIMEOUT_MS = 15000;

const KEY_INPUT_ID = 'settings-access-key';

export default function SettingsPage() {
  const s = useSettings();
  const roomId = useRoom((r) => r.roomId);
  const setRoomId = useRoom((r) => r.setRoomId);
  const bumpQuota = useQuota((q) => q.bump);
  const confirm = useConfirm();
  const confirmDelete = useConfirmDeleteRooms();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyFocus, setKeyFocus] = useState(false);
  // The danger zone used to act on an unnamed "current room" read from a
  // persisted id — which may be a room last opened weeks ago. Load it so the
  // button can say what it will delete.
  const [room, setRoom] = useState<{ id: string; name: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!roomId) {
        setRoom(null);
        return;
      }
      const r = await roomStore.loadRoom(roomId);
      if (!cancelled) setRoom(r ? { id: r.id, name: r.name } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function test() {
    if (testing || !s.apiKey) return;
    setTesting(true);
    s.setKeyValid(null, null);
    // Testing spends one real request against the same daily allowance
    // detection uses. Counting it here is the difference between "detection
    // stopped working today" being explainable and being a mystery.
    bumpQuota('flash');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race<KeyResult>([
        validateKey(s.apiKey),
        new Promise<KeyResult>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, reason: 'offline' }), TEST_TIMEOUT_MS);
        }),
      ]);
      if (!alive.current) return;
      // Narrow on `ok` before touching `reason` — it only exists on the failure
      // arm of the union.
      if (r.ok) s.setKeyValid(true, null);
      else s.setKeyValid(false, r.reason);
    } finally {
      if (timer) clearTimeout(timer);
      if (alive.current) setTesting(false);
    }
  }

  // Auto-validate on blur if the user has typed a key and we have no result yet.
  async function autoValidate() {
    setKeyFocus(false);
    if (!s.apiKey || s.keyValid !== null || testing) return;
    await test();
  }

  async function removeKey() {
    const ok = await confirm({
      title: 'Remove your detection key?',
      body: 'It is deleted from this browser straight away. Detection stops working until you paste a key again — nothing else in Danmu needs one.',
      confirmLabel: 'Remove key',
      danger: true,
    });
    if (!ok) return;
    s.setApiKey('');
    setShow(false);
    // Deleting the masked text used to be the only way to clear a key, with no
    // confirmation that it had actually left localStorage.
    toast({ tone: 'success', title: 'Key removed', message: 'It is no longer stored in this browser.' });
  }

  async function deleteRoomData() {
    if (!room) return;
    const ok = await confirmDelete([room.name]);
    if (!ok) return;
    // Soft delete, same as the workspace — one path, one recovery story.
    const token = await roomStore.clearRoom(room.id);
    if (roomId === room.id) setRoomId(null);
    setRoom(null);
    toast({
      title: `“${room.name}” deleted`,
      message: 'Recoverable for 30 days.',
      action: {
        label: 'Undo',
        onClick: async () => {
          await roomStore.restoreRoom(token);
          setRoomId(token.roomId);
          toast({ tone: 'success', title: 'Room restored' });
        },
      },
      ttl: 14000,
    });
    // Was location.reload(), which threw away the toast (and any undo with it)
    // and left the user staring at a Settings page for a room that no longer
    // exists.
    router.push('/workspace');
  }

  const failure = KEY_FAILURE[(s.keyValidReason ?? 'unknown') as KeyFailure] ?? KEY_FAILURE.unknown;
  const unitLabel = UNIT_OPTIONS.find((u) => u.id === s.dimUnit)?.label ?? s.dimUnit;
  const dailyDetections = quotaLimit('flash');

  return (
    // "Close" is gone: the breadcrumb's "Rooms" is the way back, and a page that
    // offers two of them is offering a choice nobody needs to make.
    <DocShell trail={[{ label: 'Rooms', href: '/workspace' }, { label: 'Settings' }]} measure="prose">
      <div>
        {/* The route had no heading element at all — no document outline, and the
            display serif (which globals.css hangs off h1/h2/h3) never rendered. */}
        <h1 style={{ fontSize: 30, letterSpacing: '-0.02em', marginBottom: 8 }}>Settings</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, maxWidth: 'var(--measure-text)' }}>
          Everything here is kept in this browser. There is no account to manage.
        </p>

        <SecHeader
          eyebrow="Detection"
          title="Connect a detection key (optional)."
          desc="Used only to recognise furniture in photos of your room. Everything else — the room, the sizes, the arranging — runs on your device and needs no key."
        />

        <Row
          label="Access key"
          controlId={KEY_INPUT_ID}
          hint="Saved in this browser. Danmu has no server to send it to."
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div
              style={{
                flex: '1 1 220px',
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                // --edge, not a 1.48:1 hairline: this is the boundary of the
                // most consequential input on the screen. The focus ring lives
                // on this wrapper because the input's own outline is suppressed
                // (the ring has to surround the eye button too).
                border: `1px solid ${keyFocus ? 'var(--accent-text)' : 'var(--edge)'}`,
                boxShadow: keyFocus ? '0 0 0 4px var(--accent-tint)' : 'none',
                borderRadius: 'var(--r-2)',
                background: 'var(--paper)',
                transition: 'border-color .12s, box-shadow .12s',
              }}
            >
              <input
                id={KEY_INPUT_ID}
                type={show ? 'text' : 'password'}
                value={s.apiKey}
                onChange={(e) => s.setApiKey(e.target.value)}
                onFocus={() => setKeyFocus(true)}
                onBlur={autoValidate}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your key"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  outline: 'none',
                  height: 36,
                  padding: '0 10px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  background: 'transparent',
                  color: 'var(--ink)',
                }}
              />
              <IconButton
                icon={show ? 'eye-off' : 'eye'}
                label={show ? 'Hide key' : 'Show key'}
                onClick={() => setShow(!show)}
                active={show}
                size={36}
                iconSize={13}
              />
            </div>
            <button onClick={test} disabled={testing || !s.apiKey} className="ds-btn" style={{ height: 36, fontSize: 12 }}>
              <Icon name={testing ? 'refresh' : 'check'} size={12} />
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button
              onClick={removeKey}
              disabled={!s.apiKey || testing}
              className="ds-btn"
              style={{ height: 36, fontSize: 12, color: 'var(--danger-text)', borderColor: 'var(--edge)' }}
            >
              <Icon name="trash" size={12} />
              Remove
            </button>
          </div>

          {/* Three states, all real: tested-good, tested-bad (with the reason and
              what to do), and never-tested. */}
          {testing && (
            <div style={{ marginTop: 10 }}>
              <span className="ds-chip" style={{ borderColor: 'var(--edge)', color: 'var(--ink-2)' }}>
                <Dot color="var(--ink-3)" size={5} /> Checking with the service…
              </span>
            </div>
          )}
          {!testing && s.keyValid === true && (
            <div style={{ marginTop: 10 }}>
              <span className="ds-chip" style={{ borderColor: 'var(--success)', color: 'var(--success-text)' }}>
                <Dot color="var(--success)" size={5} /> Working · saved on this device
              </span>
            </div>
          )}
          {!testing && s.keyValid === false && (
            <div style={{ marginTop: 10 }}>
              <span className="ds-chip" style={{ borderColor: 'var(--danger)', color: 'var(--danger-text)' }}>
                <Dot color="var(--danger)" size={5} /> {failure.lead}
              </span>
              <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, margin: '8px 0 0', maxWidth: 'var(--measure-text-sm)' }}>
                {failure.help}
              </p>
            </div>
          )}
          {!testing && s.keyValid === null && s.apiKey && (
            <div style={{ marginTop: 10 }}>
              <span className="ds-chip" style={{ borderColor: 'var(--edge)', color: 'var(--ink-2)' }}>
                <Dot color="var(--ink-3)" size={5} /> Not tested yet
              </span>
            </div>
          )}

          {/* The old copy — "stored on this device only, never uploaded" — sat
              30px from a button that transmits the key. Both facts, plainly. */}
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              background: 'var(--paper-2)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--r-2)',
              maxWidth: 'var(--measure-text-sm)',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>Where your key goes</div>
            <p style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0 }}>
              It is stored in this browser and never sent to Danmu. When you run detection — or press Test — your
              browser sends the key, and in a detection run the photos too, straight to Google, whose service the key
              belongs to. Nothing else in Danmu leaves your device. For safety you can restrict the key to this site in
              your provider&apos;s console.
            </p>
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '10px 0 0', lineHeight: 1.5, maxWidth: 'var(--measure-text-sm)' }}>
            Detection works about {dailyDetections} times a day on a free key and resets each day. Testing here uses
            one of those. If detection stops responding late in the day, that is usually why — not your key.
          </p>
        </Row>

        <SecHeader eyebrow="Workspace" title="Preferences." desc="" />
        <Row
          label="Dimension units"
          hint="Sizes are always stored in millimetres and only converted for display, so switching units never changes a measurement."
        >
          {/* This replaced a Metric/Imperial switch that was wired to a store
              field nothing read — a units control that changed nothing, on a
              product whose promise is that its dimensions are trustworthy. */}
          <Segmented
            ariaLabel="Dimension units"
            value={s.dimUnit}
            onChange={(u) => s.setDimUnit(u)}
            options={UNIT_OPTIONS.map((u) => ({ value: u.id, label: u.id }))}
          />
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Showing sizes in {unitLabel}.</div>
        </Row>

        <SecHeader
          eyebrow="Data"
          title="Local-first storage."
          desc="Rooms live in this browser's database. Clearing the browser's site data removes them the same way deleting them here does."
        />
        <Row
          label={room ? 'Delete this room' : 'Delete a room'}
          hint={
            room
              ? `Removes “${room.name}” — its shape, wall colours, photos, detections, furniture and every saved layout. Recoverable for 30 days.`
              : 'No room is open, so there is nothing to delete here. Open a room from your workspace first, or delete rooms directly from their cards.'
          }
        >
          <button
            onClick={deleteRoomData}
            disabled={!room}
            className="ds-btn"
            style={{
              height: 32,
              fontSize: 12,
              color: 'var(--danger-text)',
              borderColor: 'var(--danger)',
            }}
          >
            <Icon name="trash" size={12} />
            {room ? `Delete “${truncate(room.name, 28)}”` : 'Delete room'}
          </button>
          {!room && (
            <div style={{ marginTop: 8 }}>
              <Link href="/workspace" className="ds-btn" style={{ height: 28, fontSize: 11.5 }}>
                Go to your rooms
              </Link>
            </div>
          )}
        </Row>
      </div>
    </DocShell>
  );
}

/** Keeps a pasted 400-character room name from stretching a button off-screen. */
function truncate(v: string, max: number) {
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function SecHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div style={{ marginTop: 36, marginBottom: 4 }}>
      <div className="ds-kicker" style={{ marginBottom: 8 }}>
        {eyebrow}
      </div>
      {/* h2, so the sections are a real outline under the page h1 */}
      <h2 style={{ fontSize: 22, marginBottom: 6 }}>{title}</h2>
      {desc && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, maxWidth: 'var(--measure-text)' }}>{desc}</div>}
    </div>
  );
}

function Row({
  label,
  hint,
  controlId,
  children,
}: {
  label: string;
  hint?: string;
  /** id of the single control this row labels — makes the label a real <label>.
   *  `htmlFor` appeared zero times in this codebase before now. Rows whose
   *  control is a *group* (the units Segmented) leave this off: the group
   *  carries its own aria-label. */
  controlId?: string;
  children: ReactNode;
}) {
  const labelStyle = { fontSize: 12.5, fontWeight: 600, marginBottom: 4, display: 'block' } as const;
  return (
    <div
      // .row-grid collapses this to one column under 720px — the fixed
      // 220px + 1fr track crushed the control below ~600px.
      className="row-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 30,
        padding: '18px 0',
        borderBottom: '1px solid var(--hairline-soft)',
        alignItems: 'flex-start',
      }}
    >
      <div>
        {controlId ? (
          <label htmlFor={controlId} style={labelStyle}>
            {label}
          </label>
        ) : (
          <div style={labelStyle}>{label}</div>
        )}
        {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

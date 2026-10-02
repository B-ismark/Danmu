'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDimUnit, useSettings, useRoom } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { validateKey, type KeyFailure, type KeyResult } from '@/lib/validate-key';
import { UNIT_OPTIONS, formatLength } from '@/lib/units';
import { returnLabel, safeReturnPath, wayBack } from '@/lib/settings-return';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Dot, IconButton, Pill, Segmented } from '@/components/ui/primitives';
import { useConfirm, useConfirmDeleteRooms } from '@/components/ui/Confirm';
import { BackButton, DocShell } from '@/components/ui/DocShell';
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
    help: 'The service did not accept this key. Check that you copied all of it, then test again.',
  },
  offline: {
    lead: 'Could not reach the service',
    help: 'Your key was not changed. Check your connection, then test again.',
  },
  'rate-limited': {
    lead: 'Too many checks just now',
    help: 'Your key is fine. Wait a minute, then test again.',
  },
  unknown: {
    lead: 'Could not finish the check',
    help: 'The service sent an unexpected answer. Your key was not changed. Try again in a moment.',
  },
};

/** A hung request used to leave the button reading "Testing…" for good, because
 *  validateKey takes no abort signal. The UI owns the deadline instead. */
const TEST_TIMEOUT_MS = 15000;

const KEY_INPUT_ID = 'settings-access-key';

/** Where feedback goes: the project's public issue page, which a person opens and
 *  writes in themselves. Change it here if feedback should go somewhere else. */
const FEEDBACK_URL = 'https://github.com/B-ismark/Danmu/issues/new';

export default function SettingsPage() {
  const s = useSettings();
  // The unit the server printed until hydration, so the example below is not a
  // hydration mismatch for anyone who chose feet.
  const dimUnit = useDimUnit();
  const roomId = useRoom((r) => r.roomId);
  const setRoomId = useRoom((r) => r.setRoomId);
  const confirm = useConfirm();
  const confirmDelete = useConfirmDeleteRooms();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyFocus, setKeyFocus] = useState(false);
  // The danger zone used to act on an unnamed "current room" read from a
  // persisted id — which may be a room last opened weeks ago. Load it so the
  // button can say what it will delete.
  // `undefined` while it is being read: "No room is open" said during the read was
  // a false empty state, about a room that WAS open.
  const [room, setRoom] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  // How many rooms this browser holds: `undefined` while counting, `null` if the
  // list could not be read.
  const [roomCount, setRoomCount] = useState<number | null | undefined>(undefined);
  // Where Settings was opened from (`lib/settings-return.ts`). Read after mount,
  // not during render: the server has no address bar, and a first paint that
  // disagreed with the client's would be a hydration mismatch. A LAYOUT effect, so
  // arriving from the studio — a client render, with nothing painted yet — shows
  // Back on the first frame rather than pushing the cards down a frame later.
  // `undefined` until read, so Back never shows one destination and then another.
  const [returnTo, setReturnTo] = useState<string | null | undefined>(undefined);
  const alive = useRef(true);

  useLayoutEffect(() => {
    setReturnTo(safeReturnPath(new URLSearchParams(window.location.search).get('from')));
  }, []);

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
      try {
        const r = await roomStore.loadRoom(roomId);
        if (!cancelled) setRoom(r ? { id: r.id, name: r.name } : null);
      } catch {
        if (cancelled) return;
        setRoom(null);
        setUnreadable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Once: a delete here leaves for the rooms page, so the count never goes stale
  // while this page is up.
  useEffect(() => {
    let cancelled = false;
    roomStore.listRooms().then(
      (rs) => !cancelled && setRoomCount(rs.length),
      () => !cancelled && setRoomCount(null),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // History, so the room or the scan comes back as it was left — but only when
  // the entry behind is the place the label names (`wayBack`). Otherwise the
  // address: behind a tab opened on Settings is someone else's page, or none.
  // Opened without a `from` — the rooms page's own link — the way back is the rooms.
  const target = returnTo ?? '/';
  function goBack() {
    if (wayBack(target, { previous: previousPath(), documentPath: documentPath() }) === 'history') router.back();
    else router.push(target);
  }

  async function test() {
    if (testing || !s.apiKey) return;
    setTesting(true);
    s.setKeyValid(null, null);
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
      body: 'It is deleted from this browser. Detection stops working until you add a key again.',
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
    // Soft delete, same as the rooms page — one path, one recovery story.
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
    router.push('/');
  }

  const failure = KEY_FAILURE[(s.keyValidReason ?? 'unknown') as KeyFailure] ?? KEY_FAILURE.unknown;
  const back = returnLabel(target, room ? { id: room.id, name: truncate(room.name, 28) } : null);

  return (
    // "Close" is gone: the breadcrumb's "Rooms" is the fixed way out, and Back is
    // the way to carry on where you were. Without it, adding a key mid-scan or
    // switching units mid-arrangement dropped you on the room list.
    <DocShell trail={[{ label: 'Rooms', href: '/' }, { label: 'Settings' }]} measure="prose">
      {/* Three cards in the same dress as the room cards, each with its own tile —
          the page used to be three loose headings over hairline rows, which read
          as a form left unstyled beside every other screen's cards. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            marginBottom: 6,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {/* The route had no heading element at all — no document outline, and the
                display serif (which globals.css hangs off h1/h2/h3) never rendered. */}
            <h1 style={{ fontSize: 'var(--fs-display)', letterSpacing: '-0.02em', marginBottom: 4 }}>Settings</h1>
            <div className="t-small">Kept in this browser, like your rooms.</div>
          </div>
          {/* Back sits at the head of the cards, on the right, and is always there:
              above the heading on the left it was only shown with a `from`, so a
              Settings opened from the rooms page had its one way out in the bar's
              far corner. It wraps under the heading, still on the right, when a long
              room name meets a phone. Held invisible rather than left out until
              `from` is read, so a phone's cards do not jump down when it arrives. */}
          <BackButton
            onBack={goBack}
            label={back}
            edge="end"
            style={{ marginTop: 6, marginInlineStart: 'auto', visibility: returnTo === undefined ? 'hidden' : undefined }}
          />
        </div>

        <Section
          icon="sparkles"
          tint="var(--accent-tint)"
          color="var(--accent)"
          title="Furniture detection"
          tag={<Pill>Optional</Pill>}
          desc="Finds the furniture in photos of your room. Everything else works without it."
        >
          <Row label="Access key" controlId={KEY_INPUT_ID}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <div
                // The field is this wrapper, not the input inside it, so this is what
                // grows to 44px under a finger; the input stretches to fill it.
                className="key-field"
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
                  transition: 'border-color var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) var(--ease-out)',
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
                    alignSelf: 'stretch',
                    padding: '0 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-small)',
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
              <button onClick={test} disabled={testing || !s.apiKey} className="ds-btn" style={{ fontSize: 'var(--fs-small)' }}>
                <Icon name={testing ? 'refresh' : 'check'} size={12} />
                {testing ? 'Testing…' : 'Test'}
              </button>
              <button
                onClick={removeKey}
                disabled={!s.apiKey || testing}
                className="ds-btn"
                style={{ fontSize: 'var(--fs-small)', color: 'var(--danger-text)', borderColor: 'var(--edge)' }}
              >
                <Icon name="trash" size={12} />
                Remove
              </button>
            </div>
            {/* Where a key comes from. This lived on the welcome page and went with it,
                which left "Set up a key in Settings" pointing at an empty field
                with nothing to say what goes in it. */}
            <div className="t-hint" style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 }}>
              <span>A Google AI Studio key. They start with “AIza”.</span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent-text)', fontWeight: 600 }}
              >
                Get a key
                {/* target=_blank has to be visible, not a surprise. */}
                <Icon name="external" size={11} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
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
                  <Dot color="var(--success)" size={5} /> Working
                </span>
              </div>
            )}
            {!testing && s.keyValid === false && (
              <div style={{ marginTop: 10 }}>
                <span className="ds-chip" style={{ borderColor: 'var(--danger)', color: 'var(--danger-text)' }}>
                  <Dot color="var(--danger)" size={5} /> {failure.lead}
                </span>
                <p className="t-small" style={{ lineHeight: 1.5, margin: '8px 0 0', maxWidth: 'var(--measure-text-sm)' }}>
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
              <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, marginBottom: 4 }}>Where your key goes</div>
              <p className="t-note" style={{ lineHeight: 1.55, margin: 0 }}>
                Kept in this browser. Sent only to Google: on Test, and with your photos when detection runs.
                You can restrict the key to this site in Google&apos;s console.
              </p>
            </div>
          </Row>
        </Section>

        <Section
          icon="ruler"
          tint="var(--accent-2-tint)"
          color="var(--accent-2)"
          title="Units"
          desc="How every size reads, in the studio, on the plan and in a scan."
        >
          {/* The hint is the setting's own preview, formatted by the same function
              every size on screen goes through, so it cannot describe a different
              rounding from the one the studio shows. */}
          <Row label="Dimension units" hint={`Example: ${formatLength(1850, dimUnit)}`}>
            {/* This replaced a Metric/Imperial switch that was wired to a store
                field nothing read — a units control that changed nothing, on a
                product whose promise is that its dimensions are trustworthy. */}
            <Segmented
              ariaLabel="Dimension units"
              value={dimUnit}
              onChange={(u) => s.setDimUnit(u)}
              options={UNIT_OPTIONS.map((u) => ({ value: u.id, label: u.id }))}
            />
          </Row>
        </Section>

        <Section
          icon="layers"
          tint="var(--paper-3)"
          color="var(--ink-2)"
          title="Your rooms"
          desc="Saved only in this browser. Clearing this site's data in your browser deletes them."
        >
          <Row label="Saved here">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>
                {roomCount === undefined ? (
                  'Counting…'
                ) : roomCount === null ? (
                  'Your rooms could not be read.'
                ) : (
                  <>
                    <span className="mono">{roomCount}</span> room{roomCount === 1 ? '' : 's'}
                  </>
                )}
              </span>
              <Link href="/" className="ds-btn ds-btn--sm">
                Manage rooms
                <Icon name="arrow-right" size={12} />
              </Link>
            </div>
          </Row>
          <Row
            label={room ? 'Delete this room' : 'Delete a room'}
            hint={
              room
                ? 'Recoverable for 30 days.'
                : room === undefined
                  ? 'Finding the open room…'
                  : unreadable
                    ? 'The open room could not be read.'
                    : 'No room is open.'
            }
          >
            <button
              onClick={deleteRoomData}
              disabled={!room}
              className="ds-btn ds-btn--sm"
              style={{
                color: 'var(--danger-text)',
                borderColor: 'var(--danger)',
              }}
            >
              <Icon name="trash" size={12} />
              {room ? `Delete “${truncate(room.name, 28)}”` : 'Delete room'}
            </button>
          </Row>
          <Row label="Send feedback" hint="Opens a new page where you can tell us what works and what doesn't. Nothing is sent from the app.">
            {/* A plain link the person follows, never a form that posts from here:
                rule 5 allows no egress but the optional detection call. */}
            <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="ds-btn ds-btn--sm">
              Send feedback
              <Icon name="external" size={12} />
            </a>
          </Row>
        </Section>
      </div>
    </DocShell>
  );
}

/** The path of the history entry behind this one, where the Navigation API can
 *  say: null when there is none in this app, `undefined` when the API is absent. */
function previousPath(): string | null | undefined {
  const nav = (window as unknown as {
    navigation?: { currentEntry?: { index: number } | null; entries?: () => { url: string | null }[] };
  }).navigation;
  if (!nav?.currentEntry || typeof nav.entries !== 'function') return undefined;
  const prev = nav.entries()[nav.currentEntry.index - 1];
  if (!prev?.url) return null;
  try {
    const url = new URL(prev.url);
    return url.origin === window.location.origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/** The path this document was first loaded at, or null when the browser cannot
 *  say. A soft navigation keeps the document, so this is where the tab ARRIVED. */
function documentPath(): string | null {
  const nav = performance.getEntriesByType?.('navigation')[0];
  if (!nav) return null;
  try {
    return new URL(nav.name).pathname;
  } catch {
    return null;
  }
}

/** Keeps a pasted 400-character room name from stretching a button off-screen. */
function truncate(v: string, max: number) {
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** One group of settings, dressed as a card like the room cards. Each has its own
 *  tinted tile, so the three groups are told apart at a glance rather than by
 *  reading three headings. */
function Section({
  icon,
  tint,
  color,
  title,
  desc,
  tag,
  children,
}: {
  icon: IconName;
  tint: string;
  color: string;
  title: string;
  desc: string;
  tag?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ds-card" style={{ padding: '20px 22px 6px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 6 }}>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 'var(--r-2)',
            background: tint,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name={icon} size={17} color={color} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* h2, so the cards are a real outline under the page h1. `.sans`, as
                on the room cards: the display serif is for the page title. */}
            <h2 className="sans" style={{ fontSize: 'var(--fs-lead)', fontWeight: 700, letterSpacing: 0, lineHeight: 1.3 }}>
              {title}
            </h2>
            {tag}
          </div>
          <p className="t-small" style={{ lineHeight: 1.55, margin: '2px 0 0' }}>{desc}</p>
        </div>
      </div>
      {children}
    </section>
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
  const labelStyle = { fontSize: 'var(--fs-small)', fontWeight: 600, marginBottom: 4, display: 'block' } as const;
  return (
    <div
      // .row-grid collapses this to one column under 720px — the fixed
      // 200px + 1fr track crushed the control below ~600px.
      className="row-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr',
        gap: 30,
        padding: '16px 0',
        // Top, not bottom: inside a card the first rule divides the rows from
        // the card's heading, and the last row needs no rule under it.
        borderTop: '1px solid var(--hairline-soft)',
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
        {hint && <div className="t-hint" style={{ lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRoom, useSettings, CAM_HEIGHT_MIN, CAM_HEIGHT_MAX } from '@/lib/store';
import { roomStore, blobToObjectUrl } from '@/lib/storage';
import {
  ACCEPTED_PHOTO_TYPES,
  CAPTURE_METHOD,
  CAPTURE_SLOTS,
  isAcceptedPhoto,
  normalizePhoto,
  readCapturePose,
  snapToBlob,
  startCamera,
} from '@/lib/capture';
import { useDeviceTilt } from '@/lib/device-tilt';
import { scoreQuality, flagHelp, flagLabel, flagTone, type Quality } from '@/lib/image-quality';
import { useMediaQuery } from '@/lib/use-media-query';
import { Icon } from '@/components/ui/Icon';
import { NumberField } from '@/components/ui/NumberField';
import { DanmuMark, Pill, Segmented } from '@/components/ui/primitives';
import type { CaptureSlot, CapturePose } from '@/lib/storage';

type Source = 'upload' | 'camera';
type SlotDef = (typeof CAPTURE_SLOTS)[number];

const SLOT_IDS = CAPTURE_SLOTS.map((s) => s.id);
const labelOf = (id: CaptureSlot) => CAPTURE_SLOTS.find((s) => s.id === id)!.label;
function emptyMap<T>(): Record<CaptureSlot, T | null> {
  return { n: null, e: null, s: null, w: null };
}

/** Capture is the one step people really do on a phone, and the layout genuinely
 *  differs there (camera full-bleed, slots as a filmstrip) rather than just
 *  reflowing — so it needs a JS breakpoint, not only the CSS one. The shared hook
 *  replaced a third hand-rolled copy of the same matchMedia body. */
const NARROW = '(max-width: 720px)';

export default function CapturePage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const narrow = useMediaQuery(NARROW);
  const [source, setSource] = useState<Source>('upload');
  /** which wall the camera shoots into. Selected from the camera panel itself —
   *  it used to depend on clicking a card in the grid, which no keyboard user
   *  could do. */
  const [target, setTarget] = useState<CaptureSlot>('n');
  const [blobs, setBlobs] = useState(emptyMap<Blob>());
  const [previews, setPreviews] = useState(emptyMap<string>());
  const [qualities, setQualities] = useState(emptyMap<Quality>());
  const [draggingFrom, setDraggingFrom] = useState<CaptureSlot | null>(null);
  /** single polite live region for everything that happens without a page change */
  const [announce, setAnnounce] = useState('');
  // How high the phone is held. Remembered per person, not per room, and written
  // onto each photo's pose as it is saved.
  const camHeightM = useSettings((s) => s.camHeightM);
  // Only a stated height goes onto a photo. Recording the 1.5 m default would be
  // indistinguishable from an answer, and would stop the detect screen solving
  // for the real height off the wall-floor line.
  const camHeightSet = useSettings((s) => s.camHeightSet);
  const statedHeight = camHeightSet ? camHeightM : undefined;
  const setCamHeight = useSettings((s) => s.setCamHeight);
  const [heightDraft, setHeightDraft] = useState(String(camHeightM));
  const { tilt, requestAccess } = useDeviceTilt();

  // Mirror of `previews` readable from async handlers, so replacing or removing a
  // photo can revoke the URL it is retiring.
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  // Every object URL this page mints is released on unmount. The old cleanup only
  // covered the ones created while rehydrating, so each upload leaked one.
  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
    },
    [],
  );

  // Committing a new height re-stamps the photos already saved. Someone who
  // uploads four walls and only then answers the question should not have their
  // answer quietly ignored. Debounced, because the field emits per keystroke.
  useEffect(() => {
    const n = Number(heightDraft);
    if (!Number.isFinite(n) || n < CAM_HEIGHT_MIN || n > CAM_HEIGHT_MAX || n === camHeightM) return;
    const t = setTimeout(() => {
      setCamHeight(n);
      if (!roomId) return;
      void (async () => {
        const caps = await roomStore.loadCaptures(roomId);
        await Promise.all(
          caps.map((c) => roomStore.saveCapture(roomId, { ...c, pose: { ...c.pose, heightM: n } })),
        );
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [heightDraft, camHeightM, roomId, setCamHeight]);

  // Rehydrate from IndexedDB: photos survive leaving and coming back.
  useEffect(() => {
    if (!roomId) return;
    let stale = false;
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      if (stale) return;
      Object.values(previewsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
      const nextB = emptyMap<Blob>();
      const nextU = emptyMap<string>();
      for (const c of caps) {
        nextB[c.slot] = c.blob;
        nextU[c.slot] = blobToObjectUrl(c.blob);
      }
      setBlobs(nextB);
      setPreviews(nextU);
      setQualities(emptyMap<Quality>());
      for (const c of caps) {
        scoreQuality(c.blob).then((q) => setQualities((prev) => ({ ...prev, [c.slot]: q })));
      }
    })();
    return () => {
      stale = true;
    };
  }, [roomId]);

  /** `blob` is stored as given — callers normalise first (see addFiles / shoot),
   *  so nothing full-resolution reaches IndexedDB or the detection request.
   *  `pose` is what we managed to learn about the camera, read from the ORIGINAL
   *  file before normalising stripped it (see readCapturePose). */
  async function persistBlob(slot: CaptureSlot, blob: Blob, pose?: CapturePose) {
    if (!roomId) return;
    await roomStore.saveCapture(roomId, { slot, blob, takenAt: Date.now(), pose });
    const retiring = previewsRef.current[slot];
    setBlobs((p) => ({ ...p, [slot]: blob }));
    setPreviews((p) => ({ ...p, [slot]: blobToObjectUrl(blob) }));
    if (retiring) URL.revokeObjectURL(retiring);
    setQualities((q) => ({ ...q, [slot]: null }));
    scoreQuality(blob).then((q) => setQualities((prev) => ({ ...prev, [slot]: q })));
  }

  /** Dropping or picking four photos at once is the obvious move on this screen;
   *  the old handler took files[0] and silently threw the rest away. Extras fill
   *  the following empty walls in shooting order. */
  async function addFiles(startSlot: CaptureSlot, list: FileList | File[] | null) {
    const picked = Array.from(list ?? []);
    // An explicit raster allowlist, not `image/*` — that also matched SVG, which
    // has no pixels for the quality score or the colour sampler to read.
    const files = picked.filter(isAcceptedPhoto);
    if (!files.length) {
      setAnnounce(
        picked.length
          ? 'Danmu can’t read that kind of file. Choose a photo — JPEG, PNG, WebP or HEIC.'
          : 'That file is not an image. Choose a photo — JPEG, PNG, WebP or HEIC.',
      );
      return;
    }
    const start = SLOT_IDS.indexOf(startSlot);
    const followers = [...SLOT_IDS.slice(start + 1), ...SLOT_IDS.slice(0, start)].filter(
      (id) => !previewsRef.current[id],
    );
    const targets = [startSlot, ...followers].slice(0, files.length);
    // Decode + re-encode all of them at once; each was a full serialised decode
    // before, so four photos meant four round trips of nothing happening.
    // The pose is read from the ORIGINAL file: normalizePhoto strips the metadata
    // it comes from, which is the whole point of the strip.
    const prepared = await Promise.all(
      targets.map(async (_, i) => ({
        blob: await normalizePhoto(files[i]),
        pose: await readCapturePose(files[i], { heightM: statedHeight }),
      })),
    );
    for (let i = 0; i < targets.length; i++) {
      await persistBlob(targets[i], prepared[i].blob, prepared[i].pose);
    }
    const spare = files.length - targets.length;
    setAnnounce(
      `${targets.length} photo${targets.length > 1 ? 's' : ''} added: ${targets.map(labelOf).join(', ')}.` +
        (spare > 0 ? ` ${spare} could not be added — all four walls are already filled.` : ''),
    );
  }

  async function removeSlot(slot: CaptureSlot) {
    if (!roomId) return;
    await roomStore.deleteCapture(roomId, slot);
    const retiring = previewsRef.current[slot];
    setBlobs((p) => ({ ...p, [slot]: null }));
    setPreviews((p) => ({ ...p, [slot]: null }));
    setQualities((q) => ({ ...q, [slot]: null }));
    if (retiring) URL.revokeObjectURL(retiring);
    setAnnounce(`${labelOf(slot)} photo removed.`);
  }

  async function moveSlot(from: CaptureSlot, to: CaptureSlot) {
    if (!roomId || from === to) return;
    const fromBlob = blobs[from];
    const toBlob = blobs[to];
    if (!fromBlob) return;
    await roomStore.saveCapture(roomId, { slot: to, blob: fromBlob, takenAt: Date.now() });
    if (toBlob) {
      await roomStore.saveCapture(roomId, { slot: from, blob: toBlob, takenAt: Date.now() });
    } else {
      // Moving onto an empty wall vacates the source. Without this the photo
      // stayed in IndexedDB, so a reload showed the same shot in BOTH slots and
      // fed a duplicate wall into detection.
      await roomStore.deleteCapture(roomId, from);
    }
    setBlobs((p) => ({ ...p, [from]: toBlob, [to]: fromBlob }));
    setPreviews((p) => ({ ...p, [from]: p[to], [to]: p[from] }));
    // The quality read travels with its photo. It used to stay behind and end up
    // describing a different image.
    setQualities((p) => ({ ...p, [from]: p[to], [to]: p[from] }));
    setAnnounce(toBlob ? `Swapped ${labelOf(from)} and ${labelOf(to)}.` : `Moved photo to ${labelOf(to)}.`);
  }

  const filled = SLOT_IDS.filter((id) => previews[id]).length;
  const allCaptured = filled === SLOT_IDS.length;
  const anyCaptured = filled > 0;
  const flaggedCount = SLOT_IDS.filter((id) => {
    const q = qualities[id];
    return !!q && !q.flags.includes('ok');
  }).length;

  // Arriving here without a room (a shared link, a cleared browser) used to do
  // nothing at all — every upload silently no-oped.
  if (!roomId) {
    return (
      <div className="page-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--paper)' }}>
        <div className="ds-card" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <Icon name="camera" size={22} color="var(--ink-3)" style={{ margin: '0 auto 10px' }} />
          <h1 style={{ fontSize: 19, marginBottom: 8 }}>Pick a room shape first</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 18px' }}>
            Photos are saved into a room, and there is no room open on this device yet. Choose a footprint and you can
            come straight back here.
          </p>
          <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--accent" style={{ height: 44, justifyContent: 'center', width: '100%' }}>
            Pick a shape
            <Icon name="arrow-right" size={14} color="var(--on-accent)" />
          </Link>
        </div>
      </div>
    );
  }

  const forwardLabel = !anyCaptured
    ? 'Add a photo to continue'
    : allCaptured
      ? 'Continue · find my furniture'
      : `Continue with ${filled} wall${filled > 1 ? 's' : ''}`;

  const forwardButton = (full?: boolean) => (
    <button
      className="ds-btn ds-btn--accent"
      style={full ? { height: 48, width: '100%', justifyContent: 'center', fontSize: 14 } : { height: 34, fontSize: 12.5 }}
      disabled={!anyCaptured}
      onClick={() => router.push('/onboarding/detect')}
    >
      {forwardLabel}
      <Icon name="arrow-right" size={13} color="var(--on-accent)" />
    </button>
  );

  const slotCards = (compact: boolean) =>
    CAPTURE_SLOTS.map((slot) => (
      <SlotCard
        key={slot.id}
        slot={slot}
        url={previews[slot.id]}
        quality={qualities[slot.id]}
        isTarget={source === 'camera' && target === slot.id}
        compact={compact}
        filledMap={previews}
        onFiles={(list) => addFiles(slot.id, list)}
        onRemove={() => removeSlot(slot.id)}
        onMoveTo={(to) => moveSlot(slot.id, to)}
        draggingFrom={draggingFrom}
        setDraggingFrom={setDraggingFrom}
        onDropFrom={(from) => moveSlot(from, slot.id)}
      />
    ));

  const method = (
    <div style={{ padding: narrow ? '12px 14px 0' : '14px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="info" size={14} color="var(--accent-text)" style={{ marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-2)' }}>
          {CAPTURE_METHOD} <span style={{ color: 'var(--ink-3)' }}>One photo is enough to start; four gets the closest room.</span>
        </p>
      </div>
      {/* "Chest height" above is the one number the geometry engine cannot see and
          cannot do without: every distance it reads off a photo scales directly
          with it. Asking is a 10-second question that removes a ±17% error, so it
          sits with the instruction it makes precise rather than in Settings. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          margin: '10px 0 0',
          paddingLeft: 22,
        }}
      >
        <label htmlFor="cam-height" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          Phone height off the floor
        </label>
        <NumberField
          value={heightDraft}
          onChange={setHeightDraft}
          step={0.05}
          min={CAM_HEIGHT_MIN}
          max={CAM_HEIGHT_MAX}
          height={30}
          ariaLabel="Phone height off the floor, in metres"
          style={{ width: 96 }}
        />
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>m</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Sets the scale of everything measured from your photos.
        </span>
      </div>
    </div>
  );

  const cameraPanel = (
    <CameraPanel
      targetLabel={labelOf(target)}
      target={target}
      onSetTarget={setTarget}
      onStart={requestAccess}
      onCapture={(blob) => {
        // A canvas snapshot carries no EXIF, so the pose here is only what the
        // device measured — the tilt an uploaded photo can never tell us, and
        // the height the user gave us.
        void (async () => {
          const pose = await readCapturePose(blob, {
            tiltDeg: tilt ?? undefined,
            heightM: statedHeight,
          });
          await persistBlob(target, blob, pose);
        })();
        setAnnounce(`Photo taken for ${labelOf(target)}.`);
      }}
      onUseUpload={() => setSource('upload')}
    />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--paper)',
        ...(narrow ? { minHeight: '100dvh' } : { height: '100vh' }),
      }}
    >
      {/* TOP BAR — .chrome-bar wraps to a second row instead of crushing the
          forward action off a 390px screen. */}
      <div className="chrome-bar">
        <button onClick={() => router.back()} className="ds-btn ds-btn--ghost" style={{ height: 34, padding: '0 8px' }}>
          <Icon name="chevron-left" size={14} />
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Back</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <DanmuMark size={12} />
        <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>Photograph your room</span>
        <span role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {filled} of 4 walls added
        </span>
        {flaggedCount > 0 && (
          <Pill tone="warn">
            <Icon name="info" size={11} />
            {flaggedCount} photo{flaggedCount > 1 ? 's' : ''} could be clearer · retake, or continue anyway
          </Pill>
        )}
        <div className="chrome-bar__spacer" />
        <Segmented
          ariaLabel="Photo source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'upload', label: 'Upload', icon: 'image' },
            { value: 'camera', label: 'Camera', icon: 'camera' },
          ]}
        />
        <Link
          href={`/room/${roomId}/model`}
          className="ds-btn ds-btn--ghost"
          style={{ height: 34, fontSize: 12, color: 'var(--ink-2)' }}
          title="Photos are optional — you can decorate the shape you picked instead"
        >
          Skip
        </Link>
        {!narrow && forwardButton()}
      </div>

      {narrow && source === 'camera' ? (
        // Phone + camera: the viewfinder gets the screen, the walls become a
        // filmstrip under the shutter. A 360px side rail here left ~30px for the
        // grid the old copy told people to click.
        <>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 320 }}>{cameraPanel}</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 14px' }}>{slotCards(true)}</div>
        </>
      ) : (
        <div
          // .split--stack only while a 360px rail exists — it also protects the
          // first paint on a phone, before the JS breakpoint has resolved.
          className={`split${source === 'camera' ? ' split--stack' : ''}`}
          style={{ flex: 1, gridTemplateColumns: source === 'camera' ? '1fr 360px' : '1fr', minHeight: 0 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {method}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: narrow ? 'auto auto' : '1fr 1fr',
                gap: 8,
                padding: narrow ? 14 : 16,
                flex: 1,
                minHeight: 0,
              }}
            >
              {slotCards(false)}
            </div>
          </div>

          {source === 'camera' && (
            <div className="rail rail--right">{cameraPanel}</div>
          )}
        </div>
      )}

      {narrow && (
        <div className="sticky-cta" style={{ margin: '0 14px' }}>
          {forwardButton(true)}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

/** Opaque chrome over a photo. Opaque rather than a scrim because a translucent
 *  pill over an unknown image cannot promise a contrast ratio. */
function photoChrome(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: 26,
    padding: '0 10px',
    borderRadius: 'var(--r-full)',
    background: 'var(--ink)',
    border: '1px solid transparent',
    color: 'var(--on-ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: 11,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };
}

function SlotCard({
  slot,
  url,
  quality,
  isTarget,
  compact,
  filledMap,
  onFiles,
  onRemove,
  onMoveTo,
  draggingFrom,
  setDraggingFrom,
  onDropFrom,
}: {
  slot: SlotDef;
  url: string | null;
  quality: Quality | null;
  isTarget: boolean;
  compact: boolean;
  filledMap: Record<CaptureSlot, string | null>;
  onFiles: (list: FileList | File[] | null) => void;
  onRemove: () => void;
  onMoveTo: (to: CaptureSlot) => void;
  draggingFrom: CaptureSlot | null;
  setDraggingFrom: (s: CaptureSlot | null) => void;
  onDropFrom: (from: CaptureSlot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      // External file drop — all of them, not just the first.
      const files = e.dataTransfer.files;
      if (files && files.length) {
        onFiles(files);
        return;
      }
      if (draggingFrom && draggingFrom !== slot.id) onDropFrom(draggingFrom);
    },
  };

  return (
    <div
      {...dropProps}
      style={{
        position: 'relative',
        display: 'flex',
        borderRadius: 'var(--r-3)',
        background: url ? 'var(--ink)' : 'var(--paper-2)',
        border: over || isTarget ? '2px solid var(--accent)' : url ? '1px solid var(--edge)' : '1px dashed var(--edge)',
        minHeight: compact ? 96 : 132,
        ...(compact ? { flex: '0 0 148px' } : { minWidth: 0 }),
      }}
    >
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Your photo of ${slot.label}`}
            draggable
            onDragStart={(e) => {
              setDraggingFrom(slot.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDraggingFrom(null)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', cursor: 'grab' }}
          />

          <span style={{ ...photoChrome(), position: 'absolute', top: 8, left: 8, cursor: 'default' }}>
            <Icon name="check" size={11} color="var(--on-ink)" />
            {slot.label}
          </span>

          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
            <button type="button" style={photoChrome()} onClick={() => inputRef.current?.click()}>
              Replace
            </button>
            {/* There was previously no way to take a photo back out — someone who
                uploaded a shot with family in it was stuck with it. */}
            <button type="button" style={photoChrome()} onClick={onRemove}>
              Remove
            </button>
            {/* Reordering was drag-only, i.e. impossible without a mouse. */}
            <MoveMenu slot={slot} filledMap={filledMap} onMoveTo={onMoveTo} />
          </div>

          <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {quality ? (
              quality.flags.map((f) => {
                const good = flagTone(f) === 'good';
                return (
                  <span
                    key={f}
                    title={flagHelp(f)}
                    style={{
                      ...photoChrome(),
                      cursor: 'default',
                      background: good ? 'var(--success-text)' : 'var(--warn)',
                      color: 'var(--on-accent)',
                    }}
                  >
                    {/* Icon + words: the badge used to lean on colour and a bare
                        ✓ / ⚠ glyph, which renders differently on every platform. */}
                    <Icon name={good ? 'check' : 'info'} size={11} color="var(--on-accent)" />
                    {flagLabel(f)}
                    <span className="sr-only"> — {flagHelp(f)}</span>
                  </span>
                );
              })
            ) : (
              <span role="status" aria-live="polite" style={{ ...photoChrome(), cursor: 'default' }}>
                Checking this photo…
              </span>
            )}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="slot-card"
          onClick={() => inputRef.current?.click()}
          aria-label={`${slot.label}, ${slot.turn}. ${slot.instruction} Activate to choose photos.`}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: compact ? 8 : 14,
            background: 'transparent',
            border: 0,
            borderRadius: 'inherit',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          <Icon name="plus" size={compact ? 18 : 22} color="var(--ink-3)" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            {slot.label}
            {!compact && <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}> · {slot.turn}</span>}
          </span>
          {!compact && (
            <>
              {/* The instruction existed in the data model and was never rendered. */}
              <span style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.35 }}>{slot.instruction}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Tap to choose photos, or drop them here</span>
            </>
          )}
        </button>
      )}

      {/* .sr-only, never display:none — a hidden-by-display file input is gone
          from the accessibility tree entirely. `multiple` so one pick can fill
          several walls. */}
      <input
        ref={inputRef}
        type="file"
        // The same allowlist addFiles enforces, so the file dialog and the app
        // agree about what counts as a photo.
        accept={ACCEPTED_PHOTO_TYPES.join(',')}
        multiple
        className="sr-only"
        aria-label={`Choose photos for ${slot.label}`}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Keyboard path for reordering. Drag-and-drop stays, but it is no longer the
 *  only way to get a photo onto the right wall. */
function MoveMenu({
  slot,
  filledMap,
  onMoveTo,
}: {
  slot: SlotDef;
  filledMap: Record<CaptureSlot, string | null>;
  onMoveTo: (to: CaptureSlot) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const others = CAPTURE_SLOTS.filter((s) => s.id !== slot.id);

  return (
    <div
      style={{ position: 'relative' }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        setOpen(false);
        btnRef.current?.focus();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        style={photoChrome()}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="swap" size={11} color="var(--on-ink)" />
        Move
      </button>
      {open && (
        <div
          className="popover"
          role="menu"
          aria-label={`Move the ${slot.label} photo`}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            padding: 6,
            minWidth: 172,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <span className="section-title" style={{ padding: '4px 8px' }}>
            Move this photo to
          </span>
          {others.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              className="list-row"
              style={{ fontSize: 12.5 }}
              onClick={() => {
                onMoveTo(o.id);
                setOpen(false);
              }}
            >
              {o.label}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
                {filledMap[o.id] ? 'swap' : 'empty'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CAMERA_ERRORS: Record<string, { title: string; body: string }> = {
  NotAllowedError: {
    title: 'Your browser is blocking the camera',
    body: 'Nothing you shoot leaves this device — Danmu has no server to send it to. Allow camera access from the icon in your address bar, then try again. Or use photos you already have.',
  },
  SecurityError: {
    title: 'Your browser is blocking the camera',
    body: 'Camera access needs a secure page. Uploading photos from this device works exactly the same.',
  },
  NotFoundError: {
    title: 'No camera on this device',
    body: 'We could not find one to use. Upload photos from this device instead — the rest of the flow is identical.',
  },
  OverconstrainedError: {
    title: 'No usable camera on this device',
    body: 'The cameras here cannot give us a usable picture. Upload photos from this device instead.',
  },
  NotReadableError: {
    title: 'The camera is busy',
    body: 'Another app or browser tab seems to be using it. Close that one and try again, or upload photos instead.',
  },
  AbortError: {
    title: 'The camera stopped before it started',
    body: 'That is usually another app taking it over. Try again, or upload photos instead.',
  },
};
const CAMERA_ERROR_FALLBACK = {
  title: 'The camera did not start',
  body: 'Something on this device stopped it. You can try again, or upload photos you already have.',
};

function CameraPanel({
  target,
  targetLabel,
  onSetTarget,
  onCapture,
  onStart,
  onUseUpload,
}: {
  target: CaptureSlot;
  targetLabel: string;
  onSetTarget: (s: CaptureSlot) => void;
  onCapture: (blob: Blob) => void;
  /** Runs alongside the camera permission prompt. iOS only exposes the
   *  orientation sensors from inside a user gesture, and "turn on the camera" is
   *  the gesture — declining just means the geometry assumes a level phone. */
  onStart: () => Promise<void>;
  /** hands the user back to the Upload tab — the way out the error state never had */
  onUseUpload: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live'>('idle');
  const [errorName, setErrorName] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);

  // Never leave the camera light on because someone switched tab or navigated.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Attach the stream once the <video> is actually mounted (it only exists live).
  useEffect(() => {
    if (phase !== 'live' || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play();
  }, [phase]);

  // Asking for the camera the instant the tab is clicked throws a permission
  // prompt at someone who has not been told why. Prime first, request on press.
  async function turnOn() {
    setPhase('starting');
    setErrorName(null);
    // Same gesture, second ask: the orientation sensors record how far the phone
    // is tilted at the shutter. Failure is silent and harmless by design.
    void onStart();
    try {
      streamRef.current = await startCamera();
      setPhase('live');
    } catch (e) {
      setErrorName((e as DOMException)?.name || 'Error');
      setPhase('idle');
    }
  }

  async function shoot() {
    if (!videoRef.current || shooting) return;
    setShooting(true);
    try {
      onCapture(await snapToBlob(videoRef.current));
    } finally {
      setShooting(false);
    }
  }

  const head = (
    <div className="section">
      <span className="ds-label">Camera</span>
      <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '6px 0 10px', lineHeight: 1.45 }}>
        {CAPTURE_METHOD}
      </p>
      <Segmented ariaLabel="Wall to shoot" value={target} onChange={onSetTarget} options={CAPTURE_SLOTS.map((s) => ({ value: s.id, label: s.label }))} />
    </div>
  );

  if (errorName) {
    const copy = CAMERA_ERRORS[errorName] ?? CAMERA_ERROR_FALLBACK;
    return (
      <>
        {head}
        <div role="status" aria-live="polite" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--r-full)',
              background: 'var(--paper-3)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Icon name="camera" size={18} color="var(--warn-text)" />
          </span>
          <h2 style={{ fontSize: 15, color: 'var(--ink)' }}>{copy.title}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>{copy.body}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="ds-btn ds-btn--accent" style={{ height: 40 }} onClick={onUseUpload}>
              <Icon name="image" size={14} color="var(--on-accent)" />
              Upload photos instead
            </button>
            <button className="ds-btn" style={{ height: 40 }} onClick={turnOn}>
              <Icon name="refresh" size={13} />
              Try again
            </button>
          </div>
        </div>
      </>
    );
  }

  if (phase !== 'live') {
    return (
      <>
        {head}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <h2 style={{ fontSize: 15, color: 'var(--ink)' }}>Shoot {targetLabel} with this device</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5, margin: 0 }}>
            Your photos stay on this device — there is nowhere for them to go. Your browser will ask permission when you
            turn the camera on.
          </p>
          <button className="ds-btn ds-btn--accent" style={{ height: 40 }} disabled={phase === 'starting'} onClick={turnOn}>
            <Icon name="camera" size={14} color="var(--on-accent)" />
            {phase === 'starting' ? 'Starting camera…' : 'Turn on camera'}
          </button>
          {phase === 'starting' && (
            <p role="status" aria-live="polite" className="sr-only">
              Waiting for camera permission.
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div style={{ flex: 1, position: 'relative', background: 'var(--ink)', overflow: 'hidden', minHeight: 260 }}>
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label={`Live camera preview, aimed at ${targetLabel}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <span style={{ ...photoChrome(), position: 'absolute', top: 8, left: 8, cursor: 'default' }}>
          Shooting · {targetLabel}
        </span>
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={shoot}
            disabled={shooting}
            aria-label={`Take the photo for ${targetLabel}`}
            style={{
              width: 60,
              height: 60,
              borderRadius: 'var(--r-full)',
              background: 'var(--paper)',
              border: '4px solid var(--accent-tint-strong)',
              cursor: shooting ? 'progress' : 'pointer',
              opacity: shooting ? 0.6 : 1,
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 'var(--r-full)', background: 'var(--accent)', margin: 'auto' }} />
          </button>
        </div>
      </div>
    </>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  readCaptureFacts,
  snapToBlob,
  startCamera,
} from '@/lib/capture';
import {
  SLOT_ORDER,
  clearSlot,
  describePlacement,
  emptySlotMap,
  patchIfSame,
  placePhotos,
  rotateSet,
  rotationMapping,
  swapMapping,
  swapSet,
  type PlacedPhoto,
  type SlotMap,
  type SlotSignal,
} from '@/lib/capture-slots';
import { wallSpan } from '@/lib/photo-geometry';
import { useDeviceTilt } from '@/lib/device-tilt';
import { scoreQuality, flagHelp, flagLabel, flagTone, type Quality } from '@/lib/image-quality';
import { useMediaQuery } from '@/lib/use-media-query';
import { formatDim } from '@/lib/units';
import { Icon } from '@/components/ui/Icon';
import { NumberField } from '@/components/ui/NumberField';
import { FlowBarLead, Pill, Segmented } from '@/components/ui/primitives';
import type { CaptureSlot, CapturePose } from '@/lib/storage';

type Source = 'upload' | 'camera';

/** One photo, everything this screen knows about it.
 *
 *  Was four parallel `Record<CaptureSlot, T | null>` maps, which is fine until
 *  the walls can be permuted: rotating the set then means permuting four maps in
 *  step, and the quality read is the one that got left behind last time and ended
 *  up describing a different image. One record moves as one thing. */
type Photo = {
  blob: Blob;
  url: string;
  /** Rescored from the blob on every visit, deliberately never persisted beside it.
   *
   *  Two reasons, and the first is the rule. A `Quality` is a MEASUREMENT of a
   *  photograph, and a stored measurement stops being derived the moment
   *  `scoreQuality`'s thresholds move: the chip would then describe the photo as an
   *  older build saw it, with nothing on screen to say so. Rule 2 is about sizes,
   *  but "blurry" is the same kind of claim about the same photo.
   *
   *  The second is that it costs nearly nothing to be right. `scoreQuality`
   *  downsamples to 320 px on the long edge before it reads a pixel, it is async,
   *  and the chip already arrives after the picture does (`patchIfSame`) — so the
   *  work being saved is one small canvas pass per wall, on a screen the user
   *  reaches at most a handful of times. */
  quality: Quality | null;
  pose?: CapturePose;
  /** Which rung of the ladder put it on this wall. Absent for a photo read back
   *  out of IndexedDB on a fresh visit — the reasoning was a fact about the
   *  moment it was added, and inventing one after the fact would be worse than
   *  saying nothing. */
  by?: SlotSignal;
  /** The wall its own compass pointed at, when that wall was already taken. */
  clashedWith?: CaptureSlot;
};

type PhotoMap = SlotMap<Photo>;
const emptyPhotos = (): PhotoMap => emptySlotMap<Photo>();

const labelOf = (id: CaptureSlot) => CAPTURE_SLOTS.find((s) => s.id === id)!.label;
const turnOf = (id: CaptureSlot) => CAPTURE_SLOTS.find((s) => s.id === id)!.instruction;

/** What the wall assignment is standing on, in words. The screen says this per
 *  photo because a wrong wall is a wrong room — `wallDistance` reads n/s at
 *  depth/2 and e/w at width/2 — and the user is the only one who can see whether
 *  we got it right. */
const REASON: Record<SlotSignal, string> = {
  bearing: 'from this photo’s compass',
  time: 'from when it was taken',
  order: 'from the order you added it',
  manual: 'wall you chose',
};

/** The photos already placed, in the shape `placePhotos` reads. */
const placedIn = (photos: PhotoMap): PlacedPhoto[] =>
  SLOT_ORDER.filter((s) => photos[s]).map((s) => ({ slot: s, bearingDeg: photos[s]!.pose?.bearingDeg }));

/** Capture is the one step people really do on a phone, and the layout genuinely
 *  differs there (camera full-bleed, photos as a filmstrip) rather than just
 *  reflowing — so it needs a JS breakpoint, not only the CSS one. The shared hook
 *  replaced a third hand-rolled copy of the same matchMedia body. */
const NARROW = '(max-width: 720px)';

export default function CapturePage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const narrow = useMediaQuery(NARROW);
  const [source, setSource] = useState<Source>('upload');
  const [photos, setPhotos] = useState<PhotoMap>(emptyPhotos());
  const [room, setRoom] = useState<{ width: number; depth: number } | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<CaptureSlot | null>(null);
  /** single polite live region for everything that happens without a page change */
  const [announce, setAnnounce] = useState('');
  const dimUnit = useSettings((s) => s.dimUnit);
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

  // Mirror of `photos` readable from async handlers, so replacing or removing a
  // photo can revoke the URL it is retiring — and so `addFiles` can ask what is
  // already placed without closing over a stale render.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Every object URL this page mints is released on unmount. The old cleanup only
  // covered the ones created while rehydrating, so each upload leaked one.
  useEffect(
    () => () => {
      Object.values(photosRef.current).forEach((p) => p && URL.revokeObjectURL(p.url));
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
        // …and on screen too, so what is in state is what is in the store. The
        // bearing lives in the same object and now decides a wall, so a `pose`
        // that has drifted from its record is no longer a cosmetic difference.
        setPhotos((prev) => {
          const next = { ...prev };
          for (const s of SLOT_ORDER) {
            const p = next[s];
            if (p) next[s] = { ...p, pose: { ...p.pose, heightM: n } };
          }
          return next;
        });
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [heightDraft, camHeightM, roomId, setCamHeight]);

  // Rehydrate from IndexedDB: photos survive leaving and coming back.
  useEffect(() => {
    if (!roomId) return;
    let stale = false;
    (async () => {
      const [caps, meta] = await Promise.all([roomStore.loadCaptures(roomId), roomStore.loadRoom(roomId)]);
      if (stale) return;
      Object.values(photosRef.current).forEach((p) => p && URL.revokeObjectURL(p.url));
      const next = emptyPhotos();
      for (const c of caps) {
        next[c.slot] = { blob: c.blob, url: blobToObjectUrl(c.blob), quality: null, pose: c.pose };
      }
      setPhotos(next);
      // Width and depth are what make "Wall 2 · the 4.2 m wall" possible, and that
      // line is the only check a person can make against their own photograph.
      if (meta) setRoom({ width: meta.width, depth: meta.depth });
      for (const c of caps) {
        // `patchIfSame`, not a write by slot: scoring is async and the user can
        // rotate the set while it is still running.
        scoreQuality(c.blob).then((q) => setPhotos((prev) => patchIfSame(prev, c.slot, c.blob, { quality: q })));
      }
    })();
    return () => {
      stale = true;
    };
  }, [roomId]);

  /** `blob` is stored as given — callers normalise first (see addFiles / shoot),
   *  so nothing full-resolution reaches IndexedDB or the detection request.
   *  `pose` is what we managed to learn about the camera, read from the ORIGINAL
   *  file before normalising stripped it (see readCaptureFacts). */
  async function persistPhoto(
    slot: CaptureSlot,
    blob: Blob,
    pose: CapturePose | undefined,
    by: SlotSignal,
    clashedWith?: CaptureSlot,
  ) {
    if (!roomId) return;
    await roomStore.saveCapture(roomId, { slot, blob, takenAt: Date.now(), pose });
    const retiring = photosRef.current[slot]?.url;
    setPhotos((p) => ({ ...p, [slot]: { blob, url: blobToObjectUrl(blob), quality: null, pose, by, clashedWith } }));
    if (retiring) URL.revokeObjectURL(retiring);
    // Keyed on the blob, not the wall. A score started for this photo must not
    // land on whichever photo occupies this wall by the time it resolves — which
    // is exactly what a rotation mid-scoring used to make happen.
    scoreQuality(blob).then((q) => setPhotos((prev) => patchIfSame(prev, slot, blob, { quality: q })));
  }

  /**
   * Take in photos and work out which wall each one is.
   *
   * The four labelled bays are gone, so this is the whole ingest: drop or pick
   * any number in any order and `placePhotos` files them, saying which rung of
   * its ladder answered. It no longer takes a starting slot, because there is no
   * longer a card to have dropped them on.
   */
  async function addFiles(list: FileList | File[] | null) {
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

    // Read what each ORIGINAL file knows about itself first: `normalizePhoto`
    // strips exactly the metadata the wall is decided from, which is the point of
    // the strip. Then place, then normalise — in that order, and never the other.
    const read = await Promise.all(files.map((f) => readCaptureFacts(f, { heightM: statedHeight })));
    const { placed, rejected } = placePhotos(
      placedIn(photosRef.current),
      read.map((r) => r.facts),
    );

    // Decode + re-encode all of them at once; each was a full serialised decode
    // before, so four photos meant four round trips of nothing happening.
    const prepared = await Promise.all(
      placed.map(async (p) => ({ p, blob: await normalizePhoto(files[p.index]) })),
    );
    for (const { p, blob } of prepared) {
      await persistPhoto(p.slot, blob, read[p.index].pose, p.by, p.clashedWith);
    }

    setAnnounce(describePlacement({ placed, rejected }, labelOf));
  }

  /** Replace one wall's photo in place. Distinct from `addFiles`, which would
   *  auto-place it: the user pointed at a card, so the wall is already decided. */
  async function replacePhoto(slot: CaptureSlot, list: FileList | File[] | null) {
    const file = Array.from(list ?? []).filter(isAcceptedPhoto)[0];
    if (!file) {
      setAnnounce('Danmu can’t read that kind of file. Choose a photo — JPEG, PNG, WebP or HEIC.');
      return;
    }
    const { pose } = await readCaptureFacts(file, { heightM: statedHeight });
    await persistPhoto(slot, await normalizePhoto(file), pose, 'manual');
    setAnnounce(`${labelOf(slot)} photo replaced.`);
  }

  async function removePhoto(slot: CaptureSlot) {
    if (!roomId) return;
    await roomStore.deleteCapture(roomId, slot);
    const retiring = photosRef.current[slot]?.url;
    setPhotos((p) => clearSlot(p, slot));
    if (retiring) URL.revokeObjectURL(retiring);
    setAnnounce(`${labelOf(slot)} photo removed.`);
  }

  async function movePhoto(from: CaptureSlot, to: CaptureSlot) {
    if (!roomId || from === to) return;
    const moving = photosRef.current[from];
    if (!moving) return;
    const displaced = photosRef.current[to];
    // One store operation rather than two saves and a delete: `reslotCaptures`
    // carries the whole record — pose included — and writes before it deletes.
    // The version this replaces re-wrote `{ slot, blob, takenAt }` and dropped
    // the pose, so reordering photos threw away the focal length, the tilt, and
    // the bearing.
    await roomStore.reslotCaptures(roomId, swapMapping(photosRef.current, from, to));
    setPhotos((p) => swapSet(p, from, to));
    setAnnounce(
      displaced ? `Swapped ${labelOf(from)} and ${labelOf(to)}.` : `Moved photo to ${labelOf(to)}.`,
    );
  }

  /** Turn every label one wall round. The set stays four consecutive walls in
   *  order; only where it starts changes — and because the anchor is derived from
   *  where the photos now sit, the next photo to arrive follows the correction
   *  without anything having to remember it. */
  async function rotateAll(steps: number) {
    if (!roomId) return;
    await roomStore.reslotCaptures(roomId, rotationMapping(steps));
    setPhotos((p) => rotateSet(p, steps));
    setAnnounce(`Walls turned ${steps > 0 ? 'forwards' : 'back'} one.`);
  }

  const filledSlots = SLOT_ORDER.filter((s) => photos[s]);
  const filled = filledSlots.length;
  const anyCaptured = filled > 0;
  const allCaptured = filled === SLOT_ORDER.length;
  const flaggedCount = filledSlots.filter((s) => {
    const q = photos[s]!.quality;
    return !!q && !q.flags.includes('ok');
  }).length;
  // Which wall the camera is shooting next, from the same function that places an
  // upload — so the viewfinder's promise and the ingest cannot disagree.
  const nextSlot = useMemo(
    () => placePhotos(placedIn(photos), [{}]).placed[0]?.slot ?? null,
    [photos],
  );
  /** Only worth showing when the walls are actually different lengths; in a square
   *  room every rotation measures the same and the number would be noise. */
  const spanLabel = (slot: CaptureSlot) =>
    room && room.width !== room.depth
      ? // `formatDim` returns the number alone, so the unit has to come from the
        // setting beside it — a bare "5.60 wall" is not a measurement.
        `${formatDim(wallSpan(slot, room) * 1000, dimUnit)} ${dimUnit}`
      : null;

  // Arriving here without a room (a shared link, a cleared browser) used to do
  // nothing at all — every upload silently no-oped.
  if (!roomId) {
    return (
      <div className="page-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--paper)' }}>
        <div className="ds-card" style={{ maxWidth: 'var(--measure-card)', padding: 24, textAlign: 'center' }}>
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

  const method = (
    <div style={{ padding: narrow ? '12px 14px 0' : '14px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="info" size={14} color="var(--accent-text)" style={{ marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-2)', minWidth: 0 }}>
          {CAPTURE_METHOD}{' '}
          <span style={{ color: 'var(--ink-3)' }}>
            One photo is enough to start; four gets the closest room. Add them in any order — each photo’s own compass
            names its wall where it has one.
          </span>
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
        {/* A span, not a label: NumberField takes no `id`, so the `htmlFor` that
            used to be here pointed at nothing. The field carries its own
            accessible name via `ariaLabel`. */}
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Phone height off the floor</span>
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

  const gallery = (compact: boolean) => (
    <>
      {filledSlots.map((slot) => (
        <PhotoCard
          key={slot}
          slot={slot}
          photo={photos[slot]!}
          span={spanLabel(slot)}
          compact={compact}
          filled={photos}
          onReplace={(list) => replacePhoto(slot, list)}
          onRemove={() => removePhoto(slot)}
          onMoveTo={(to) => movePhoto(slot, to)}
          draggingFrom={draggingFrom}
          setDraggingFrom={setDraggingFrom}
          onDropFrom={(from) => movePhoto(from, slot)}
        />
      ))}
      {!allCaptured && <AddTile compact={compact} first={!anyCaptured} onFiles={addFiles} />}
    </>
  );

  const cameraPanel = (
    <CameraPanel
      nextSlot={nextSlot}
      onStart={requestAccess}
      // Awaited by the shutter, deliberately. The wall is now the FIRST FREE one
      // rather than a wall the user picked, so two presses landing before the
      // first write completes would both aim at the same slot and the second
      // would overwrite the first — a photo lost, silently. While `target` was a
      // picker that was merely a re-take of the wall you had chosen.
      onCapture={async (blob) => {
        if (!nextSlot) return;
        // A canvas snapshot carries no EXIF, so the pose here is only what the
        // device measured — the tilt an uploaded photo can never tell us, and
        // the height the user gave us. The WALL is arrival order, which on this
        // path is the strongest signal there is: the instruction on screen is
        // telling them to make it true, and they are standing in the room.
        const { pose } = await readCaptureFacts(blob, {
          tiltDeg: tilt ?? undefined,
          heightM: statedHeight,
        });
        await persistPhoto(nextSlot, blob, pose, 'order');
        setAnnounce(`Photo taken for ${labelOf(nextSlot)}.`);
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
        {/* The mark links here: `persistPhoto` writes every shot to IndexedDB as
            it is taken, so leaving this screen costs nothing. */}
        <FlowBarLead onBack={() => router.back()} markHref="/workspace">
          <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 700 }}>Photograph your room</span>
        </FlowBarLead>
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
        // Phone + camera: the viewfinder gets the screen, the photos become a
        // filmstrip under the shutter. A 360px side rail here left ~30px for the
        // gallery the old copy told people to click.
        <>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 320 }}>{cameraPanel}</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 14px' }}>{gallery(true)}</div>
        </>
      ) : (
        <div
          // .split--stack only while a 360px rail exists — it also protects the
          // first paint on a phone, before the JS breakpoint has resolved.
          className={`split${source === 'camera' ? ' split--stack' : ''}`}
          style={{ flex: 1, gridTemplateColumns: source === 'camera' ? '1fr 360px' : '1fr', minHeight: 0 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
            {method}
            {anyCaptured && (
              <WallControls square={!!room && room.width === room.depth} onRotate={rotateAll} />
            )}
            <div
              style={{
                display: 'grid',
                // auto-fill, not two fixed columns: the gallery now holds one to
                // four cards plus an add tile, and a 2×2 grid left a lone photo
                // occupying a quarter of the screen next to three empty cells.
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
                gap: 8,
                padding: narrow ? 14 : 16,
                alignContent: 'start',
                flex: 1,
                minHeight: 0,
              }}
            >
              {gallery(false)}
            </div>
          </div>

          {source === 'camera' && <div className="rail rail--right">{cameraPanel}</div>}
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

/** Turn the whole set of labels round by one wall.
 *
 *  This is the control the no-bearing case needs, and the one a bad magnetometer
 *  reading needs too. A set can only ever be wrong by a whole number of
 *  quarter-turns — the photos are four consecutive walls whatever else is true —
 *  so one control fixes every case of it at once. */
function WallControls({ square, onRotate }: { square: boolean; onRotate: (steps: number) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '12px 16px 0',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)', minWidth: 0 }}>
        {square
          ? 'Wrong wall on a photo? Move it, or turn the whole set round.'
          : 'Check each photo against the wall length beside it — if the whole set is one wall out, turn it round.'}
      </span>
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
        <button
          className="ds-btn"
          style={{ height: 30, fontSize: 12 }}
          onClick={() => onRotate(-1)}
          title="Every photo moves back one wall"
        >
          <Icon name="rotate-ccw" size={12} />
          Back one
        </button>
        <button
          className="ds-btn"
          style={{ height: 30, fontSize: 12 }}
          onClick={() => onRotate(1)}
          title="Every photo moves on one wall"
        >
          <Icon name="rotate-cw" size={12} />
          On one
        </button>
      </div>
    </div>
  );
}

/** The way photos get in, now that there are no bays to drop them onto. */
function AddTile({
  compact,
  first,
  onFiles,
}: {
  compact: boolean;
  first: boolean;
  onFiles: (list: FileList | File[] | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      }}
      style={{
        display: 'flex',
        borderRadius: 'var(--r-3)',
        background: 'var(--paper-2)',
        border: over ? '2px solid var(--accent)' : '1px dashed var(--edge)',
        minHeight: compact ? 96 : 132,
        // The first tile is the whole screen's call to action, so it may run wider
        // than one column; every later one is just the next card along.
        ...(compact ? { flex: '0 0 148px' } : { minWidth: 0, ...(first ? { gridColumn: '1 / -1' } : {}) }),
      }}
    >
      <button
        type="button"
        className="slot-card"
        onClick={() => inputRef.current?.click()}
        aria-label="Add photos of your room. We work out which wall each one is."
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          padding: compact ? 8 : 18,
          background: 'transparent',
          border: 0,
          borderRadius: 'inherit',
          cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        <Icon name="plus" size={compact ? 18 : 22} color="var(--ink-3)" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          {first ? 'Add photos' : 'Add another'}
        </span>
        {!compact && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-2)', lineHeight: 1.35 }}>
            Tap to choose, or drop them here. Up to four — one per wall.
          </span>
        )}
      </button>

      {/* .sr-only, never display:none — a hidden-by-display file input is gone
          from the accessibility tree entirely. `multiple` so one pick can fill
          every wall at once. */}
      <input
        ref={inputRef}
        type="file"
        // The same allowlist addFiles enforces, so the file dialog and the app
        // agree about what counts as a photo.
        accept={ACCEPTED_PHOTO_TYPES.join(',')}
        multiple
        className="sr-only"
        aria-label="Choose photos of your room"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function PhotoCard({
  slot,
  photo,
  span,
  compact,
  filled,
  onReplace,
  onRemove,
  onMoveTo,
  draggingFrom,
  setDraggingFrom,
  onDropFrom,
}: {
  slot: CaptureSlot;
  photo: Photo;
  span: string | null;
  compact: boolean;
  filled: PhotoMap;
  onReplace: (list: FileList | File[] | null) => void;
  onRemove: () => void;
  onMoveTo: (to: CaptureSlot) => void;
  draggingFrom: CaptureSlot | null;
  setDraggingFrom: (s: CaptureSlot | null) => void;
  onDropFrom: (from: CaptureSlot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const label = labelOf(slot);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // A file dropped onto a card replaces that card's photo — the wall is
        // already decided by where it landed.
        if (e.dataTransfer.files?.length) {
          onReplace(e.dataTransfer.files);
          return;
        }
        if (draggingFrom && draggingFrom !== slot) onDropFrom(draggingFrom);
      }}
      style={{
        position: 'relative',
        display: 'flex',
        borderRadius: 'var(--r-3)',
        background: 'var(--ink)',
        border: over ? '2px solid var(--accent)' : '1px solid var(--edge)',
        minHeight: compact ? 96 : 150,
        ...(compact ? { flex: '0 0 148px' } : { minWidth: 0 }),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={`Your photo of ${label}`}
        draggable
        onDragStart={(e) => {
          setDraggingFrom(slot);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDraggingFrom(null)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', cursor: 'grab' }}
      />

      {/* ONE wrapping row, not a chip pinned left and a cluster pinned right.
          Two absolutely-positioned children cannot reflow past each other, and
          these are opaque: measured at 11px/700, the label runs 159px and the
          three actions 189px, so on the narrowest gallery card (240px, 224px of
          content) they overlapped by 132px and the buttons simply printed over
          the wall name. That is the second failure mode CLAUDE.md rule 4 names,
          and the fix is the one it prescribes — let it wrap. */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 6,
        }}
      >
        <span style={{ ...photoChrome(), cursor: 'default' }}>
          <Icon name="check" size={11} color="var(--on-ink)" />
          {label}
          {/* Derived from the room's own width and depth — never a number typed in
              beside the thing it describes. It is what makes "turn the set round"
              a decision the user can take rather than a guess. Dropped in the
              filmstrip, where 132px of content cannot hold it and a `nowrap` chip
              does not shrink, it spills. */}
          {span && !compact && <span style={{ fontWeight: 600, opacity: 0.8 }}>· {span} wall</span>}
        </span>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Replace and Move belong to the gallery, where there is room for them
              and where someone is actually working on the assignment. The
              filmstrip under a live viewfinder keeps only Remove — it is a
              reference strip, and the one thing you want from a bad shot there is
              to get rid of it and take another. */}
          {!compact && (
            <button type="button" style={photoChrome()} onClick={() => inputRef.current?.click()}>
              Replace
            </button>
          )}
          {/* There was previously no way to take a photo back out — someone who
              uploaded a shot with family in it was stuck with it. */}
          <button type="button" style={photoChrome()} onClick={onRemove}>
            Remove
          </button>
          {/* Reordering was drag-only, i.e. impossible without a mouse. */}
          {!compact && <MoveMenu slot={slot} filled={filled} onMoveTo={onMoveTo} />}
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {photo.clashedWith && (
          <span
            title={`This photo’s compass pointed at ${labelOf(photo.clashedWith)}, which already had one. It may be a second photo of the same wall.`}
            style={{ ...photoChrome(), cursor: 'default', background: 'var(--warn)', color: 'var(--on-accent)' }}
          >
            <Icon name="info" size={11} color="var(--on-accent)" />
            Maybe {labelOf(photo.clashedWith)} again
          </span>
        )}
        {/* Reason and quality are gallery-only for the same reason as Replace:
            a 148px filmstrip card cannot hold a nowrap chip reading "from the
            order you added it", and the top bar already carries the count of
            photos that could be clearer. The clash chip stays in both, because it
            is the only one that is asking for something. */}
        {!compact && photo.by && !photo.clashedWith && (
          <span style={{ ...photoChrome(), cursor: 'default', background: 'var(--paper)', color: 'var(--ink-2)' }}>
            {REASON[photo.by]}
          </span>
        )}
        {!compact &&
          (photo.quality ? (
            photo.quality.flags.map((f) => {
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
          ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_PHOTO_TYPES.join(',')}
        className="sr-only"
        aria-label={`Choose a different photo for ${label}`}
        onChange={(e) => {
          onReplace(e.target.files);
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
  filled,
  onMoveTo,
}: {
  slot: CaptureSlot;
  filled: PhotoMap;
  onMoveTo: (to: CaptureSlot) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const others = SLOT_ORDER.filter((s) => s !== slot);

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
          aria-label={`Move the ${labelOf(slot)} photo`}
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
              key={o}
              type="button"
              role="menuitem"
              className="list-row"
              style={{ fontSize: 12.5 }}
              onClick={() => {
                onMoveTo(o);
                setOpen(false);
              }}
            >
              {labelOf(o)}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>
                {filled[o] ? 'swap' : 'empty'}
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
  nextSlot,
  onCapture,
  onStart,
  onUseUpload,
}: {
  /** The wall the next shot goes on, or null when all four have a photo. Decided
   *  by `placePhotos`, not by a picker — the "wall to shoot" segmented control
   *  existed to drive the four-bay grid, and asking someone to keep a bookkeeping
   *  promise while turning on the spot is exactly the ritual this phase retires.
   *  Arrival order is the answer here, and the instruction below is what makes
   *  it true. */
  nextSlot: CaptureSlot | null;
  /** Awaited: the shutter must not fire twice into one wall. See the call site. */
  onCapture: (blob: Blob) => void | Promise<void>;
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
  const nextLabel = nextSlot ? labelOf(nextSlot) : null;

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
    if (!videoRef.current || shooting || !nextSlot) return;
    setShooting(true);
    try {
      await onCapture(await snapToBlob(videoRef.current));
    } finally {
      setShooting(false);
    }
  }

  const head = (
    <div className="section">
      <span className="ds-label">Camera</span>
      <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '6px 0 8px', lineHeight: 1.45 }}>
        {CAPTURE_METHOD}
      </p>
      {/* What used to be a four-way "Wall to shoot" picker. The sequence is the
          answer, so the panel states where you are in it instead of asking. */}
      <p style={{ fontSize: 12.5, color: 'var(--ink)', margin: 0, lineHeight: 1.45 }}>
        {nextSlot ? (
          <>
            <strong>Next: {nextLabel}</strong>{' '}
            <span style={{ color: 'var(--ink-2)' }}>{turnOf(nextSlot)}</span>
          </>
        ) : (
          <span style={{ color: 'var(--ink-2)' }}>
            All four walls have a photo. Remove one to retake it.
          </span>
        )}
      </p>
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
          <h2 style={{ fontSize: 15, color: 'var(--ink)' }}>
            {nextLabel ? `Shoot ${nextLabel} with this device` : 'Every wall has a photo'}
          </h2>
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
          aria-label={nextLabel ? `Live camera preview, aimed at ${nextLabel}` : 'Live camera preview'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <span style={{ ...photoChrome(), position: 'absolute', top: 8, left: 8, cursor: 'default' }}>
          {nextLabel ? `Shooting · ${nextLabel}` : 'All four walls done'}
        </span>
        <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={shoot}
            disabled={shooting || !nextSlot}
            aria-label={nextLabel ? `Take the photo for ${nextLabel}` : 'All four walls already have a photo'}
            style={{
              width: 60,
              height: 60,
              borderRadius: 'var(--r-full)',
              background: 'var(--paper)',
              border: '4px solid var(--accent-tint-strong)',
              cursor: shooting ? 'progress' : nextSlot ? 'pointer' : 'not-allowed',
              opacity: shooting || !nextSlot ? 0.6 : 1,
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 'var(--r-full)', background: 'var(--accent)', margin: 'auto' }} />
          </button>
        </div>
      </div>
    </>
  );
}

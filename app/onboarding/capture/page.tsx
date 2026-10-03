'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRoom, useSettings, CAM_HEIGHT_MIN, CAM_HEIGHT_MAX } from '@/lib/store';
import { roomStore, blobToObjectUrl } from '@/lib/storage';
import {
  ACCEPTED_PHOTO_TYPES,
  CAPTURE_METHOD,
  CAPTURE_STEPS,
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
  swapMapping,
  swapSet,
  type PlacedPhoto,
  type SlotMap,
  type SlotSignal,
} from '@/lib/capture-slots';
import { wallFrame } from '@/lib/photo-geometry';
import { roomFootprint } from '@/lib/footprint';
import { looseDropIntent, photoDropIntent } from '@/lib/photo-drop';
import { useDeviceTilt } from '@/lib/device-tilt';
import { scoreQuality, flagHelp, flagLabel, flagTone, type Quality } from '@/lib/image-quality';
import { useMediaQuery } from '@/lib/use-media-query';
import { formatDim } from '@/lib/units';
import { Icon } from '@/components/ui/Icon';
import { Select, type SelectOption } from '@/components/ui/Select';
import { NumberField } from '@/components/ui/NumberField';
import { FlowBarLead, Pill, Segmented } from '@/components/ui/primitives';
import { FlowStepper } from '@/components/ui/FlowStepper';
import { framedWall } from '@/lib/capture-plan';
import type { CaptureSlot, CapturePose } from '@/lib/storage';

type Source = 'upload' | 'camera';

/** One photo, everything this screen knows about it.
 *
 *  Was four parallel `Record<CaptureSlot, T | null>` maps, which is fine until
 *  the walls can be permuted: moving a photo then means permuting four maps in
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
 *  photo because a wrong wall is a wrong room — `wallFrame` reads the framed wall's
 *  distance across the room's depth for n/s and across its width for e/w, so a photo
 *  filed under the wrong wall is measured from the wrong distance — and the user is
 *  the only one who can see whether we got it right. (It named `wallDistance` until
 *  § 44 deleted it; the convention is the same, the function is not.) */
const REASON: Record<SlotSignal, string> = {
  bearing: 'Placed by compass',
  time: 'Placed by shutter time',
  order: 'Placed by order added',
  manual: 'Placed by you',
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
  // The room's OUTLINE, not the box around it. `layoutId` and `footprint` are here because
  // `spanLabel` measures the framed wall with `wallFrame`, which needs the polygon — see
  // the note at the read below for what holding only width/depth cost.
  const [room, setRoom] = useState<{
    width: number;
    depth: number;
    layoutId: string | undefined;
    footprint?: Array<[number, number]>;
    /** The size is the shape's typical one (`RoomData.roughSize`), so the wall
     *  lengths beside the photos are too, and say so. */
    roughSize: boolean;
  } | null>(null);
  const [draggingFrom, setDraggingFrom] = useState<CaptureSlot | null>(null);
  /** The wall whose name is being pointed at or focused, on a card or in its Wall
   *  list. The plan shimmers that wall, so a name on a card and a line on the room
   *  are the same thing to the eye. */
  const [shimmer, setShimmer] = useState<CaptureSlot | null>(null);
  const takesDrop = (e: React.DragEvent) => draggingFrom !== null || carriesFiles(e);
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
      // The wall-length label is the only check a person can make against their own
      // photograph, so it has to describe the room they are standing in.
      //
      // THIS LINE READ `setRoom({ width: meta.width, depth: meta.depth })` and the comment
      // above it said "width and depth are what make 'Wall 2 · the 4.2 m wall' possible".
      // That was true while the label read `wallSpan`. § 44b repointed it at
      // `wallFrame(slot, roomFootprint(room))` and did not come here — and because
      // `roomFootprint`'s `layoutId` was OPTIONAL, a `{ width, depth }` object type-checked
      // and fell back to `'rect'`, so every preset was measured as a rectangle and a
      // T-Shape's stem wall went on being announced as 4.70 m against a real 2.58.
      // `scripts/capture-route-probe.mjs` measured it in a browser: the label printed the
      // same number before and after § 44b, while the geometry on the next screen moved
      // 3.64×. A comment stating the superseded reason is what kept it standing.
      if (meta)
        setRoom({
          width: meta.width,
          depth: meta.depth,
          layoutId: meta.layoutId,
          footprint: meta.footprint,
          roughSize: meta.roughSize === true,
        });
      for (const c of caps) {
        // `patchIfSame`, not a write by slot: scoring is async and the user can
        // move a photo to another wall while it is still running.
        scoreQuality(c.blob).then((q) => setPhotos((prev) => patchIfSame(prev, c.slot, c.blob, { quality: q })));
      }
    })();
    return () => {
      stale = true;
    };
  }, [roomId]);

  /** What to say when a write to IndexedDB refuses.
   *
   *  Every `roomStore` call on this screen used to be unguarded. Two things throw:
   *  a quota failure, which `lib/storage.ts` re-raises after dispatching
   *  `danmu:storage-full`, and `reslotCaptures`, which throws outright if a mapping
   *  would land two photos on one wall. Neither was caught, so the screen said
   *  NOTHING — and in `addFiles` the throw also skipped the `setAnnounce` at the end
   *  of the loop, so a batch that half-landed reported neither the half that did nor
   *  the half that did not.
   *
   *  It deliberately does not apologise or guess the cause. The quota case already
   *  has the global banner (`StorageToast` listens for that event); what this screen
   *  owes the user is what is now TRUE on it, which is why every caller below leaves
   *  the tiles showing the store rather than what it just tried to write. */
  function writeFailed(what: string): string {
    return `${what} could not be saved. Your other photos are safe. Try again, or continue with the walls you have.`;
  }

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
    // is exactly what moving photos mid-scoring used to make happen.
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
          ? 'Danmu can’t read that kind of file. Choose a JPEG, PNG, WebP or HEIC photo.'
          : 'That file is not an image. Choose a JPEG, PNG, WebP or HEIC photo.',
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
    // One at a time, and a failure does not abandon the rest: the photos after the
    // one that threw are just as savable, and the old loop dropped them silently.
    const landed: typeof placed = [];
    const refused: CaptureSlot[] = [];
    for (const { p, blob } of prepared) {
      try {
        await persistPhoto(p.slot, blob, read[p.index].pose, p.by, p.clashedWith);
        landed.push(p);
      } catch {
        refused.push(p.slot);
      }
    }

    // The placement sentence describes what is ON the screen, so it is built from
    // what landed rather than from what was attempted.
    const said = describePlacement({ placed: landed, rejected }, labelOf);
    setAnnounce(
      refused.length === 0
        ? said
        : `${said} ${writeFailed(refused.length === 1 ? `The ${labelOf(refused[0])} photo` : `${refused.length} photos`)}`,
    );
  }

  /** Replace one wall's photo in place. Distinct from `addFiles`, which would
   *  auto-place it: the user pointed at a card, so the wall is already decided. */
  async function replacePhoto(slot: CaptureSlot, list: FileList | File[] | null) {
    const file = Array.from(list ?? []).filter(isAcceptedPhoto)[0];
    if (!file) {
      setAnnounce('Danmu can’t read that kind of file. Choose a JPEG, PNG, WebP or HEIC photo.');
      return;
    }
    const { pose } = await readCaptureFacts(file, { heightM: statedHeight });
    try {
      await persistPhoto(slot, await normalizePhoto(file), pose, 'manual');
    } catch {
      setAnnounce(writeFailed(`The new ${labelOf(slot)} photo`));
      return;
    }
    setAnnounce(`${labelOf(slot)} photo replaced.`);
  }

  async function removePhoto(slot: CaptureSlot) {
    if (!roomId) return;
    try {
      await roomStore.deleteCapture(roomId, slot);
    } catch {
      // Deliberately does NOT clear the tile. The photo is still in the store, so a
      // screen that showed it gone would be lying about what a re-scan will read.
      setAnnounce(writeFailed(`Removing the ${labelOf(slot)} photo`));
      return;
    }
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
    try {
      await roomStore.reslotCaptures(roomId, swapMapping(photosRef.current, from, to));
    } catch {
      // `reslotCaptures` throws rather than half-applying, so the store still holds
      // the old arrangement and the tiles must keep showing it.
      setAnnounce(writeFailed(`Moving the ${labelOf(from)} photo`));
      return;
    }
    setPhotos((p) => swapSet(p, from, to));
    setAnnounce(
      displaced ? `Swapped ${labelOf(from)} and ${labelOf(to)}.` : `Moved photo to ${labelOf(to)}.`,
    );
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
  /** How long each wall really is, from the ROOM'S OUTLINE rather than the box
   *  around it. This used to read `wallSpan`, a bounding-box side, which survived
   *  the ±half pair's deletion on the measured ground that a span is the one
   *  quantity the two conventions agree on — true of a rectangle, dragged or not,
   *  and false of every preset that cuts a corner. A `t`'s stem wall is 2.58 m long
   *  and the box said 4.70; a `u`'s north view has no wall in front of it at all.
   *  This number is the one check a person can make against their own photograph,
   *  so it is the last place in the app that should be describing a different room
   *  than the one on screen. Null where the lens has no wall ahead of it. */
  const wallSpans = useMemo(() => {
    if (!room) return null;
    const fp = roomFootprint(room);
    const out = {} as Record<CaptureSlot, number | null>;
    for (const slot of SLOT_ORDER) {
      const frame = wallFrame(slot, fp);
      out[slot] = frame ? frame.right - frame.left : null;
    }
    return out;
  }, [room]);
  /** Only worth showing when the walls are actually different lengths; in a square
   *  room every wall measures the same and the number would be noise. */
  const spanLabel = (slot: CaptureSlot) => {
    const span = wallSpans?.[slot];
    if (span == null || !wallSpans) return null;
    const known = SLOT_ORDER.map((s) => wallSpans[s]).filter((v): v is number => v != null);
    if (known.every((v) => v === known[0])) return null;
    // `formatDim` returns the number alone, so the unit has to come from the
    // setting beside it — a bare "5.60 wall" is not a measurement. `≈` when the
    // room is still its shape's typical size: the label is then a typical wall's
    // length, which still tells the long walls from the short ones but is not a
    // number to hold a tape measure against.
    return `${room?.roughSize ? '≈' : ''}${formatDim(span * 1000, dimUnit)} ${dimUnit}`;
  };

  // Arriving here without a room (a shared link, a cleared browser) used to do
  // nothing at all — every upload silently no-oped.
  if (!roomId) {
    return (
      <div className="page-pad" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--paper)' }}>
        <div className="ds-card" style={{ maxWidth: 'var(--measure-card)', padding: 24, textAlign: 'center' }}>
          <Icon name="camera" size={22} color="var(--ink-3)" style={{ margin: '0 auto 10px' }} />
          <h1 style={{ fontSize: 'var(--fs-title)', marginBottom: 8 }}>Pick a room shape first</h1>
          <p className="t-body" style={{ lineHeight: 1.5, margin: '0 0 18px' }}>
            Photos are saved into a room, and no room is open on this device yet. Choose a footprint, then come back
            here.
          </p>
          <Link href="/onboarding/layout-pick" className="ds-btn ds-btn--lg ds-btn--accent ds-btn--block-compact">
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
      style={full ? { height: 48, width: '100%', justifyContent: 'center', fontSize: 'var(--fs-body)' } : { height: 34, fontSize: 'var(--fs-small)' }}
      disabled={!anyCaptured}
      onClick={() => router.push('/onboarding/detect')}
    >
      {forwardLabel}
      <Icon name="arrow-right" size={13} color="var(--on-accent)" />
    </button>
  );

  const nextSpan = nextSlot ? spanLabel(nextSlot) : null;
  // The how-to, the room's plan with the next wall lit, and the phone height: what
  // a person reads before the first shot, kept beside the photos rather than in a
  // line over them.
  //
  // Two pieces, so a phone can put the photos between them: the title, then the
  // add tile, then the how-to. In that order in the DOM too, rather than a visual
  // reorder — on a laptop the grid's areas stack the two pieces in the left column.
  // The height can be answered after the photos: committing it re-stamps them.
  const guideHead = (
    <div className="capture-head">
      <h1 className="capture-guide__title">Photograph your room</h1>
      <p className="capture-guide__lede">One photo of each wall, taken from the middle of the room.</p>
    </div>
  );
  const guide = (
    <div className="capture-guide">
      <ol className="capture-steps">
        {CAPTURE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {room && (
        <figure className="capture-card">
          <WallPlan footprint={roomFootprint(room)} filled={photos} next={nextSlot} shimmer={shimmer} />
          <figcaption className="t-small">
            {nextSlot ? (
              <>
                Next: <b>{labelOf(nextSlot)}</b>
                {nextSpan && <>, the {nextSpan} wall</>}
                {/* The plan lights what the geometry measures from, and from the
                    middle of some outlines one view has no wall straight ahead (the
                    U's first). Said, rather than a caption pointing at nothing. */}
                {!framedWall(nextSlot, roomFootprint(room)) && <> — from the middle of this shape there is no wall straight ahead, so it is not marked</>}
              </>
            ) : (
              <b>All four walls added</b>
            )}
          </figcaption>
        </figure>
      )}
      {/* "Chest height" above is the one number the geometry engine cannot see and
          cannot do without: every distance it reads off a photo scales directly
          with it. Asking is a 10-second question that removes a ±17% error, so it
          sits with the instruction it makes precise rather than in Settings. */}
      <div className="capture-card capture-height">
        {/* A span, not a label: NumberField takes no `id`. The field carries its
            own accessible name via `ariaLabel`. */}
        <span className="capture-height__text">
          <b>Phone height</b>
          <span className="t-small">Off the floor, to the lens</span>
        </span>
        <span className="capture-height__field">
          <NumberField
            value={heightDraft}
            onChange={setHeightDraft}
            step={0.05}
            min={CAM_HEIGHT_MIN}
            max={CAM_HEIGHT_MAX}
            height={36}
            ariaLabel="Phone height off the floor, in metres"
            style={{ width: 96 }}
          />
          <span className="t-meta">m</span>
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
          onShimmer={setShimmer}
          draggingFrom={draggingFrom}
          setDraggingFrom={setDraggingFrom}
          onDropFrom={(from) => movePhoto(from, slot)}
        />
      ))}
      {!allCaptured && <AddTile compact={compact} first={!anyCaptured} cardDragging={draggingFrom !== null} onFiles={addFiles} />}
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
      // A photo let go anywhere but on a card is added, rather than opened by the
      // browser in place of the app (`looseDropIntent`). A card has already claimed
      // its own drop by the time one bubbles here. Only a drag carrying a file, or a
      // card's own, is the page's to take: text dragged into a field is the field's,
      // and cancelling that drop is what stops the text landing.
      onDragOver={(e) => {
        if (takesDrop(e)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.defaultPrevented || !takesDrop(e)) return;
        e.preventDefault();
        const intent = looseDropIntent({ draggingFrom, hasFiles: !!e.dataTransfer.files?.length });
        if (intent.kind === 'add') void addFiles(e.dataTransfer.files);
      }}
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
        <FlowBarLead onBack={() => router.back()} markHref="/">
          <span style={{ fontSize: 'var(--fs-body)', color: 'var(--ink)', fontWeight: 700 }}>Photograph your room</span>
        </FlowBarLead>
        <span role="status" aria-live="polite" className="t-meta">
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
          className="ds-btn ds-btn--sm ds-btn--ghost"
          style={{ color: 'var(--ink-2)' }}
          title="Photos are optional. Decorate the shape you picked instead."
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
            {/* One centred column, the width of the layout picker's: the scroll box
                stays window-wide so its scrollbar is at the edge, and what is in it
                does not grow with the window. At 1920 the drop zone was 1,886px
                wide, and the buttons that turn the walls sat at the window's far
                edge, away from the sentence they answer. */}
            <div className="capture-page">
              <FlowStepper current="Photos" />
              <div className={`capture-layout${source === 'camera' ? ' capture-layout--camera' : ''}`}>
                {guideHead}
                <div className="capture-photos">
                  <div
                    style={{
                      display: 'grid',
                      // auto-fill, not two fixed columns: the gallery now holds one to
                      // four cards plus an add tile, and a 2×2 grid left a lone photo
                      // occupying a quarter of the screen next to three empty cells.
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
                      gap: 12,
                      alignContent: 'start',
                    }}
                  >
                    {gallery(false)}
                  </div>
                  {anyCaptured && (
                    <WallHint square={!!room && room.width === room.depth} />
                  )}
                </div>
                {guide}
              </div>
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

/** Which job a photo chip is doing. Three, because a card can carry six chips at
 *  once and they were all one weight — the wall it is a photo OF read exactly as
 *  loudly as the fact that the app checked its focus.
 *
 *  · `action` — pressable. Replace, Remove, Move.
 *  · `fact`   — identity, or something asking to be dealt with: the wall label,
 *               the clash warning, a quality flag. The default, because a chip
 *               that is not a button is the common case; `cursor: pointer` used to
 *               be the default here and six of the nine call sites had to override
 *               it back, which is the tell that the default was the wrong way up.
 *  · `quiet`  — derived or procedural: the wall's span, why this photo landed on
 *               this wall, "checking this photo…". True, worth having, and not
 *               what you look at the card to find out.
 *
 *  **The ground is a SOLID --ink in every tier and no variant may override it.**
 *  Two reasons, and the second was found the hard way. A translucent chip sits on
 *  a photograph nobody has seen, so its text contrast would be a promise about the
 *  user's own living room. And the chip's SILHOUETTE against that photograph is
 *  guaranteed only for this ground: --ink plus the --edge-on-ink boundary clears
 *  3:1 against every possible photo tone, where a --warn ground manages 1.93:1 and
 *  a --success-text ground 2.03:1 — unfixable by a heavier boundary, since a
 *  mid-dark ground and a light edge sit too close together in luminance.
 *
 *  The clash chip and the two quality flags DID override it, which both escaped
 *  that guarantee and broke it. So a chip that needs to signal something recolours
 *  its TYPE (--on-ink-warn, --on-ink-success) and never its ground. Quiet is
 *  spelled the same way, with weight, size and --on-ink-2 — all checkable, and
 *  never with alpha, which is not.
 *
 *  tests/color-tokens.test.ts holds both halves: the 3:1 guarantee, and that no
 *  call site in this file spreads photoChrome() and then sets a background. */
type ChromeTier = 'action' | 'fact' | 'quiet';

function photoChrome(tier: ChromeTier = 'fact'): CSSProperties {
  const quiet = tier === 'quiet';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: quiet ? 22 : 26,
    padding: quiet ? '0 8px' : '0 10px',
    borderRadius: 'var(--r-full)',
    background: 'var(--ink)',
    // Was `transparent`. A dark chip on a dark photo has no outline at all —
    // 1.00:1, measured — and --edge is --ink at 50%, so it cannot help here.
    // See --edge-on-ink in globals.css.
    border: '1px solid var(--edge-on-ink)',
    color: quiet ? 'var(--on-ink-2)' : 'var(--on-ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: quiet ? 'var(--fs-micro)' : 'var(--fs-caption)',
    fontWeight: quiet ? 600 : 700,
    whiteSpace: 'nowrap',
    cursor: tier === 'action' ? 'pointer' : 'default',
  };
}

/** The room's outline with each photo's wall marked: the next one to shoot lit in
 *  moss and numbered, the ones already photographed inked with a tick, the rest
 *  quiet. A dot at the middle is where to stand — the origin the geometry assumes
 *  the photos were taken from. Drawn in plan metres (north up), fitted to its box. */
function WallPlan({
  footprint,
  filled,
  next,
  shimmer,
}: {
  footprint: [number, number][];
  filled: PhotoMap;
  next: CaptureSlot | null;
  /** The wall to play the shimmer on — see `.capture-plan__wall[data-shimmer]`. */
  shimmer: CaptureSlot | null;
}) {
  const xs = footprint.map((p) => p[0]);
  const zs = footprint.map((p) => p[1]);
  const pad = 0.9;
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...zs) - minZ + pad;
  const walls = SLOT_ORDER.map((slot) => ({ slot, seg: framedWall(slot, footprint) }));
  const r = Math.max(w, h) * 0.055;
  return (
    <svg
      className="capture-plan"
      viewBox={`${minX} ${minZ} ${w} ${h}`}
      role="img"
      aria-label={`Your room from above. ${next ? `Next: ${labelOf(next)}.` : 'All four walls added.'}`}
    >
      <polygon points={footprint.map(([x, z]) => `${x},${z}`).join(' ')} fill="var(--paper)" stroke="var(--ink-4)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {walls.map(({ slot, seg }) => {
        if (!seg) return null;
        const state = slot === next ? 'next' : filled[slot] ? 'done' : 'later';
        const [[ax, az], [bx, bz]] = seg;
        // The number sits just inside the wall, toward the stander.
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const len = Math.hypot(mx, mz) || 1;
        const cx = mx - (mx / len) * r * 1.8;
        const cz = mz - (mz / len) * r * 1.8;
        return (
          <g key={slot} data-state={state} data-shimmer={shimmer === slot ? 'on' : undefined} className="capture-plan__wall">
            <line x1={ax} y1={az} x2={bx} y2={bz} vectorEffect="non-scaling-stroke" />
            {/* The moving highlight. Present always, drawn only under data-shimmer. */}
            <line className="capture-plan__shine" x1={ax} y1={az} x2={bx} y2={bz} vectorEffect="non-scaling-stroke" aria-hidden="true" />
            <circle cx={cx} cy={cz} r={r} />
            <text x={cx} y={cz} fontSize={r * 1.15} textAnchor="middle" dominantBaseline="central">
              {SLOT_ORDER.indexOf(slot) + 1}
            </text>
          </g>
        );
      })}
      <circle cx={0} cy={0} r={r * 0.45} fill="var(--ink)" />
    </svg>
  );
}

/** The line under the photos: what to check, now that each card carries its own
 *  wall picker. A whole-set "turn it round" pair used to sit here; one move per
 *  photo covers the same mistake with the control already in front of the user. */
function WallHint({ square }: { square: boolean }) {
  return (
    <p className="t-small" style={{ margin: 0, minWidth: 0 }}>
      {square
        ? 'Wrong wall on a photo? Pick the right one under it.'
        : 'Check each photo against the wall length on it, and pick the right wall under it if it is out.'}
    </p>
  );
}

/** A drag with a file in it — from the desktop, or a gallery card, which carries its
 *  own photo as one. `types`, not `files`: during a drag only the kinds are readable. */
function carriesFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** The way photos get in, now that there are no bays to drop them onto. */
function AddTile({
  compact,
  first,
  cardDragging,
  onFiles,
}: {
  compact: boolean;
  first: boolean;
  /** A gallery card is being dragged: letting it go here adds nothing, so the tile
   *  does not light as though it would. */
  cardDragging: boolean;
  onFiles: (list: FileList | File[] | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (cardDragging || !carriesFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      // Lit here, taken by the page: a drop that is not on a card means the same
      // thing wherever it lands, including what to do with a gallery tile.
      onDrop={() => setOver(false)}
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
        <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--ink)' }}>
          {first ? 'Add photos' : 'Add another'}
        </span>
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

/** The two round buttons over a photo's top corner. Paper, so they read on any
 *  photograph (the badge is the dark one), and `--edge` because they are pressed. */
const ROUND_BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  inlineSize: 32,
  blockSize: 32,
  padding: 0,
  borderRadius: 'var(--r-full)',
  background: 'var(--paper)',
  border: '1px solid var(--edge)',
  color: 'var(--ink)',
  cursor: 'pointer',
};

/** One wall's option in a card's Wall list. A wall that already holds a photo says
 *  so, because choosing it swaps the two. */
function wallOptions(slot: CaptureSlot, filled: PhotoMap): SelectOption<CaptureSlot>[] {
  return SLOT_ORDER.map((o) => ({
    value: o,
    label: o !== slot && filled[o] ? `${labelOf(o)} (swap)` : labelOf(o),
    short: labelOf(o),
  }));
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
  onShimmer,
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
  /** Which wall's name is being pointed at or focused, or null. */
  onShimmer: (wall: CaptureSlot | null) => void;
  draggingFrom: CaptureSlot | null;
  setDraggingFrom: (s: CaptureSlot | null) => void;
  onDropFrom: (from: CaptureSlot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const label = labelOf(slot);
  // Whether the pointer or focus is on this card's own Wall control, so a list that
  // closes hands the shimmer back to this card's wall rather than switching it off.
  const onControl = useRef(false);
  const settle = () => onShimmer(onControl.current ? slot : null);
  // A photo moved to an EMPTY wall takes its card with it (cards are keyed by wall),
  // with the pointer still on this control — so no leave or blur ever arrives, and
  // the list's close has just handed the shimmer back to the wall it left. A card
  // that goes while it holds the shimmer switches it off.
  const shimmerRef = useRef(onShimmer);
  shimmerRef.current = onShimmer;
  useEffect(
    () => () => {
      if (onControl.current) shimmerRef.current(null);
    },
    [],
  );
  // The Wall list is portalled to <body>, and React still delivers its pointer and
  // focus events to this wrapper: only what happens on the wrapper's own DOM counts,
  // or a pointer resting on a list that has just closed would keep the wall lit.
  const control = (e: React.SyntheticEvent<HTMLElement>, on: boolean) => {
    if (!e.currentTarget.contains(e.target as Node)) return;
    onControl.current = on;
    onShimmer(on ? slot : null);
  };

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
        // already decided by where it landed. But which gesture this IS cannot
        // be decided here: a dragged tile arrives carrying its own image as a
        // file, so `files.length` is true for a reorder too. See
        // `lib/photo-drop.ts` for the ordering and the data loss it caused.
        const intent = photoDropIntent({
          slot,
          draggingFrom,
          hasFiles: !!e.dataTransfer.files?.length,
        });
        if (intent.kind === 'replace') onReplace(e.dataTransfer.files);
        else if (intent.kind === 'reorder') onDropFrom(intent.from);
      }}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 'var(--r-3)',
        background: compact ? 'var(--ink)' : 'var(--paper)',
        border: over ? '2px solid var(--accent)' : '1px solid var(--edge)',
        minHeight: compact ? 96 : undefined,
        ...(compact ? { flex: '0 0 148px' } : { minWidth: 0 }),
      }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          background: 'var(--ink)',
          minHeight: compact ? undefined : 150,
          ...(compact ? { flex: 1 } : { aspectRatio: '4 / 3' }),
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
          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'grab' }}
        />

        {/* ONE wrapping row, not a badge pinned left and buttons pinned right: two
            absolutely-positioned children cannot reflow past each other (CLAUDE.md
            rule 4), so if the badge ever outgrows its half the buttons drop under it
            instead of printing over it. */}
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
            // The row spans the photo; only what is on it should take a press.
            pointerEvents: 'none',
          }}
        >
          <span
            data-wall-badge={slot}
            style={{ ...photoChrome(), pointerEvents: 'auto' }}
            onMouseEnter={() => onShimmer(slot)}
            onMouseLeave={() => onShimmer(null)}
          >
            {label}
            {/* Derived from the room's own footprint — never a number typed in beside
                the thing it describes. It is what makes "turn the set round" a
                decision the user can take rather than a guess. Dropped in the
                filmstrip, where 132px of content cannot hold it and a `nowrap` chip
                does not shrink, it spills. */}
            {span && !compact && <span>· {span}</span>}
          </span>

          <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
            {/* Replace belongs to the gallery. The filmstrip under a live viewfinder
                keeps only Remove — a reference strip, where the one thing you want
                from a bad shot is to get rid of it and take another. */}
            {!compact && (
              <button
                type="button"
                style={ROUND_BUTTON}
                aria-label={`Replace the photo for ${label}`}
                title="Replace this photo"
                onClick={() => inputRef.current?.click()}
              >
                <Icon name="refresh" size={14} />
              </button>
            )}
            {/* There was previously no way to take a photo back out — someone who
                uploaded a shot with family in it was stuck with it. */}
            <button
              type="button"
              style={ROUND_BUTTON}
              aria-label={`Remove the photo for ${label}`}
              title="Remove this photo"
              onClick={onRemove}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        </div>

        {/* The clash is the one finding that is asking for something, so it stays on
            the filmstrip card, which has no footer to hold it. */}
        {compact && photo.clashedWith && (
          <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span
              title={`This photo’s compass pointed at ${labelOf(photo.clashedWith)}, which already had one. It may be a second photo of the same wall.`}
              // Signalled in the TYPE, not the ground — see photoChrome.
              style={{ ...photoChrome(), color: 'var(--on-ink-warn)' }}
            >
              <Icon name="info" size={11} color="var(--on-ink-warn)" />
              Maybe {labelOf(photo.clashedWith)} again
            </span>
          </div>
        )}
      </div>

      {!compact && (
        <div className="capture-foot">
          <div className="capture-foot__status">
            {photo.clashedWith && (
              <span
                className="capture-status"
                data-tone="warn"
                title={`This photo’s compass pointed at ${labelOf(photo.clashedWith)}, which already had one. It may be a second photo of the same wall.`}
              >
                <Icon name="info" size={12} />
                Maybe {labelOf(photo.clashedWith)} again
              </span>
            )}
            {photo.quality ? (
              photo.quality.flags.map((f) => {
                const good = flagTone(f) === 'good';
                return (
                  <span key={f} className="capture-status" data-tone={good ? 'good' : 'warn'} title={flagHelp(f)}>
                    {/* Icon + words: never colour alone. */}
                    <Icon name={good ? 'check' : 'info'} size={12} />
                    {flagLabel(f)}
                    <span className="sr-only">. {flagHelp(f)}</span>
                  </span>
                );
              })
            ) : (
              <span role="status" aria-live="polite" className="capture-status" data-tone="quiet">
                Checking this photo…
              </span>
            )}
          </div>

          <div className="capture-foot__wall">
            <div
              style={{ flex: '0 1 140px', minWidth: 0 }}
              onMouseEnter={(e) => control(e, true)}
              onMouseLeave={(e) => control(e, false)}
              onFocus={(e) => control(e, true)}
              onBlur={(e) => control(e, false)}
            >
              <Select
                options={wallOptions(slot, filled)}
                value={slot}
                onChange={(to) => onMoveTo(to)}
                onActiveChange={(to) => (to ? onShimmer(to) : settle())}
                ariaLabel={`Wall for the ${label} photo`}
                height={32}
                fontSize="var(--fs-small)"
              />
            </div>
            {/* Why it is on this wall: the user is the only one who can see whether
                the assignment is right, so the screen says what it stood on. Absent
                for a photo read back from storage, which has no moment to describe. */}
            {photo.by && <span className="capture-foot__reason">{REASON[photo.by]}</span>}
          </div>
        </div>
      )}

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

const CAMERA_ERRORS: Record<string, { title: string; body: string }> = {
  NotAllowedError: {
    title: 'Your browser is blocking the camera',
    body: 'Allow camera access from the icon in your address bar, then try again. Or upload photos you already have.',
  },
  SecurityError: {
    title: 'Your browser is blocking the camera',
    body: 'Camera access needs a secure page. Upload photos from this device instead.',
  },
  NotFoundError: {
    title: 'No camera on this device',
    body: 'Upload photos from this device instead.',
  },
  OverconstrainedError: {
    title: 'No usable camera on this device',
    body: 'The cameras here cannot give a usable picture. Upload photos from this device instead.',
  },
  NotReadableError: {
    title: 'The camera is busy',
    body: 'Another app or browser tab may be using it. Close it and try again, or upload photos instead.',
  },
  AbortError: {
    title: 'The camera stopped before it started',
    body: 'Another app may have taken it over. Try again, or upload photos instead.',
  },
};
const CAMERA_ERROR_FALLBACK = {
  title: 'The camera did not start',
  body: 'Something on this device stopped it. Try again, or upload photos instead.',
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
      <p className="t-small" style={{ margin: '6px 0 8px', lineHeight: 1.45 }}>
        {CAPTURE_METHOD}
      </p>
      {/* What used to be a four-way "Wall to shoot" picker. The sequence is the
          answer, so the panel states where you are in it instead of asking. */}
      <p style={{ fontSize: 'var(--fs-small)', color: 'var(--ink)', margin: 0, lineHeight: 1.45 }}>
        {nextSlot ? (
          <>
            <strong>Next: {nextLabel}</strong>{' '}
            <span style={{ color: 'var(--ink-2)' }}>{turnOf(nextSlot)}</span>
          </>
        ) : (
          <span style={{ color: 'var(--ink-2)' }}>
            All four walls have a photo.
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
          <h2 style={{ fontSize: 'var(--fs-lead)', color: 'var(--ink)' }}>{copy.title}</h2>
          <p className="t-small" style={{ lineHeight: 1.5, margin: 0 }}>{copy.body}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="ds-btn ds-btn--lg ds-btn--accent" onClick={onUseUpload}>
              <Icon name="image" size={14} color="var(--on-accent)" />
              Upload photos instead
            </button>
            <button className="ds-btn ds-btn--lg" onClick={turnOn}>
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
          <h2 style={{ fontSize: 'var(--fs-lead)', color: 'var(--ink)' }}>
            {nextLabel ? `Shoot ${nextLabel} with this device` : 'Every wall has a photo'}
          </h2>
          <p className="t-small" style={{ lineHeight: 1.5, margin: 0 }}>
            Your photos stay on this device.
          </p>
          <button className="ds-btn ds-btn--lg ds-btn--accent" disabled={phase === 'starting'} onClick={turnOn}>
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
        <span style={{ ...photoChrome(), position: 'absolute', top: 8, left: 8 }}>
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

'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useRoom, useSettings } from '@/lib/store';
import { roomStore, blobToObjectUrl, type Capture, type CaptureSlot, type RoomData } from '@/lib/storage';
import { detectAcrossImages, DetectError, type Detection } from '@/lib/detection';
import { CAPTURE_SLOTS } from '@/lib/capture';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, EditableText, IconButton, StepHeader } from '@/components/ui/primitives';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { Select } from '@/components/ui/Select';
import { PhotoEditor } from '@/components/studio/PhotoEditor';
import { sampleBoxColor } from '@/lib/color-sample';
import { localDetectorAvailable, detectLocalAcrossImages } from '@/lib/local-detect';
import {
  defaultCal,
  calibrateFromFloorLine,
  findFloorLine,
  imageAspect,
  placeFloorObject,
  placeWallObject,
  type CameraCal,
} from '@/lib/photo-geometry';
import { anchorFor } from '@/lib/physics';
import type { Category, Shape } from '@/lib/scene-spec';

type SlotEntry = { slot: CaptureSlot; url: string; cap: Capture };
type RoomDims = { width: number; depth: number };
type CalMap = Partial<Record<CaptureSlot, CameraCal>>;
type Box = [number, number, number, number];
type SavedDetection = NonNullable<RoomData['detectedObjects']>[number];

/** How many colour samples decode at once. See the sampling effect below. */
const COLOR_BATCH = 4;

// ─── Persistence codec ──────────────────────────────────────────────────────
//
// ONE pair of functions, because these two directions used to be written out by
// hand at opposite ends of the file and had drifted: the record written by
// finish() carried `position`, `yaw` and `shape` — the placement geoRefine()
// derived from the calibrated camera — and the cache read that runs when the
// screen is re-entered rebuilt Detection objects WITHOUT them. Since finish() is
// the only way forward off this screen and its button is always enabled, the next
// press wrote `undefined` over all three. The studio's Rescan button links
// straight here, so it was one click from silently discarding the geometry pass
// and falling back to wall-snapping and shape guessing.
//
// If a field is added to one of these, the other fails to compile.

function toRecord(d: Detection, index: number, locked: boolean): SavedDetection {
  return {
    id: index,
    // Minted once and then carried, so the ScenePart id stays attached to the
    // same piece of furniture across a re-detect.
    uid: d.uid ?? uuid(),
    label: `${cleanLabelOf(d)}__slot:${d.slot}`,
    conf: d.conf,
    locked,
    box: d.box,
    category: d.category,
    dimMM: d.dimMM,
    position: d.position,
    yaw: d.yaw,
    shape: d.shape,
    color: d.color,
    meshHash: d.meshHash,
  };
}

function fromRecord(r: SavedDetection): Detection {
  return {
    uid: r.uid,
    label: r.label.replace(/__slot:[nesw]$/, ''),
    conf: r.conf,
    box: r.box,
    category: (r.category ?? 'other') as Detection['category'],
    slot: ((r.label.match(/__slot:([nesw])$/) ?? [])[1] ?? 'n') as CaptureSlot,
    dimMM: r.dimMM,
    position: r.position,
    yaw: r.yaw,
    shape: r.shape,
    color: r.color,
    meshHash: r.meshHash,
  };
}

/** Give every detection a key the moment it enters state, so React rows and the
 *  eventual ScenePart id are both stable. Rows used to be keyed by array index
 *  while deleteDetection spliced the array, so removing a row handed its DOM node
 *  — and an in-flight rename — to the row below it. */
function keyed(items: Detection[]): Detection[] {
  return items.map((d) => (d.uid ? d : { ...d, uid: uuid() }));
}

// Where the recognising happened. This drives the privacy line, so it has to be
// exact: 'local' really is on-device, 'cloud' means the wall photos were sent to
// Google once. Never claim one while doing the other.
type Path = 'idle' | 'cache' | 'checking' | 'local' | 'cloud' | 'stopped';

// Not an error taxonomy — a "what happens next" taxonomy. `tone` decides whether
// something reads as a failure at all: declining an optional feature is a choice,
// not a fault, so it must never render as a red alarm above a Retry that lands
// in the identical state.
type Notice = {
  code:
    | 'NO_CAPS'
    | 'NO_KEY'
    | 'STOPPED'
    | 'NOTHING_FOUND'
    | 'DAILY_QUOTA'
    | 'RATE_LIMIT'
    | 'INVALID_KEY'
    | 'PHOTOS_TOO_BIG'
    | 'BAD_RESPONSE'
    | 'UNKNOWN';
  tone: 'calm' | 'warn' | 'error';
  kicker: string;
  title: string;
  body: string;
  /** raw technical text, shown quietly under the body */
  detail?: string;
  /** true only when reloading could plausibly give a different result */
  retry?: boolean;
  settings?: boolean;
  capture?: boolean;
};

// The by-hand path needs a name for the thing being drawn — the geometry engine
// takes the category for its depth default and anchor, and the label is what the
// user sees in the studio. Wording is a decorator's, not the model's enum.
const MANUAL_CATEGORIES: { value: Detection['category']; label: string }[] = [
  { value: 'sofa', label: 'Sofa' },
  { value: 'chair', label: 'Chair' },
  { value: 'table', label: 'Table' },
  { value: 'desk', label: 'Desk' },
  { value: 'bed', label: 'Bed' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'nightstand', label: 'Bedside table' },
  { value: 'ottoman', label: 'Footstool' },
  { value: 'tv', label: 'TV' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'lamp', label: 'Lamp' },
  { value: 'plant', label: 'Plant' },
  { value: 'rug', label: 'Rug' },
  { value: 'mirror', label: 'Mirror' },
  { value: 'painting', label: 'Picture' },
  { value: 'curtain', label: 'Curtain' },
  { value: 'fridge', label: 'Fridge' },
  { value: 'fan', label: 'Fan' },
  { value: 'ac', label: 'Air conditioner' },
  { value: 'door', label: 'Door' },
  { value: 'other', label: 'Something else' },
];

// Keyboard placement: a box you can walk into position instead of dragging.
const KEY_BOX: Box = [0.38, 0.44, 0.24, 0.3];
const KEY_STEP = 0.02;
const KEY_MIN = 0.05;

// Wall names come from the capture step, so the two screens can never disagree
// about what the user photographed. The n/e/s/w ids stay; only labels are human.
function slotLabel(slot: CaptureSlot): string {
  return CAPTURE_SLOTS.find((c) => c.id === slot)?.label ?? slot.toUpperCase();
}

function categoryLabel(cat?: string): string {
  return MANUAL_CATEGORIES.find((c) => c.value === cat)?.label ?? 'Furniture';
}

function cleanLabelOf(d: Detection): string {
  return d.label.replace(/__slot:[nesw]$/, '');
}

// Per-photo camera calibration: try the wall-floor line (exact), fall back to
// a typical phone FOV. Deterministic either way.
async function buildCals(entries: SlotEntry[], room: RoomDims): Promise<CalMap> {
  const map: CalMap = {};
  for (const e of entries) {
    const aspect = await imageAspect(e.cap.blob);
    const vFloor = await findFloorLine(e.cap.blob);
    map[e.slot] =
      (vFloor !== null ? calibrateFromFloorLine(vFloor, e.slot, room, aspect) : null) ?? defaultCal(aspect);
  }
  return map;
}

// Replace the AI's guessed position/size with values computed from projective
// geometry: bbox bottom edge → floor position; angular size × distance → real
// W and H. Depth stays a category default (single photo can't observe it) and
// clampDims gates everything downstream. AI keeps naming/classifying only.
function geoRefine(d: Detection, cals: CalMap, room: RoomDims): Detection {
  const cal = cals[d.slot];
  if (!cal) return d;
  const anchor = anchorFor((d.category ?? 'other') as Category, (d.shape ?? 'box') as Shape);
  if (anchor === 'ceiling' && d.category !== 'curtain') return d; // fan/pendant: not on the wall plane
  const g =
    anchor === 'floor'
      ? placeFloorObject(d.box, d.slot, room, cal)
      : placeWallObject(d.box, d.slot, room, cal);
  if (!g) return d;
  const depth = d.dimMM?.[1] ?? 500;
  return {
    ...d,
    position: g.position,
    yaw: typeof d.yaw === 'number' ? d.yaw : g.yaw,
    dimMM: [g.widthMM, depth, g.heightMM],
  };
}

// Every outcome of a detect attempt, in the product's own language. Two of these
// are not failures: no key and a stopped run are the user's choices, so they get
// the calm treatment and point at the by-hand path — which needs no key, no
// connection, and produces the same real measurements.
function noticeFor(e: unknown): Notice {
  const err = e instanceof DetectError ? e : null;
  switch (err?.code) {
    case 'NO_KEY':
      return {
        code: 'NO_KEY',
        tone: 'calm',
        kicker: 'No key needed',
        title: 'Let’s do this by hand',
        body:
          'Automatic recognising is optional and there’s no key set for it — so we’ll go the direct way, which works just as well. Draw a box around anything you want in the room and Danmu works out its real size from the photo. It’s switched on already.',
        settings: true,
      };
    case 'DAILY_QUOTA':
      return {
        code: 'DAILY_QUOTA',
        tone: 'warn',
        kicker: 'Daily limit',
        title: 'Today’s free scans are used up',
        body:
          'The allowance resets overnight. Come back tomorrow if you’d like Danmu to look for you — or add your pieces by hand right now, which needs no key at all.',
      };
    case 'RATE_LIMIT':
      return {
        code: 'RATE_LIMIT',
        tone: 'warn',
        kicker: 'One at a time',
        title: 'That was a lot of scanning at once',
        body:
          'Only a few scans a minute get through. Give it a minute and try again, or add your pieces by hand in the meantime — nothing is lost either way.',
        retry: true,
      };
    case 'INVALID_KEY':
      return {
        code: 'INVALID_KEY',
        tone: 'error',
        kicker: 'Key not accepted',
        title: 'Google didn’t accept that key',
        body:
          'Have a look at the detection key in Settings — a stray space is the usual culprit. You don’t need a key to carry on: draw a box around each piece instead.',
        settings: true,
      };
    case 'PHOTOS_TOO_BIG':
      // Its own outcome, not a mystery failure. Photos are shrunk on the way in
      // now, so this only reaches someone whose captures predate that — and
      // "retake them" is a real, working instruction rather than "try again".
      return {
        code: 'PHOTOS_TOO_BIG',
        tone: 'warn',
        kicker: 'Photos too large',
        title: 'These photos are too big to send in one go',
        body:
          'Danmu now shrinks photos as you add them, so this usually means these were taken before that. Retake or re-add your wall photos and it will go through — or add your pieces by hand right now, which sends nothing at all.',
        capture: true,
      };
    case 'BAD_RESPONSE':
      // Was indistinguishable from an empty room: an unparseable body came back
      // as [], and the screen then said "nothing stood out in your photos, which
      // is exactly right for an empty room".
      return {
        code: 'BAD_RESPONSE',
        tone: 'error',
        kicker: 'Unreadable answer',
        title: 'Danmu couldn’t make sense of the reply',
        body:
          'The service answered, but not in a form Danmu can read — this is not something about your room or your photos. Trying again usually clears it. You can also add your pieces by hand, which needs no key.',
        retry: true,
      };
    default:
      return {
        code: 'UNKNOWN',
        tone: 'error',
        kicker: 'Something went wrong',
        title: 'Danmu couldn’t finish looking through your photos',
        body:
          'Trying again often works. If it doesn’t, add your pieces by hand — draw a box around each one and Danmu measures it from the photo.',
        detail: err?.message ?? (e instanceof Error ? e.message : String(e)),
        retry: true,
      };
  }
}

export default function DetectPage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const apiKey = useSettings((s) => s.apiKey);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  // Persisted as `locked` on RoomData.detectedObjects — "confirmed" is the same
  // flag in the user's words: a piece they've said is really in the room.
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [activeSlot, setActiveSlot] = useState<CaptureSlot>('n');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  const [manualCat, setManualCat] = useState<Detection['category']>('sofa');
  // Keyboard-placed box in flight — the pointer-free alternative to dragging.
  const [pending, setPending] = useState<Box | null>(null);
  // The one item hovered/focused anywhere, so the row and its box on the photo
  // are visibly the same object.
  const [linked, setLinked] = useState<number | null>(null);
  const [path, setPath] = useState<Path>('idle');
  // Geometry context for deterministic dims — per-slot camera calibration +
  // the room's real dimensions. Used on fresh detections and manual adds.
  const [cals, setCals] = useState<CalMap>({});
  const [roomDims, setRoomDims] = useState<RoomDims | null>(null);
  const padRef = useRef<HTMLButtonElement>(null);
  // Flipped by Stop so an in-flight run stops writing to state.
  const stopped = useRef(false);
  // The detect run needs the key to be CURRENT when it calls, not to be a
  // trigger. With `apiKey` in the effect's dep array, editing it in Settings —
  // including in another tab, since the store persists to localStorage — re-ran
  // the whole pipeline: re-read every capture blob, re-calibrated all four photos
  // (two decodes each), re-minted the object URLs, and fired a second billed
  // detection. The subscribed value above still drives the privacy line.
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  useEffect(() => {
    if (!roomId) return;
    let urls: string[] = [];
    let cancelled = false;
    stopped.current = false;
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      if (caps.length === 0) {
        setNotice({
          code: 'NO_CAPS',
          tone: 'calm',
          kicker: 'Nothing to look at yet',
          title: 'This room has no wall photos',
          body:
            'Photos are how Danmu spots what’s already in the room, so there’s nothing to go through. Take your wall photos, or head straight to the studio and decorate the room at its real size.',
          capture: true,
        });
        return;
      }
      const entries = caps
        .map((c) => {
          const u = blobToObjectUrl(c.blob);
          urls.push(u);
          return { slot: c.slot, url: u, cap: c };
        })
        .sort((a, b) => 'nesw'.indexOf(a.slot) - 'nesw'.indexOf(b.slot));
      setSlots(entries);
      setActiveSlot(entries[0]?.slot ?? 'n');

      // CACHE: if this room already has detections, skip the API call entirely.
      const room = await roomStore.loadRoom(roomId);
      // Calibrate every photo up front (floor-line → exact, else default FOV)
      // so geometry-derived dims are available to detections + manual adds.
      let calMap: CalMap = {};
      if (room) {
        const dims = { width: room.width, depth: room.depth };
        calMap = await buildCals(entries, dims);
        if (!cancelled) {
          setCals(calMap);
          setRoomDims(dims);
        }
      }
      if (room?.detectedObjects && room.detectedObjects.length > 0) {
        setDetections(keyed(room.detectedObjects.map(fromRecord)));
        setConfirmed(new Set(room.detectedObjects.map((d, i) => (d.locked ? i : -1)).filter((x) => x >= 0)));
        setPath('cache');
        return;
      }

      // Otherwise: local on-device detector first (no key, no quota); Gemini
      // only as the fallback when the model isn't deployed or finds nothing.
      setRunning(true);
      setPath('checking');
      try {
        let dets: Detection[] | null = null;
        if (await localDetectorAvailable()) {
          setPath('local');
          try {
            dets = await detectLocalAcrossImages(entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })));
            if (dets && dets.length === 0) dets = null; // empty result → let Gemini try
          } catch {
            dets = null;
          }
        }
        if (!dets) {
          // The photos are about to leave the device. Say so BEFORE the call, so
          // the disclosure is on screen for the whole upload.
          setPath('cloud');
          dets = await detectAcrossImages(
            apiKeyRef.current,
            entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })),
            room ? { width: room.width, depth: room.depth, height: room.height, layoutId: room.layoutId } : undefined,
          );
        }
        if (cancelled || stopped.current) return;
        // Geometry pass — deterministic position + W/H from the calibrated
        // camera; the AI result only contributes label/category/depth hint.
        const refined = keyed(
          room ? dets.map((d) => geoRefine(d, calMap, { width: room.width, depth: room.depth })) : dets,
        );
        setDetections(refined);
        const marks = new Set<number>();
        refined.forEach((d, i) => {
          if (d.conf >= 0.85) marks.add(i);
        });
        setConfirmed(marks);
        if (refined.length === 0) {
          // Saying nothing here is how someone who photographed an empty study
          // ends up in a room full of furniture they never owned.
          setAdding(true);
          setNotice({
            code: 'NOTHING_FOUND',
            tone: 'calm',
            kicker: 'All clear',
            title: 'Nothing stood out in your photos',
            body: `Danmu went through ${entries.length === 1 ? 'your photo' : `all ${entries.length} photos`} and couldn’t pick out any furniture — which is exactly right for an empty room, and common in dim light or very close-up shots. Draw a box around anything you’d like measured; it’s switched on already. Carry on with an empty list and the studio opens with a starter arrangement instead of your own pieces, which you can clear one by one.`,
          });
        }
      } catch (e) {
        if (cancelled || stopped.current) return;
        const n = noticeFor(e);
        setNotice(n);
        if (n.code === 'NO_KEY') {
          // No key means the by-hand path IS the path — arm it rather than leave
          // the user staring at a tool they have to discover. And nothing was
          // sent: detection refuses before it touches the network, so the
          // upload disclosure must not stay on screen.
          setAdding(true);
          setPath('idle');
        }
      } finally {
        if (!cancelled && !stopped.current) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
    // roomId only — see apiKeyRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Hybrid colour fill — sample the dominant colour from each detection's photo
  // region (exact pixels), falling back to any Gemini-provided hex. Runs once
  // per detection: only items still missing `color` are processed, so updating
  // state here doesn't loop.
  useEffect(() => {
    if (slots.length === 0) return;
    const missing = detections
      .map((d, i) => ({ d, i }))
      .filter((x) => !x.d.color);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // A few at a time, not one after another and not all at once. Each call
      // decodes the WHOLE photo, so serialising twenty detections meant twenty
      // round trips of nothing happening — but firing all twenty holds twenty
      // decoded bitmaps at once, which is ~150 MB on the phones this screen is
      // aimed at. Four gives most of the speed-up with a bounded peak.
      const sampled: Array<string | null> = [];
      for (let n = 0; n < missing.length && !cancelled; n += COLOR_BATCH) {
        const batch = missing.slice(n, n + COLOR_BATCH);
        sampled.push(
          ...(await Promise.all(
            batch.map(({ d }) => {
              const cap = slots.find((s) => s.slot === d.slot)?.cap;
              return cap ? sampleBoxColor(cap.blob, d.box) : Promise.resolve(null);
            }),
          )),
        );
      }
      const updates = new Map<number, string>();
      missing.forEach(({ d, i }, n) => {
        const color = sampled[n] ?? d.color; // hybrid: photo sample, else Gemini hex
        if (color) updates.set(i, color);
      });
      if (cancelled || updates.size === 0) return;
      setDetections((arr) => arr.map((x, i) => (updates.has(i) ? { ...x, color: updates.get(i) } : x)));
    })();
    return () => {
      cancelled = true;
    };
  }, [detections, slots]);

  function toggleConfirm(i: number) {
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function deleteDetection(i: number) {
    setDetections((d) => d.filter((_, idx) => idx !== i));
    setLinked(null);
    setConfirmed((prev) => {
      const next = new Set<number>();
      prev.forEach((x) => {
        if (x < i) next.add(x);
        else if (x > i) next.add(x - 1);
      });
      return next;
    });
  }

  function renameDetection(i: number, label: string) {
    setDetections((d) => d.map((x, idx) => (idx === i ? { ...x, label } : x)));
  }

  function addManual(box: Box) {
    let det: Detection = {
      uid: uuid(),
      label: categoryLabel(manualCat),
      conf: 1,
      box,
      category: manualCat,
      slot: activeSlot,
    };
    // Zero-AI path: the drawn box + calibrated camera give real position and
    // W/H directly. Works offline, no key needed.
    if (roomDims) det = geoRefine(det, cals, roomDims);
    setDetections((d) => [...d, det]);
    // A piece the user drew themselves is confirmed by definition.
    setConfirmed((prev) => new Set(prev).add(detections.length));
    setPending(null);
    // Stay armed: whoever is adding by hand is usually adding several.
  }

  // Pointer-free placement. Arrow keys walk the box into position, Shift resizes,
  // the button itself commits — so the whole by-hand path is reachable without a
  // drag, which was the only way in before.
  function startPending() {
    setAdding(true);
    setPending(KEY_BOX);
    requestAnimationFrame(() => padRef.current?.focus());
  }

  function nudge(e: KeyboardEvent<HTMLButtonElement>) {
    if (!pending) return;
    const [x, y, w, h] = pending;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let next: Box;
    switch (e.key) {
      case 'ArrowLeft':
        next = e.shiftKey ? [x, y, Math.max(KEY_MIN, w - KEY_STEP), h] : [clamp(x - KEY_STEP, 0, 1 - w), y, w, h];
        break;
      case 'ArrowRight':
        next = e.shiftKey ? [x, y, Math.min(1 - x, w + KEY_STEP), h] : [clamp(x + KEY_STEP, 0, 1 - w), y, w, h];
        break;
      case 'ArrowUp':
        next = e.shiftKey ? [x, y, w, Math.max(KEY_MIN, h - KEY_STEP)] : [x, clamp(y - KEY_STEP, 0, 1 - h), w, h];
        break;
      case 'ArrowDown':
        next = e.shiftKey ? [x, y, w, Math.min(1 - y, h + KEY_STEP)] : [x, clamp(y + KEY_STEP, 0, 1 - h), w, h];
        break;
      case 'Escape':
        e.preventDefault();
        setPending(null);
        return;
      default:
        return; // Enter / Space fall through to the button's own click handler
    }
    e.preventDefault(); // arrows would otherwise scroll the panel
    setPending(next);
  }

  // The SDK call has no abort signal, so stopping means we stop *listening* and
  // hand the page back. A late result is dropped rather than landing on someone
  // who has already moved on.
  function stopDetecting() {
    stopped.current = true;
    setRunning(false);
    setPath('stopped');
    setAdding(true);
    setNotice({
      code: 'STOPPED',
      tone: 'calm',
      kicker: 'Stopped',
      title: 'Left it there',
      body:
        'No problem — you can add the pieces yourself. Draw a box around anything in the photo and Danmu works out its real size.',
    });
  }

  function goStudio() {
    if (roomId) router.push(`/room/${roomId}/model`);
  }

  async function finish() {
    if (!roomId) return;
    setSaving(true);
    try {
      const room = await roomStore.loadRoom(roomId);
      if (!room) return;
      const flat = detections.map((d, i) => toRecord(d, i, confirmed.has(i)));
      await roomStore.saveRoom({ ...room, detectedObjects: flat });
      router.push(`/room/${roomId}/model`);
    } finally {
      setSaving(false);
    }
  }

  const active = slots.find((s) => s.slot === activeSlot);
  const activeDetections = detections
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.slot === activeSlot);
  const total = detections.length;
  const photoCount = slots.length;

  // Truthful for the path actually taken, and on screen for the whole upload.
  const sendsPhotos = path === 'cloud' || (path === 'checking' && !!apiKey);
  const privacyLine = sendsPhotos
    ? `One thing to know: to name your furniture, this step sends your ${photoCount === 1 ? 'wall photo' : `${photoCount} wall photos`} to Google once. Nothing else in Danmu leaves your device.`
    : path === 'local'
      ? 'Recognised right here in your browser — your photos never left this device.'
      : null;

  // The one live region on the page: detection can run for tens of seconds, and
  // before this a screen-reader user was told nothing at all when it finished.
  const statusText = running
    ? `Looking through your ${photoCount === 1 ? 'photo' : `${photoCount} photos`}…`
    : total === 0
      ? 'No pieces yet'
      : `${total} ${total === 1 ? 'piece' : 'pieces'} in this room`;

  const linkedBox = linked !== null && detections[linked]?.slot === activeSlot ? detections[linked].box : null;

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      {/* .chrome-bar wraps instead of overflowing when the viewport narrows. */}
      <header className="chrome-bar">
        <button onClick={() => router.back()} className="ds-btn ds-btn--ghost" style={{ height: 32, padding: '0 10px' }}>
          <Icon name="chevron-left" size={14} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Back</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} aria-hidden="true" />
        <DanmuMark size={12} />
        <div className="chrome-bar__spacer" />
        <span role="status" aria-live="polite" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {statusText}
        </span>
        {/* The way out of onboarding is the loudest thing here — it used to be a
            32px ghost-weight button, quieter than the add-a-box tool. */}
        <button onClick={finish} disabled={running || saving} className="ds-btn ds-btn--primary">
          {saving ? 'Opening your room…' : 'Continue to the studio'}
          <Icon name="arrow-right" size={13} />
        </button>
      </header>

      <div style={{ padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <StepHeader
          kicker="Last step"
          title="Check your furniture"
          subtitle="Everything Danmu found, measured at real size. Confirm what’s yours, drop what isn’t, and add anything it missed."
        />
        {privacyLine && (
          <p
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              margin: 0,
              maxWidth: '68ch',
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--ink-2)',
              background: 'var(--paper-2)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--r-2)',
              padding: '9px 11px',
            }}
          >
            <Icon name="info" size={14} color="var(--ink-3)" style={{ marginTop: 2 }} />
            <span>{privacyLine}</span>
          </p>
        )}
      </div>

      {notice && (
        <NoticeCard notice={notice} onDismiss={notice.tone === 'calm' ? () => setNotice(null) : undefined}>
          {notice.capture && (
            <Link href="/onboarding/capture" className="ds-btn ds-btn--primary" style={{ height: 34, fontSize: 12.5 }}>
              <Icon name="camera" size={13} />
              Take wall photos
            </Link>
          )}
          {notice.retry && (
            <button
              onClick={() => {
                setNotice(null);
                location.reload();
              }}
              className="ds-btn"
              style={{ height: 34, fontSize: 12.5 }}
            >
              <Icon name="refresh" size={12} />
              Try again
            </button>
          )}
          {notice.settings && (
            <Link href="/settings" className="ds-btn" style={{ height: 34, fontSize: 12.5 }}>
              <Icon name="key" size={12} />
              Set up a key in Settings
            </Link>
          )}
          {notice.capture && (
            <button onClick={goStudio} className="ds-btn" style={{ height: 34, fontSize: 12.5 }}>
              Skip to the studio
              <Icon name="arrow-right" size={12} />
            </button>
          )}
        </NoticeCard>
      )}

      {/* .split--stack turns the rail into a sheet under the photo on narrow
          screens; the fixed 380px track left the canvas about 10px wide. */}
      <div className="split split--stack" style={{ flex: 1, gridTemplateColumns: '1fr 380px', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {slots.length > 1 && (
            <div
              role="group"
              aria-label="Your wall photos"
              style={{ display: 'flex', flexWrap: 'wrap', padding: '10px 16px 0', gap: 6, flexShrink: 0 }}
            >
              {slots.map((s) => {
                const sel = activeSlot === s.slot;
                const count = detections.filter((d) => d.slot === s.slot).length;
                return (
                  <button
                    key={s.slot}
                    onClick={() => setActiveSlot(s.slot)}
                    aria-pressed={sel}
                    className="ds-btn"
                    style={{
                      flex: '1 1 130px',
                      height: 36,
                      justifyContent: 'space-between',
                      fontSize: 12.5,
                      background: sel ? 'var(--ink)' : 'var(--paper)',
                      color: sel ? 'var(--on-ink)' : 'var(--ink-2)',
                      borderColor: sel ? 'var(--ink)' : 'var(--edge)',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slotLabel(s.slot)}
                    </span>
                    {count > 0 && (
                      <span className="mono" style={{ fontSize: 11, fontWeight: 600, opacity: 0.85 }}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ flex: 1, padding: 16, minHeight: 0, overflow: 'auto' }}>
            {active ? (
              <div style={{ position: 'relative' }}>
                <PhotoEditor
                  imageUrl={active.url}
                  items={activeDetections.map(({ d, i }) => ({ index: i, d, locked: confirmed.has(i) }))}
                  mode={adding ? 'add' : 'select'}
                  onToggleLock={toggleConfirm}
                  onDelete={deleteDetection}
                  onAddBox={addManual}
                />
                {/* Page-level box layer, in the same normalized space as the
                    editor's own overlays: the row↔box link and the keyboard
                    placement preview. Pointer events off so it never eats a
                    click meant for the box underneath. */}
                {linkedBox && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${linkedBox[0] * 100}%`,
                      top: `${linkedBox[1] * 100}%`,
                      width: `${linkedBox[2] * 100}%`,
                      height: `${linkedBox[3] * 100}%`,
                      outline: '2px solid var(--accent-text)',
                      outlineOffset: 2,
                      borderRadius: 'var(--r-1)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {pending && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: `${pending[0] * 100}%`,
                      top: `${pending[1] * 100}%`,
                      width: `${pending[2] * 100}%`,
                      height: `${pending[3] * 100}%`,
                      border: '2px dashed var(--accent-ink)',
                      background: 'var(--accent-tint-strong)',
                      borderRadius: 'var(--r-1)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', padding: 12 }}>
                {slots.length === 0 ? 'No wall photos for this room yet.' : 'No photo for this wall yet.'}
              </div>
            )}
          </div>

          {active && (
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid var(--hairline)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => {
                  setAdding((v) => !v);
                  setPending(null);
                }}
                aria-pressed={adding}
                className="ds-btn"
                style={{
                  height: 34,
                  fontSize: 12.5,
                  ...(adding
                    ? { background: 'var(--accent-tint)', color: 'var(--accent-text)', borderColor: 'var(--accent-text)' }
                    : null),
                }}
              >
                <Icon name={adding ? 'check' : 'plus'} size={13} />
                {adding ? 'Adding by hand' : 'Add a piece by hand'}
              </button>

              {adding ? (
                <>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>
                    What is it?
                    <Select
                      value={manualCat}
                      onChange={(v) => setManualCat(v as Detection['category'])}
                      options={MANUAL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                      ariaLabel="What is it?"
                      width={176}
                      height={34}
                      fontSize={12.5}
                    />
                  </label>
                  {pending ? (
                    <>
                      <button
                        ref={padRef}
                        onClick={() => addManual(pending)}
                        onKeyDown={nudge}
                        className="ds-btn ds-btn--accent"
                        style={{ height: 34, fontSize: 12.5 }}
                        aria-describedby="place-hint"
                      >
                        <Icon name="check" size={13} />
                        Add this box
                      </button>
                      <span id="place-hint" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        Arrow keys move it · Shift + arrows resize · Esc cancels
                      </span>
                    </>
                  ) : (
                    <>
                      <button onClick={startPending} className="ds-btn" style={{ height: 34, fontSize: 12.5 }}>
                        <Icon name="crosshair" size={13} />
                        Place with the keyboard
                      </button>
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>…or drag a box around it on the photo.</span>
                    </>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Tap a box on the photo to confirm that piece. Tap its × to drop it.
                </span>
              )}
            </div>
          )}
        </div>

        <div className="rail rail--right">
          <div className="section">
            <div className="section-head">
              <h2 className="section-title">Your pieces</h2>
              {total > 0 && <span className="section-meta mono">{total}</span>}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: 0, lineHeight: 1.45 }}>
              Confirmed pieces are the ones you’ve told Danmu are really in the room — it confirms the clearest ones
              for you. Tap a piece to change your mind, or rename it in your own words.
            </p>
          </div>

          <div className="list" style={{ padding: 10, gap: 4 }}>
            {total === 0 && !running && (
              <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Nothing here yet</b>
                {slots.length > 0
                  ? 'Draw a box around any piece on the photo and Danmu works out its real size. '
                  : 'Take your wall photos and Danmu can measure what’s in them. '}
                Carry on with an empty list and the studio opens with a starter arrangement instead of your own
                pieces — you can clear it one by one.
              </div>
            )}
            {detections.map((d, i) => (
              <DetectionRow
                key={d.uid ?? `row-${i}`}
                d={d}
                confirmed={confirmed.has(i)}
                highlighted={linked === i}
                onThisPhoto={d.slot === activeSlot}
                onToggle={() => toggleConfirm(i)}
                onRename={(label) => renameDetection(i, label)}
                onDelete={() => deleteDetection(i)}
                onLink={(on) => setLinked(on ? i : null)}
                onShow={() => setActiveSlot(d.slot)}
              />
            ))}
          </div>
        </div>
      </div>

      {running && (
        <LoadingOverlay
          title="Finding your furniture"
          description={`Danmu looks at your ${photoCount === 1 ? 'photo' : `${photoCount} photos`} together, so a piece caught in two of them isn’t counted twice.`}
          note={
            sendsPhotos
              ? 'Your wall photos go to Google once for this step. Nothing else leaves your device.'
              : undefined
          }
          local={path === 'local'}
          onCancel={stopDetecting}
          cancelLabel="Stop and add by hand"
        />
      )}
    </div>
  );
}

// Calm / warn / error share one shell so the difference between "you declined an
// optional feature" and "something broke" is a tone, not a different component
// someone forgets to write.
const NOTICE_TONES: Record<Notice['tone'], { border: string; bg: string; fg: string }> = {
  calm: { border: 'var(--accent-2)', bg: 'var(--accent-2-tint)', fg: 'var(--success-text)' },
  warn: { border: 'var(--warn)', bg: 'var(--paper-3)', fg: 'var(--warn-text)' },
  error: { border: 'var(--danger)', bg: 'var(--danger-tint)', fg: 'var(--danger-text)' },
};

function NoticeCard({
  notice,
  onDismiss,
  children,
}: {
  notice: Notice;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  const tone = NOTICE_TONES[notice.tone];
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      style={{
        margin: '0 18px 14px',
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        borderRadius: 'var(--r-3)',
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ds-label" style={{ color: tone.fg, marginBottom: 4 }}>
            {notice.kicker}
          </div>
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>{notice.title}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, maxWidth: '68ch' }}>
            {notice.body}
          </p>
          {notice.detail && (
            <p style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, margin: '6px 0 0' }}>{notice.detail}</p>
          )}
        </div>
        {onDismiss && <IconButton icon="x" label="Dismiss this message" onClick={onDismiss} size={28} iconSize={12} />}
      </div>
      {children && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{children}</div>}
    </div>
  );
}

function DetectionRow({
  d,
  confirmed,
  highlighted,
  onThisPhoto,
  onToggle,
  onRename,
  onDelete,
  onLink,
  onShow,
}: {
  d: Detection;
  confirmed: boolean;
  highlighted: boolean;
  onThisPhoto: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onLink: (on: boolean) => void;
  onShow: () => void;
}) {
  const label = cleanLabelOf(d);
  return (
    // Hover AND focus drive the same highlight, so a keyboard user gets the
    // row↔photo link too. onFocus/onBlur bubble from the child buttons.
    <div
      onMouseEnter={() => onLink(true)}
      onMouseLeave={() => onLink(false)}
      onFocus={() => onLink(true)}
      onBlur={() => onLink(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        border: `1px solid ${confirmed ? 'var(--locked)' : 'var(--hairline)'}`,
        borderRadius: 'var(--r-2)',
        background: confirmed ? 'var(--locked-tint)' : 'var(--paper)',
        boxShadow: highlighted ? 'inset 0 0 0 1px var(--accent-text)' : 'none',
        transition: 'background .12s, box-shadow .12s, border-color .12s',
      }}
    >
      {/* Was the whole row as a `div onClick`: unreachable by keyboard and with
          no state announced. Now a real toggle with aria-pressed. */}
      <IconButton
        icon={confirmed ? 'lock' : 'unlock'}
        label={`Confirm ${label}`}
        title={
          confirmed
            ? 'Confirmed — this piece goes into your room as measured'
            : 'Confirm this piece is really in your room'
        }
        active={confirmed}
        onClick={onToggle}
        variant="outline"
        size={28}
        iconSize={13}
        style={
          confirmed
            ? { background: 'var(--locked-tint)', color: 'var(--locked)', borderColor: 'var(--locked)' }
            : undefined
        }
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <EditableText
          value={label}
          onCommit={onRename}
          label="Piece name"
          style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', textTransform: 'capitalize', display: 'block' }}
          inputStyle={{ height: 28, fontSize: 12.5 }}
        />
        {/* Confidence percentages and slot codes were telemetry. What helps is
            which photo it came from and what Danmu thinks it is. */}
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {categoryLabel(d.category)} · {slotLabel(d.slot)}
        </div>
      </div>
      {!onThisPhoto && (
        <button
          onClick={onShow}
          className="ds-btn ds-btn--ghost"
          aria-label={`Show ${label} on the ${slotLabel(d.slot).toLowerCase()} photo`}
          style={{ height: 26, fontSize: 11.5, padding: '0 8px', color: 'var(--accent-text)' }}
        >
          Show
        </button>
      )}
      <IconButton
        icon="x"
        label={`Remove ${label}`}
        variant="outline"
        tone="danger"
        onClick={onDelete}
        size={26}
        iconSize={11}
        style={{ borderRadius: 'var(--r-1)' }}
      />
    </div>
  );
}

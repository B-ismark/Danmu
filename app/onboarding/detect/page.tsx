'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { v4 as uuid } from 'uuid';
import { useRoom, useSettings } from '@/lib/store';
import { roomStore, blobToObjectUrl, type Capture, type CaptureSlot } from '@/lib/storage';
import { detectAcrossImages, DetectError, type Detection } from '@/lib/detection';
import { setAsideSentence, setAsideTitle } from '@/lib/set-aside';
import { Icon } from '@/components/ui/Icon';
import { FlowBarLead, IconButton, Segmented } from '@/components/ui/primitives';
import { DetectionRow, EMPTY_OFFER, MANUAL_CATEGORIES, categoryLabel, candidateLabel, slotLabel } from '@/components/studio/DetectionRow';
import { FindingFurniture } from '@/components/ui/FindingFurniture';
import { FlowStepper } from '@/components/ui/FlowStepper';
import { BuildingRoom } from '@/components/ui/BuildingRoom';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { Select } from '@/components/ui/Select';
import { PhotoEditor } from '@/components/studio/PhotoEditor';
import { isTypingOrDialog } from '@/components/studio/KeyboardShortcuts';
import { localDetectorAvailable, detectLocalAcrossImages, detectorStatus, onDetectorDownload, type DetectorStatus, type DownloadProgress } from '@/lib/local-detect';
import { megabytes } from '@/lib/model-cache';
import type { DetectorPack } from '@/lib/model-verify';
import { DetectorPackPicker, onMeteredConnection } from '@/components/ui/DetectorPackPicker';
import {
  calForPhoto,
  findFloorLine,
  imageAspect,
  type CameraView,
  calibrateFromPhoto,
} from '@/lib/photo-geometry';
import { hfovFromFocal35 } from '@/lib/exif';
import { geoPlace, refineDetections, type CalMap, type RoomDims } from '@/lib/detect-refine';
import { judgeLabels, type LabelCandidate } from '@/lib/label-repair';
import { suggestFromLabel } from '@/lib/label-suggest';
import {
  canRedo,
  canUndo,
  emptyHistory,
  keptAfterPick,
  record as recordStep,
  redo as redoStep,
  restoreConfirmed,
  snapshotConfirmed,
  undo as undoStep,
} from '@/lib/review-history';
import { shouldAutoConfirm } from '@/lib/detect-confidence';
import { findRepeats, keptAtFirst } from '@/lib/repeat-sightings';
import { linkCandidates, linkSighting, linkedTo, sightingsOf, unlinkSighting, withSeenAt, withoutRow } from '@/lib/sighting-links';
import { cleanLabelOf } from '@/lib/detection-record';
import { fromRecords, toRecord } from '@/lib/detection-record';
import { adoptEditedList, adoptFreshScan, listEditSentence } from '@/lib/rescan';
import { toast } from '@/components/ui/StorageToast';
import { roomFootprint } from '@/lib/footprint';
import { settingsHref } from '@/lib/settings-return';

type SlotEntry = { slot: CaptureSlot; url: string; cap: Capture };
type Box = [number, number, number, number];

// How long the Building screen stays up at the least, so it is read rather than
// glimpsed. The save behind it usually takes a fraction of this.
const BUILD_MIN_MS = 1200;

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
    | 'CACHED'
    | 'SECOND_LOOK_FAILED'
    | 'SOME_SET_ASIDE'
    | 'DAILY_QUOTA'
    | 'RATE_LIMIT'
    | 'INVALID_KEY'
    | 'PHOTOS_TOO_BIG'
    | 'SKIPPED_DOWNLOAD'
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
  /** offers **Look again** — a fresh run over the same photos */
  again?: boolean;
};


// Keyboard placement: a box you can walk into position instead of dragging.
const KEY_BOX: Box = [0.38, 0.44, 0.24, 0.3];
const KEY_STEP = 0.02;
const KEY_MIN = 0.05;

// Per-photo camera calibration: read what each photo can tell, and let
// `calForPhoto` decide. The ladder itself, and why it is shaped the way it is, lives
// there, beside the equations it chooses between.
async function buildCals(entries: SlotEntry[], room: RoomDims): Promise<CalMap> {
  const map: CalMap = {};
  for (const e of entries) {
    const aspect = await imageAspect(e.cap.blob);
    const pose = e.cap.pose;
    const view: CameraView = {};
    if (pose?.heightM !== undefined) view.height = pose.heightM;
    if (pose?.tiltDeg !== undefined) view.tiltRad = (pose.tiltDeg * Math.PI) / 180;
    const exifHfov = pose?.focal35mm !== undefined ? hfovFromFocal35(pose.focal35mm, aspect) : null;
    const floorLine = await findFloorLine(e.cap.blob);
    // No EXIF: read the lens out of the photo's own perspective. This is the path
    // for an upload whose metadata was stripped somewhere upstream, which is most
    // of them, including anything that went through a messaging app.
    const vanishing = exifHfov === null ? await calibrateFromPhoto(e.cap.blob) : null;
    map[e.slot] = calForPhoto({ aspect, view, exifHfov, vanishing, floorLine }, e.slot, room.footprint);
  }
  return map;
}

// Every outcome of a detect attempt, in the product's own language. Two of these
// are not failures: no key and a stopped run are the user's choices, so they get
// the calm treatment and point at the by-hand path — which needs no key, no
// connection, and produces the same rough sizes.
function noticeFor(e: unknown): Notice {
  const err = e instanceof DetectError ? e : null;
  switch (err?.code) {
    case 'NO_KEY':
      return {
        code: 'NO_KEY',
        tone: 'calm',
        kicker: 'No key needed',
        title: 'Add your pieces by hand',
        body:
          'Automatic detection is optional and no key is set for it. Draw a box around anything you want in the room and Danmu gives it a typical size you can adjust in the studio.',
        settings: true,
      };
    case 'DAILY_QUOTA':
      return {
        code: 'DAILY_QUOTA',
        tone: 'warn',
        kicker: 'Daily limit',
        title: 'Today’s free scans are used up',
        body:
          'The limit resets overnight. Try again tomorrow, or add your pieces by hand now.',
      };
    case 'RATE_LIMIT':
      return {
        code: 'RATE_LIMIT',
        tone: 'warn',
        kicker: 'One at a time',
        title: 'Too many scans at once',
        body:
          'Only a few scans a minute get through. Wait a minute and try again, or add your pieces by hand.',
        retry: true,
      };
    case 'INVALID_KEY':
      return {
        code: 'INVALID_KEY',
        tone: 'error',
        kicker: 'Key not accepted',
        title: 'Google didn’t accept that key',
        body:
          'Check the detection key in Settings. A stray space is the usual cause. Or add your pieces by hand, which needs no key.',
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
          'Danmu shrinks photos as you add them, so these were probably added before it did. Retake or re-add your wall photos, or add your pieces by hand.',
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
          'The detection service replied in a form Danmu can’t read. Nothing is wrong with your photos. Try again, or add your pieces by hand.',
        retry: true,
      };
    default:
      return {
        code: 'UNKNOWN',
        tone: 'error',
        kicker: 'Something went wrong',
        title: 'Danmu couldn’t finish looking through your photos',
        body:
          'Try again. If that fails, add your pieces by hand: draw a box around each one and Danmu gives it a typical size.',
        detail: err?.message ?? (e instanceof Error ? e.message : String(e)),
        retry: true,
      };
  }
}

export default function DetectPage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const apiKey = useSettings((s) => s.apiKey);
  const dimUnit = useSettings((s) => s.dimUnit);
  const [running, setRunning] = useState(false);
  // The detector's one-time download: asked about before a byte of it moves, then
  // counted while it runs. `ask` resolves the question the scan is waiting on.
  const [download, setDownload] = useState<{
    sizes: Record<DetectorPack, DetectorStatus>;
    update: boolean;
    metered: boolean;
    ask: (pack: DetectorPack | null) => void;
  } | null>(null);
  const detectorPack = useSettings((s) => s.detectorPack);
  const [fetched, setFetched] = useState<DownloadProgress | null>(null);
  const [saving, setSaving] = useState(false);
  // The Building screen, from Continue until the studio has taken over. Not `saving`:
  // that clears in `finish`'s `finally` as soon as the push is issued, which would
  // flash the review back up for the moment before the route changes.
  const [building, setBuilding] = useState(false);
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  // Persisted as `locked` on RoomData.detectedObjects, and it means KEPT: only these
  // rows are built into the room (`buildSceneFromRoom`). An unkept row stays on the
  // list, so a wrong guess or a second sighting costs one tap to bring back.
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [activeSlot, setActiveSlot] = useState<CaptureSlot>('n');
  // The list follows the wall being looked at, so the review is a walk round the room
  // one wall at a time; "All walls" is the check before Continue that the room holds
  // one bed. Where the person is LOOKING, so it is not in the undo history.
  const [listScope, setListScope] = useState<'wall' | 'all'>('wall');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  const [manualCat, setManualCat] = useState<Detection['category']>('sofa');
  // Keyboard-placed box in flight — the pointer-free alternative to dragging.
  const [pending, setPending] = useState<Box | null>(null);
  // The one piece hovered or focused anywhere — its box on the photo or its row in the
  // list — so the two are visibly the same object, whichever side the pointer is on.
  // `from` says which, because only a hover that began on the photo scrolls the list.
  const [hover, setHover] = useState<{ index: number; from: 'photo' | 'row' } | null>(null);
  const linked = hover?.index ?? null;
  const [path, setPath] = useState<Path>('idle');
  // Geometry context for deterministic dims — per-slot camera calibration +
  // the room's real dimensions. Used on fresh detections and manual adds.
  const [cals, setCals] = useState<CalMap>({});
  const [roomDims, setRoomDims] = useState<RoomDims | null>(null);
  // The room still stands at its shape's typical size (`RoomData.roughSize`). Every
  // size read off a wall or the floor line scales with how far away the wall is
  // assumed to be, so a claim of real sizes is one this screen cannot
  // make — the header says what the sizes are instead.
  const [roughSize, setRoughSize] = useState(false);
  const padRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const photoBoxRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const capProbeRef = useRef<HTMLDivElement>(null);
  // Flipped by Stop so an in-flight run stops writing to state.
  const stopped = useRef(false);
  // The detection run, set by the loading effect so **Look again** can start it.
  const runRef = useRef<(() => Promise<void>) | null>(null);
  // The ids of every row a run in THIS visit produced. Continue replaces the room's
  // arrangement (`lib/rescan.ts`) only when the list it saves still holds one of
  // them — a flag would stay set after Undo took the list back to the last scan,
  // and Continue would then throw away the studio's arrangement to rebuild the
  // very list it already had. Ids survive every edit to a row, because every edit
  // spreads the row; a list with none of them is the cached one, however edited.
  const runUids = useRef(new Set<string>());
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
    const urls: string[] = [];
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
          body: 'Danmu needs wall photos to find the furniture already in the room.',
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
      if (!cancelled) setRoughSize(room?.roughSize === true);
      // Calibrate every photo up front (floor-line → exact, else default FOV)
      // so geometry-derived dims are available to detections + manual adds.
      let calMap: CalMap = {};
      // Built ONCE and shared by the calibration, the geometry pass and the label
      // verdicts. It used to be constructed twice from the same `room`, which is
      // how a third dimension gets added to one copy and not the other — and the
      // one that would have silently lost it is the geometry pass, where a missing
      // ceiling means every fan in the room stops being measured.
      const dims: RoomDims | null = room
        ? {
            width: room.width,
            depth: room.depth,
            height: room.height,
            // The room's real outline, not the box around it. Every consumer of this
            // state inherits it — the pipeline below, `judgeLabels`, the manual-draw
            // path and `suggestFromLabel` all read `roomDims` — which is why it goes
            // here rather than being threaded through five signatures.
            footprint: roomFootprint(room),
          }
        : null;
      if (dims) {
        calMap = await buildCals(entries, dims);
        if (!cancelled) {
          setCals(calMap);
          setRoomDims(dims);
        }
      }
      // The run itself, as a function rather than inline, because there are two ways
      // in: straight away on a room nobody has scanned, and **Look again** on one that
      // has. `cancelled` is this effect's, so a press after navigating away writes
      // nothing — the same guard the first run has.
      const run = async () => {
        stopped.current = false;
        setRunning(true);
        setPath('checking');
        try {
          let dets: Detection[] | null = null;
          let skipped = false;
          if (await localDetectorAvailable()) {
            // ~65 MB the first time, nothing after (`lib/model-cache.ts`). Asked, never
            // assumed: on mobile data that is the most this app ever costs anyone.
            // An update is asked about the same way: a kept copy for another version
            // of the file is a download, and nobody's data plan is spent unasked.
            let pack = useSettings.getState().detectorPack;
            const status = await detectorStatus(pack);
            let go = status.owed === 0;
            let owed = status.owed;
            if (!go) {
              const [full, basic] = await Promise.all([detectorStatus('full'), detectorStatus('basic')]);
              const chosen = await new Promise<DetectorPack | null>((ask) =>
                setDownload({ sizes: { full, basic }, update: status.update, metered: onMeteredConnection(), ask }),
              );
              setDownload(null);
              if (chosen) {
                owed = (chosen === 'full' ? full : basic).owed;
                pack = chosen;
                useSettings.getState().setDetectorPack(chosen);
                go = true;
              }
            }
            if (cancelled || stopped.current) return;
            if (go) {
              setPath('local');
              onDetectorDownload(setFetched, owed);
              try {
                dets = await detectLocalAcrossImages(entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })), pack);
                if (dets && dets.length === 0) dets = null; // empty result → let Gemini try
              } catch {
                dets = null;
              } finally {
                onDetectorDownload(null);
                setFetched(null);
              }
            } else {
              skipped = true;
            }
          }
          if (skipped && !apiKeyRef.current) {
            // Nothing was downloaded and nothing was sent: the by-hand path is the path,
            // armed, with the way back to a scan for when the person is on Wi-Fi.
            setAdding(true);
            setPath('idle');
            setNotice({
              code: 'SKIPPED_DOWNLOAD',
              tone: 'calm',
              kicker: 'Scan skipped',
              title: 'Add your furniture by hand',
              body: 'Draw a box around each piece in your photos. When you are on Wi-Fi, press Look again to have Danmu find them for you.',
              again: true,
            });
            return;
          }
          // How many of the reply's rows it refused beside the ones it kept (§ 49.19):
          // a scan that kept 6 of 9 pieces used to look exactly like one that found 6.
          let setAside = 0;
          const askCloud = async () => {
            const reply = await detectAcrossImages(
              apiKeyRef.current,
              entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })),
              room ? { width: room.width, depth: room.depth, height: room.height, layoutId: room.layoutId } : undefined,
            );
            setAside = reply.dropped;
            return reply.rows;
          };
          let secondLookFailed = false;
          if (!dets) {
            // The photos are about to leave the device. Say so BEFORE the call, so
            // the disclosure is on screen for the whole upload.
            setPath('cloud');
            dets = await askCloud();
          } else if (apiKeyRef.current) {
            // A SECOND LOOK, not only a fallback. Someone who set up a key did it so
            // their photos would be read by the stronger model, and the on-device pass
            // finding SOMETHING used to be enough to skip it — measured on a real
            // four-photo room, on-device found 13 of 19 pieces. Both lists go through
            // the same geometry pass and merge, so a piece seen by both is one row.
            // A failed second look costs nothing already found: the on-device list
            // stands and the screen says the cloud half did not happen.
            setPath('cloud');
            try {
              dets = [...dets, ...(await askCloud())];
            } catch {
              secondLookFailed = true;
            }
          }
          if (cancelled || stopped.current) return;
          // Geometry pass, then the merge — in that order, which is the whole
          // reason this is one call into lib. The AI result only contributes
          // label/category and a depth hint.
          const refined = keyed(refineDetections(dets, calMap, dims));
          setDetections(refined);
            // These rows are what the photos were really looked at for, and the studio
          // has to show them — see `runUids` and `lib/rescan.ts`.
          for (const d of refined) if (d.uid) runUids.current.add(d.uid);
          // Which rows to tick before the user has looked at them. The whole policy
          // lives in lib/detect-confidence.ts, because it was three unrelated
          // confidence scales being compared against one literal here — and a row
          // that is probably another row seen again starts unticked, so one bed
          // photographed from three walls is one bed (lib/repeat-sightings.ts).
          const judged = judgeLabels(refined, calMap, dims);
          setConfirmed(keptAtFirst(refined, refined.map((d, i) => shouldAutoConfirm(d, judged[i].status)), dims, calMap));
          if (secondLookFailed) {
            setNotice({
              code: 'SECOND_LOOK_FAILED',
              tone: 'calm',
              kicker: 'Found on this device',
              title: 'The second look didn’t go through',
              body: 'Google’s scan of your photos failed, so this list is only what your browser found. Add anything missing by hand, or press Re-scan later.',
            });
          }
          if (setAside > 0) {
            // Before NOTHING_FOUND, which replaces it: an empty list says the more
            // useful thing, and its body counts these too.
            setNotice({
              code: 'SOME_SET_ASIDE',
              tone: 'calm',
              kicker: 'Scan finished',
              title: setAsideTitle(setAside),
              body: `${setAsideSentence(setAside)} If something is missing from the list, draw a box around it.`,
            });
          }
          if (refined.length === 0) {
            // Saying nothing here is how someone who photographed an empty study
            // ends up in a room full of furniture they never owned.
            setAdding(true);
            setNotice({
              code: 'NOTHING_FOUND',
              tone: 'calm',
              kicker: 'Scan finished',
              title: 'Nothing stood out in your photos',
              body: `Danmu found no furniture in ${entries.length === 1 ? 'your photo' : `your ${entries.length} photos`}. ${setAside > 0 ? `${setAsideSentence(setAside)} ` : ''}This is common in dim light or with close-up shots. Draw a box around anything you’d like in your room.`,
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
      };
      runRef.current = run;

      // CACHE: this room has been scanned, so show that list rather than spend a scan
      // on arriving — and say so, with the way to look again, because **Re-scan** in
      // the studio lands here and used to show the old list as though it were new.
      if (room?.detectedObjects && room.detectedObjects.length > 0) {
        setDetections(fromRecords(room.detectedObjects));
        setConfirmed(new Set(room.detectedObjects.map((d, i) => (d.locked ? i : -1)).filter((x) => x >= 0)));
        setPath('cache');
        setNotice({
          code: 'CACHED',
          tone: 'calm',
          kicker: 'Already scanned',
          title: 'Showing your previous scan',
          body:
            'Look again scans your photos from scratch. The new list replaces this one, and your current room is saved under Layouts as “Before re-scan”.',
          again: true,
        });
        return;
      }

      // Otherwise: local on-device detector first (no key, no quota), and
      // Gemini when that finds nothing — or as a second look whenever a key is set.
      await run();
    })();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
    // roomId only — see apiKeyRef above.
  }, [roomId]);

  function toggleConfirm(i: number) {
    remember();
    // Ticking a linked row means it is its own piece after all: a row both kept and
    // linked would be built AND counted as another's sighting.
    if (detections[i]?.sameAs && !confirmed.has(i)) setDetections((d) => unlinkSighting(d, i) as Detection[]);
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const measuredRows = detections;

  // Only the geometry may accuse a word, and only the user may change it. The
  // verdicts are recomputed from `detections` rather than stored on them: a
  // verdict is about the current measurement, so persisting one would let a stale
  // accusation outlive the row it was about.
  const verdicts = useMemo(() => judgeLabels(measuredRows, cals, roomDims), [measuredRows, cals, roomDims]);

  /** Which row each row probably repeats — the same piece seen from another wall,
   *  or read twice from one photo. Ranked by the confidence policy rather than by
   *  the current ticks, so a row's note does not move when the user ticks it: the
   *  note is about the photographs, and a tick is not new evidence about them. */
  const repeats = useMemo(
    () =>
      findRepeats(
        measuredRows,
        measuredRows.map((d, i) => shouldAutoConfirm(d, (verdicts[i] ?? { status: 'unmeasured' }).status)),
        roomDims,
        cals,
      ),
    [measuredRows, verdicts, roomDims, cals],
  );

  /** A model offered because of what the user just TYPED, rather than because the
   *  measurement disagreed. Held on the page and not per row because only one rename
   *  can be in flight, and because a stale offer pointing at a row that has since been
   *  deleted or repaired would name the wrong piece — `deleteDetection` re-indexes
   *  `confirmed` for exactly that reason, and this is the same hazard. */
  const [offer, setOffer] = useState<{ index: number; candidates: LabelCandidate[] } | null>(null);

  /** Undo / redo for the review. In memory and gone on navigation, exactly like the
   *  review itself — nothing here is persisted until `finish()` writes it.
   *
   *  `lib/history.ts` cannot serve this: it snapshots `useStudio` on a debounce and
   *  is gated on `draggingId`, none of which exists on this screen. */
  const [history, setHistory] = useState(() => emptyHistory<Detection>());

  /** The state as it stands right now, for recording BEFORE a change is applied.
   *  Read from the render’s own values rather than through a setter callback: every
   *  caller is an event handler, so these are the values the user was looking at when
   *  they acted, which is what an undo should return to. */
  function remember() {
    setHistory((h) => recordStep(h, { detections, confirmed: snapshotConfirmed(confirmed) }));
  }

  /** Apply a snapshot. Both halves together and never one of them: `confirmed` is a
   *  set of INDICES into `detections`, so restoring one without the other points
   *  every confirmation at a different piece of furniture. */
  function applySnapshot(snap: { detections: readonly Detection[]; confirmed: readonly number[] }) {
    setDetections([...snap.detections]);
    setConfirmed(restoreConfirmed(snap.confirmed));
    // Both are about a row by index, and an undo can change what is at that index.
    setOffer(null);
    setHover(null);
  }

  function doUndo() {
    const r = undoStep(history, { detections, confirmed: snapshotConfirmed(confirmed) });
    if (!r) return;
    setHistory(r.history);
    applySnapshot(r.state);
  }

  function doRedo() {
    const r = redoStep(history, { detections, confirmed: snapshotConfirmed(confirmed) });
    if (!r) return;
    setHistory(r.history);
    applySnapshot(r.state);
  }

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, the same pair the studio uses.
  //
  // `isTypingOrDialog` rather than a fresh predicate: this screen is mostly text
  // fields, and Ctrl+Z inside a half-typed rename must undo the TEXT, not the
  // review. Five studio components already share that guard and a sixth copy of it
  // is the drift this repo keeps finding. It also covers the confirm dialog.
  //
  // Not `capture`, and not `preventDefault` when it declines: an undo this screen
  // refuses has to fall through to the browser, or a field would lose its own undo.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      if (isTypingOrDialog(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `doUndo` / `doRedo` close over `history`, `detections` and `confirmed`, so the
    // listener has to be re-attached when those change. Listing them rather than the
    // functions, which are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, detections, confirmed]);

  function applyRepair(i: number, cand: LabelCandidate, keep = false) {
    remember();
    setOffer(null);
    // A model the person chose from what they typed is a piece they want: it is ticked
    // here, in the same step, so one undo takes back both. A tick they then remove
    // stays removed — nothing re-ticks it.
    if (keep) setConfirmed((prev) => keptAfterPick(prev, i));
    // In place, never a filter or a re-sort: `confirmed` is a Set of array
    // INDICES, so reordering here would silently move every confirmation onto a
    // different piece of furniture.
    setDetections((arr) =>
      arr.map((x, idx) => (idx === i ? { ...cand.detection, label: candidateLabel(cand) } : x)),
    );
  }

  function deleteDetection(i: number) {
    remember();
    // The offer is keyed on an INDEX, and this function re-indexes everything after
    // `i`. Rather than shift it too, drop it: an offer is a response to a keystroke
    // seconds ago, and one that survives a delete would point at whichever piece
    // slid into that slot.
    setOffer(null);
    // `withoutRow` rather than a filter: a row linked to this one would otherwise
    // keep a link to nothing.
    setDetections((d) => withoutRow(d, i));
    setHover(null);
    setConfirmed((prev) => {
      const next = new Set<number>();
      prev.forEach((x) => {
        if (x < i) next.add(x);
        else if (x > i) next.add(x - 1);
      });
      return next;
    });
  }

  /** "This is the same piece as row `j`": the row is linked and unticked, so the room
   *  builds the piece once (`lib/sighting-links.ts`). One step, so one undo. */
  function linkRow(i: number, j: number) {
    const next = linkSighting(detections, i, j);
    if (next === detections) return;
    remember();
    setDetections(next as Detection[]);
    setConfirmed((prev) => {
      const out = new Set(prev);
      out.delete(i);
      return out;
    });
  }

  /** Undo a link: the row is its own piece again, and kept — unlinking says "this is
   *  another one", and another one is a piece the person wants. */
  function unlinkRow(i: number) {
    remember();
    setDetections((d) => unlinkSighting(d, i) as Detection[]);
    setConfirmed((prev) => new Set(prev).add(i));
  }

  function renameDetection(i: number, label: string) {
    // `EditableText` commits on blur or Enter, not per keystroke, so one commit is
    // one entry and the stack does not fill with single letters.
    remember();
    setDetections((d) => d.map((x, idx) => (idx === i ? { ...x, label } : x)));
    // A rename changes the WORD and nothing else, and the model comes off
    // `category` — `buildSceneFromRoom` picks it and only refines the shape within
    // that category — so renaming a bed to "Fridge" gave a bed called Fridge. The
    // existing repair chips could not catch it: they fire on a MEASUREMENT
    // disagreement, and typing a word is not one.
    //
    // Offered, never applied. The rule is two comments down in this same file — "a
    // silent re-label is the same mistake as a silent resize" — and accepting this
    // re-measures the piece, which is a size the user has not asked for yet.
    const cands = suggestFromLabel(detections[i], label, cals, roomDims);
    setOffer(cands.length > 0 ? { index: i, candidates: cands } : null);
  }

  function addManual(box: Box) {
    remember();
    let det: Detection = {
      uid: uuid(),
      label: categoryLabel(manualCat),
      // Not a confidence. A sentinel for "the user drew this", which is why
      // `source` carries the meaning and this number is never compared.
      conf: 1,
      source: 'manual',
      box,
      category: manualCat,
      slot: activeSlot,
    };
    // Zero-AI path: the drawn box + calibrated camera give real position and
    // W/H directly. Works offline, no key needed.
    if (roomDims) det = geoPlace(det, cals, roomDims);
    setDetections((d) => [...d, det]);
    // A piece the user drew themselves is kept by definition.
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
    // A scan waiting on the download question is answered no, so it does not wait forever.
    setDownload((d) => {
      d?.ask(null);
      return null;
    });
    setPath('stopped');
    setAdding(true);
    setNotice({
      code: 'STOPPED',
      tone: 'calm',
      kicker: 'Stopped',
      title: 'Add your pieces by hand',
      body: 'Draw a box around anything in the photo and Danmu gives it a typical size.',
    });
  }

  function goStudio() {
    if (roomId) router.push(`/room/${roomId}/model`);
  }

  async function finish() {
    if (!roomId) return;
    setSaving(true);
    setBuilding(true);
    const shownAt = performance.now();
    let opened = false;
    try {
      const room = await roomStore.loadRoom(roomId);
      if (!room) return;
      // Each kept floor piece seen on more than one wall stands where its linked
      // sightings put it together — derived here because only this screen has the
      // lenses (`withSeenAt`).
      const flat = withSeenAt(
        detections.map((d, i) => toRecord(d, i, confirmed.has(i), uuid)),
        detections,
        cals,
      );
      if (detections.some((d) => d.uid && runUids.current.has(d.uid))) {
        const kept = await adoptFreshScan(room, flat);
        if (kept)
          toast({
            title: 'Your room now shows the new scan',
            message: `The arrangement you had is saved under Room check › Layouts as “${kept.name}”.`,
            ttl: 14000,
          });
      } else {
        // The list the room was already built from, edited or not. A room the studio
        // has arranged loads its saved scene over the list, so the edit has to be
        // carried into that scene or a tick changed here never reaches the room.
        const edit = await adoptEditedList(room, flat);
        if (edit) toast({ title: 'Your room now matches this list', message: listEditSentence(edit), ttl: 9000 });
      }
      // Long enough to be read rather than flicker; not at all for someone who has
      // asked for less motion, for whom the wait would be the only thing it added.
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const wait = still ? 0 : BUILD_MIN_MS - (performance.now() - shownAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      router.push(`/room/${roomId}/model`);
      opened = true;
    } finally {
      setSaving(false);
      if (!opened) setBuilding(false);
    }
  }

  const active = slots.find((s) => s.slot === activeSlot);
  const activeDetections = detections
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.slot === activeSlot);
  const total = detections.length;
  // The rows the list shows: the wall being looked at, or every wall. With one photo
  // there is nothing to choose between, and the list is all of it.
  const listed = detections
    .map((d, i) => ({ d, i }))
    .filter((x) => listScope === 'all' || slots.length <= 1 || x.d.slot === activeSlot);
  const keptCount = confirmed.size;
  const photoCount = slots.length;

  // The pinned photo column, measured, for two rules in globals.css that no fixed
  // number could serve. `--scan-photo-room` is the height of everything in the column
  // but the photo — the wall buttons, the padding, the tool row — which the photo's cap
  // leaves room for, because those rows wrap: four walls are two rows of buttons on a
  // phone, and adding by hand grows the tools by two more lines. Guessed at 200px, the
  // column outgrew the window, and the box round the photo became a 30px scroll area of
  // its own that took every swipe and hid the photo's bottom edge. `--scan-pin-h` is the
  // column's own height, which the list keeps clear of when focus scrolls a row into
  // view, so a row focused while stacked does not land under the photo. `--scan-photo-w`
  // is how wide the photo's column needs to be: the photo is drawn at its cap's height and
  // its own shape, so it is usually narrower than the column `1fr` gives it, and the list
  // sat a hundred pixels off its right edge — more for a portrait photo. The column is
  // that width instead (never more than leaves the list its own), and the pair is centred.
  const hasWallButtons = slots.length > 1;
  const hasPhoto = active !== undefined;
  useEffect(() => {
    const pane = paneRef.current;
    const box = photoBoxRef.current;
    if (!pane || !box) return;
    const root = document.documentElement;
    const split = splitRef.current;
    const probe = capProbeRef.current;
    const publish = () => {
      const img = box.querySelector('img');
      const rail = split?.querySelector('.rail');
      if (split && probe && img && rail && img.naturalWidth > 0 && img.naturalHeight > 0) {
        // The photo's own width at its cap (`.scan-cap-probe` is as tall as the cap), plus
        // the box's padding; stacked, the list is as wide as the page and there is no
        // room to give back, so the variable goes.
        const cap = probe.getBoundingClientRect().height;
        const room = split.clientWidth - rail.getBoundingClientRect().width;
        const want = Math.ceil((cap * img.naturalWidth) / img.naturalHeight + 32);
        if (room > 0 && rail.getBoundingClientRect().width < split.clientWidth - 1) split.style.setProperty('--scan-photo-w', `${Math.min(want, Math.floor(room))}px`);
        else split.style.removeProperty('--scan-photo-w');
      }
      const cs = getComputedStyle(box);
      // The box's padding is room too; its height, squeezed or not, is not.
      const room = pane.getBoundingClientRect().height - box.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const next = `${Math.ceil(room)}px`;
      if (pane.style.getPropertyValue('--scan-photo-room') !== next) pane.style.setProperty('--scan-photo-room', next);
      root.style.setProperty('--scan-pin-h', `${Math.ceil(pane.getBoundingClientRect().height)}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return () => root.style.removeProperty('--scan-pin-h');
    // On the next frame, not inside the observer's own delivery: the cap resizes the
    // column being observed, and a resize made there is one the browser cannot deliver
    // in the same pass — it reports a ResizeObserver loop error, twice at 360×640 on
    // turning adding by hand on and off and nudging the window.
    let frame = 0;
    const ro = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; publish(); });
    });
    // Every row, not only the column: a row that wraps inside a column already at its
    // cap changes nothing about the column's own size.
    ro.observe(pane);
    if (split) ro.observe(split);
    for (const row of pane.children) ro.observe(row);
    // A photo that has just loaded is a new shape for the column; its load is not a resize
    // of anything observed here, and does not bubble, hence the capture.
    const onLoad = () => publish();
    box.addEventListener('load', onLoad, true);
    return () => {
      box.removeEventListener('load', onLoad, true);
      split?.style.removeProperty('--scan-photo-w');
      ro.disconnect();
      cancelAnimationFrame(frame);
      // Removed rather than left: the next page has no column to keep clear of.
      root.style.removeProperty('--scan-pin-h');
    };
    // Re-run when a row comes or goes, so the new one is observed too.
  }, [hasWallButtons, hasPhoto]);

  // Truthful for the path actually taken, and on screen for the whole upload.
  const sendsPhotos = path === 'cloud' || (path === 'checking' && !!apiKey);
  const privacyLine = sendsPhotos
    ? `To name your furniture, this step sends your ${photoCount === 1 ? 'wall photo' : `${photoCount} wall photos`} to Google once. Nothing else in Danmu leaves your device.`
    : path === 'local'
      ? 'Found in your browser. Your photos did not leave this device.'
      : null;

  // The one live region on the page: detection can run for tens of seconds, and
  // before this a screen-reader user was told nothing at all when it finished.
  const statusText = running
    ? `Looking through your ${photoCount === 1 ? 'photo' : `${photoCount} photos`}…`
    : total === 0
      ? 'No pieces yet'
      : `${keptCount} of ${total} ${total === 1 ? 'piece' : 'pieces'} kept`;
  // The button says what pressing it will build, because the three outcomes differ
  // and only one of them is obvious: kept pieces, an empty room when every row was
  // left out, and the starter arrangement when the list itself is empty.
  const continueLabel =
    total === 0
      ? 'Continue to the studio'
      : keptCount === 0
        ? 'Continue with an empty room'
        : `Continue with ${keptCount} ${keptCount === 1 ? 'piece' : 'pieces'}`;

  if (building)
    return (
      <BuildingRoom
        dimUnit={dimUnit}
        facts={roomDims && { ...roomDims, rough: roughSize, pieces: keptCount, photos: photoCount }}
      />
    );

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      {/* .chrome-bar wraps instead of overflowing when the viewport narrows. */}
      <header className="chrome-bar">
        {/* No `markHref`, deliberately: this page's whole review — what is kept,
            edits, boxes added by hand — lives in component state until `finish()`
            writes it, so a stray click on a logo would discard it. Back is an
            explicit, high-intent control; a logo is not. */}
        <FlowBarLead onBack={() => router.back()} />
        {/* Undo / redo for the review. Here rather than beside each row because they
            act on the whole review, and because the studio puts its pair in chrome
            too. NOT the studio’s `UndoRedo` component — that one reads `useStudio`,
            which has nothing to do with this screen. */}
        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton
            icon="rotate-ccw"
            label="Undo the last change to this list"
            onClick={doUndo}
            disabled={!canUndo(history)}
          />
          <IconButton
            icon="rotate-cw"
            label="Redo"
            onClick={doRedo}
            disabled={!canRedo(history)}
          />
        </div>
        <div className="chrome-bar__spacer" />
        <span role="status" aria-live="polite" className="t-body">
          {statusText}
        </span>
        {/* The way out of onboarding is the loudest thing here — it used to be a
            32px ghost-weight button, quieter than the add-a-box tool. */}
        <button onClick={finish} disabled={running || saving} className="ds-btn ds-btn--accent">
          {saving ? 'Opening your room…' : continueLabel}
          <Icon name="arrow-right" size={13} />
        </button>
      </header>

      <div className="scan-head">
        <FlowStepper current="Furniture" />
        <div className="scan-head__text">
          <h1 className="scan-head__title">Check your furniture</h1>
          <p className="scan-head__lede">
            Keep what’s yours. Anything you leave out stays out of the room.
            {roughSize ? ' Sizes are rough until you set the room’s size.' : null}
          </p>
        </div>
        {download && (
          <section className="ds-card scan-download" aria-labelledby="dl-title">
            <span className="scan-download__icon" aria-hidden="true">
              <Icon name="download" size={18} />
            </span>
            <div className="scan-download__body">
            <h2 id="dl-title" className="scan-download__title">
              {download.update ? 'An improved furniture finder is ready' : 'Find furniture on this device'}
            </h2>
            <p className="t-small" style={{ margin: 0, lineHeight: 1.5 }}>
              {download.update
                ? 'This version of Danmu finds furniture better than the copy on this device. It is a one-time download, kept afterwards.'
                : 'To spot your furniture on this device, Danmu needs a one-time download. It is kept afterwards, so later scans use no data.'}{' '}
              {download.metered ? 'You seem to be on mobile data, so you may want to wait for Wi-Fi.' : null}
            </p>
            <DetectorPackPicker
              value={detectorPack}
              onChange={(p) => useSettings.getState().setDetectorPack(p)}
              sizes={download.sizes}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="ds-btn ds-btn--accent" onClick={() => download.ask(detectorPack)}>
                <Icon name="download" size={13} />
                {download.sizes[detectorPack].owed === 0
                  ? `Use ${detectorPack === 'full' ? 'Full' : 'Basic'}, already kept`
                  : `${download.update ? 'Update' : 'Download'} ${megabytes(download.sizes[detectorPack].owed)}`}
              </button>
              <button className="ds-btn" onClick={() => download.ask(null)}>
                Skip for now
              </button>
            </div>
            </div>
          </section>
        )}
        {fetched && fetched.total > 0 && fetched.loaded < fetched.total && (
          <p className="t-small" role="status" style={{ margin: 0 }}>
            Downloading the furniture finder… {megabytes(fetched.loaded)} of {megabytes(fetched.total)}
          </p>
        )}
        {privacyLine && (
          // A padlock only where it is true: on the cloud path the photos do leave.
          <p className="scan-privacy" data-sends={sendsPhotos || undefined}>
            <Icon name={sendsPhotos ? 'info' : 'lock'} size={14} />
            <span>{privacyLine}</span>
          </p>
        )}
      </div>

      {notice && (
        <NoticeCard notice={notice} onDismiss={notice.tone === 'calm' ? () => setNotice(null) : undefined}>
          {notice.capture && (
            <Link href="/onboarding/capture" className="ds-btn ds-btn--sm">
              <Icon name="camera" size={13} />
              Take wall photos
            </Link>
          )}
          {notice.again && (
            <button
              onClick={() => {
                // Undoable: the list being replaced is one step back.
                remember();
                setNotice(null);
                setOffer(null);
                setHover(null);
                void runRef.current?.();
              }}
              className="ds-btn ds-btn--sm"
            >
              <Icon name="refresh" size={12} />
              Look again
            </button>
          )}
          {notice.retry && (
            <button
              onClick={() => {
                setNotice(null);
                // Run again rather than reload: a reload of a room that already has a
                // scan lands on that scan, so after a failed Look again it showed the
                // old list instead of trying.
                if (runRef.current) void runRef.current();
                else location.reload();
              }}
              className="ds-btn ds-btn--sm"
            >
              <Icon name="refresh" size={12} />
              Try again
            </button>
          )}
          {notice.settings && (
            <Link href={settingsHref('/onboarding/detect')} className="ds-btn ds-btn--sm">
              <Icon name="key" size={12} />
              Set up a key in Settings
            </Link>
          )}
          {notice.capture && (
            <button onClick={goStudio} className="ds-btn ds-btn--sm">
              Skip to the studio
              <Icon name="arrow-right" size={12} />
            </button>
          )}
        </NoticeCard>
      )}

      {/* .split--stack turns the rail into a sheet under the photo on narrow
          screens; the fixed 380px track left the canvas about 10px wide. */}
      <div ref={splitRef} className="split split--stack scan-split" style={{ flex: 1, minHeight: 0 }}>
        {/* Pinned while the list scrolls (`.scan-photo-pane`): a long list used to
            take the photo off screen, so the rows at its end had no picture to be
            matched against. */}
        <div ref={paneRef} className="scan-photo-pane" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {slots.length > 1 && (
            <div role="group" aria-label="Your wall photos" className="scan-walls">
              {slots.map((s) => {
                const sel = activeSlot === s.slot;
                const count = detections.filter((d) => d.slot === s.slot).length;
                return (
                  <button
                    key={s.slot}
                    onClick={() => setActiveSlot(s.slot)}
                    aria-pressed={sel}
                    className="scan-walls__tab"
                  >
                    <span className="truncate">
                      {slotLabel(s.slot)}
                    </span>
                    {count > 0 && <span className="scan-walls__count">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div ref={photoBoxRef} style={{ flex: 1, padding: 16, minHeight: 0, overflow: 'auto' }}>
            {active ? (
              // On the page's left edge with the heading, the notice and the wall
              // buttons, rather than centred away from all three.
              <PhotoEditor
                imageUrl={active.url}
                // The pinned column's cap, one per layout — beside the list and stacked
                // over it — so it lives with the rule that pins it (globals.css).
                maxPhotoHeight="var(--scan-photo-cap)"
                // Without this every photo on this screen shares one generic alt
                // string, which is the whole review queue reading identically to a
                // screen reader. The prop existed; nothing passed it.
                slotLabel={slotLabel(active.slot)}
                items={activeDetections.map(({ d, i }) => ({ index: i, d, locked: confirmed.has(i) }))}
                mode={adding ? 'add' : 'select'}
                onToggleLock={toggleConfirm}
                onDelete={deleteDetection}
                onAddBox={addManual}
                hovered={linked}
                onHover={(i) => setHover(i === null ? null : { index: i, from: 'photo' })}
              >
                {/* Page-level box layer, in the same normalized space as the
                    editor's own overlays: the keyboard placement preview. Pointer
                    events off so it never eats a click meant for the box underneath. */}
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
              </PhotoEditor>
            ) : (
              <div className="t-small" style={{ padding: 12 }}>
                {slots.length === 0 ? 'No wall photos for this room yet.' : 'No photo for this wall yet.'}
              </div>
            )}
          </div>

          <div ref={capProbeRef} aria-hidden="true" className="scan-cap-probe" />

          {active && (
            <div className="scan-hand">
              <button
                onClick={() => {
                  setAdding((v) => !v);
                  setPending(null);
                }}
                aria-pressed={adding}
                className="ds-btn"
                style={{
                  height: 34,
                  fontSize: 'var(--fs-small)',
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
                  <label className="t-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    What is it?
                    <Select
                      value={manualCat}
                      onChange={(v) => setManualCat(v as Detection['category'])}
                      options={MANUAL_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
                      ariaLabel="What is it?"
                      width={176}
                      height={34}
                      fontSize="var(--fs-small)"
                    />
                  </label>
                  {pending ? (
                    <>
                      <button
                        ref={padRef}
                        onClick={() => addManual(pending)}
                        onKeyDown={nudge}
                        className="ds-btn ds-btn--sm"
                        aria-describedby="place-hint"
                      >
                        <Icon name="check" size={13} />
                        Add this box
                      </button>
                      <span id="place-hint" className="t-meta">
                        Arrow keys move it · Shift + arrows resize · Esc cancels
                      </span>
                    </>
                  ) : (
                    <>
                      <button onClick={startPending} className="ds-btn ds-btn--sm">
                        <Icon name="crosshair" size={13} />
                        Place with the keyboard
                      </button>
                      <span className="t-meta">Or drag a box around it on the photo.</span>
                    </>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="rail rail--right">
          <div className="section">
            <div className="section-head">
              <h2 className="section-title">Your pieces</h2>
              {total > 0 && <span className="section-meta">{keptCount} of {total} kept</span>}
            </div>
            {hasWallButtons && total > 0 && (
              <div style={{ marginTop: 8 }}>
                <Segmented
                  ariaLabel="Which pieces to list"
                  value={listScope}
                  onChange={setListScope}
                  options={[
                    { value: 'wall', label: `${slotLabel(activeSlot)} only` },
                    { value: 'all', label: 'All walls' },
                  ]}
                  stretch
                  size={28}
                />
              </div>
            )}
          </div>

          <div className="list" style={{ padding: 10, gap: 4 }}>
            {total === 0 && !running && (
              <div className="t-small" style={{ padding: '14px 12px', lineHeight: 1.5 }}>
                <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Nothing here yet</b>
                Continue for a starter arrangement.
              </div>
            )}
            {total > 0 && keptCount === 0 && !running && (
              <div className="t-small" style={{ padding: '4px 12px 10px', lineHeight: 1.5 }}>
                <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Nothing kept yet</b>
                Your room will open empty.
              </div>
            )}
            {total > 0 && listed.length === 0 && !running && (
              <div className="t-small" style={{ padding: '4px 12px 10px', lineHeight: 1.5 }}>
                <b style={{ display: 'block', marginBottom: 4, color: 'var(--ink)' }}>Nothing found on {slotLabel(activeSlot)}</b>
                Draw a box around anything Danmu missed, or look at another wall.
              </div>
            )}
            {listed.map(({ d, i }) => (
              <DetectionRow
                key={d.uid ?? `row-${i}`}
                d={d}
                confirmed={confirmed.has(i)}
                repeatOf={repeats[i] == null ? null : (detections[repeats[i]] ?? null)}
                doubted={verdicts[i]?.status === 'suspect'}
                index={i}
                onRepair={(cand, keep) => applyRepair(i, cand, keep)}
                offer={offer?.index === i ? offer.candidates : EMPTY_OFFER}
                onDismissOffer={() => setOffer(null)}
                highlighted={linked === i}
                scrollWhenHovered={linked === i && hover?.from === 'photo'}
                onThisPhoto={d.slot === activeSlot}
                onToggle={() => toggleConfirm(i)}
                onRename={(label) => renameDetection(i, label)}
                suggestModels={(draft) => suggestFromLabel(d, draft, cals, roomDims)}
                onDelete={() => deleteDetection(i)}
                onLink={(on) => setHover(on ? { index: i, from: 'row' } : null)}
                onShow={() => setActiveSlot(d.slot)}
                sameAs={(() => {
                  const j = linkedTo(detections, i);
                  return j === null ? null : detections[j];
                })()}
                alsoSeenOn={sightingsOf(detections, i).map((j) => detections[j].slot)}
                linkOptions={linkCandidates(detections, confirmed, i).map((j) => ({
                  index: j,
                  label: `${cleanLabelOf(detections[j])} · ${slotLabel(detections[j].slot)}`,
                }))}
                onLinkTo={(j) => linkRow(i, j)}
                onUnlink={() => unlinkRow(i)}
                onConfirmRepeat={() => {
                  const j = repeats[i];
                  if (j != null) linkRow(i, j);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {running && (
        <LoadingOverlay
          title="Finding your furniture"
          note={
            sendsPhotos
              ? 'Your wall photos go to Google once for this step. Nothing else leaves your device.'
              : undefined
          }
          onCancel={stopDetecting}
          cancelLabel="Stop and add by hand"
          art={<FindingFurniture photos={photoCount} />}
        />
      )}
    </div>
  );
}

// Calm / warn / error share one shell so the difference between "you declined an
// optional feature" and "something broke" is a tone, not a different component
// someone forgets to write.
const NOTICE_TONES: Record<Notice['tone'], { border: string; bg: string; fg: string }> = {
  calm: { border: 'var(--success)', bg: 'var(--success-tint)', fg: 'var(--success-text)' },
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
        // As wide as what it says: its text already stops at 68ch, and the card ran on
        // to the window's edge beside it, 1,884px of tint at 1920.
        width: 'fit-content',
        maxWidth: 'calc(100% - 36px)',
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
          <h2 style={{ fontSize: 'var(--fs-lead)', marginBottom: 6 }}>{notice.title}</h2>
          <p className="t-small" style={{ lineHeight: 1.55, margin: 0, maxWidth: '68ch' }}>
            {notice.body}
          </p>
          {notice.detail && (
            <p className="t-hint" style={{ lineHeight: 1.5, margin: '6px 0 0' }}>{notice.detail}</p>
          )}
        </div>
        {onDismiss && <IconButton icon="x" label="Dismiss this message" onClick={onDismiss} size={28} iconSize={12} />}
      </div>
      {children && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{children}</div>}
    </div>
  );
}

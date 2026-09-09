'use client';

// "Use the colours in my photos" — the room's own wall colours, read out of the
// captures it was built from.
//
// WHY IT IS IN THE BODY and not the section header: `RailSection` documents that
// the header carries ONE control for the section as a whole, and Re-scan has it.
// A second 32px box in a row sized for one at the rail's 228px floor is rule 4's
// spill, and this is not a navigation anyway.
//
// WHY A TOAST and not a live region: `PartTree`'s header says every bulk action in
// this rail answers with a toast, whose host is already the app's only live
// region, and that a second polite region here would make a screen reader say
// things twice.
//
// It reads `useParams` itself rather than taking a `roomId` prop, following
// `RoomDimsEditor` — `PartTree` does not import `next/navigation` and does not
// need to start.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { roomStore } from '@/lib/storage';
import { sampleWallColors, type SkipReason } from '@/lib/wall-colors';
import type { FurnitureKnowledge } from '@/lib/wall-sample';
import { wallSegments } from '@/lib/footprint';
import type { Region } from '@/lib/wall-sample';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';
import { useBusyAction } from '@/components/ui/useBusyAction';
import type { CaptureSlot } from '@/lib/storage';

/** What to say about a photo that produced nothing. One sentence each, naming the
 *  cause rather than the code — a skipped wall the user cannot account for reads
 *  as the feature half working. */
const SKIP_COPY: Record<SkipReason, string> = {
  'no-wall': 'too little clear wall between the skirting and the ceiling',
  blocked: 'furniture covering most of the wall',
  unreadable: 'a photo that could not be read',
  unsampled: 'a wall strip with too little of the picture in it to read',
  unmapped: 'a photo that could not be matched to a wall',
};

/** The furniture caveat, or nothing. Derived from the per-photo fact rather than
 *  from an "any", and said on BOTH toast paths — the first version appended it only
 *  to the per-wall branch, so every L/T/U room (and every room opened from a scene
 *  file, which has no detection boxes at all by design) got a confident success
 *  with the caveat that applied most of all left off. */
function furnitureSentence(f: FurnitureKnowledge): string | undefined {
  if (f.blindIn.length === 0) return undefined;
  if (f.knownIn.length === 0) {
    return 'This room has no detected objects, so anything standing against a wall may have tinted its colour.';
  }
  const n = f.blindIn.length;
  return `${n === 1 ? 'One of these photos has' : `${n} of these photos have`} no detected objects to leave out, so furniture may have tinted ${n === 1 ? 'that wall' : 'those walls'}.`;
}

function skipSentence(skipped: Array<{ slot: CaptureSlot; reason: SkipReason }>): string | undefined {
  if (skipped.length === 0) return undefined;
  // Group by cause, not by wall: "two walls were skipped" plus the reason is what
  // helps, where a list of slot letters is internal vocabulary.
  const reasons = [...new Set(skipped.map((s) => SKIP_COPY[s.reason]))];
  const n = skipped.length;
  return `${n === 1 ? 'One photo was' : `${n} photos were`} skipped — ${reasons.join('; ')}.`;
}

export function WallColorsFromPhotos() {
  const { roomId } = useParams<{ roomId: string }>();
  const setWallColor = useScene((s) => s.setWallColor);
  const setAllWallColors = useScene((s) => s.setAllWallColors);
  const [busy, run] = useBusyAction();

  // Whether this room has photos at all. `hasCaptures` is the cheap variant that
  // does not fan out over multi-megabyte blobs — those are only read on the press.
  const [hasPhotos, setHasPhotos] = useState<boolean | null>(null);
  useEffect(() => {
    if (!roomId) return;
    let live = true;
    const ask = () => {
      roomStore
        .hasCaptures(roomId)
        .then((yes) => {
          if (live) setHasPhotos(yes);
        })
        // No captures as far as this control is concerned. The rationale below
        // says a button that can only fail is worse than no button, and an
        // unreadable IndexedDB is that case — but it has to be an explicit choice
        // rather than an unhandled rejection, which is what this was.
        .catch(() => {
          if (live) setHasPhotos(false);
        });
    };
    ask();
    // Asked ONCE per `roomId` before, so the answer went stale in both
    // directions: photograph the room that is already open (in another tab, or
    // through the capture screen and back without a remount) and the button stayed
    // absent, while deleting the captures left it present and only able to fail.
    // Focus is the cheap signal that something may have happened elsewhere; the
    // press itself still re-checks by loading the captures.
    window.addEventListener('focus', ask);
    return () => {
      live = false;
      window.removeEventListener('focus', ask);
    };
  }, [roomId]);

  // A room with no photos has nothing to offer, and an always-visible button that
  // can only fail is worse than no button. Null = still asking.
  if (!roomId || hasPhotos !== true) return null;

  async function sample() {
    try {
      await sampleAndPaint();
    } catch {
      // `useBusyAction` clears its flag and re-raises, so without this the spinner
      // simply stops and NOTHING is said — against copy that promises an outcome
      // for every path. IndexedDB is unavailable in some private-browsing modes,
      // and `loadCaptures` is the first thing this does.
      toast({
        tone: 'danger',
        title: 'Could not read your photos',
        message: 'This room’s photos could not be opened just now. Nothing was changed.',
      });
    }
  }

  async function sampleAndPaint() {
    // Read at PRESS time rather than out of the last render's closure. Both were
    // the same value in practice — the component subscribed to `room`, so React
    // re-rendered before the press — but a press handler that reads the store when
    // it is pressed cannot be wrong about it, and this one now also decides which
    // room it is allowed to write to.
    const { room, parts } = useScene.getState();
    const sampledFootprint = room.footprint;
    const captures = await roomStore.loadCaptures(roomId);
    // Detected furniture, so a sofa does not become the wall colour. Rides on the
    // parts as `fromDetection`, which is stripped from an exported scene file — so
    // a room opened from a file has none and the sample leans on the wall band and
    // the median alone. That is reported rather than silently done.
    const boxesBySlot: Partial<Record<CaptureSlot, Region[]>> = {};
    for (const p of parts) {
      const d = p.fromDetection;
      if (!d) continue;
      (boxesBySlot[d.slot] ??= []).push(d.bbox as Region);
    }

    const proposal = await sampleWallColors({
      captures,
      ceilingM: room.height,
      footprint: room.footprint,
      boxesBySlot,
    });

    // Every write below is a global store action that outlives this component, so
    // the room the answer belongs to has to be checked again now that the awaits
    // are done — see `loadedRoomId` in `lib/scene-store.ts`.
    const stillHere = () => useScene.getState().loadedRoomId === roomId;
    if (!stillHere()) return;
    // And the geometry the sample was measured from has to still be the geometry
    // on screen: a wall dragged mid-sample re-derives the footprint, so these wall
    // indices would land on a shape that no longer exists — and the in-range check
    // in `wallColorProposal` cannot catch it, having been evaluated against the
    // footprint as it was. `moveWall` and `setRoom` both write a fresh polygon
    // array, so identity is the test; painting a wall does not, so an ordinary
    // recolour mid-sample is not mistaken for a reshape.
    if (useScene.getState().room.footprint !== sampledFootprint) {
      toast({
        title: 'The room changed while your photos were being read',
        message: 'Nothing was applied, because the colours were measured from the room’s old shape. Press it again.',
      });
      return;
    }

    const detail = proposal ? skipSentence(proposal.skipped) : undefined;
    const caveat = proposal ? furnitureSentence(proposal.furniture) : undefined;
    const painted = proposal ? Object.keys(proposal.perWall).length : 0;
    if (!proposal || (painted === 0 && !proposal.allWalls)) {
      toast({
        title: 'No wall colour to read',
        message:
          detail ??
          'None of this room’s photos showed enough clear wall to sample. Re-take one with more of the wall in frame.',
      });
      return;
    }

    // The undo snapshot is taken HERE — after the awaits, immediately before the
    // write — and that is the whole of it. Read at the press (or, as the first
    // version had it, out of the render closure) it is the map from before four
    // JPEG decodes, so a wall the user painted while they waited was not in it and
    // Undo silently discarded their work. Restoring the map creates a new `room`
    // object, so the normal undo stack still sees it as an edit.
    //
    // The gate matters more here than on the write: a toast lives 9 seconds, which
    // is long enough to open another room, and this map is the OTHER room's paint
    // — usually `{}`. Pressing Undo there erased whatever the user had painted in
    // the room they were now looking at.
    const before = useScene.getState().room.wallColors;
    const undo = {
      label: 'Undo',
      onClick: () => {
        if (!stillHere()) return;
        useScene.setState((s) => ({ room: { ...s.room, wallColors: before } }));
      },
    };

    if (proposal.allWalls) {
      setAllWallColors(proposal.allWalls);
      toast({
        tone: 'success',
        title: 'Every wall took the colour from your photos',
        message: [
          'This room’s shape can’t say which wall each photo shows, so they share one colour.',
          detail,
          caveat,
        ]
          .filter(Boolean)
          .join(' '),
        action: undo,
      });
      return;
    }

    for (const [index, hex] of Object.entries(proposal.perWall)) setWallColor(Number(index), hex);
    const total = wallSegments(sampledFootprint).length;
    toast({
      tone: 'success',
      title: `${painted} of ${total} walls took their colour from your photos`,
      message: [detail, caveat].filter(Boolean).join(' '),
      action: undo,
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => run(sample)}
        disabled={busy}
        aria-busy={busy}
        className="ds-btn"
        title="Read each wall’s colour out of the photo of it"
        style={{ width: '100%', height: 32, fontSize: 12, gap: 6, justifyContent: 'center' }}
      >
        {busy ? <Spinner size={12} /> : <Icon name="image" size={13} />}
        {/* The label gets its OWN element, which is what `.ds-btn`'s own comment
            prescribes for a button with no room: it is `white-space: nowrap` with
            no `overflow`, and a bare text node beside an icon is an anonymous flex
            item that nothing can address — so a label too long for the pill printed
            straight through its border, and the rail's `overflow: hidden` clipped
            what crossed the edge with no scrollbar and no clue.
            "Use the colours in my photos" is 28 characters: ~168–185px at 12px
            Nunito, plus a 13px icon, a 6px gap and 32px of padding, so 219–236px of
            content against a rail that is `--rail-left-tight` 208px at the compact
            step (1024–1279px) and 228px at its floor. The idle label is the one that
            breaks — the busy one is shorter. Shortened AND made to ellipsise, so a
            future rewording degrades instead of spilling. */}
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {busy ? 'Reading your photos…' : 'Use my photos’ colours'}
        </span>
      </button>
      <p style={{ margin: '6px 0 0', fontSize: 10.5, lineHeight: 1.4, color: 'var(--ink-3)' }}>
        Reads the wall colour straight out of each photo. Nothing is uploaded, and Undo puts it back.
      </p>
    </div>
  );
}

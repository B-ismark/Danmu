'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRoom, useSettings } from '@/lib/store';
import { roomStore, blobToObjectUrl, type Capture, type CaptureSlot } from '@/lib/storage';
import { detectAcrossImages, DetectError, type Detection } from '@/lib/detection';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, IconButton } from '@/components/ui/primitives';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
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

export default function DetectPage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const apiKey = useSettings((s) => s.apiKey);
  const [running, setRunning] = useState(false);
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [activeSlot, setActiveSlot] = useState<CaptureSlot>('n');
  const [error, setError] = useState<{ code: string; title: string; body: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // Geometry context for deterministic dims — per-slot camera calibration +
  // the room's real dimensions. Used on fresh detections and manual adds.
  const [cals, setCals] = useState<CalMap>({});
  const [roomDims, setRoomDims] = useState<RoomDims | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let urls: string[] = [];
    let cancelled = false;
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      if (caps.length === 0) {
        setError({ code: 'NO_CAPS', title: 'No captures found', body: 'Upload photos first.' });
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
        const cached: Detection[] = room.detectedObjects.map((d) => ({
          label: d.label.replace(/__slot:[nesw]$/, ''),
          conf: d.conf,
          box: d.box as [number, number, number, number],
          category: (d.category ?? 'other') as Detection['category'],
          slot: ((d.label.match(/__slot:([nesw])$/) ?? [])[1] ?? 'n') as CaptureSlot,
          dimMM: d.dimMM,
          color: d.color,
          meshHash: d.meshHash,
        }));
        setDetections(cached);
        setLocked(new Set(room.detectedObjects.map((d, i) => (d.locked ? i : -1)).filter((x) => x >= 0)));
        return;
      }

      // Otherwise: local on-device detector first (no key, no quota); Gemini
      // only as the fallback when the model isn't deployed or finds nothing.
      setRunning(true);
      try {
        let dets: Detection[] | null = null;
        if (await localDetectorAvailable()) {
          try {
            dets = await detectLocalAcrossImages(entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })));
            if (dets && dets.length === 0) dets = null; // empty result → let Gemini try
          } catch {
            dets = null;
          }
        }
        dets ??= await detectAcrossImages(
          apiKey,
          entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })),
          room ? { width: room.width, depth: room.depth, height: room.height, layoutId: room.layoutId } : undefined,
        );
        if (cancelled) return;
        // Geometry pass — deterministic position + W/H from the calibrated
        // camera; the AI result only contributes label/category/depth hint.
        const refined = room
          ? dets.map((d) => geoRefine(d, calMap, { width: room.width, depth: room.depth }))
          : dets;
        setDetections(refined);
        const lockSet = new Set<number>();
        refined.forEach((d, i) => {
          if (d.conf >= 0.85) lockSet.add(i);
        });
        setLocked(lockSet);
      } catch (e) {
        if (e instanceof DetectError) {
          if (e.code === 'DAILY_QUOTA') {
            setError({
              code: e.code,
              title: 'Daily scan limit reached',
              body: 'You’ve used today’s room scans. It resets overnight — or skip scanning and add your furniture by hand.',
            });
          } else if (e.code === 'RATE_LIMIT') {
            setError({ code: e.code, title: 'Per-minute rate limit', body: 'Wait 60s and reload this page.' });
          } else if (e.code === 'INVALID_KEY') {
            setError({ code: e.code, title: 'Invalid API key', body: 'Check your key in Settings.' });
          } else {
            setError({ code: 'UNKNOWN', title: 'Detection failed', body: e.message });
          }
        } else {
          setError({ code: 'UNKNOWN', title: 'Detection failed', body: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [roomId, apiKey]);

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
      const updates = new Map<number, string>();
      for (const { d, i } of missing) {
        const cap = slots.find((s) => s.slot === d.slot)?.cap;
        const sampled = cap ? await sampleBoxColor(cap.blob, d.box) : null;
        const color = sampled ?? d.color; // hybrid: photo sample, else Gemini hex
        if (color) updates.set(i, color);
      }
      if (cancelled || updates.size === 0) return;
      setDetections((arr) => arr.map((x, i) => (updates.has(i) ? { ...x, color: updates.get(i) } : x)));
    })();
    return () => {
      cancelled = true;
    };
  }, [detections, slots]);

  function toggle(i: number) {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function deleteDetection(i: number) {
    setDetections((d) => d.filter((_, idx) => idx !== i));
    setLocked((prev) => {
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

  function addManual(box: [number, number, number, number]) {
    let det: Detection = {
      label: 'New item',
      conf: 1,
      box,
      category: 'other',
      slot: activeSlot,
    };
    // Zero-AI path: the drawn box + calibrated camera give real position and
    // W/H directly. Works offline, no key needed.
    if (roomDims) det = geoRefine(det, cals, roomDims);
    setDetections((d) => [...d, det]);
    setLocked((prev) => new Set(prev).add(detections.length));
    setAdding(false);
  }

  async function finish() {
    if (!roomId) return;
    const room = await roomStore.loadRoom(roomId);
    if (!room) return;
    const flat = detections.map((d, i) => ({
      id: i,
      label: `${d.label}__slot:${d.slot}`,
      conf: d.conf,
      locked: locked.has(i),
      box: d.box,
      category: d.category,
      dimMM: d.dimMM,
      position: d.position,
      yaw: d.yaw,
      shape: d.shape,
      color: d.color,
      meshHash: d.meshHash,
    }));
    await roomStore.saveRoom({ ...room, detectedObjects: flat });
    router.push(`/room/${roomId}/model`);
  }

  const active = slots.find((s) => s.slot === activeSlot);
  const activeDetections = detections
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.slot === activeSlot);
  const total = detections.length;
  const lockedCount = locked.size;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      {/* Top bar */}
      <div
        style={{
          height: 56,
          padding: '0 24px',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexShrink: 0,
        }}
      >
        <button onClick={() => router.back()} className="ds-btn ds-btn--ghost" style={{ height: 32, padding: '0 8px' }}>
          <Icon name="chevron-left" size={14} />
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Back</span>
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <DanmuMark size={12} />
        <span className="ds-label" style={{ marginLeft: 6 }}>Step 04 / 04 · Detect</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
          {running ? 'Cross-referencing 4 walls…' : `${total} items · ${lockedCount} locked`}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={finish} disabled={running} className="ds-btn ds-btn--primary" style={{ height: 32, fontSize: 12 }}>
          Continue · Studio
          <Icon name="arrow-right" size={12} />
        </button>
      </div>

      {error && (
        <ErrorBanner
          title={error.title}
          body={error.body}
          onSkip={() => {
            setError(null);
            // skip detection — go to studio with empty/default scene
            router.push(`/room/${roomId}/model`);
          }}
          onRetry={() => {
            setError(null);
            location.reload();
          }}
        />
      )}

      {/* MAIN: split */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 0 }}>
        {/* IMAGE PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--hairline)' }}>
          {/* slot tabs */}
          <div style={{ display: 'flex', padding: '8px 16px 0', gap: 6, flexShrink: 0 }}>
            {slots.map((s) => {
              const sel = activeSlot === s.slot;
              const slotCount = detections.filter((d) => d.slot === s.slot).length;
              const slotLocks = detections.filter((d, i) => d.slot === s.slot && locked.has(i)).length;
              return (
                <button
                  key={s.slot}
                  onClick={() => setActiveSlot(s.slot)}
                  aria-pressed={sel}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: sel ? 'var(--ink)' : 'var(--paper)',
                    color: sel ? 'var(--paper)' : 'var(--ink-2)',
                    border: sel ? '1px solid var(--ink)' : '1px solid var(--hairline-strong)',
                    borderRadius: 'var(--r-2)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>{s.slot.toUpperCase()}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, opacity: 0.85 }}>
                    <span className="mono">{slotCount}</span>
                    {slotLocks > 0 && (
                      <>
                        <Icon name="lock" size={9} color={sel ? 'var(--paper)' : 'var(--locked)'} />
                        <span className="mono">{slotLocks}</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* image canvas */}
          <div style={{ flex: 1, position: 'relative', padding: 16, minHeight: 0 }}>
            {active && (
              <PhotoEditor
                imageUrl={active.url}
                items={activeDetections.map(({ d, i }) => ({ index: i, d, locked: locked.has(i) }))}
                mode={adding ? 'add' : 'select'}
                onToggleLock={toggle}
                onDelete={deleteDetection}
                onAddBox={addManual}
              />
            )}
          </div>

          {/* canvas toolbar */}
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setAdding((v) => !v)}
              className="ds-btn"
              style={{
                height: 30,
                fontSize: 12,
                background: adding ? 'var(--accent)' : 'var(--paper)',
                color: adding ? '#fff' : 'var(--ink-2)',
                borderColor: adding ? 'var(--accent)' : 'var(--hairline-strong)',
              }}
            >
              <Icon name={adding ? 'x' : 'plus'} size={12} color={adding ? '#fff' : 'var(--ink-2)'} />
              {adding ? 'Cancel add' : 'Add missing item'}
            </button>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>
              {adding
                ? 'Drag on the image to draw a box'
                : 'Drag a box to reposition it, or click to lock it.'}
            </div>
          </div>
        </div>

        {/* RIGHT: list */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="ds-label">Detected · {total}</span>
              <span className="ds-label" style={{ color: 'var(--locked)' }}>{lockedCount} locked</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0', lineHeight: 1.4 }}>
              Lock = high-confidence item, kept as-is in your 3D room. Toggle on/off freely.
            </p>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {detections.length === 0 && !running && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: 12, textAlign: 'center' }}>
                No items detected. Use <b>Add missing item</b> on the image.
              </div>
            )}
            {detections.map((d, i) => (
              <DetectionRow
                key={i}
                index={i}
                d={d}
                isLocked={locked.has(i)}
                onToggle={() => toggle(i)}
                onRename={(label) => renameDetection(i, label)}
                onDelete={() => deleteDetection(i)}
              />
            ))}
          </div>
        </div>
      </div>

      {running && (
        <LoadingOverlay
          title="Finding your furniture"
          description="We look at all your photos together so a piece seen on two walls isn’t counted twice. Usually 10–20 seconds."
        />
      )}
    </div>
  );
}

function ErrorBanner({
  title,
  body,
  onSkip,
  onRetry,
}: {
  title: string;
  body: string;
  onSkip: () => void;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        margin: '14px 24px',
        border: '1px solid var(--danger)',
        background: 'var(--danger-tint)',
        borderRadius: 'var(--r-3)',
        padding: 16,
      }}
    >
      <div className="ds-label" style={{ fontSize: 10, color: 'var(--danger)', marginBottom: 6 }}>
        Detection error
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, margin: '0 0 12px' }}>{body}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onRetry} className="ds-btn" style={{ height: 32, fontSize: 12 }}>
          <Icon name="refresh" size={11} />
          Retry
        </button>
        <button onClick={onSkip} className="ds-btn ds-btn--primary" style={{ height: 32, fontSize: 12 }}>
          Skip · go to studio
          <Icon name="arrow-right" size={11} />
        </button>
      </div>
    </div>
  );
}

function DetectionRow({
  index,
  d,
  isLocked,
  onToggle,
  onRename,
  onDelete,
}: {
  index: number;
  d: Detection;
  isLocked: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const cleanLabel = d.label.replace(/__slot:[nesw]$/, '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cleanLabel);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== cleanLabel) onRename(trimmed);
    setEditing(false);
  }

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid var(--hairline)',
        borderRadius: 'var(--r-2)',
        background: isLocked ? 'var(--locked-tint)' : 'var(--paper)',
        cursor: 'pointer',
      }}
    >
      <Icon name={isLocked ? 'lock' : 'unlock'} size={13} color={isLocked ? 'var(--locked)' : 'var(--ink-3)'} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') {
                setDraft(cleanLabel);
                setEditing(false);
              }
            }}
            style={{
              width: '100%',
              fontFamily: 'var(--font-sans)',
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--ink)',
              padding: '2px 4px',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--r-1)',
              outline: 'none',
              background: 'var(--paper)',
            }}
          />
        ) : (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
              setDraft(cleanLabel);
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--ink)',
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              padding: '2px 4px',
              borderRadius: 'var(--r-1)',
              cursor: 'text',
            }}
            title="Click to rename"
          >
            {cleanLabel}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'capitalize' }}>
          {d.slot.toUpperCase()} · {d.category} · <span className="mono">{(d.conf * 100).toFixed(0)}%</span>
          {d.alsoSeenIn && d.alsoSeenIn.length > 0 && (
            <> · Also {d.alsoSeenIn.join('/').toUpperCase()}</>
          )}
        </div>
      </div>
      <IconButton
        icon="x"
        label="Remove"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        size={24}
        iconSize={10}
        style={{ borderRadius: 'var(--r-1)' }}
      />
    </div>
  );
}


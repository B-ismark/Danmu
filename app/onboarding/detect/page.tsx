'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRoom, useSettings } from '@/lib/store';
import { roomStore, blobToObjectUrl, type Capture, type CaptureSlot } from '@/lib/storage';
import { detectAcrossImages, DetectError, type Detection } from '@/lib/detection';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark } from '@/components/ui/primitives';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { PhotoEditor } from '@/components/studio/PhotoEditor';
import { cropFromBbox, perceptualHash } from '@/lib/mask';
import { sampleBoxColor } from '@/lib/color-sample';
import { meshCache } from '@/lib/mesh-cache';
import { generateMesh, Mesh3dError } from '@/lib/image-to-3d';

type SlotEntry = { slot: CaptureSlot; url: string; cap: Capture };

export default function DetectPage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const apiKey = useSettings((s) => s.apiKey);
  const mesh3dProvider = useSettings((s) => s.mesh3dProvider);
  const meshyKey = useSettings((s) => s.meshyKey);
  const tripoKey = useSettings((s) => s.tripoKey);
  const [running, setRunning] = useState(false);
  const [slots, setSlots] = useState<SlotEntry[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [activeSlot, setActiveSlot] = useState<CaptureSlot>('n');
  const [error, setError] = useState<{ code: string; title: string; body: string } | null>(null);
  const [adding, setAdding] = useState(false);
  /** indices of detections with cached meshes (synced from meshCache on load + mesh-gen) */
  const [meshReady, setMeshReady] = useState<Set<number>>(new Set());
  const [meshPending, setMeshPending] = useState<Set<number>>(new Set());
  const [meshError, setMeshError] = useState<string | null>(null);

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
      if (room?.detectedObjects && room.detectedObjects.length > 0) {
        const cached: Detection[] = room.detectedObjects.map((d) => ({
          label: d.label.replace(/__slot:[nesw]$/, ''),
          conf: d.conf,
          box: d.box as [number, number, number, number],
          category: (d.category ?? 'other') as Detection['category'],
          slot: ((d.label.match(/__slot:([nesw])$/) ?? [])[1] ?? 'n') as CaptureSlot,
          dimMM: d.dimMM,
          color: d.color,
          dstBox: d.dstBox as [number, number, number, number] | undefined,
          removed: d.removed,
          meshHash: d.meshHash,
        }));
        setDetections(cached);
        setLocked(new Set(room.detectedObjects.map((d, i) => (d.locked ? i : -1)).filter((x) => x >= 0)));
        // Hydrate mesh-ready set from cache.
        const ready = new Set<number>();
        for (const [i, d] of cached.entries()) {
          if (d.meshHash && (await meshCache.has(d.meshHash))) ready.add(i);
        }
        setMeshReady(ready);
        return;
      }

      // Otherwise: single multi-image Gemini call.
      setRunning(true);
      try {
        const dets = await detectAcrossImages(
          apiKey,
          entries.map((e) => ({ slot: e.slot, blob: e.cap.blob })),
          room ? { width: room.width, depth: room.depth, height: room.height, layoutId: room.layoutId } : undefined,
        );
        if (cancelled) return;
        setDetections(dets);
        const lockSet = new Set<number>();
        dets.forEach((d, i) => {
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
    const det: Detection = {
      label: 'New item',
      conf: 1,
      box,
      category: 'other',
      slot: activeSlot,
    };
    setDetections((d) => [...d, det]);
    setLocked((prev) => new Set(prev).add(detections.length));
    setAdding(false);
  }

  function setDstBox(i: number, dst: [number, number, number, number]) {
    setDetections((d) => d.map((x, idx) => (idx === i ? { ...x, dstBox: dst } : x)));
  }
  function clearDstBox(i: number) {
    setDetections((d) =>
      d.map((x, idx) => {
        if (idx !== i) return x;
        const { dstBox: _drop, ...rest } = x;
        return rest;
      }),
    );
  }
  function toggleRemoved(i: number) {
    setDetections((d) => d.map((x, idx) => (idx === i ? { ...x, removed: !x.removed } : x)));
  }

  async function persistDetections(meshIdx: number, meshHash: string) {
    if (!roomId) return;
    const room = await roomStore.loadRoom(roomId);
    if (!room) return;
    // Mirror finish()'s shape exactly — full rewrite of detectedObjects from
    // the in-memory state so brand-new detect runs (which haven't called
    // finish() yet) still produce a consistent persisted array.
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
      dstBox: d.dstBox,
      removed: d.removed,
      meshHash: i === meshIdx ? meshHash : d.meshHash,
    }));
    await roomStore.saveRoom({ ...room, detectedObjects: flat });
  }

  async function make3d(i: number) {
    if (mesh3dProvider === 'off') {
      setMeshError('Enable a 3D provider in Settings first.');
      return;
    }
    const key = mesh3dProvider === 'meshy' ? meshyKey : tripoKey;
    if (!key) {
      setMeshError(`Add ${mesh3dProvider} API key in Settings.`);
      return;
    }
    const det = detections[i];
    if (!det) return;
    const cap = slots.find((s) => s.slot === det.slot)?.cap;
    if (!cap) return;

    setMeshError(null);
    setMeshPending((prev) => new Set(prev).add(i));
    try {
      const crop = await cropFromBbox(cap.blob, det.box);
      const hash = await perceptualHash(crop);

      // Cache hit? Skip the network call entirely.
      const fromCache = await meshCache.has(hash);
      if (!fromCache) {
        const result = await generateMesh(mesh3dProvider, key, crop, { label: det.label });
        await meshCache.put({
          hash,
          label: det.label,
          provider: result.provider,
          glb: result.glb,
          remoteUrl: result.remoteUrl,
          createdAt: Date.now(),
          source: roomId ? { roomId, slot: det.slot, bbox: det.box } : undefined,
        });
      }
      setDetections((d) => d.map((x, idx) => (idx === i ? { ...x, meshHash: hash } : x)));
      setMeshReady((prev) => new Set(prev).add(i));

      // Auto-persist immediately so a refresh on this page doesn't lose the
      // binding. The GLB itself lives forever in meshCache, but without the
      // hash on the detection nothing references it.
      if (roomId) await persistDetections(i, hash);
    } catch (e) {
      if (e instanceof Mesh3dError) setMeshError(`${e.code}: ${e.message}`);
      else setMeshError(e instanceof Error ? e.message : String(e));
    } finally {
      setMeshPending((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });
    }
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
      dstBox: d.dstBox,
      removed: d.removed,
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
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: sel ? 'var(--ink)' : 'var(--paper)',
                    color: sel ? 'var(--paper)' : 'var(--ink-2)',
                    border: sel ? '1px solid var(--ink)' : '1px solid var(--hairline-strong)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{s.slot.toUpperCase()}</span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>
                    {slotCount} {slotLocks > 0 && <span style={{ color: sel ? '#9CC1F2' : 'var(--locked)' }}>· {slotLocks}🔒</span>}
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
                onSetDstBox={setDstBox}
                onClearDstBox={clearDstBox}
                onToggleRemoved={toggleRemoved}
                onAddBox={addManual}
                onMake3d={mesh3dProvider === 'off' ? undefined : make3d}
                meshAvailable={(i) => meshReady.has(i)}
                meshPending={(i) => meshPending.has(i)}
              />
            )}
          </div>

          {meshError && (
            <div
              style={{
                margin: '0 16px 8px',
                padding: '6px 10px',
                background: 'rgba(192,38,24,0.08)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: 11,
              }}
            >
              3D · {meshError}
              <button
                onClick={() => setMeshError(null)}
                style={{
                  marginLeft: 8,
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  padding: '0 6px',
                  cursor: 'pointer',
                  fontSize: 10,
                }}
              >
                Dismiss
              </button>
            </div>
          )}

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
                : 'Drag a box to move · click to lock · ∅ remove · 3D mesh · ✕ delete'}
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
              Lock = preserved when AI renders around it. Toggle on/off freely.
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
        background: 'rgba(192,38,24,0.05)',
        padding: 16,
      }}
    >
      <div className="ds-label" style={{ fontSize: 10, color: 'var(--danger)', marginBottom: 6 }}>
        ⚠ Detection error
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
              borderRadius: 2,
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
              borderRadius: 2,
              cursor: 'text',
            }}
            title="Click to rename"
          >
            {cleanLabel}
          </div>
        )}
        <div className="mono" style={{ fontSize: 9, color: 'var(--ink-3)' }}>
          {d.slot.toUpperCase()} · {d.category} · {(d.conf * 100).toFixed(0)}%
          {d.alsoSeenIn && d.alsoSeenIn.length > 0 && (
            <> · Also {d.alsoSeenIn.join('/').toUpperCase()}</>
          )}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{
          width: 22,
          height: 22,
          border: '1px solid var(--hairline-strong)',
          background: 'var(--paper)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-3)',
        }}
        aria-label="Remove"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}


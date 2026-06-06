'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRoom } from '@/lib/store';
import { roomStore, blobToObjectUrl } from '@/lib/storage';
import { CAPTURE_SLOTS, snapToBlob, startCamera } from '@/lib/capture';
import { scoreQuality, flagLabel, flagColor, type Quality } from '@/lib/image-quality';
import { Icon } from '@/components/ui/Icon';
import { DanmuMark, Dot } from '@/components/ui/primitives';
import type { CaptureSlot } from '@/lib/storage';

type Source = 'upload' | 'camera';

export default function CapturePage() {
  const router = useRouter();
  const roomId = useRoom((s) => s.roomId);
  const [source, setSource] = useState<Source>('upload');
  const [activeSlot, setActiveSlot] = useState<CaptureSlot>('n');
  const [blobs, setBlobs] = useState<Record<CaptureSlot, Blob | null>>({ n: null, e: null, s: null, w: null });
  const [previews, setPreviews] = useState<Record<CaptureSlot, string | null>>({ n: null, e: null, s: null, w: null });
  const [qualities, setQualities] = useState<Record<CaptureSlot, Quality | null>>({ n: null, e: null, s: null, w: null });
  const [draggingFrom, setDraggingFrom] = useState<CaptureSlot | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let urls: string[] = [];
    (async () => {
      const caps = await roomStore.loadCaptures(roomId);
      const nextB: Record<CaptureSlot, Blob | null> = { n: null, e: null, s: null, w: null };
      const nextU: Record<CaptureSlot, string | null> = { n: null, e: null, s: null, w: null };
      for (const c of caps) {
        nextB[c.slot] = c.blob;
        const u = blobToObjectUrl(c.blob);
        urls.push(u);
        nextU[c.slot] = u;
      }
      setBlobs(nextB);
      setPreviews(nextU);
      // Score quality for any pre-existing captures
      for (const c of caps) {
        scoreQuality(c.blob).then((q) =>
          setQualities((prev) => ({ ...prev, [c.slot]: q })),
        );
      }
    })();
    return () => urls.forEach(URL.revokeObjectURL);
  }, [roomId]);

  async function persistBlob(slot: CaptureSlot, blob: Blob) {
    if (!roomId) return;
    await roomStore.saveCapture(roomId, { slot, blob, takenAt: Date.now() });
    setBlobs((p) => ({ ...p, [slot]: blob }));
    if (previews[slot]) URL.revokeObjectURL(previews[slot]!);
    setPreviews((p) => ({ ...p, [slot]: blobToObjectUrl(blob) }));
    setQualities((q) => ({ ...q, [slot]: null }));
    scoreQuality(blob).then((q) => setQualities((prev) => ({ ...prev, [slot]: q })));
  }

  async function swapSlots(a: CaptureSlot, b: CaptureSlot) {
    if (!roomId || a === b) return;
    const blobA = blobs[a];
    const blobB = blobs[b];
    if (blobA) await roomStore.saveCapture(roomId, { slot: b, blob: blobA, takenAt: Date.now() });
    if (blobB) await roomStore.saveCapture(roomId, { slot: a, blob: blobB, takenAt: Date.now() });
    setBlobs({ ...blobs, [a]: blobB, [b]: blobA });
    setPreviews({ ...previews, [a]: previews[b], [b]: previews[a] });
  }

  const allCaptured = (Object.keys(previews) as CaptureSlot[]).every((k) => previews[k]);
  const filled = Object.values(previews).filter(Boolean).length;
  const anyCaptured = filled > 0;
  const flaggedCount = Object.values(qualities).filter((q) => q && !q.flags.includes('ok')).length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      {/* TOP BAR */}
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
        <span className="ds-label" style={{ marginLeft: 6 }}>Step 03 / 04 · Capture</span>
        <span style={{ fontSize: 13, color: 'var(--ink)' }}>Add 4 wall photos</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em' }}>
          {filled} / 4
        </span>
        {flaggedCount > 0 && (
          <span
            style={{
              padding: '4px 8px',
              background: 'rgba(192,38,24,0.1)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              fontSize: 10,
            }}
          >
            ⚠ {flaggedCount} quality issue{flaggedCount > 1 ? 's' : ''} — detection may miss things
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: '1px solid var(--hairline-strong)' }}>
          {(
            [
              { id: 'upload', label: 'Upload', icon: 'image' },
              { id: 'camera', label: 'Camera', icon: 'camera' },
            ] as const
          ).map((m, i) => (
            <button
              key={m.id}
              onClick={() => setSource(m.id)}
              style={{
                height: 32,
                padding: '0 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: source === m.id ? 'var(--ink)' : 'var(--paper)',
                color: source === m.id ? 'var(--paper)' : 'var(--ink-2)',
                border: 'none',
                borderRight: i === 0 ? '1px solid var(--hairline-strong)' : 'none',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Icon name={m.icon} size={12} color={source === m.id ? 'var(--paper)' : 'var(--ink-2)'} />
              {m.label}
            </button>
          ))}
        </div>
        <button
          className="ds-btn ds-btn--primary"
          style={{ height: 32, fontSize: 12 }}
          disabled={!anyCaptured}
          onClick={() => router.push('/onboarding/detect')}
        >
          {!anyCaptured ? 'Upload at least 1 wall' : allCaptured ? 'Continue · Detect items' : `Detect with ${filled} wall${filled > 1 ? 's' : ''}`}
          <Icon name="arrow-right" size={12} />
        </button>
      </div>

      {/* MAIN: 2×2 grid fills viewport */}
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: source === 'camera' ? '1fr 360px' : '1fr',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: 8,
            padding: 16,
            minHeight: 0,
          }}
        >
          {CAPTURE_SLOTS.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              url={previews[slot.id]}
              quality={qualities[slot.id]}
              active={activeSlot === slot.id}
              onSelect={() => setActiveSlot(slot.id)}
              onUpload={(blob) => persistBlob(slot.id, blob)}
              draggingFrom={draggingFrom}
              setDraggingFrom={setDraggingFrom}
              onDropFrom={(from) => swapSlots(from, slot.id)}
            />
          ))}
        </div>

        {source === 'camera' && (
          <div style={{ borderLeft: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)' }}>
              <span className="ds-label">Camera · {activeSlot.toUpperCase()}</span>
              <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '6px 0 0' }}>
                Click a slot in the grid to set the target wall, then shoot.
              </p>
            </div>
            <CameraPanel activeSlot={activeSlot} onCapture={(blob) => persistBlob(activeSlot, blob)} />
          </div>
        )}
      </div>
    </div>
  );
}

function SlotCard({
  slot,
  url,
  quality,
  active,
  onSelect,
  onUpload,
  draggingFrom,
  setDraggingFrom,
  onDropFrom,
}: {
  slot: { id: CaptureSlot; label: string };
  url: string | null;
  quality: Quality | null;
  active: boolean;
  onSelect: () => void;
  onUpload: (blob: Blob) => void;
  draggingFrom: CaptureSlot | null;
  setDraggingFrom: (s: CaptureSlot | null) => void;
  onDropFrom: (from: CaptureSlot) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function trigger() {
    inputRef.current?.click();
  }

  return (
    <div
      onClick={() => {
        onSelect();
        if (!url) trigger();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // External file drop
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('image/')) {
          onUpload(f);
          return;
        }
        // Internal slot swap
        if (draggingFrom && draggingFrom !== slot.id) {
          onDropFrom(draggingFrom);
        }
      }}
      style={{
        position: 'relative',
        background: url ? '#000' : 'var(--paper-2)',
        border: over
          ? '2px solid var(--accent)'
          : active
            ? '2px solid var(--accent)'
            : url
              ? '1px solid var(--hairline-strong)'
              : '1px dashed var(--hairline-strong)',
        cursor: 'pointer',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {url ? (
        <img
          src={url}
          alt={slot.label}
          draggable
          onDragStart={(e) => {
            setDraggingFrom(slot.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDraggingFrom(null)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'grab' }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--ink-3)',
          }}
        >
          <Icon name="plus" size={28} color="var(--ink-3)" />
          <span style={{ fontSize: 11 }}>
            Click or drop image
          </span>
          <span style={{ fontSize: 9, color: 'var(--ink-4)' }}>
            <span className="mono">{slot.id.toUpperCase()}</span> · {slot.label}
          </span>
        </div>
      )}

      {/* slot badge */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '3px 8px',
          background: url ? 'rgba(0,0,0,0.8)' : 'var(--ink)',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {url ? <Icon name="check" size={10} color="#7AD27A" /> : <Dot color="#fff" size={5} />}
        <span style={{ fontSize: 10, color: '#fff' }}>
          <span className="mono">{slot.id.toUpperCase()}</span> · {slot.label}
        </span>
      </div>

      {/* actions */}
      {url && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 4,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              trigger();
            }}
            style={btnStyle()}
          >
            Replace
          </button>
        </div>
      )}

      {url && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {quality
            ? quality.flags.map((f) => (
                <span
                  key={f}
                  style={{
                    padding: '3px 8px',
                    background: f === 'ok' ? 'rgba(46,125,79,0.92)' : 'rgba(192,38,24,0.92)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    letterSpacing: '0.08em',
                  }}
                >
                  {f === 'ok' ? '✓ ' : '⚠ '}
                  {flagLabel(f)}
                </span>
              ))
            : (
                <span
                  style={{
                    padding: '3px 8px',
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    fontSize: 9,
                  }}
                >
                  Analyzing…
                </span>
              )}
          <div style={{ flex: 1 }} />
          <span
            style={{
              padding: '3px 8px',
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontSize: 9,
            }}
          >
            Drag to swap
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '4px 8px',
    background: 'rgba(0,0,0,0.7)',
    border: 'none',
    color: '#fff',
    fontSize: 9,
    cursor: 'pointer',
  };
}

function CameraPanel({ activeSlot, onCapture }: { activeSlot: CaptureSlot; onCapture: (blob: Blob) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    startCamera()
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play();
        }
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function shoot() {
    if (!videoRef.current) return;
    const blob = await snapToBlob(videoRef.current);
    onCapture(blob);
  }

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--ink-2)' }}>
        Camera unavailable: {error}.
      </div>
    );
  }
  return (
    <div style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
      <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '4px 10px',
          background: 'rgba(232,84,42,0.95)',
          color: '#fff',
          fontSize: 10,
        }}
      >
        Shooting · <span className="mono">{activeSlot.toUpperCase()}</span>
      </div>
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={shoot}
          aria-label="Capture"
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: '#fff',
            border: '4px solid rgba(232,84,42,0.8)',
            cursor: 'pointer',
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#E2613A', margin: 'auto' }} />
        </button>
      </div>
    </div>
  );
}

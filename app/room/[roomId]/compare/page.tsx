'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { roomStore, blobToObjectUrl, type RenderVariant } from '@/lib/storage';
import { Icon } from '@/components/ui/Icon';
import { useConfirm } from '@/components/ui/Confirm';
import { SecondaryNav } from '@/components/studio/SecondaryNav';

export default function ComparePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const confirm = useConfirm();
  const [pos, setPos] = useState(52);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [beforeLabel, setBeforeLabel] = useState('Before');
  const [renders, setRenders] = useState<RenderVariant[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [empty, setEmpty] = useState(false);

  // Track every object URL we mint so we can revoke on unmount / delete.
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!roomId) return;
    let canceled = false;
    (async () => {
      // Before image: prefer a real capture; otherwise fall back to the 3D scene
      // snapshot. Without this fallback, a blockout render (no photos) had no
      // "before", so the slider revealed nothing and looked broken.
      const caps = await roomStore.loadCaptures(roomId);
      const south = caps.find((c) => c.slot === 's') ?? caps[0];
      if (south) {
        const u = blobToObjectUrl(south.blob);
        urlsRef.current.push(u);
        if (!canceled) {
          setBeforeUrl(u);
          setBeforeLabel('Before · Capture');
        }
      } else {
        const snap = await roomStore.loadSceneSnap(roomId);
        if (snap) {
          const u = blobToObjectUrl(snap);
          urlsRef.current.push(u);
          if (!canceled) {
            setBeforeUrl(u);
            setBeforeLabel('Before · 3D model');
          }
        }
      }

      const rs = await roomStore.listRenders(roomId);
      if (canceled) return;
      if (rs.length === 0) {
        setEmpty(true);
        return;
      }
      const map: Record<string, string> = {};
      for (const v of rs) {
        const u = blobToObjectUrl(v.blob);
        urlsRef.current.push(u);
        map[v.id] = u;
      }
      setRenders(rs);
      setUrls(map);
    })();
    return () => {
      canceled = true;
      urlsRef.current.forEach(URL.revokeObjectURL);
      urlsRef.current = [];
    };
  }, [roomId]);

  async function deleteVariant(v: RenderVariant, idx: number) {
    const ok = await confirm({
      title: 'Delete this render?',
      body: 'This rendered scene will be permanently removed from this room.',
      confirmLabel: 'Delete render',
      danger: true,
    });
    if (!ok) return;
    await roomStore.deleteRender(roomId, v.id);
    const u = urls[v.id];
    if (u) {
      URL.revokeObjectURL(u);
      urlsRef.current = urlsRef.current.filter((x) => x !== u);
    }
    setRenders((prev) => {
      const next = prev.filter((x) => x.id !== v.id);
      if (next.length === 0) setEmpty(true);
      return next;
    });
    setUrls((prev) => {
      const next = { ...prev };
      delete next[v.id];
      return next;
    });
    setActiveIdx((cur) => (idx < cur ? cur - 1 : Math.min(cur, renders.length - 2)));
  }

  if (empty) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
        <SecondaryNav eyebrow="Result" title="Compare" />
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 40 }}>
          <div style={{ textAlign: 'center', maxWidth: 460 }}>
            <div className="ds-kicker" style={{ color: 'var(--accent)', marginBottom: 10 }}>
              ↘ No previews yet
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 8 }}>
              Generate a preview first.
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 22 }}>
              Compare opens up once you have at least one preview of this room.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Link href={`/room/${roomId}/model`} className="ds-btn" style={{ height: 36, fontSize: 13 }}>
                <Icon name="arrow-left" size={12} /> Back to Studio
              </Link>
              <Link href={`/room/${roomId}/compose`} className="ds-btn ds-btn--primary" style={{ height: 36, fontSize: 13 }}>
                <Icon name="image" size={12} /> Generate a preview
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const active = renders[activeIdx];
  const afterUrl = active ? urls[active.id] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SecondaryNav
        eyebrow="Result"
        title="Compare"
        rightSlot={
          <Link href={`/room/${roomId}/share`} className="ds-btn ds-btn--primary" style={{ height: 28, fontSize: 12 }}>
            <Icon name="share" size={11} /> Share
          </Link>
        }
      />

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          position: 'relative',
        }}
        className="ds-grid-bg"
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            maxWidth: 1200,
            maxHeight: 720,
            border: '1px solid var(--ink)',
            overflow: 'hidden',
            userSelect: 'none',
            background: '#0A0A08',
          }}
        >
          {afterUrl && (
            <img src={afterUrl} alt="after" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {beforeUrl ? (
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <img src={beforeUrl} alt="before" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: `inset(0 ${100 - pos}% 0 0)`,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--paper-2)',
                color: 'var(--ink-3)',
                fontSize: 12,
                textAlign: 'center',
                padding: 20,
              }}
            >
              No “before” image — this room was rendered without a capture or 3D snapshot.
            </div>
          )}

          <div style={{ position: 'absolute', top: 14, left: 14, padding: '5px 10px', background: 'rgba(19,19,17,0.85)', color: '#fff' }}>
            <span className="ds-label" style={{ color: '#fff' }}>{beforeLabel}</span>
          </div>
          <div style={{ position: 'absolute', top: 14, right: 14, padding: '5px 10px', background: 'var(--accent)', color: '#fff' }}>
            <span className="ds-label" style={{ color: '#fff' }}>After · Preview</span>
          </div>

          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${pos}%`,
              width: 2,
              background: 'var(--accent)',
              transform: 'translateX(-1px)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%,-50%)',
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--accent)',
                border: '3px solid var(--paper)',
                boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="chevron-left" size={11} color="#fff" />
              <Icon name="chevron-right" size={11} color="#fff" />
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={pos}
            onChange={(e) => setPos(+e.target.value)}
            aria-label="Before / after slider"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize' }}
          />
        </div>
      </div>

      {/* Variant strip */}
      {renders.length > 0 && (
        <div
          style={{
            padding: '14px 18px',
            borderTop: '1px solid var(--hairline)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            overflowX: 'auto',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 8, flexShrink: 0 }}>
            <span className="ds-label">Variants</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{renders.length}</span>
          </div>
          {renders.map((r, i) => (
            <div
              key={r.id}
              style={{
                position: 'relative',
                width: 120,
                height: 78,
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setActiveIdx(i)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: i === activeIdx ? '2px solid var(--accent)' : '1px solid var(--hairline-strong)',
                  padding: 0,
                  cursor: 'pointer',
                  background: '#000',
                }}
              >
                <img src={urls[r.id]} alt={`V${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '2px 5px',
                    background: 'rgba(19,19,17,0.82)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8.5,
                    letterSpacing: '0.06em',
                  }}
                >
                  V{i + 1}
                  {r.pinned && <span style={{ float: 'right', fontFamily: 'var(--font-sans)' }}>★ Pinned</span>}
                </div>
              </button>
              <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 4 }}>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const next = !r.pinned;
                    await roomStore.pinRender(roomId, r.id, next);
                    setRenders((prev) => prev.map((x) => (x.id === r.id ? { ...x, pinned: next } : x)));
                  }}
                  aria-label={r.pinned ? 'Unpin' : 'Pin'}
                  title={r.pinned ? 'Unpin' : 'Pin · keep this version'}
                  style={{
                    width: 22,
                    height: 22,
                    background: r.pinned ? 'var(--accent)' : 'rgba(19,19,17,0.7)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ★
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteVariant(r, i);
                  }}
                  aria-label="Delete render"
                  title="Delete this render"
                  style={{
                    width: 22,
                    height: 22,
                    background: 'rgba(19,19,17,0.7)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="trash" size={11} color="#fff" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

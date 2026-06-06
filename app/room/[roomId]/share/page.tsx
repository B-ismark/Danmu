'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Dot } from '@/components/ui/primitives';
import { SecondaryNav } from '@/components/studio/SecondaryNav';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { roomStore, blobToObjectUrl, type RenderVariant } from '@/lib/storage';

export default function SharePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState<RenderVariant | undefined>();
  const [pinnedUrl, setPinnedUrl] = useState<string | undefined>();
  const url = typeof window !== 'undefined' ? `${window.location.origin}/room/${roomId}/compare` : '';

  useEffect(() => {
    if (!roomId) return;
    let revoke: string | null = null;
    (async () => {
      const v = await roomStore.firstPinnedRender(roomId);
      if (v) {
        const u = blobToObjectUrl(v.blob);
        revoke = u;
        setPinned(v);
        setPinnedUrl(u);
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [roomId]);

  function downloadPinned() {
    if (!pinnedUrl) return;
    const a = document.createElement('a');
    a.href = pinnedUrl;
    a.download = `danmu-render-${roomId.slice(0, 8)}.png`;
    a.click();
  }

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  // WhatsApp message — richer if a pinned render exists.
  const waText = pinned
    ? `Check out the new design for our room — ${url}`
    : `Danmu design draft — ${url}`;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SecondaryNav eyebrow="Handoff" title="Share" />
      <div style={{ flex: 1, overflow: 'auto', padding: 32 }}>
      <div style={{ maxWidth: 720 }}>
        <div className="ds-label" style={{ marginBottom: 16 }}>
          ↘ Share & handoff
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Send the result.</div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', maxWidth: 520, lineHeight: 1.6, marginBottom: 24 }}>
          Share a read-only link to your decorated room, or export the rendered preview. Local-first: recipients open
          the link, you keep your API key.
        </p>

        <span className="ds-label" style={{ marginBottom: 8, display: 'block' }}>Share link</span>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          <div
            style={{
              flex: 1,
              border: '1px solid var(--hairline-strong)',
              height: 36,
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              background: 'var(--paper-2)',
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {url}
            </span>
          </div>
          <button
            onClick={copy}
            className="ds-btn ds-btn--primary"
            style={{ height: 36, fontSize: 12, background: copied ? 'var(--success)' : 'var(--accent)', borderColor: copied ? 'var(--success)' : 'var(--accent)' }}
          >
            <Icon name={copied ? 'check' : 'share'} size={12} />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <span className="ds-label" style={{ marginBottom: 8, display: 'block' }}>Send directly</span>
        <div style={{ marginBottom: 24 }}>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(waText)}`}
            target="_blank"
            rel="noreferrer"
            className="ds-btn"
            style={{ height: 56, justifyContent: 'flex-start', padding: '0 16px', width: '100%' }}
          >
            <Icon name="whatsapp" size={20} color="#25D366" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>WhatsApp</span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Pre-filled message + link</span>
            </div>
          </a>
        </div>

        <span className="ds-label" style={{ marginBottom: 8, display: 'block' }}>Export image</span>
        <div style={{ marginBottom: 24 }}>
          {pinnedUrl ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '1px solid var(--hairline-strong)', background: 'var(--paper-2)' }}>
              <img
                src={pinnedUrl}
                alt="pinned render"
                style={{ width: 120, height: 90, objectFit: 'cover', border: '1px solid var(--ink)' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Pinned render</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 8 }}>
                  {new Date(pinned!.createdAt).toLocaleString()}
                </div>
                <button onClick={downloadPinned} className="ds-btn" style={{ height: 30, fontSize: 12 }}>
                  <Icon name="download" size={12} /> Download PNG
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: 14, border: '1px dashed var(--hairline-strong)', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
              No pinned render yet. <Link href={`/room/${roomId}/compare`} style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Pin a variant</Link> to enable image export.
            </div>
          )}
        </div>

        <div style={{ padding: 12, border: '1px solid var(--hairline)', background: 'var(--paper-2)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Dot color="var(--accent)" size={6} style={{ marginTop: 4 }} />
          <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            Share links open the project locally on the recipient&apos;s device. Your API key never travels.
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

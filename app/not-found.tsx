// 404 boundary. Rounds out the App Router's required special files alongside
// error.tsx / global-error.tsx.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ maxWidth: 'var(--measure-card)', textAlign: 'center' }}>
        {/* No "404" eyebrow: the heading already says what happened, and an HTTP
            status code is not this product's language. */}
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>We can’t find that room</h1>
        {/* Names the likely cause instead of shrugging: rooms are stored per
            browser, so a link from another device or a deleted room both land
            here and both look identical from the outside. */}
        <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)', marginBottom: 20 }}>
          It may have been deleted, or the link may be from another browser — your rooms are saved on
          the device you built them on, not in the cloud.
        </p>
        <Link
          href="/"
          className="ds-btn ds-btn--primary"
          style={{ display: 'inline-flex', height: 40, padding: '0 18px', alignItems: 'center', fontSize: 13 }}
        >
          Back to your rooms
        </Link>
      </div>
    </div>
  );
}

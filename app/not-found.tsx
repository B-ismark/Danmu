// 404 boundary. Rounds out the App Router's required special files alongside
// error.tsx / global-error.tsx.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ maxWidth: 'var(--measure-card)', textAlign: 'center' }}>
        {/* No "404" eyebrow: the heading already says what happened, and an HTTP
            status code is not this product's language. */}
        <h1 style={{ fontSize: 'var(--fs-title)', margin: '0 0 12px' }}>We can’t find that room</h1>
        {/* Names the likely cause instead of shrugging: rooms are stored per
            browser, so a link from another device or a deleted room both land
            here and both look identical from the outside. */}
        <p className="t-body" style={{ lineHeight: 1.55, marginBottom: 20 }}>
          It may have been deleted, or the link came from another browser. Rooms are saved only in the
          browser they were made in.
        </p>
        <Link
          href="/"
          className="ds-btn ds-btn--lg ds-btn--primary"
          style={{ display: 'inline-flex', padding: '0 18px', alignItems: 'center' }}
        >
          Back to your rooms
        </Link>
      </div>
    </div>
  );
}

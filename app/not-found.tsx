// 404 boundary. Rounds out the App Router's required special files alongside
// error.tsx / global-error.tsx.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 40 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div className="ds-kicker" style={{ marginBottom: 8 }}>404</div>
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Nothing here</h1>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)', marginBottom: 20 }}>
          That room or page doesn’t exist.
        </p>
        <Link href="/" className="ds-btn ds-btn--primary" style={{ display: 'inline-flex', height: 36, padding: '0 18px', alignItems: 'center' }}>
          Back home
        </Link>
      </div>
    </div>
  );
}

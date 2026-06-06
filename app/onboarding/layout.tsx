'use client';

import type { ReactNode } from 'react';

// Desktop renders edge-to-edge with native desktop chrome.
// Mobile renders the page content directly (no frame, real viewport).
// Each onboarding page handles its own responsive layout.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>{children}</div>;
}

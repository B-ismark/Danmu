'use client';

import type { ReactNode } from 'react';

// Desktop renders edge-to-edge with native desktop chrome.
// Mobile renders the page content directly (no frame, real viewport).
// Each onboarding page handles its own responsive layout.
//
// <main> because the root layout emits no landmark of its own: without it the
// onboarding routes had nothing for "skip to content" or landmark navigation to
// land on. dvh, not vh — mobile browser chrome eats vh and adds a phantom
// scroll on these full-height screens.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ minHeight: '100dvh', background: 'var(--paper)' }}>{children}</main>
  );
}

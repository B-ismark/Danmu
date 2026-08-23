'use client';

import { useEffect } from 'react';

// Registers public/sw.js. Renders nothing — it exists so the root layout can stay
// a server component.
//
// Production only, and that is not a detail. In `next dev` the chunks are
// recompiled on every edit at URLs the worker would happily cache, so a
// dev-registered worker serves yesterday's component and the app appears to
// ignore your edits. Worse, a worker registered on localhost:3000 outlives the
// dev server and starts intercepting whatever else you run on that port.
//
// `load` rather than immediately: registration competes with the first paint and
// the chunks the page actually needs, and there is nothing to be gained by
// winning that race.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      // Failure here is not worth surfacing: an unregistered worker means the app
      // behaves exactly as it did before this file existed. It is an enhancement,
      // so it fails as one.
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}

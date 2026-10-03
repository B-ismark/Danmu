'use client';

import { useEffect } from 'react';
import { useSettings } from '@/lib/store';
import { SETTINGS_STORAGE_KEY, applyAppearance, applyThemeColor, suppressTransitions } from '@/lib/appearance';

// Keeps `<html data-theme>` in step with the night-mode setting after the first
// paint. Renders nothing — it exists so the root layout can stay a server
// component, the same bargain as `ServiceWorkerRegistrar`.
//
// The FIRST paint is not this component's job and cannot be: React runs after the
// HTML is drawn. The inline boot script in `app/layout.tsx` has already set the
// attribute by then, so the first run of the effect below is a no-op for the
// colours and only re-points the browser chrome's theme-color.
export function AppearanceSync() {
  const appearance = useSettings((s) => s.appearance);

  useEffect(() => {
    applyAppearance(document.documentElement, appearance);
    applyThemeColor(document, appearance);
  }, [appearance]);

  // Next re-renders the head's `theme-color` tags on every client-side navigation,
  // putting their `media` back to the device's scheme — measured: a pinned Dark on
  // a light device kept a dark status bar on the rooms page and lost it the moment
  // "Start decorating" routed into the studio. So the tags are watched, and
  // re-pointed whenever Next writes them. `applyThemeColor` writes only on a
  // difference, so its own writes settle rather than loop.
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(() => applyThemeColor(document, appearance));
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['media'] });
    return () => observer.disconnect();
  }, [appearance]);

  // System: the stylesheet follows the device by itself, but the switch would
  // animate every colour transition on screen at once. Blank them for that frame.
  useEffect(() => {
    if (appearance !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => suppressTransitions(document.documentElement);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appearance]);

  // A choice made in another tab of this app reaches this one. zustand's persist
  // does not listen for `storage` itself, and two tabs in two themes is the kind of
  // inconsistency that reads as a bug.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_STORAGE_KEY) void useSettings.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return null;
}

'use client';

// Maya-style: W = move, E = rotate, R = scale, Esc = deselect.
// Plus Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo, Cmd/Ctrl+, = settings.
// Mounted once at studio layout. Ignores events while typing in inputs.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStudio } from '@/lib/store';
import { useHistory, applySnapshot, startHistoryRecording } from '@/lib/history';

export function KeyboardShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const unsubHistory = startHistoryRecording();

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const snap = e.shiftKey ? useHistory.getState().redo() : useHistory.getState().undo();
        if (snap) applySnapshot(snap);
        return;
      }
      if (meta && e.key === ',') {
        e.preventDefault();
        router.push('/settings');
        return;
      }

      const s = useStudio.getState();
      switch (e.key.toLowerCase()) {
        case 'w':
          s.setTransformMode('translate');
          break;
        case 's':
          s.setTransformMode('scale');
          break;
        case 'r':
          s.setTransformMode('rotate');
          break;
        case 'f':
          if (s.selectedPartId) s.frameSelected();
          break;
        case 'v':
          if (s.selectedPartId) s.toggleHidden(s.selectedPartId);
          break;
        case 'escape':
          s.setSelected(null);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsubHistory();
    };
  }, []);
  return null;
}

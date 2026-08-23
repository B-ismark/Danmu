'use client';

// Every "take this away with you" action, in one place.
//
// There were three, in three places, at three visual weights: Snapshot as the
// PRIMARY button in the top bar (downloading a PNG is not the primary verb of a
// decoration app), "Export plan" as a plain button at the 2D canvas's top-right,
// and the furniture CSV buried in the Room panel's List tab. Same intent, three
// placements — which is how you end up not knowing the other two exist.
//
// Snapshot is offered only on the 3D tab because it captures that view. The plan
// PNG and the CSV are derived from the scene, not from what is on screen, so they
// are offered on both.

import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { useSnapshot, downloadBlob } from '@/lib/snapshot';
import { exportPlanPng } from '@/lib/plan-export';
import { roomStore } from '@/lib/storage';
import { applyTransforms, fileSlug, furnitureCsvBlob } from '@/lib/exports';
import { Icon, type IconName } from '@/components/ui/Icon';

export function ExportMenu() {
  const pathname = usePathname();
  const { roomId } = useParams<{ roomId: string }>();
  const dimUnit = useSettings((s) => s.dimUnit);
  const [roomName, setRoomName] = useState('Room');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const onModel = pathname?.endsWith('/model') ?? false;

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r?.name) setRoomName(r.name);
    });
  }, [roomId]);

  // Close on outside press or Esc. Esc is stopped so it does not also reach the
  // studio's global "deselect" binding and clear the user's selection.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // stopImmediatePropagation, not stopPropagation: capture listeners on the
      // SAME node (window) still run after a plain stop, so one Esc closed this
      // and the help card together.
      e.stopImmediatePropagation();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    }
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  /** The arranged scene — never the base parts. See lib/exports. */
  function arranged() {
    const { positions, rotations, dims } = useStudio.getState();
    return applyTransforms(useScene.getState().parts, { positions, rotations, dims });
  }

  function planPng() {
    exportPlanPng(arranged(), useScene.getState().room, dimUnit, roomName);
  }

  function listCsv() {
    downloadBlob(furnitureCsvBlob(arranged(), dimUnit), `${fileSlug(roomName)}-furniture.csv`);
  }

  const items: Array<{ icon: IconName; label: string; hint: string; onClick: () => void }> = [
    ...(onModel
      ? [
          {
            icon: 'image' as IconName,
            label: 'This 3D view',
            hint: 'PNG of the room as you are looking at it',
            onClick: () => useSnapshot.getState().request(),
          },
        ]
      : []),
    { icon: 'grid', label: 'Floor plan', hint: 'To-scale PNG, measured in ' + dimUnit, onClick: planPng },
    { icon: 'file', label: 'Furniture list', hint: 'CSV to take shopping', onClick: listCsv },
  ];

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="ds-btn"
        style={{ height: 28, fontSize: 12 }}
      >
        <Icon name="download" size={12} />
        Export
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} />
      </button>

      {/* A group of buttons, not role="menu". A menu promises arrow-key roving
          focus — the bar ui/Select.tsx sets — and these are three plain tabbable
          buttons. Claiming the role without the behaviour is worse for a screen
          reader than not claiming it. */}
      {open && (
        <div
          role="group"
          aria-label="Export"
          className="popover"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 'var(--z-popover)',
            padding: 5,
            minWidth: 232,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => run(it.onClick)}
              className="list-row"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                textAlign: 'left',
                width: '100%',
                border: 0,
                background: 'transparent',
                cursor: 'pointer',
                padding: '7px 8px',
                borderRadius: 'var(--r-1)',
              }}
            >
              <Icon name={it.icon} size={13} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{it.label}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

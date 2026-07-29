'use client';

import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { PART_LIBRARY, placeNewPart, DND_MIME, type LibraryItem } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';

// Floating, non-blocking furniture catalog docked on the left edge of the 3D
// viewport. Items can be DRAGGED onto the room (Room's onDrop raycasts the drop
// point) or CLICKED to drop at room centre. Deliberately a narrow strip so the
// rest of the canvas stays a valid drop target.
export function CatalogPanel() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  function addAtCentre(item: LibraryItem) {
    const { room, parts } = useScene.getState();
    const { pos, wallMounted } = placeNewPart(item.category, item.shape, [...item.dimMM], room, parts);
    const id = `${item.category}-${uuid().slice(0, 6)}`;
    useScene.getState().addPart({
      id, category: item.category, name: item.label, shape: item.shape,
      pos, rot: 0, dimMM: [...item.dimMM], locked: false, wallMounted,
    });
    useStudio.getState().setSelected(id);
  }

  const query = q.trim().toLowerCase();
  const items = query
    ? PART_LIBRARY.filter((i) => i.label.toLowerCase().includes(query) || i.group.toLowerCase().includes(query))
    : PART_LIBRARY;
  const groups = items.reduce<Record<string, LibraryItem[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ds-chip"
        style={{ position: 'absolute', top: 54, left: 12, cursor: 'pointer', height: 30, fontWeight: 700 }}
      >
        <Icon name="plus" size={12} /> Catalog
      </button>
    );
  }

  return (
    <div
      className="ds-card"
      style={{
        position: 'absolute',
        top: 54,
        left: 12,
        // Stops short of the bottom-left corner: the studio's only help
        // affordance lives there, and this panel used to sit on top of it.
        bottom: 56,
        width: 230,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 'var(--z-canvas-ui)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 8px' }}>
        <span className="ds-label" style={{ flex: 1 }}>Furniture catalog</span>
        <IconButton icon="x" label="Close catalog" onClick={() => setOpen(false)} size={24} iconSize={12} />
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <input
          className="field"
          aria-label="Search the furniture catalog"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search furniture…"
        />
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.4 }}>
          {query
            ? `${items.length} match${items.length === 1 ? '' : 'es'}`
            : 'Drag a piece into the room, or click to drop it in the centre.'}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Object.keys(groups).length === 0 && (
          <div style={{ padding: 14, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            Nothing here matches “{q}”.
            <br />
            Try a room word like “chair”, “lamp” or “storage”.
          </div>
        )}
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            {/* Sticky group header: 40 items in a narrow scroller means the
                grouping only earns its keep if you can always see which group
                you are looking at. */}
            <div
              className="ds-label"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                fontSize: 10,
                padding: '4px 4px 6px',
                background: 'var(--paper)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span>{group}</span>
              <span style={{ fontWeight: 600 }}>{list.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {list.map((item) => (
                <button
                  key={item.label}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      DND_MIME,
                      JSON.stringify({ label: item.label, category: item.category, shape: item.shape, dimMM: item.dimMM }),
                    );
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addAtCentre(item)}
                  title={`${item.label} — drag into the room, or click to add it in the centre`}
                  className="list-row"
                  style={{ cursor: 'grab' }}
                >
                  <Icon name="plus" size={11} />
                  <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

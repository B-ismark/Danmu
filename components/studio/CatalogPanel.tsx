'use client';

import { useState } from 'react';
import { v4 as uuid } from 'uuid';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { PART_LIBRARY, placeNewPart, DND_MIME, type LibraryItem } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';

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
        bottom: 12,
        width: 230,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 8px' }}>
        <span className="ds-label" style={{ flex: 1 }}>Furniture catalog</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close catalog"
          className="ds-btn ds-btn--ghost"
          style={{ height: 24, width: 24, padding: 0, justifyContent: 'center' }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div style={{ padding: '0 12px 8px' }}>
        <input
          className="field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search furniture…"
        />
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.4 }}>
          Drag a piece into the room, or click to drop it in the centre.
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Object.keys(groups).length === 0 && (
          <div style={{ padding: 14, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            No furniture matches “{q}”.
          </div>
        )}
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <div className="ds-label" style={{ fontSize: 9, marginBottom: 6, paddingLeft: 4 }}>{group}</div>
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
                  title={`${item.dimMM[0]} × ${item.dimMM[1]} × ${item.dimMM[2]} mm — drag in or click to add`}
                  className="list-row"
                  style={{ cursor: 'grab', textAlign: 'left', border: 0, background: 'transparent', width: '100%' }}
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

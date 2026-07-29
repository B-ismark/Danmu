'use client';

import { useState } from 'react';
import { PART_LIBRARY, type LibraryItem } from '@/lib/scene-spec';
import { PRODUCT_PRESETS } from '@/lib/product-presets';
import { Icon } from '@/components/ui/Icon';

const ALL_ITEMS: LibraryItem[] = [...PART_LIBRARY, ...PRODUCT_PRESETS];

// Searchable, grouped grid over PART_LIBRARY + real-product presets. Shared by
// the Add-model modal (AddPartButton) and the Inspector's swap flow.
export function LibraryPicker({ onPick }: { onPick: (item: LibraryItem) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const items = query
    ? ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(query) || i.group.toLowerCase().includes(query))
    : ALL_ITEMS;
  const groups = items.reduce<Record<string, LibraryItem[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div>
      {/* A placeholder is not a label — it disappears the moment you type. */}
      <input
        className="field"
        aria-label="Search furniture"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search furniture…"
        autoFocus
        style={{ marginBottom: 12 }}
      />
      <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.keys(groups).length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            Nothing matches &quot;{q}&quot;.
            <br />
            Try a room word like &quot;chair&quot;, &quot;lamp&quot; or &quot;storage&quot;.
          </div>
        )}
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            {/* Sticky, counted group headers — with ~50 items in one scroller the
                grouping has to stay visible to be worth having. */}
            <div
              className="ds-label"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 'var(--z-sticky-local)',
                fontSize: 10,
                padding: '2px 0 6px',
                background: 'var(--paper)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{group}</span>
              <span style={{ fontWeight: 600 }}>{list.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {list.map((item) => (
                <button
                  key={item.label}
                  onClick={() => onPick(item)}
                  className="ds-btn"
                  title={`${item.dimMM[0]} × ${item.dimMM[1]} × ${item.dimMM[2]} mm`}
                  style={{ height: 34, fontSize: 12, justifyContent: 'flex-start', paddingLeft: 10 }}
                >
                  <Icon name="plus" size={11} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

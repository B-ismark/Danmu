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
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search furniture…"
        autoFocus
        style={{
          width: '100%',
          height: 32,
          padding: '0 10px',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 2,
          outline: 'none',
          marginBottom: 12,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--hairline-strong)')}
      />
      <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.keys(groups).length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            No furniture matches &quot;{q}&quot;.
          </div>
        )}
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <div className="ds-label" style={{ fontSize: 9, marginBottom: 6 }}>
              {group}
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

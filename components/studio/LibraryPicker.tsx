'use client';

// The model picker, and the two controls that frame it everywhere it appears.
//
// One list, three hosts: the catalog panel (docked over the canvas, one column,
// items draggable onto the floor), the Inspector's swap flow, and anything else
// that needs "choose a model". Before this the catalog panel kept its OWN grouped
// list over `PART_LIBRARY` alone, so the real-product presets existed in the
// modal and silently did not exist on the canvas — the same feature, two lists,
// one of them wrong.

import { useState, type CSSProperties } from 'react';
import { PART_LIBRARY, DND_MIME, type LibraryItem } from '@/lib/scene-spec';
import { Icon } from '@/components/ui/Icon';

const ALL_ITEMS: LibraryItem[] = PART_LIBRARY;

export function LibraryPicker({
  onPick,
  /** one column in a narrow dock, two in a modal */
  columns = 2,
  /** let each row be dragged onto the 3D floor. Off where nothing can catch the
   *  drop — the 2D plan and the swap modal — because a drag that cannot land is a
   *  worse affordance than no drag at all. */
  draggable = false,
  /** A NUMBER caps the scroller (the modal, which sits in a page-sized dialog).
   *  `null` makes it fill its flex parent instead — which is what a docked panel
   *  needs, and why this is not just `maxHeight: '100%'`: a percentage max-height
   *  against an auto-height flex parent resolves to none, so the list would grow
   *  past the panel and be clipped by its `overflow: hidden` rather than scroll. */
  maxHeight = 320,
  autoFocus = true,
}: {
  onPick: (item: LibraryItem) => void;
  columns?: 1 | 2;
  draggable?: boolean;
  maxHeight?: number | null;
  autoFocus?: boolean;
}) {
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: maxHeight === null ? 1 : undefined }}>
      {/* A placeholder is not a label — it disappears the moment you type. */}
      <input
        className="field"
        aria-label="Search the catalog"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the catalog…"
        autoFocus={autoFocus}
        style={{ marginBottom: 10, flexShrink: 0 }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {query ? `${items.length} match${items.length === 1 ? '' : 'es'}` : ''}
      </div>
      <div
        style={{
          maxHeight: maxHeight ?? undefined,
          flex: maxHeight === null ? 1 : undefined,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minHeight: 0,
        }}
      >
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
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 6 }}>
              {list.map((item) => (
                <button
                  key={item.label}
                  draggable={draggable || undefined}
                  onDragStart={
                    draggable
                      ? (e) => {
                          e.dataTransfer.setData(
                            DND_MIME,
                            JSON.stringify({
                              label: item.label,
                              category: item.category,
                              shape: item.shape,
                              dimMM: item.dimMM,
                            }),
                          );
                          e.dataTransfer.effectAllowed = 'copy';
                        }
                      : undefined
                  }
                  onClick={() => onPick(item)}
                  className="ds-btn"
                  title={
                    draggable
                      ? `${item.label} — drag into the room, or click to add it in the centre · ${item.dimMM[0]} × ${item.dimMM[1]} × ${item.dimMM[2]} mm`
                      : `${item.dimMM[0]} × ${item.dimMM[1]} × ${item.dimMM[2]} mm`
                  }
                  style={{
                    height: 34,
                    fontSize: 12,
                    justifyContent: 'flex-start',
                    paddingLeft: 10,
                    cursor: draggable ? 'grab' : 'pointer',
                    minWidth: 0,
                  }}
                >
                  <Icon name="plus" size={11} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

export type PickerTab = 'library' | 'describe';

/** Catalog | Describe it — the two ways into every model picker in the studio.
 *  Shared so the Add flow and the Swap flow can never drift into looking like
 *  two different features. */
export function PickerTabs({
  tab,
  onChange,
  style,
}: {
  tab: PickerTab;
  onChange: (t: PickerTab) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      role="group"
      aria-label="How to find a model"
      style={{ display: 'inline-flex', border: '1px solid var(--edge)', borderRadius: 'var(--r-2)', overflow: 'hidden', ...style }}
    >
      {(['library', 'describe'] as const).map((t, i) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          aria-pressed={tab === t}
          style={{
            height: 30,
            padding: '0 16px',
            border: 'none',
            borderLeft: i > 0 ? '1px solid var(--edge)' : 'none',
            background: tab === t ? 'var(--ink)' : 'transparent',
            color: tab === t ? 'var(--on-ink)' : 'var(--ink-2)',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          {t === 'library' ? 'Catalog' : 'Describe it'}
        </button>
      ))}
    </div>
  );
}

/** The description box shared by the Add and Swap flows. A placeholder is not a
 *  label, so the real one is always attached. */
export function DescribeField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={placeholder}
      autoFocus
      className="field"
      style={{
        minHeight: 56,
        height: 'auto',
        padding: 10,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        lineHeight: 1.4,
        resize: 'vertical',
        marginBottom: 12,
      }}
    />
  );
}

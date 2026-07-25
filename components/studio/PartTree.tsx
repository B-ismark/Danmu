'use client';

import { useState, useEffect, useRef } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { bestMatch } from '@/lib/shape-search';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/Confirm';
import { RoomDimsEditor } from './RoomDimsEditor';
import { AddPartButton } from './AddPartButton';
import { THEMES, themeColorFor } from '@/lib/themes';

export function PartTree() {
  const parts = useScene((s) => s.parts);
  const deletePart = useScene((s) => s.deletePart);
  const updatePart = useScene((s) => s.updatePart);
  const selectedId = useStudio((s) => s.selectedPartId);
  const setSelected = useStudio((s) => s.setSelected);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const [query, setQuery] = useState('');
  const hasAnyOverride = useStudio(
    (s) =>
      Object.keys(s.positions).length > 0 ||
      Object.keys(s.rotations).length > 0 ||
      Object.keys(s.dims).length > 0,
  );
  const confirm = useConfirm();

  const setLighting = useStudio((s) => s.setLighting);
  function applyTheme(theme: (typeof THEMES)[number]) {
    // Recolour every unlocked part; locked items keep their preserved look.
    for (const p of useScene.getState().parts) {
      if (p.locked) continue;
      updatePart(p.id, { color: themeColorFor(p.category, theme) });
    }
    setLighting(theme.lighting);
  }

  const q = query.trim().toLowerCase();
  const visibleParts = q
    ? parts.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    : parts;
  const generics = parts.filter((p) => p.shape === 'box');

  // Upgrade every generic box to its closest catalog model by NAME — local
  // token matching, no AI. Items whose name matches nothing stay boxes (the
  // per-part "Swap model" flow handles those).
  function improveAll() {
    for (const p of generics) {
      const m = bestMatch(`${p.name} ${p.category}`);
      if (m) updatePart(p.id, { shape: m.shape, dimMM: m.dimMM });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      <RoomDimsEditor />
      <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span className="ds-label">Parts</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>
            {parts.length} item{parts.length === 1 ? '' : 's'}
          </span>
        </div>
        <AddPartButton />

        <div style={{ marginTop: 12 }}>
          <span className="ds-label" style={{ display: 'block', marginBottom: 8 }}>One-tap restyle</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => applyTheme(t)}
                title={`Restyle the room — ${t.label}`}
                className="ds-chip"
                style={{ cursor: 'pointer', height: 30, paddingLeft: 6, fontWeight: 600 }}
              >
                <span style={{ display: 'inline-flex', borderRadius: 'var(--r-full)', overflow: 'hidden', width: 22, height: 12 }}>
                  {t.swatch.map((c) => (
                    <span key={c} style={{ flex: 1, background: c }} />
                  ))}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {generics.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--accent)', background: 'var(--accent-tint)', borderRadius: 'var(--r-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 4, fontWeight: 700 }}>
              {generics.length} generic item{generics.length === 1 ? '' : 's'}
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-2)', margin: '0 0 8px', lineHeight: 1.4 }}>
              Some items use a generic box. Match them to proper 3D models by name.
            </p>
            <button
              onClick={improveAll}
              className="ds-btn"
              style={{ width: '100%', height: 28, fontSize: 11, justifyContent: 'center' }}
            >
              <Icon name="refresh" size={11} />
              Match to 3D models
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '8px 10px 4px', borderBottom: '1px solid var(--hairline-soft)' }}>
        <input
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts…"
        />
        {q && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, fontWeight: 600 }}>
            {visibleParts.length} of {parts.length} match
          </div>
        )}
      </div>

      <div className="list">
        {visibleParts.length === 0 && q && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--ink-3)', fontSize: 11 }}>
            No parts match &quot;{q}&quot;.
          </div>
        )}
        {visibleParts.map((part) => {
          const isSel = selectedId === part.id;
          return (
            <PartRow
              key={part.id}
              partId={part.id}
              name={part.name}
              category={part.category}
              locked={part.locked}
              selected={isSel}
              onSelect={() => setSelected(part.id)}
              onToggleHidden={() => useStudio.getState().toggleHidden(part.id)}
              onDelete={async () => {
                const ok = await confirm({
                  title: `Delete "${part.name}"?`,
                  body: 'Removes it from the scene.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) return;
                deletePart(part.id);
                if (selectedId === part.id) setSelected(null);
              }}
            />
          );
        })}
      </div>

      {/* Cost totals moved off this screen — they belong on Spec / Realize,
          not the modelling view. Footer now only surfaces the bulk-reset action
          when there are edits to revert. */}
      {hasAnyOverride && (
        <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px', background: 'var(--paper-2)' }}>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Reset all parts?',
                body: 'Move / rotate / scale on every part will revert to detected positions.',
                confirmLabel: 'Reset all',
                danger: true,
              });
              if (ok) resetTransforms();
            }}
            className="ds-btn"
            style={{ width: '100%', height: 30, fontSize: 11, gap: 6, justifyContent: 'center' }}
          >
            <Icon name="refresh" size={11} /> Reset all to detected
          </button>
        </div>
      )}
    </div>
  );
}

function PartRow({
  partId,
  name,
  category,
  locked,
  selected,
  onSelect,
  onToggleHidden,
  onDelete,
}: {
  partId: string;
  name: string;
  category: string;
  locked: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isHidden = useStudio((s) => !!s.hidden[partId]);

  // Scroll into view when selection happens elsewhere (3D click).
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selected]);

  return (
    <div
      ref={ref}
      data-part-id={partId}
      className={`list-row${selected ? ' is-selected' : ''}`}
      title={`${name} · ${category}${isHidden ? ' · hidden' : ''}${locked ? ' · locked' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
    >
      <span
        style={{
          width: selected ? 9 : 7,
          height: selected ? 9 : 7,
          borderRadius: '50%',
          background: locked ? 'var(--locked)' : 'var(--accent)',
          opacity: selected ? 1 : 0.55,
          flexShrink: 0,
          transition: 'all .12s',
        }}
      />
      <span
        style={{
          fontSize: 12,
          fontWeight: selected ? 500 : 400,
          color: isHidden ? 'var(--ink-3)' : 'var(--ink)',
          textDecoration: isHidden ? 'line-through' : 'none',
          flex: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </span>
      <IconButton
        icon={isHidden ? 'eye-off' : 'eye'}
        label={isHidden ? 'Show' : 'Hide'}
        title={isHidden ? 'Show (V)' : 'Hide (V)'}
        active={isHidden}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
        size={22}
        iconSize={12}
        style={{ opacity: isHidden || hover ? 1 : 0, transition: 'opacity 0.15s' }}
      />
      {/* Delete on hover. The category tag was removed — it just echoed the name
          (e.g. "modular wardrobe" / "wardrobe"). The leading dot + name suffice. */}
      {hover && (
        <IconButton
          icon="trash"
          label="Delete part"
          title="Delete"
          tone="danger"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          size={22}
          iconSize={12}
          style={{ borderRadius: 'var(--r-1)' }}
        />
      )}
    </div>
  );
}

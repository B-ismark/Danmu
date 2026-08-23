'use client';

import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { bestMatch, type LocalMatch } from '@/lib/shape-search';
import { Icon } from '@/components/ui/Icon';
import { Dot, IconButton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/Confirm';
import { toast } from '@/components/ui/StorageToast';
import Link from 'next/link';
import { RoomDimsEditor } from './RoomDimsEditor';
import { RailSection } from './RailSection';
import { RoomTools } from './RoomTools';
import { ViewOptions } from './ViewOptions';
import { AddPiecesButton } from './CatalogPanel';
import { removeParts } from './KeyboardShortcuts';
import { THEMES, themeColorFor, type Theme } from '@/lib/themes';

// This rail is the accessible twin of the 3D canvas. A WebGL canvas exposes
// nothing to assistive tech — no children, no roles, no focus — so a piece that
// can't be reached from here can't be reached without a mouse at all. Hence the
// real listbox with arrow-key navigation and a roving tabindex, and row actions
// that stay in the DOM instead of being conjured on hover.
//
// Rows are `div[role="option"][tabindex]` rather than `<button role="option">`:
// each row owns two nested action buttons, and a button inside a button is
// invalid HTML. The div is focusable, keyboard-operable and picks up the same
// `.list-row:focus-visible` ring, which is what the row-as-a-control CSS is for.
//
// Speech is deliberately NOT duplicated here: moving through a listbox already
// announces each option, its selected state and its position, canvas-driven
// selection is spoken by StudioAnnouncer, and every bulk action below answers
// with a toast (whose host is a live region). A second polite region in this
// panel would make a screen reader say each selection twice.

export function PartTree() {
  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const selectedId = useStudio((s) => s.selectedPartId);
  const setSelected = useStudio((s) => s.setSelected);
  const frameSelected = useStudio((s) => s.frameSelected);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const [query, setQuery] = useState('');
  // Local, not persisted: which drawer you left open is not a preference worth
  // remembering across rooms, and `partialize` should stay about how the room
  // LOOKS. Room and Pieces open by default — the dimensions and the piece list
  // are what the rail is for; Style and View are occasional.
  const [sec, setSec] = useState({ room: true, style: false, view: false, pieces: true });
  const toggle = (k: keyof typeof sec) => setSec((v) => ({ ...v, [k]: !v[k] }));
  const hasAnyOverride = useStudio(
    (s) =>
      Object.keys(s.positions).length > 0 ||
      Object.keys(s.rotations).length > 0 ||
      Object.keys(s.dims).length > 0,
  );
  const confirm = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const visibleParts = q
    ? parts.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    : parts;
  const generics = parts.filter((p) => p.shape === 'box');

  // Which chip reads as "on" is DERIVED from the scene, never remembered. A
  // theme is one undoable gesture (colours *and* lighting are both in the
  // history snapshot), so a local "last applied" flag kept insisting a theme was
  // active after Ctrl+Z had already reverted it — the panel lying about the room.
  const activeTheme = useMemo(() => {
    const restyled = parts.filter((p) => !p.locked);
    if (restyled.length === 0) return null;
    return (
      THEMES.find(
        (t) =>
          t.lighting === lighting && restyled.every((p) => p.color === themeColorFor(p.category, t)),
      )?.id ?? null
    );
  }, [parts, lighting]);

  function applyTheme(theme: Theme) {
    // One store write for one gesture. The old per-part `updatePart` loop fired
    // N notifications (N re-renders, N subscription hits) that all collapsed
    // into the same single debounced snapshot anyway.
    useScene.setState((s) => ({
      parts: s.parts.map((p) => (p.locked ? p : { ...p, color: themeColorFor(p.category, theme) })),
    }));
    setLighting(theme.lighting);
    toast({
      title: `${theme.label} applied`,
      message: 'Recoloured everything except the pieces kept as-is, and set the light to match.',
      ttl: 5000,
    });
  }

  // Upgrade every generic box to its closest catalog model by NAME — local
  // token matching, no AI. Items whose name matches nothing stay boxes; the
  // per-piece model picker in the Inspector handles those.
  function improveAll() {
    const matched = new Map<string, LocalMatch>();
    for (const p of generics) {
      const m = bestMatch(`${p.name} ${p.category}`);
      if (m) matched.set(p.id, m);
    }
    if (matched.size === 0) {
      toast({
        title: 'No matches by name',
        message: 'None of these names look like a piece in the catalog. Select one and pick its model in the panel on the right.',
      });
      return;
    }
    // Single write, same reasoning as applyTheme.
    useScene.setState((s) => ({
      parts: s.parts.map((p) => {
        const m = matched.get(p.id);
        return m ? { ...p, shape: m.shape, dimMM: m.dimMM } : p;
      }),
    }));
    toast({
      tone: 'success',
      title: `${matched.size} piece${matched.size === 1 ? '' : 's'} matched to a real model`,
      message: matched.size < generics.length ? 'The rest stayed generic — rename them, or pick a model by hand.' : undefined,
    });
  }

  /** Move DOM focus to a row. The target row is already in the DOM, so focus can
   *  move before React re-renders the roving tabindex. */
  function focusRow(id: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-part-id="${id}"]`)?.focus();
  }

  function navigate(from: number, to: 'prev' | 'next' | 'first' | 'last') {
    const last = visibleParts.length - 1;
    if (last < 0) return;
    const i =
      to === 'first' ? 0
      : to === 'last' ? last
      : Math.min(last, Math.max(0, from + (to === 'next' ? 1 : -1)));
    const part = visibleParts[i];
    if (!part) return;
    // Selection follows focus, so arrowing down the list also walks the
    // highlight through the 3D scene — the point of the whole rail.
    setSelected(part.id);
    focusRow(part.id);
  }

  // No confirm: `removeParts` is the single delete path and it offers Undo in a
  // toast instead of asking first (see KeyboardShortcuts).
  function removePart(index: number, id: string) {
    const neighbour = visibleParts[index + 1] ?? visibleParts[index - 1] ?? null;
    removeParts([id], selectedId === id ? { selectAfter: neighbour?.id ?? null } : undefined);
    // Keep the keyboard's place: the row that had focus just left the DOM. Wait
    // a frame so this lands after React drops it.
    if (neighbour) requestAnimationFrame(() => focusRow(neighbour.id));
  }

  // The tab stop sits on the selected row (first row when nothing is selected):
  // one stop for the whole list, arrows to move inside it.
  const selIndex = visibleParts.findIndex((p) => p.id === selectedId);
  const tabStop = selIndex >= 0 ? selIndex : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
      {/* The room's state, always on screen — see RoomTools. Above the sections
          because it is about the whole room, not one of its parts. */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <RoomTools />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <RailSection
          title="Room"
          meta={<span className="mono">{(room.width / 1000).toFixed(1)}×{(room.depth / 1000).toFixed(1)}m</span>}
          open={sec.room}
          onToggle={() => toggle('room')}
        >
          <RoomDimsEditor />
          {/* Rescan changes what is IN the room, which is this section's subject.
              It was in the top bar, next to controls about how the app is framed. */}
          <Link
            href="/onboarding/detect"
            className="ds-btn"
            style={{ width: '100%', height: 30, fontSize: 11.5, justifyContent: 'center', marginTop: 10 }}
          >
            <Icon name="refresh" size={12} />
            Re-scan the room
          </Link>
        </RailSection>

        <RailSection
          title="Style"
          meta={activeTheme ? THEMES.find((t) => t.id === activeTheme)?.label : undefined}
          open={sec.style}
          onToggle={() => toggle('style')}
        >
        <div role="group" aria-labelledby="restyle-label">
          <span id="restyle-label" className="ds-label" style={{ display: 'block', marginBottom: 8 }}>One-tap restyle</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {THEMES.map((t) => {
              const on = activeTheme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => applyTheme(t)}
                  title={`Restyle the room — ${t.label}`}
                  aria-pressed={on}
                  className={`ds-chip${on ? ' ds-chip--accent' : ''}`}
                  style={{ cursor: 'pointer', height: 30, paddingLeft: 6, fontWeight: 600 }}
                >
                  <span style={{ display: 'inline-flex', borderRadius: 'var(--r-full)', overflow: 'hidden', width: 22, height: 12 }}>
                    {t.swatch.map((c) => (
                      <span key={c} style={{ flex: 1, background: c }} />
                    ))}
                  </span>
                  {t.label}
                  {/* The active chip can't be tint-and-colour only: a check mark
                      carries the state without relying on hue. */}
                  {on && <Icon name="check" size={11} />}
                </button>
              );
            })}
          </div>
        </div>

        {generics.length > 0 && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--accent-text)', background: 'var(--accent-tint)', borderRadius: 'var(--r-2)' }}>
            {/* --accent-text, not --accent: accent as 11px type on its own tint
                measures 2.89:1. */}
            <div style={{ fontSize: 11, color: 'var(--accent-text)', marginBottom: 4, fontWeight: 700 }}>
              {generics.length} generic shape{generics.length === 1 ? '' : 's'}
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-2)', margin: '0 0 8px', lineHeight: 1.4 }}>
              {generics.length === 1
                ? 'One piece is still a plain box. Match it to a real model by name.'
                : 'Some pieces are still plain boxes. Match them to real models by name.'}
            </p>
            <button
              onClick={improveAll}
              className="ds-btn"
              style={{ width: '100%', height: 28, fontSize: 11, justifyContent: 'center' }}
            >
              <Icon name="refresh" size={11} />
              Match to real models
            </button>
          </div>
        )}
        </RailSection>

        <RailSection title="View" open={sec.view} onToggle={() => toggle('view')}>
          <ViewOptions />
        </RailSection>

        <RailSection
          title="Pieces"
          meta={<span className="mono">{parts.length}</span>}
          open={sec.pieces}
          onToggle={() => toggle('pieces')}
          grow
        >
        <div style={{ paddingBottom: 6 }}>
        {/* A placeholder is not a label — it disappears the moment you type. */}
        <input
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the furniture in this room"
          placeholder="Search the catalog…"
        />
        {/* Always mounted so the count is actually spoken: a live region that
            appears together with its text is announced unreliably. Typing in the
            field is otherwise silent feedback for a screen-reader user. */}
        <div
          role="status"
          aria-live="polite"
          style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: q ? 4 : 0, fontWeight: 600 }}
        >
          {q ? `${visibleParts.length} of ${parts.length} match` : ''}
        </div>
      </div>

        <div ref={listRef} className="list" role="listbox" aria-label="Furniture in this room" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {visibleParts.length === 0 && (
          // role="presentation": a listbox may only own options, and this is copy.
          <div role="presentation" style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            {q ? (
              <>Nothing here matches “{q}”. Try another word — a sofa, a lamp, a rug.</>
            ) : (
              <>The room is bare. Add a piece above and start arranging it.</>
            )}
          </div>
        )}
        {visibleParts.map((part, i) => (
          <PartRow
            key={part.id}
            partId={part.id}
            name={part.name}
            category={part.category}
            locked={part.locked}
            selected={selectedId === part.id}
            tabbable={i === tabStop}
            onSelect={() => setSelected(part.id)}
            onFrame={() => {
              setSelected(part.id);
              frameSelected();
            }}
            onNavigate={(to) => navigate(i, to)}
            onToggleHidden={() => useStudio.getState().toggleHidden(part.id)}
            onDelete={() => removePart(i, part.id)}
          />
        ))}
        </div>
        </RailSection>
      </div>

      {/* Pinned footer, the way Drafted pins Cancel / Create: the rail's own
          action never scrolls away, and "Add" was previously buried mid-column
          inside the Furniture section. The bulk revert joins it, and still only
          appears when there is something to revert. */}
      <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px', background: 'var(--paper-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <AddPiecesButton />
        {hasAnyOverride && (
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Put every piece back?',
                body: 'Every move, turn and resize returns to where the room started. Colours, styles and pieces you added stay.',
                confirmLabel: 'Put them back',
                danger: true,
              });
              if (!ok) return;
              resetTransforms();
              toast({ title: 'Everything is back where it started', ttl: 4000 });
            }}
            className="ds-btn"
            style={{ width: '100%', height: 30, fontSize: 11, gap: 6, justifyContent: 'center' }}
          >
            <Icon name="refresh" size={11} /> Put everything back
          </button>
        )}
      </div>
    </div>
  );
}

function PartRow({
  partId,
  name,
  category,
  locked,
  selected,
  tabbable,
  onSelect,
  onFrame,
  onNavigate,
  onToggleHidden,
  onDelete,
}: {
  partId: string;
  name: string;
  category: string;
  locked: boolean;
  selected: boolean;
  /** roving tabindex: exactly one row in the list is a tab stop */
  tabbable: boolean;
  onSelect: () => void;
  onFrame: () => void;
  onNavigate: (to: 'prev' | 'next' | 'first' | 'last') => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isHidden = useStudio((s) => !!s.hidden[partId]);

  // Scroll into view when selection happens elsewhere (3D click, arrow keys).
  useEffect(() => {
    if (!selected || !ref.current) return;
    // The CSS reduced-motion block can't reach a JS-requested smooth scroll.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [selected]);

  // Keys the row owns. They are stopped, not just handled: ArrowUp/Down would
  // otherwise ALSO pan the 3D camera. Everything else keeps bubbling (Esc
  // deselects from anywhere); the studio's single-character keys are scoped to
  // the canvas surface, so Delete has to be answered here or a keyboard user in
  // the list has no delete key at all.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const mine = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    // Activation keys are only the row's when the row itself is focused —
    // otherwise Enter on the nested Hide button would frame the camera and
    // preventDefault would eat the toggle. Arrows always belong to the list, so
    // they also carry focus back out of an action button onto a row.
    const onRow = e.target === e.currentTarget;
    switch (e.key) {
      case 'ArrowDown': mine(); onNavigate('next'); break;
      case 'ArrowUp': mine(); onNavigate('prev'); break;
      case 'Home': mine(); onNavigate('first'); break;
      case 'End': mine(); onNavigate('last'); break;
      // Enter/Space selects and brings the camera to it — the keyboard's only
      // way to actually *look* at a piece.
      case 'Enter':
      case ' ': if (onRow) { mine(); onFrame(); } break;
      case 'Delete':
      case 'Backspace': if (onRow) { mine(); onDelete(); } break;
    }
  }

  return (
    <div
      ref={ref}
      data-part-id={partId}
      role="option"
      aria-selected={selected}
      // Explicit name: without it the row's name is computed from its contents,
      // which would swallow the nested buttons' labels ("Sofa Hide Remove").
      aria-label={`${name}${locked ? ', kept as-is' : ''}${isHidden ? ', hidden' : ''}`}
      tabIndex={tabbable ? 0 : -1}
      className={`list-row${selected ? ' is-selected' : ''}`}
      title={`${name} · ${category}${isHidden ? ' · hidden' : ''}${locked ? ' · kept as-is' : ''}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {/* Status glyph. Shape, not just hue: a lock reads as "kept as-is" even
          where the aubergine and the clay look the same. */}
      <span aria-hidden="true" style={{ display: 'inline-flex', justifyContent: 'center', width: 12, flexShrink: 0 }}>
        {locked ? <Icon name="lock" size={11} color="var(--locked)" /> : <Dot size={7} />}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
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
      {/* Both actions are permanent DOM — .row-action only fades them, and the
          class reveals them on row hover, row focus and their own focus. The
          previous `{hover && <IconButton/>}` delete existed for the mouse only.
          `is-on` pins the eye open while a piece is hidden, so the state is
          visible without hovering. */}
      <IconButton
        icon={isHidden ? 'eye-off' : 'eye'}
        label={isHidden ? `Show ${name}` : `Hide ${name}`}
        title={isHidden ? 'Show in the room' : 'Hide from the room'}
        active={isHidden}
        className={`row-action${isHidden ? ' is-on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
        size={24}
        iconSize={12}
      />
      <IconButton
        icon="trash"
        label={`Remove ${name}`}
        title="Remove (Del)"
        tone="danger"
        className="row-action"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        size={24}
        iconSize={12}
      />
    </div>
  );
}

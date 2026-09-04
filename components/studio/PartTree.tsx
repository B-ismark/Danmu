'use client';

import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { bestMatch, type LocalMatch } from '@/lib/shape-search';
import { Icon } from '@/components/ui/Icon';
import { Dot, IconButton } from '@/components/ui/primitives';
import { toast } from '@/components/ui/StorageToast';
import { Tooltip } from '@/components/ui/Tooltip';
import Link from 'next/link';
import { RoomDimsEditor } from './RoomDimsEditor';
import { RailSection } from './RailSection';
import { RoomTools } from './RoomTools';
import { NorthDial } from './NorthDial';
import { LightingPicker } from './LightingPicker';
import { ViewOptions } from './ViewOptions';
import { duplicateSelection, removeParts } from './KeyboardShortcuts';
import { THEMES, themeColorFor, type Theme } from '@/lib/themes';
import { LIGHTING } from '@/lib/lighting-moods';
import { isAperture } from '@/lib/apertures';
import { groupRows, type TreeRow } from '@/lib/part-rows';
import type { ScenePart } from '@/lib/scene-spec';

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
  const ungroupParts = useScene((s) => s.ungroupParts);
  const selectedId = useStudio((s) => s.selectedPartId);
  const selection = useStudio((s) => s.selection);
  const setSelected = useStudio((s) => s.setSelected);
  const setSelection = useStudio((s) => s.setSelection);
  const toggleInSelection = useStudio((s) => s.toggleInSelection);
  const frameSelected = useStudio((s) => s.frameSelected);
  const lighting = useStudio((s) => s.lighting);
  const setLighting = useStudio((s) => s.setLighting);
  const [query, setQuery] = useState('');
  // Local, not persisted: which drawer you left open is not a preference worth
  // remembering across rooms, and `partialize` should stay about how the room
  // LOOKS. Room and Catalog open by default — the dimensions and the piece list
  // are what the rail is for; Style and View are occasional.
  const [sec, setSec] = useState({ room: true, style: false, view: false, pieces: true });
  const toggle = (k: keyof typeof sec) => setSec((v) => ({ ...v, [k]: !v[k] }));
  const listRef = useRef<HTMLDivElement>(null);
  // Where a Shift-range starts. Every plain click moves it; a range never does, so
  // Shift-clicking twice re-measures from the same place instead of crawling down
  // the list a row at a time.
  const anchorRef = useRef<string | null>(null);

  const q = query.trim().toLowerCase();
  const visibleParts = q
    ? parts.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    : parts;
  const generics = parts.filter((p) => p.shape === 'box');

  // Merged sets, drawn as such. A group is only a shared `groupId` on each
  // member — there is no node in the scene and no ordering — so until now the
  // rail showed three merged chairs exactly as it showed three loose ones, and
  // the only tell that they moved together was watching them do it. `groupRows`
  // derives the nesting at read time; see `lib/part-rows.ts` for the three rules
  // it keeps.
  //
  // Collapse is local and unpersisted, for the same reason the open sections are
  // (above): which drawer you left shut is not a property of the room. Keyed by
  // `groupId`, so a group that loses its last member simply stops being asked
  // about.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => {
    const all = groupRows(visibleParts, parts);
    if (collapsed.size === 0) return all;
    return all.filter((r) => !(r.kind === 'part' && r.gid && collapsed.has(r.gid)));
  }, [visibleParts, parts, collapsed]);
  const toggleGroup = (gid: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(gid)) next.add(gid);
      return next;
    });

  // Which chip reads as "on" is DERIVED from the scene, never remembered. A
  // theme is one undoable gesture (colours *and* lighting are both in the
  // history snapshot), so a local "last applied" flag kept insisting a theme was
  // active after Ctrl+Z had already reverted it — the panel lying about the room.
  //
  // It tests the COLOURS and not the lighting, and that distinction is the second
  // half of the same lie. A theme sets a mood on the way past — one tap, whole look
  // — but the mood is a starting point the Lighting row below is there to change,
  // and while `t.lighting === lighting` was part of this test, changing it
  // UNCHECKED the theme: the room was still every colour Coastal had painted it,
  // the section header stopped naming Coastal, and the swatch stopped showing its
  // tick. So the two controls in this section each quietly cancelled the other's
  // report — press a swatch and the light moves under you, move the light and the
  // swatch forgets. The first of those is the feature (and it is legible now that
  // both controls are in one section, which is why they were brought together);
  // the second was never anything but wrong.
  const activeTheme = useMemo(() => {
    const restyled = parts.filter((p) => !p.locked);
    if (restyled.length === 0) return null;
    return (
      THEMES.find((t) => restyled.every((p) => p.color === themeColorFor(p.category, t)))?.id ?? null
    );
  }, [parts]);

  // Whether a sun mood has anything to shine through. Since the walls became
  // shadow casters the sun reaches the inside of the room ONLY through a window or
  // a door (`components/three/RoomShell.tsx`), which is the physically right answer
  // and also means a sealed room is lit by sky and lamps alone. That is worth
  // saying rather than leaving someone to wonder why moving the sun does nothing —
  // rule 2's "say so, never silently" — and the predicate comes from
  // `lib/apertures.ts` so the sentence cannot disagree with the geometry that cuts
  // the holes.
  const sunHasNoWayIn = !!LIGHTING[lighting].sun && !parts.some(isAperture);

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
      message: 'Recoloured everything except the pieces from your photo, and set the light to match.',
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
        message: 'None of these names look like a piece in the Library. Select one and pick its model in the panel on the right.',
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
   *  move before React re-renders the roving tabindex.
   *
   *  Keyed by the ROW key, not a part id: a group header is a row you can land
   *  on and it has no part of its own. `lib/part-rows.ts` prefixes those keys so
   *  the two namespaces cannot collide. */
  function focusRow(key: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-row-key="${key}"]`)?.focus();
  }

  /** Every member of a group that is in the ROOM, not only the ones on screen.
   *
   *  This is the distinction that made three separate bugs, so it is one function
   *  now and every group-wide action goes through it. `row.ids` is the VISIBLE
   *  members — right for drawing a header and for a range, wrong for anything that
   *  acts on "the group", because a search hiding two of three chairs must not turn
   *  a group action into a one-piece action. */
  const groupMemberIds = (gid: string) => parts.filter((p) => p.groupId === gid).map((p) => p.id);

  /** Select what a row stands for: one piece, or a whole group.
   *
   *  A group row takes every member in the room. It used to take `row.ids`, and
   *  fall through `ids.length === 1` to `setSelected` when a filter left one member
   *  visible — so pressing a header that read `Group · 1 of 3` selected a single
   *  chair, and then rendered itself UNSELECTED, because `groupSelected` is
   *  measured against the room. The header disagreed with the row under it. */
  function selectRow(row: TreeRow<ScenePart>) {
    const ids = row.kind === 'group' ? groupMemberIds(row.gid) : row.ids;
    if (ids.length === 1) setSelected(ids[0]);
    else setSelection(ids, ids[0] ?? null);
    anchorRef.current = row.key;
  }

  function navigate(from: number, to: 'prev' | 'next' | 'first' | 'last', extend = false) {
    const last = rows.length - 1;
    if (last < 0) return;
    const i =
      to === 'first' ? 0
      : to === 'last' ? last
      : Math.min(last, Math.max(0, from + (to === 'next' ? 1 : -1)));
    const row = rows[i];
    if (!row) return;
    // Shift+Arrow grows the range rather than moving a single selection — the
    // keyboard half of Shift-click, which the ARIA listbox pattern expects. This
    // rail exists BECAUSE the canvas is opaque to assistive tech, so a
    // mouse-only multi-select here would defeat the point of it.
    if (extend) selectRange(row.key);
    // Selection follows focus, so arrowing down the list also walks the
    // highlight through the 3D scene — the point of the whole rail.
    else selectRow(row);
    focusRow(row.key);
  }

  /** Everything between the anchor and `key`, inclusive. Measured over the rows the
   *  user can SEE: this list is searchable and its groups fold, and a range
   *  computed over every part in the room would quietly take in pieces neither
   *  the filter nor the fold is showing.
   *
   *  Unioning each row's `ids` is what makes a folded group behave like the one
   *  row it looks like — its members are not rows, so nothing else would pick
   *  them up — while an unfolded one contributes nothing extra, because its
   *  member rows are already in the slice. The Set is what makes those two cases
   *  one line instead of a branch. */
  function selectRange(key: string) {
    const from = rows.findIndex((r) => r.key === anchorRef.current);
    const to = rows.findIndex((r) => r.key === key);
    if (to < 0) return;
    // No anchor, or one the filter has hidden: there is no range to take, so this
    // press behaves as a plain click and becomes the new anchor.
    if (from < 0) {
      selectRow(rows[to]);
      return;
    }
    // A group is atomic in a range: touch it at either end and the whole group
    // comes. Unioning the span's own `ids` was asymmetric, and visibly so — with
    // rows `sofa, [Group×3, c1, c2, c3, lamp`, sweeping sofa→c1 took four pieces
    // (the header dragged in c2 and c3 past the end of the range) while sweeping
    // lamp→c3 took two. Same gesture, same two rows swept, different arity, and
    // neither matched the documented rule.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const gids = new Set<string>();
    for (let i = lo; i <= hi; i++) {
      if (rows[i].gid) gids.add(rows[i].gid!);
    }
    // Built by walking every row in order rather than by collecting into a Set, so
    // the selection arrives in the order the list is drawn — which is what the
    // Inspector's "first selected" and a follow-up Shift-range both read.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!(i >= lo && i <= hi) && !(r.gid && gids.has(r.gid))) continue;
      for (const id of r.ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    setSelection(ids, rows[to].ids[0] ?? null);
  }

  /**
   * What a press on a row means. Three gestures, and only two of them are about
   * selection at all:
   *
   *   - plain: select this piece, and anchor a future range here
   *   - Shift: extend the range from the anchor. The LIST convention; on the
   *     canvas Shift toggles one piece instead, which is the same split Figma
   *     draws between its layer panel and its artboard.
   *   - Ctrl / Cmd: add another of this piece to the room.
   *
   * That last one is a deliberate trade: Ctrl-click means "toggle this row" in
   * every file manager, so per-row toggling moves to Ctrl+Space — which the
   * listbox pattern requires regardless.
   */
  function pickRow(e: React.MouseEvent, row: TreeRow<ScenePart>) {
    if (e.metaKey || e.ctrlKey) {
      // Same room-not-filter rule: Ctrl-clicking a group header adds a copy of the
      // whole set, not of whichever members a search happens to be showing.
      duplicateSelection(row.kind === 'group' ? groupMemberIds(row.gid) : row.ids);
      return;
    }
    if (e.shiftKey) {
      selectRange(row.key);
      return;
    }
    selectRow(row);
  }

  // No confirm: `removeParts` is the single delete path and it offers Undo in a
  // toast instead of asking first (see KeyboardShortcuts).
  function removeRow(index: number, ids: string[]) {
    // The neighbour has to be a row that SURVIVES. Taking `rows[index + 1]`
    // outright was fine while every row was one piece; a group header's next row
    // is its own first member, so deleting a merged set would have parked focus
    // on a row that left the DOM with it.
    const gone = new Set(ids);
    const alive = (r: TreeRow<ScenePart>) => r.ids.some((id) => !gone.has(id));
    const neighbour =
      rows.slice(index + 1).find(alive) ??
      rows.slice(0, index).reverse().find(alive) ??
      null;
    removeParts(
      ids,
      selectedId && gone.has(selectedId)
        ? { selectAfter: neighbour?.ids.find((id) => !gone.has(id)) ?? null }
        : undefined,
    );
    // Keep the keyboard's place: the row that had focus just left the DOM. Wait
    // a frame so this lands after React drops it.
    if (neighbour) requestAnimationFrame(() => focusRow(neighbour.key));
  }

  // The tab stop sits on the selected row (first row when nothing is selected):
  // one stop for the whole list, arrows to move inside it.
  //
  // A group whose members are ALL selected claims the stop ahead of any one of
  // them, because that is the row whose `aria-selected` is true — clicking a
  // merged piece in the 3D scene selects the whole set (see `Pickable`), and the
  // tab stop should land where the highlight is, not one row inside it.
  //
  // "All selected" is measured against the ROOM, not against the rows on screen.
  // `Pickable` selects every member; a search showing one of three would make an
  // exact match against the visible ids fail, and the header would read
  // unselected directly above a member that reads selected.
  const groupSelected = (gid: string) =>
    selection.length > 0 && parts.every((p) => p.groupId !== gid || selection.includes(p.id));
  const tabStop = useMemo(() => {
    const primaryGroup = parts.find((p) => p.id === selectedId)?.groupId;
    // Inlined rather than reusing `groupSelected` above: that closure is rebuilt
    // every render, so depending on it would make this memo never hit — and
    // silencing the lint rule instead of fixing the dependency is how a memo
    // quietly stops being one.
    const whole =
      !!primaryGroup &&
      selection.length > 0 &&
      parts.every((p) => p.groupId !== primaryGroup || selection.includes(p.id));
    const g = whole ? rows.findIndex((r) => r.kind === 'group' && r.gid === primaryGroup) : -1;
    if (g >= 0) return g;
    const p = rows.findIndex((r) => r.kind === 'part' && r.part.id === selectedId);
    return p >= 0 ? p : 0;
  }, [rows, parts, selection, selectedId]);

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
          // NOT `/ 1000`. `RoomShape.width` is METRES (see `lib/scene-store.ts`),
          // so the divide rendered every room as `0.0×0.0m` — a 7.5 m room reported
          // as 0.0. It read as plausible chrome rather than as a bug, which is what
          // rule 2 means by a displayed measurement having to be derived: the number
          // beside the fields disagreed with the fields and neither was labelled
          // with its unit.
          meta={<span className="mono">{room.width.toFixed(1)}×{room.depth.toFixed(1)}m</span>}
          open={sec.room}
          onToggle={() => toggle('room')}
          // Re-scan changes what is IN the room, which is this section's subject — it
          // was in the top bar, next to controls about how the app is framed. It is
          // the header's trailing action rather than a full-width button in the body
          // for two reasons: the body is dimensions, a compass dial and nothing else
          // that is a NAVIGATION, and a control about the section should survive the
          // section being closed.
          //
          // A <Link> wearing `.icon-btn` rather than the IconButton primitive, because
          // IconButton renders a <button> and this is a real navigation — middle-click
          // and prefetch are worth keeping. `.icon-btn::after` supplies the 44px hit
          // area, so the 28px box is visual only.
          //
          // Tooltip, not `title`: the glyph is the whole label now, `.rail` is
          // `overflow: hidden` so an absolute bubble is clipped, and the native one
          // never appears on keyboard focus. The bubble is the short name and the
          // sentence is the accessible one, which is the split Tooltip documents.
          action={
            <Tooltip label="Re-scan">
              <Link
                href="/onboarding/detect"
                className="icon-btn"
                aria-label="Re-scan the room from your photos"
                style={{ width: 32, height: 32, flexShrink: 0 }}
              >
                <Icon name="refresh" size={14} />
              </Link>
            </Tooltip>
          }
        >
          <RoomDimsEditor />
          {/* Which way the room faces. It used to live inside the Lighting mood
              that consumed it, alongside a latitude and a longitude; it is a
              property of the ROOM — `lib/storage.ts` says so in as many words —
              so it belongs with the room's other dimensions. See NorthDial. */}
          <div style={{ marginTop: 12 }}>
            <span className="ds-label" style={{ display: 'block', marginBottom: 6 }}>Facing</span>
            <NorthDial />
          </div>
        </RailSection>

        <RailSection
          title="Style"
          meta={activeTheme ? THEMES.find((t) => t.id === activeTheme)?.label : undefined}
          open={sec.style}
          onToggle={() => toggle('style')}
        >
        {/* Palettes, not names.
            A theme is four hex values and a lighting mood. It used to present as
            five *named* chips — "Studio Loft", "Coastal" — which name whole design
            languages and promise a redecoration the recolour cannot deliver; the
            swatch is both the more honest label and the more informative one, since
            `#DCE4E2 #A9C4C0 #7C9C8E` tells you more about the result than the word
            "Coastal" does.
            It also fits. Labelled, these wrapped to four rows (~162px) in the
            1024–1279px rail, which is 208px wide with 176px of content: "Warm
            Minimal" alone is ~116px. Four 30px swatches and three gaps are 138px —
            one row, in the narrowest rail there is, with room to spare. It was five
            until `Coastal` and `Studio Loft` merged into one cold neutral; the count
            is derived from `THEMES`, so nothing here needs to know that.
            The name is not lost: it is the accessible name, the tooltip, and the
            section's collapsed `meta` above, which is where a *chosen* theme should
            be reported anyway. */}
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
                  aria-label={`Restyle the room — ${t.label}`}
                  aria-pressed={on}
                  className={`ds-chip${on ? ' ds-chip--accent' : ''}`}
                  style={{
                    cursor: 'pointer',
                    height: 30,
                    width: 30,
                    padding: 0,
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex',
                      borderRadius: 'var(--r-full)',
                      overflow: 'hidden',
                      width: 18,
                      height: 18,
                    }}
                  >
                    {t.swatch.map((c) => (
                      <span key={c} style={{ flex: 1, background: c }} />
                    ))}
                  </span>
                  {/* The active swatch can't be tint-and-border only: a check mark
                      carries the state without relying on hue — and it sits OVER the
                      palette rather than beside it, because a swatch-sized button has
                      no beside. `--on-ink` on a scrim, since what is underneath is an
                      arbitrary colour and no token can be legible on all of them. */}
                  {on && (
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 'inherit',
                        background: 'rgba(0,0,0,0.42)',
                        color: 'var(--on-ink)',
                      }}
                    >
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lighting joins the themes rather than sitting in View, because a theme
            SETS a mood (`applyTheme` calls `setLighting`) — so the two were one
            question in two drawers, and picking a theme silently moved a control
            the user could not see. Same construction as the swatch row above: one
            line of 32px targets, no words, name on hover and on focus. */}
        <div style={{ marginTop: 12 }}>
          <span id="lighting-label" className="ds-label" style={{ display: 'block', marginBottom: 8 }}>Lighting</span>
          <LightingPicker />
          {/* The room is closed to the sun now, so a sun mood in a room with no
              opening has nothing to come through. Said in the same 10.5px --ink-3
              hint voice the View section uses, directly under the control that
              raises the question, and worded about the ROOM rather than about the
              renderer — on Fast quality there are no cast shadows at all, so a
              sentence claiming the room is unlit would be wrong half the time
              while this one stays true.
              It is NOT the common case, and I had that backwards for a while:
              `lib/room-openings.ts` gives every preset room a door and a window
              before any furniture is placed, so a starter room has two ways in for
              the light. What is left is a room someone has emptied, and a room
              rebuilt from photographs where detection found no opening — which is
              exactly where a silent flat sun mood would be most confusing. */}
          {sunHasNoWayIn && (
            <p style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4, margin: '6px 0 0' }}>
              Sunlight only reaches a room through its openings. Add a window or a door
              from the Library to let this one in.
            </p>
          )}
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
          title="Catalog"
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
          placeholder="Search this room…"
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

        <div
          ref={listRef}
          className="list"
          role="listbox"
          aria-label="Furniture in this room"
          aria-multiselectable="true"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
        >
        {visibleParts.length === 0 && (
          // role="presentation": a listbox may only own options, and this is copy.
          <div role="presentation" style={{ padding: '18px 14px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
            {q ? (
              <>Nothing here matches “{q}”. Try another word — a sofa, a lamp, a rug.</>
            ) : (
              <>The room is bare. Press Add to put the first piece in.</>
            )}
          </div>
        )}
        {rows.map((row, i) =>
          row.kind === 'group' ? (
            <GroupRow
              key={row.key}
              rowKey={row.key}
              shown={row.ids.length}
              total={row.total}
              collapsed={collapsed.has(row.gid)}
              selected={groupSelected(row.gid)}
              tabbable={i === tabStop}
              onSelect={(e) => pickRow(e, row)}
              onToggleCollapsed={() => toggleGroup(row.gid)}
              onNavigate={(to, extend) => navigate(i, to, extend)}
              onFrame={() => {
                selectRow(row);
                frameSelected();
              }}
              onUngroup={() => {
                const ids = groupMemberIds(row.gid);
                ungroupParts(ids);
                setSelection(ids, ids[0] ?? null);
              }}
              // Every member, for the reason `groupMemberIds` exists. This was
              // `row.ids` — the VISIBLE members — while the button beside it is
              // labelled "Remove these 3 pieces" and titled "Remove the whole
              // group". So a search that left one chair showing turned a labelled
              // three-piece delete into a one-piece delete, and left the other two
              // merged to each other. The reasoning was already written out one
              // handler above, for ungroup, and then not applied to the
              // destructive twin.
              onDelete={() => removeRow(i, groupMemberIds(row.gid))}
            />
          ) : (
            <PartRow
              key={row.key}
              rowKey={row.key}
              partId={row.part.id}
              name={row.part.name}
              category={row.part.category}
              locked={row.part.locked}
              inGroup={!!row.gid}
              lastOfGroup={!!row.lastOfGroup}
              selected={selection.includes(row.part.id)}
              tabbable={i === tabStop}
              onSelect={(e) => pickRow(e, row)}
              onToggleSelect={() => toggleInSelection(row.part.id)}
              onFrame={() => {
                setSelected(row.part.id);
                anchorRef.current = row.key;
                frameSelected();
              }}
              onNavigate={(to, extend) => navigate(i, to, extend)}
              onToggleHidden={() => useStudio.getState().toggleHidden(row.part.id)}
              onTogglePinned={() => useStudio.getState().togglePinned(row.part.id)}
              onDelete={() => removeRow(i, row.ids)}
            />
          ),
        )}
        </div>
        </RailSection>
      </div>

      {/* The room-level actions that used to be pinned here are the RIGHT rail's
          footer now (`RailFooter`). They sat in the bottom-left corner of the
          window, diagonally opposite the Inspector that answers every other
          question about what is selected. This rail ends with the piece list,
          which already takes the leftover height. */}
    </div>
  );
}

/** The ├ / └ before a group member. Two absolutely-positioned rules rather than a
 *  border on the row, because `.list-row.is-selected` already spends the row's
 *  `box-shadow` and its `border` on the selected ring — a third boundary there
 *  would either fight it or disappear under it. `--hairline-strong`, since this
 *  is a decorative connector and not the edge of anything interactive. */
function Connector({ last }: { last: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', width: 11, alignSelf: 'stretch', flexShrink: 0 }}
    >
      <span
        style={{
          position: 'absolute',
          left: 4,
          // `.list` puts a 2px gap between rows, so a stem drawn inside the row
          // box would break every 37px and read as a dotted line. The row has no
          // `overflow`, so the stem simply reaches across the gap instead — no
          // negative margins, no change to how the list stacks.
          top: -2,
          // A last member's stem stops at the elbow; every other member's runs
          // past the bottom so the spine is continuous down the group.
          bottom: last ? '50%' : -2,
          width: 1,
          background: 'var(--hairline-strong)',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 4,
          top: '50%',
          width: 6,
          height: 1,
          background: 'var(--hairline-strong)',
        }}
      />
    </span>
  );
}

function PartRow({
  rowKey,
  partId,
  name,
  category,
  locked,
  inGroup,
  lastOfGroup,
  selected,
  tabbable,
  onSelect,
  onToggleSelect,
  onFrame,
  onNavigate,
  onToggleHidden,
  onTogglePinned,
  onDelete,
}: {
  rowKey: string;
  partId: string;
  name: string;
  category: string;
  locked: boolean;
  /** a member of a merged set — indented under its group header */
  inGroup: boolean;
  lastOfGroup: boolean;
  selected: boolean;
  /** roving tabindex: exactly one row in the list is a tab stop */
  tabbable: boolean;
  onSelect: (e: React.MouseEvent) => void;
  /** Ctrl+Space: the keyboard's per-row toggle, since Ctrl-click is spent on
   *  adding a piece. */
  onToggleSelect: () => void;
  onFrame: () => void;
  onNavigate: (to: 'prev' | 'next' | 'first' | 'last', extend?: boolean) => void;
  onToggleHidden: () => void;
  onTogglePinned: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isHidden = useStudio((s) => !!s.hidden[partId]);
  const isPinned = useStudio((s) => !!s.pinned[partId]);

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
      case 'ArrowDown': mine(); onNavigate('next', e.shiftKey); break;
      case 'ArrowUp': mine(); onNavigate('prev', e.shiftKey); break;
      case 'Home': mine(); onNavigate('first'); break;
      case 'End': mine(); onNavigate('last'); break;
      // Enter/Space selects and brings the camera to it — the keyboard's only
      // way to actually *look* at a piece.
      case 'Enter':
      case ' ':
        if (onRow) {
          mine();
          // Ctrl+Space takes this row in or out of the selection without
          // disturbing the rest of it; bare Space still flies the camera to it.
          if (e.ctrlKey || e.metaKey) onToggleSelect();
          else onFrame();
        }
        break;
      case 'Delete':
      case 'Backspace': if (onRow) { mine(); onDelete(); } break;
    }
  }

  return (
    <div
      ref={ref}
      data-row-key={rowKey}
      data-part-id={partId}
      role="option"
      aria-selected={selected}
      // Explicit name: without it the row's name is computed from its contents,
      // which would swallow the nested buttons' labels ("Sofa Hide Remove").
      //
      // Membership is spoken, not just drawn. The indent and the connector say
      // "grouped" to a sighted user; nothing in a flat listbox says it otherwise,
      // and this is the one fact that changes what dragging the piece will do.
      aria-label={`${name}${inGroup ? ', grouped' : ''}${locked ? ', from your photo' : ''}${isHidden ? ', hidden' : ''}${isPinned ? ', locked in place' : ''}`}
      tabIndex={tabbable ? 0 : -1}
      className={`list-row${selected ? ' is-selected' : ''}`}
      title={`${name} · ${category}${inGroup ? ' · grouped' : ''}${isHidden ? ' · hidden' : ''}${isPinned ? ' · locked in place' : ''}${locked ? ' · from your photo' : ''}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {inGroup && <Connector last={lastOfGroup} />}
      {/* Status glyph. Shape, not just hue: a camera reads as "came out of your
          photo" even where the aubergine and the clay look the same. A padlock sat
          here and said the wrong thing — see ScenePart.locked. */}
      <span aria-hidden="true" style={{ display: 'inline-flex', justifyContent: 'center', width: 12, flexShrink: 0 }}>
        {locked ? <Icon name="camera" size={11} color="var(--locked)" /> : <Dot size={7} />}
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
      {/* Lock, beside Hide and pinned open by `is-on` for the same reason: a piece
          Fix or Shuffle may not move is a state you need to see without hovering
          every row to find it.

          The label says what it does rather than what it is. "Lock" alone invites
          the reading the padlock that used to sit in the status glyph got wrong —
          that the piece is frozen against everything — and this one blocks the
          solver only: it still drags, turns, resizes and deletes by hand. */}
      <IconButton
        icon={isPinned ? 'lock' : 'unlock'}
        label={isPinned ? `Let Fix/Shuffle move ${name}` : `Keep ${name} where it is`}
        title={isPinned ? 'Fix and Shuffle may not move this — click to release' : 'Keep where it is when the room is rearranged'}
        active={isPinned}
        className={`row-action${isPinned ? ' is-on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePinned();
        }}
        size={24}
        iconSize={12}
      />
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

/**
 * The header of a merged set.
 *
 * It is an `option` like every other row, not a heading with a button in it:
 * a listbox may only own options, and this row is genuinely selectable —
 * pressing it takes the whole group, which is the gesture the 3D canvas already
 * performs on a click (see `Pickable`) and which the rail otherwise had no way
 * to reach. Selecting one MEMBER is the thing the rail adds, and it is the row
 * below.
 *
 * `aria-expanded` carries the fold, and Left/Right work it — the tree keys, which
 * a listbox leaves free. There is no `treeitem` here on purpose: making this a
 * real tree would mean re-roling every row, and the nesting is exactly one level
 * deep and cannot become two (a `groupId` is a flat string).
 */
function GroupRow({
  rowKey,
  shown,
  total,
  collapsed,
  selected,
  tabbable,
  onSelect,
  onToggleCollapsed,
  onNavigate,
  onFrame,
  onUngroup,
  onDelete,
}: {
  rowKey: string;
  /** members the filter is showing */
  shown: number;
  /** members in the room */
  total: number;
  collapsed: boolean;
  selected: boolean;
  tabbable: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggleCollapsed: () => void;
  onNavigate: (to: 'prev' | 'next' | 'first' | 'last', extend?: boolean) => void;
  onFrame: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}) {
  // Say what is hidden rather than just showing a smaller number. A search that
  // matches one of three merged chairs must not make the set look like a pair —
  // the two it is hiding still move when this one is dragged.
  const count = shown < total ? `${shown} of ${total}` : `${total}`;
  const name = `Group, ${total} piece${total === 1 ? '' : 's'}${shown < total ? `, ${shown} shown` : ''}`;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const mine = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onRow = e.target === e.currentTarget;
    switch (e.key) {
      case 'ArrowDown': mine(); onNavigate('next', e.shiftKey); break;
      case 'ArrowUp': mine(); onNavigate('prev', e.shiftKey); break;
      case 'Home': mine(); onNavigate('first'); break;
      case 'End': mine(); onNavigate('last'); break;
      // Right opens, Left closes — and Left on an already-closed group does
      // nothing rather than jumping somewhere, because there is no parent to
      // jump to at one level of nesting.
      case 'ArrowRight': if (onRow && collapsed) { mine(); onToggleCollapsed(); } break;
      case 'ArrowLeft': if (onRow && !collapsed) { mine(); onToggleCollapsed(); } break;
      case 'Enter':
      case ' ': if (onRow) { mine(); onFrame(); } break;
      case 'Delete':
      case 'Backspace': if (onRow) { mine(); onDelete(); } break;
    }
  }

  return (
    <div
      data-row-key={rowKey}
      role="option"
      aria-selected={selected}
      aria-label={name}
      tabIndex={tabbable ? 0 : -1}
      className={`list-row${selected ? ' is-selected' : ''}`}
      title={`${name} — one press takes the whole set`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {/* The chevron is a real button so a pointer user can fold without
          selecting; the keyboard reaches the same thing through Left/Right on
          the row, which is why this one is not a tab stop of its own. */}
      <IconButton
        icon={collapsed ? 'chevron-right' : 'chevron-down'}
        label={collapsed ? `Show the ${total} pieces in this group` : 'Fold this group away'}
        // On the chevron and not on the row: ARIA 1.2 dropped `aria-expanded`
        // from `role="option"`, and the button is what performs the disclosure
        // anyway. Left/Right on the row work the same toggle.
        expanded={!collapsed}
        onClick={(e) => {
          e.stopPropagation();
          onToggleCollapsed();
        }}
        size={20}
        iconSize={12}
      />
      {/* `.ds-label`, not the row's own 12px/500: this is a heading for the rows
          beneath it and should not read as another piece of furniture. The chevron
          and the connectors below carry the rest of the identity — a `layers`
          glyph as well would have cost 20px of a label budget that is only ~46px
          in the 1024–1279px rail, and pushed the word itself to "Grou…". */}
      <span
        className="ds-label"
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        Group · {count}
      </span>
      <IconButton
        icon="swap"
        label={`Ungroup these ${total} pieces`}
        title="Ungroup — they stay where they are"
        className="row-action"
        onClick={(e) => {
          e.stopPropagation();
          onUngroup();
        }}
        size={24}
        iconSize={12}
      />
      <IconButton
        icon="trash"
        label={`Remove these ${total} pieces`}
        title="Remove the whole group (Del)"
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

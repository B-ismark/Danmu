'use client';

// The model picker, and the two controls that frame it everywhere it appears.
//
// One list, three hosts: the catalog panel (docked over the canvas, one column,
// items draggable onto the floor), the Inspector's swap flow, and anything else
// that needs "choose a model". Before this the catalog panel kept its OWN grouped
// list over `PART_LIBRARY` alone, so the real-product presets existed in the
// modal and silently did not exist on the canvas — the same feature, two lists,
// one of them wrong.
//
// It also absorbed the "Describe it" tab that used to sit beside it. That tab
// read as a way to find models the library does not have, and this app cannot do
// that — every piece is procedural and there is no mesh download path (rule 1).
// What was real underneath it was `lib/shape-search`: synonym-folding token
// scoring, and a dimension parser that let "queen bed 160x200cm" arrive at that
// size. Both are on THIS box now, so there is one field instead of two tabs
// claiming two features, and `rankLibrary` is what the search reads.

import { useRef, useState } from 'react';
import { PART_LIBRARY, DND_MIME, type LibraryItem } from '@/lib/scene-spec';
import { rankLibrary, sizeFromQuery, queryNamesSize, resolveQuerySize, describeOverruled } from '@/lib/shape-search';
import { Icon } from '@/components/ui/Icon';

const ALL_ITEMS: LibraryItem[] = PART_LIBRARY;

export function LibraryPicker({
  onPick,
  onPickMany,
  /** one column in a narrow dock, two in a modal */
  columns = 2,
  /** let each row be dragged into the room. On for both studio tabs — the plan
   *  catches a drop now too, and puts the piece where the pointer let go. Off
   *  where nothing can catch it (the swap modal), because a drag that cannot land
   *  is a worse affordance than no drag at all. */
  draggable = false,
  /** A NUMBER caps the scroller (the modal, which sits in a page-sized dialog).
   *  `null` makes it fill its flex parent instead — which is what a docked panel
   *  needs, and why this is not just `maxHeight: '100%'`: a percentage max-height
   *  against an auto-height flex parent resolves to none, so the list would grow
   *  past the panel and be clipped by its `overflow: hidden` rather than scroll. */
  maxHeight = 320,
  autoFocus = true,
  initialQuery = '',
}: {
  onPick: (item: LibraryItem) => void;
  /** Add several at once. Passing it turns on Shift-click range marking — the
   *  swap flow leaves it out, because swapping one piece for a SET is not a
   *  thing, and a list that could mark rows there would offer a gesture with
   *  nowhere to go. */
  onPickMany?: (items: LibraryItem[]) => void;
  columns?: 1 | 2;
  draggable?: boolean;
  maxHeight?: number | null;
  autoFocus?: boolean;
  /** What the box starts with. The swap flow seeds it with the piece's own name, so
   *  opening the modal on something called "office chair" is already showing office
   *  chairs — which is what the deleted Describe-it tab did with the same string.
   *
   *  Initial only, not controlled: the field is the user's the moment they type in
   *  it, and a `value` prop here would fight them on every keystroke. */
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  // Marked as RESOLVED items, not as labels.
  //
  // Labels were the obvious choice — the catalogue is fixed, so a label identifies
  // an entry and survives the list being re-filtered under it — and they were wrong
  // for one reason: the SIZE a query names is not part of the label. `asAdded` closes
  // over the live query, so resolving at press time meant a mark made under one
  // query was added under whatever query was in the box later. Clearing the box to
  // see the rest of the list is the natural way to mark more rows, and it silently
  // dropped the size off everything already marked; retyping a query about a
  // different piece was worse, and gave a bed the size from a query about a
  // wardrobe. A mark records what the user was looking at when they made it.
  //
  // Found in review. It is the same defect `asAdded` exists to prevent — four
  // consumption paths agreeing about one query — with a fifth path nobody named,
  // because the fifth axis is TIME rather than a call site.
  const [marked, setMarked] = useState<LibraryItem[]>([]);
  const anchorRef = useRef<string | null>(null);
  const query = q.trim();
  // Ranked, synonym-folded, with the old substring match kept underneath as a
  // fallback — see `rankLibrary`. Grouping a ranked list leaves the groups in the
  // order of their best match and the rows inside each one in rank order, which is
  // the order `orderedRows` below then reads for a Shift-range.
  const items = rankLibrary(q);
  // Whether the words named a size at all. Only asked so the rows can SHOW the
  // size they would arrive at, and only when there is something to show — the
  // ordinary list is unchanged.
  const sized = queryNamesSize(q);
  const groups = items.reduce<Record<string, LibraryItem[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});
  // The order the rows are actually READ in, which is what a Shift-range has to
  // walk: grouped, and only the entries the current search left behind.
  const ordered = Object.values(groups).flat();
  const canMark = !!onPickMany;

  /** The item as it would actually be ADDED: same label, same shape, but carrying
   *  any size the search words named, clamped into its own range.
   *
   *  A copy rather than a second argument on `onPick`, and that is the design: every
   *  host already reads `item.dimMM` (the catalog panel spawns from it, the swap
   *  modal re-grounds from it, the drag payload serialises it), so handing them a
   *  resolved item means the size travels through all four paths without any of them
   *  having to learn about the search box. The alternative — `onPick(item, dim?)` —
   *  is a parameter three of the four would ignore, and the one that forgot it would
   *  silently add the preset size instead. */
  const asAdded = (item: LibraryItem): LibraryItem =>
    sized ? { ...item, dimMM: sizeFromQuery(item, q) } : item;

  /**
   * What a press on an entry means.
   *
   *   - plain, or Ctrl / Cmd: add this model to the room. Both, deliberately:
   *     Ctrl-click is the gesture the request named, and in a list of things to
   *     add there is nothing else for it to mean.
   *   - Shift: mark a range, to add several in one go.
   */
  function press(e: React.MouseEvent, item: LibraryItem) {
    if (canMark && e.shiftKey) {
      const from = ordered.findIndex((i) => i.label === anchorRef.current);
      const to = ordered.findIndex((i) => i.label === item.label);
      // No anchor yet (or the search has hidden it): mark this one and start here.
      // `item` arrives already resolved (the row passes `added`), and the rest of a
      // Shift-range is resolved here, under the query that is in the box right now.
      const range =
        from < 0 || to < 0
          ? [item]
          : ordered.slice(Math.min(from, to), Math.max(from, to) + 1).map(asAdded);
      anchorRef.current = anchorRef.current ?? item.label;
      // De-duplicated by label, and an existing mark WINS over a re-mark: the first
      // press is the one the user chose a size under.
      setMarked((prev) => {
        const already = new Set(prev.map((m) => m.label));
        return [...prev, ...range.filter((r) => !already.has(r.label))];
      });
      return;
    }
    anchorRef.current = item.label;
    setMarked([]);
    onPick(item);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: maxHeight === null ? 1 : undefined }}>
      {/* A placeholder is not a label — it disappears the moment you type. */}
      <input
        className="field"
        aria-label="Search the Library"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search the Library…"
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
              {list.map((item) => {
                const added = asAdded(item);
                // The SAME call `asAdded` delegates to, asked a second question:
                // which axes the range had to overrule. One derivation, two
                // readers of its two halves — not two clamps.
                const overruled = sized ? resolveQuerySize(item, q).overruled : {};
                const refused = describeOverruled(overruled);
                return (
                <button
                  key={item.label}
                  draggable={draggable || undefined}
                  onDragStart={
                    draggable
                      ? (e) => {
                          e.dataTransfer.setData(
                            DND_MIME,
                            JSON.stringify({
                              label: added.label,
                              category: added.category,
                              shape: added.shape,
                              dimMM: added.dimMM,
                            }),
                          );
                          e.dataTransfer.effectAllowed = 'copy';
                        }
                      : undefined
                  }
                  onClick={(e) => press(e, added)}
                  aria-pressed={marked.some((m) => m.label === item.label) || undefined}
                  className="ds-btn"
                  title={
                    (draggable
                      ? `${added.label} — drag into the room, or click to add it in the first clear spot · ${added.dimMM[0]} × ${added.dimMM[1]} × ${added.dimMM[2]} mm`
                      : `${added.dimMM[0]} × ${added.dimMM[1]} × ${added.dimMM[2]} mm`) + (refused ? ` · ${refused}` : '')
                  }
                  // A refusal that only a `title` carries is a refusal for mouse
                  // users. `title` does not surface on keyboard focus and screen
                  // readers treat it as optional, so the sentence goes into the
                  // accessible NAME — which means the name has to carry the label
                  // and the size too, since setting it replaces the text content.
                  aria-label={
                    refused
                      ? `${added.label}, ${added.dimMM[0]} × ${added.dimMM[1]} × ${added.dimMM[2]} mm. ${refused}`
                      : undefined
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
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {added.label}
                  </span>
                  {/* Only when the words named a size, and then it is THIS row's
                      size after its own clamp — not the text echoed back. Two rows
                      can read differently from one query, which is the honest
                      answer: a 4 m sofa is legal and a 4 m mirror is not. */}
                  {sized && (
                    // 10px, not 9.5: --ink-3 states its own contrast as safe for 10-12px
                    // hint text, and a badge below that floor is a token used outside what
                    // it promises. The ratio holds either way (4.92:1 at worst) - the point
                    // is that the promise and the use agree. A `{/* */}` comment cannot go
                    // here: `{sized && (` opens a JS expression, and a JSX comment is only
                    // legal where children are.
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        // Two tells, not one: the warn tone AND the glyph beside
                        // it, because colour alone is not a state.
                        color: refused ? 'var(--warn-text)' : 'var(--ink-3)',
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      {added.dimMM[0]}×{added.dimMM[1]}×{added.dimMM[2]}
                      {refused && <Icon name="info" size={10} />}
                    </span>
                  )}
                </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {/* What a marked set is FOR. Without this row the Shift gesture would mark
          things and then have nowhere to go. It only exists while something is
          marked, so the list is unchanged until the gesture is used. */}
      {canMark && marked.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 8, flexShrink: 0 }}>
          <button
            className="ds-btn"
            style={{ flex: 1, minWidth: 0, height: 30, fontSize: 12, justifyContent: 'center', fontWeight: 700 }}
            onClick={() => {
              // Catalogue order rather than press order, which is what this did before
              // and is the less surprising of the two when several pieces land at once.
              // The SIZE comes from the mark, not from the box — see `marked`.
              const byLabel = new Map(marked.map((m) => [m.label, m]));
              const picked = ALL_ITEMS.filter((i) => byLabel.has(i.label)).map((i) => byLabel.get(i.label)!);
              setMarked([]);
              onPickMany?.(picked);
            }}
          >
            <Icon name="plus" size={11} />
            Add {marked.length}
          </button>
          <button
            className="ds-btn"
            style={{ height: 30, fontSize: 12, paddingInline: 10 }}
            onClick={() => setMarked([])}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

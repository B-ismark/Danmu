'use client';

// The app's dropdown. Replaces <select>, whose option list is drawn by the OS —
// square corners, system blue highlight, system font, a scrollbar nothing here
// controls — dropped on top of a warm, rounded, Figtree interface. Same reason
// ColorPicker replaced <input type="color"> and Confirm replaced window.confirm.
//
// It keeps the parts of a native select that matter:
//   · focus stays on the trigger; the list is described with aria-activedescendant
//   · Up/Down change the value while closed, exactly like a native select
//   · type-ahead ("wa" jumps to Wardrobe), Home/End, Enter/Space, Esc
//   · the selected option is scrolled into view when the list opens
//
// The list is portalled to <body> and positioned fixed. Both call sites live in
// scrolling panels, and an absolutely-positioned popup would be clipped by the
// first ancestor with overflow — the units dropdown sits inside the Inspector's
// scroll container, so this is not hypothetical. It flips above the trigger when
// there is more room up there, and closes on scroll (matching native behaviour,
// and cheaper than tracking the trigger every frame).

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
  /** optional trailing note, e.g. a unit or a hint */
  hint?: string;
  /** what the closed trigger shows, when the full label is too long for it.
   *  The list always shows `label`, so nothing is hidden from the choice
   *  itself — this only keeps "Millimeters (mm)" from being cut to "Millimeter"
   *  in a 92px control. */
  short?: string;
};

const MAX_LIST_H = 288;
const GAP = 6;

export function Select<T extends string>({
  options,
  value,
  onChange,
  onActiveChange,
  ariaLabel,
  title,
  id,
  width,
  height = 34,
  fontSize = 'var(--fs-body)',
  placeholder = 'Select…',
}: {
  options: SelectOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Optional. Called with the option the open list is highlighting (pointer or
   *  arrows), and with `null` when the list closes. Lets a caller preview what an
   *  option refers to before it is chosen. Never fires for a closed Select. */
  onActiveChange?: (v: T | null) => void;
  ariaLabel?: string;
  title?: string;
  id?: string;
  /** trigger width. Defaults to filling its container, like `.field`. */
  width?: number | string;
  height?: number;
  /** A `--fs-*` step, as `var(--fs-…)`. */
  fontSize?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const typed = useRef({ q: '', at: 0 });
  /** Where the list should open, when something other than the chosen option asked
   *  for it: type-ahead on a Select with nothing chosen yet. */
  const openAt = useRef<number | null>(null);

  // A value that is not one of the options shows the placeholder, and it used to
  // show the FIRST option instead: the ideas gallery's "Keep a piece…" read "Sofa",
  // which says the sofa is kept. `index` stays 0 for the list's own starting point.
  const found = options.findIndex((o) => o.value === value);
  const index = Math.max(0, found);
  const selected = found >= 0 ? options[found] : undefined;

  function place() {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP;
    const above = r.top - GAP;
    const flip = below < Math.min(MAX_LIST_H, options.length * 34 + 12) && above > below;
    setBox({
      position: 'fixed',
      left: r.left,
      minWidth: r.width,
      maxHeight: Math.min(MAX_LIST_H, Math.max(120, flip ? above : below)),
      ...(flip ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
    });
  }

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActive(openAt.current ?? index);
    openAt.current = null;
    function onDown(e: MouseEvent) {
      if (btn.current?.contains(e.target as Node) || list.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    // Capture: a scroll inside any panel would slide the trigger out from under
    // a fixed-position list. Scrolling *within* the list is the exception — and
    // not a rare one: opening on a value far down the list scrolls it into view,
    // which fired this handler and shut the list again the moment it appeared.
    function onScroll(e: Event) {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  // Keep the active option visible — both on open (jump to the selected one) and
  // while arrowing through a list taller than the popup.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Reported only while open, and `null` on close or unmount so a preview cannot be
  // left on. The callback is read through a ref: callers pass an inline function.
  const activeCb = useRef(onActiveChange);
  activeCb.current = onActiveChange;
  useEffect(() => {
    if (!open) return;
    activeCb.current?.(options[active]?.value ?? null);
    return () => activeCb.current?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function commit(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    btn.current?.focus();
  }

  /** Type-ahead over labels, native-select style: keystrokes within a second
   *  accumulate into one query, a repeated single letter cycles matches. */
  function typeAhead(key: string) {
    const now = Date.now();
    const t = typed.current;
    t.q = now - t.at > 1000 ? key : t.q + key;
    t.at = now;
    const q = t.q.toLowerCase();
    // With nothing chosen the search starts BEFORE the first option, so a first
    // option that matches is found first rather than last.
    const from = open ? active : found < 0 ? -1 : index;
    const cycle = t.q.length > 1 ? 0 : 1;
    for (let n = cycle; n < options.length + cycle; n++) {
      const i = (from + n) % options.length;
      if (options[i].label.toLowerCase().startsWith(q)) {
        if (open) setActive(i);
        // Nothing chosen yet: open ON the match rather than choosing it, for the
        // reason an arrow opens the list here (see `step`).
        else if (found < 0) {
          openAt.current = i;
          setOpen(true);
        } else onChange(options[i].value);
        return;
      }
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = (d: number) => {
      e.preventDefault();
      if (open) setActive((a) => Math.min(options.length - 1, Math.max(0, a + d)));
      // Nothing chosen yet: an arrow opens the list rather than choosing for the
      // person, since a closed trigger has nothing to step from.
      else if (found < 0) setOpen(true);
      else {
        const next = Math.min(options.length - 1, Math.max(0, index + d));
        if (next !== index) onChange(options[next].value);
      }
    };
    switch (e.key) {
      case 'ArrowDown': step(1); return;
      case 'ArrowUp': step(-1); return;
      case 'Home': if (open) { e.preventDefault(); setActive(0); } return;
      case 'End': if (open) { e.preventDefault(); setActive(options.length - 1); } return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) commit(active);
        else setOpen(true);
        return;
      case 'Escape':
        if (open) {
          // Stop here: Esc in the studio also clears the selection, and closing a
          // dropdown should not do that too.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          typeAhead(e.key);
        }
    }
  }

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        // `select-trigger` is only a hook for the touch rule in globals.css: under a
        // finger the trigger is 44px tall whatever `height` asked for, because a
        // minimum wins over an inline height.
        className="field select-trigger"
        style={{
          width: width ?? '100%',
          height,
          fontSize,
          fontWeight: 600,
          padding: '0 8px 0 10px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span className="truncate" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {selected?.icon && <Icon name={selected.icon} size={13} />}
          {selected ? selected.short ?? selected.label : placeholder}
        </span>
        <Icon name="chevron-down" size={13} style={{ color: 'var(--ink-3)' }} />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="ds-card select-pop"
            style={{ ...box, zIndex: 'var(--z-popover)', padding: 5, overflowY: 'auto' }}
          >
            {options.map((o, i) => {
              const isSel = o.value === value;
              const isActive = i === active;
              return (
                <div
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSel}
                  className="select-option"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 32,
                    padding: '0 8px',
                    borderRadius: 'var(--r-1)',
                    fontSize: 'var(--fs-small)',
                    fontWeight: isSel ? 700 : 500,
                    color: 'var(--ink)',
                    // Two states, two tells that cannot be confused: "where I am" (the
                    // pointer or the arrow keys) is the warm paper wash every other
                    // hover here uses, and "what is set" is the weight and a moss
                    // check. The chosen row used to wear a green tint as well, and
                    // under the pointer that was a green slab beside a beige one,
                    // with a hairline box round the beige — three looks for two facts.
                    background: isActive ? 'var(--paper-2)' : 'transparent',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {o.icon && <Icon name={o.icon} size={13} />}
                  <span className="truncate" style={{ flex: 1 }}>{o.label}</span>
                  {o.hint && <span className="t-hint">{o.hint}</span>}
                  {isSel && (
                    <span style={{ display: 'inline-flex', color: 'var(--accent-text)' }}>
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

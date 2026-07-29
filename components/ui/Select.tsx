'use client';

// The app's dropdown. Replaces <select>, whose option list is drawn by the OS —
// square corners, system blue highlight, system font, a scrollbar nothing here
// controls — dropped on top of a warm, rounded, Nunito interface. Same reason
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
  ariaLabel,
  title,
  id,
  width,
  height = 34,
  fontSize = 13,
  placeholder = 'Select…',
}: {
  options: SelectOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  title?: string;
  id?: string;
  /** trigger width. Defaults to filling its container, like `.field`. */
  width?: number | string;
  height?: number;
  fontSize?: number;
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

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[index];

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
    setActive(index);
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
    const from = open ? active : index;
    const cycle = t.q.length > 1 ? 0 : 1;
    for (let n = cycle; n < options.length + cycle; n++) {
      const i = (from + n) % options.length;
      if (options[i].label.toLowerCase().startsWith(q)) {
        if (open) setActive(i);
        else onChange(options[i].value);
        return;
      }
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = (d: number) => {
      e.preventDefault();
      if (open) setActive((a) => Math.min(options.length - 1, Math.max(0, a + d)));
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
        className="field"
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 32,
                    padding: '0 8px',
                    borderRadius: 'var(--r-1)',
                    fontSize: 12.5,
                    fontWeight: isSel ? 700 : 500,
                    color: isSel ? 'var(--accent-text)' : 'var(--ink)',
                    // Hover/keyboard focus is a wash; the chosen one keeps the
                    // accent tint, so "where I am" and "what is set" stay distinct.
                    background: isSel ? 'var(--accent-tint)' : isActive ? 'var(--paper-2)' : 'transparent',
                    boxShadow: isActive && !isSel ? 'inset 0 0 0 1px var(--hairline-strong)' : 'none',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  {o.icon && <Icon name={o.icon} size={13} />}
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                  {o.hint && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{o.hint}</span>}
                  {isSel && <Icon name="check" size={13} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

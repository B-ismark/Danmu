'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  MARK_FILL_OPACITY,
  MARK_LINES,
  MARK_PIECE,
  MARK_SOLID,
  MARK_STROKE_WIDTH,
  MARK_VIEWBOX,
} from '@/lib/brand-mark';
import { Icon, type IconName } from './Icon';

// The mark is the room the studio builds: a soft dollhouse volume with one piece
// of furniture in it. It replaced a hard-cornered square with tracked monospace
// caps — a drafting-instrument signature that contradicted the brand's "warm,
// playful, deliberately not CAD" commitment on every screen it appeared.
//
// The path data is `lib/brand-mark.ts`'. It used to be written out here and
// written out again in app/icon.svg, and the two had already drifted a stroke
// width and a fill opacity apart before a share card and an iOS icon wanted the
// same drawing. Colour still belongs to the consumer: this one can read custom
// properties, so it does — and it strokes with `currentColor` so the mark takes
// the colour of whatever bar it is sitting in.
//
// `nowrap` on the wordmark: this whole thing lives in `.chrome-bar`, which wraps,
// and a two-line "Dan / mu" beside a 16px glyph is not a reflow anyone wanted.
export function DanmuMark({ size = 16, color = 'var(--ink)' as string }: { size?: number; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={MARK_VIEWBOX} fill="none" aria-hidden="true">
        <path d={MARK_SOLID} fill="var(--accent)" opacity={MARK_FILL_OPACITY} />
        <path
          d={MARK_LINES}
          stroke="currentColor"
          strokeWidth={MARK_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect {...MARK_PIECE} fill="var(--accent-2)" />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size + 1,
          fontWeight: 560,
          letterSpacing: '-0.015em',
          whiteSpace: 'nowrap',
        }}
      >
        Danmu
      </span>
    </div>
  );
}

/**
 * The lead of an onboarding step's bar: Back, a divider, and the mark.
 *
 * Capture and detect each built this triple by hand and had already drifted —
 * 34px vs 32px buttons, `0 8px` vs `0 10px` padding, 12 vs 12.5px labels, and
 * `aria-hidden` on only one of the two dividers. The same drift, from the same
 * cause, as the two studio tabs.
 *
 * `markHref` is optional ON PURPOSE. Everywhere the mark is a link it goes to the
 * workspace, and it should — except where a stray click on a logo would discard
 * work. Detect holds its whole review (confirmations, edits, added boxes) in
 * component state until `finish()` writes it, so it passes no href and keeps a
 * bare mark. Capture persists every shot as it is taken, so leaving costs
 * nothing and its mark links. Do not "fix" detect's to match.
 */
export function FlowBarLead({
  onBack,
  markHref,
  children,
}: {
  onBack: () => void;
  /** Omit where leaving would lose unsaved work. */
  markHref?: string;
  /** The step's own title / status, rendered after the mark. */
  children?: ReactNode;
}) {
  return (
    <>
      <button onClick={onBack} className="ds-btn ds-btn--ghost" style={{ height: 32, padding: '0 10px' }}>
        <Icon name="chevron-left" size={14} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Back</span>
      </button>
      <div aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
      {markHref ? (
        <Link href={markHref} aria-label="Danmu — back to your rooms" style={{ display: 'flex' }}>
          <DanmuMark size={12} />
        </Link>
      ) : (
        <DanmuMark size={12} />
      )}
      {children}
    </>
  );
}

// Rename-in-place. A real button that swaps to an input, so renaming is
// reachable by keyboard and announced — it replaces four separate
// `<div onClick>` affordances (room card, room name in the studio top bar, part
// name, detection label) whose only hint was a title attribute.
export function EditableText({
  value,
  onCommit,
  onReject,
  label,
  maxLength = 80,
  style,
  inputStyle,
}: {
  value: string;
  onCommit: (next: string) => void;
  /** called when a blank/whitespace-only name is submitted and the old value is
   *  kept, so the caller can say so instead of appearing to ignore the user */
  onReject?: () => void;
  /** what is being renamed, e.g. "Room name" — used for the accessible name */
  label: string;
  maxLength?: number;
  /** `.editable` already truncates (`max-width: 100%`, ellipsis, nowrap), so a
   *  caller inside a flex row needs nothing here but `minWidth: 0` — without it
   *  the item's automatic minimum is its content and it refuses to shrink at
   *  all, which is what pushed the studio's top bar wider than the window. */
  style?: CSSProperties;
  inputStyle?: CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const btnRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);

  // Return focus to the trigger after an edit ends, so keyboard position is
  // never lost. Only on a real edit — not on first mount.
  useEffect(() => {
    if (!editing && restore.current) {
      restore.current = false;
      btnRef.current?.focus();
    }
  }, [editing]);

  function start() {
    setDraft(value);
    restore.current = true;
    setEditing(true);
  }

  function commit() {
    const next = draft.trim();
    // An empty or whitespace-only name is a mistake, not an intent: revert, and
    // let the caller explain why nothing changed.
    if (!next) onReject?.();
    else if (next !== value) onCommit(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className="field"
        aria-label={label}
        autoFocus
        maxLength={maxLength}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        style={inputStyle}
      />
    );
  }

  return (
    <button
      ref={btnRef}
      type="button"
      className="editable"
      onClick={(e) => {
        e.stopPropagation();
        start();
      }}
      aria-label={`${label}: ${value}. Activate to rename.`}
      // Carries the FULL value as well as the verb. The title used to be the
      // bare word "Rename", which is enough until the label is ellipsised —
      // then the tooltip is the only place a sighted user can read the rest of
      // their room's name.
      title={`Rename “${value}”`}
      style={style}
    >
      {value}
    </button>
  );
}

export function Dot({
  color = 'var(--accent)' as string,
  size = 6,
  style,
}: {
  color?: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/** The ring a control shows while it is working. Decorative only — `aria-hidden`
 *  because the control it sits in changes its own label and carries `aria-busy`,
 *  and a screen reader being told "image" mid-sentence is worse than silence. */
export function Spinner({ size = 12, style }: { size?: number; style?: CSSProperties }) {
  return <span className="ds-spinner" aria-hidden="true" style={{ width: size, height: size, ...style }} />;
}

// The title is a real <h1>: these are separate routes, and without a heading
// element the page has no document outline *and* the display-serif rule in
// globals.css never fires — which is why Fraunces was absent from onboarding.
// `kicker` is free text rather than a zero-padded "Step 01 / 04": the mono
// tabular counter read as a drafting form, and it over-promised a fixed
// four-step sequence the primary path skips.
export function StepHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {kicker && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ds-label" style={{ color: 'var(--accent-text)' }}>
            {kicker}
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
        </div>
      )}
      <h1 style={{ fontSize: 24, lineHeight: 1.15, color: 'var(--ink)' }}>{title}</h1>
      {subtitle && (
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>{subtitle}</div>
      )}
    </div>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      style={{
        width: 44,
        height: 24,
        borderRadius: 'var(--r-full)',
        border: '1px solid var(--edge)',
        background: on ? 'var(--accent)' : 'var(--paper-2)',
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        transition: 'background .15s, border-color .15s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 18,
          height: 18,
          borderRadius: 'var(--r-full)',
          background: 'var(--on-accent)',
          border: '1px solid var(--edge)',
          // transform, not `left` — `left` forces layout on every toggle, and
          // this is the primitive every other switch in the app copies.
          transform: on ? 'translateX(20px)' : 'translateX(0)',
          transition: 'transform .15s',
        }}
      />
    </button>
  );
}

// Square icon-only button. `label` is REQUIRED and becomes both the aria-label
// and the title tooltip — so an icon button is never unlabelled and its glyph
// is always centered (styling lives in the .icon-btn class). Pass `active` to
// expose a pressed/toggle state (adds aria-pressed + the tinted look).
export function IconButton({
  icon,
  label,
  onClick,
  active,
  expanded,
  disabled,
  /** visual box; the hit area is lifted to 44px by .icon-btn::after. Floored at
   *  24px so no control falls under the WCAG 2.5.8 minimum target size. */
  size = 32,
  iconSize = 16,
  variant = 'ghost',
  tone = 'default',
  title,
  style,
  className,
}: {
  icon: IconName;
  label: string;
  /** receives the event, so buttons nested in a clickable row can stopPropagation */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  /** disclosure state, for a button that folds something away. Kept OFF the row
   *  it sits in: `aria-expanded` is not a supported state of `role="option"`
   *  (ARIA 1.2 dropped it), so the control that does the folding is the one that
   *  reports it. */
  expanded?: boolean;
  disabled?: boolean;
  size?: number;
  iconSize?: number;
  variant?: 'ghost' | 'outline';
  /** 'danger' tints the glyph red with a red hover — for destructive actions */
  tone?: 'default' | 'danger';
  title?: string;
  style?: CSSProperties;
  /** extra class(es) merged onto .icon-btn — e.g. "row-action" for hover-reveal */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-expanded={expanded === undefined ? undefined : expanded}
      title={title ?? label}
      className={`icon-btn${variant === 'outline' ? ' icon-btn--outline' : ''}${tone === 'danger' ? ' icon-btn--danger' : ''}${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: Math.max(size, 24), height: Math.max(size, 24), ...style }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

// Small status pill — tinted background + tinted text from one tone. Replaces
// the hand-built "Locked" / status chips that were duplicated across panels.
// Foregrounds are the *-text tokens: pill copy is 11px on a tinted surface, the
// hardest contrast case in the app, and the plain fill tokens do not clear
// 4.5:1 against their own tints.
const PILL_TONES: Record<string, [string, string]> = {
  locked: ['--locked-tint', '--locked'],
  accent: ['--accent-tint', '--accent-text'],
  sage: ['--accent-2-tint', '--success-text'],
  danger: ['--danger-tint', '--danger-text'],
  warn: ['--paper-3', '--warn-text'],
  neutral: ['--paper-2', '--ink-2'],
};

export function Pill({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: 'locked' | 'accent' | 'sage' | 'danger' | 'warn' | 'neutral';
  children: ReactNode;
  style?: CSSProperties;
}) {
  const [bg, fg] = PILL_TONES[tone] ?? PILL_TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 22,
        padding: '0 10px',
        borderRadius: 'var(--r-full)',
        background: `var(${bg})`,
        color: `var(${fg})`,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// Segmented toggle — a row of mutually-exclusive options in the rounded
// .toolbar shell, with aria-pressed per option. Replaces the several inline
// segmented controls (units, upload/camera, view presets, …).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 30,
  stretch = false,
  wrap = false,
  minItem = 84,
}: {
  options: { value: T; label?: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  size?: number;
  /** fill the container and split it evenly between segments. For a set whose
   *  labels are too wide to sit at their natural size in a narrow panel — even
   *  thirds beat a track that overflows and clips its last segment. */
  stretch?: boolean;
  /**
   * Let the segments reflow onto more than one row.
   *
   * `stretch` divides ONE row evenly, which helps only while the row is wide
   * enough for every label — and it hides the moment it isn't. Four
   * `icon + word` segments want about 340px; the lighting set had 272px, so each
   * got 68px while "Evening" needed 82. `flex: 1 1 0` with `minWidth: 0` sizes
   * the BOX, not the text, and the segment had no `overflow` of its own, so the
   * word simply printed over its neighbours — `justify-content: center` spilling
   * it 7px into "Day" on one side and "Cool" on the other. Nothing errored and
   * nothing was missing; the control just read as overlapping mush.
   *
   * This mode lays the segments out as an auto-fitting grid instead, so the same
   * set is 4-across in a dialog and a 2×2 pad in a rail without either caller
   * knowing which it got.
   *
   * No dividers are drawn between the rows, because none are drawn between the
   * columns either — the filled active segment is what carries the state.
   */
  wrap?: boolean;
  /** Narrowest a segment may be before the grid drops to fewer columns. Default
   *  fits `icon + one word` at 12.5px; raise it for two-word labels. Ignored
   *  unless `wrap`. */
  minItem?: number;
}) {
  const fill = wrap || stretch;
  return (
    <div
      className="toolbar"
      role="group"
      aria-label={ariaLabel}
      style={
        wrap
          ? {
              display: 'grid',
              width: '100%',
              // `min(…, 100%)` so a container narrower than one segment gets a
              // single squeezed column rather than a track that overflows it.
              gridTemplateColumns: `repeat(auto-fit, minmax(min(${minItem}px, 100%), 1fr))`,
            }
          : stretch
            ? { display: 'flex', width: '100%' }
            : undefined
      }
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            aria-label={o.label ?? o.value}
            title={o.label ?? o.value}
            style={{
              height: size,
              padding: o.label ? (fill ? '0 6px' : '0 12px') : 0,
              // Left alone under `wrap` — the grid track is what sizes the cell,
              // and a `width` here would fight it. Otherwise: labels take their
              // natural width, and an icon-only segment is square.
              width: wrap ? undefined : o.label ? 'auto' : size,
              // `flex` is meaningless in the grid, and setting it would read as
              // if one of the two modes were still doing the other's work.
              flex: wrap ? undefined : stretch ? '1 1 0' : undefined,
              minWidth: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              // An icon + label pair used to be one string with a space in it,
              // which wrapped to a second line inside a 30px-tall segment.
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              border: 'none',
              background: active ? 'var(--accent-tint)' : 'transparent',
              color: active ? 'var(--accent-text)' : 'var(--ink-2)',
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {/* The icon never shrinks — it is the part that still identifies the
                segment once the word has been cut. */}
            {o.icon && <Icon name={o.icon} size={14} />}
            {/* Its own element so the ellipsis has something to apply to: a bare
                text node inside a flex container is an anonymous flex item, and
                `text-overflow` does not reach it. Below `minItem` there is no
                column count that fits, so cutting the label here is the last
                resort — and it is a real improvement on what a too-narrow
                segment used to do, which was let the word print straight over
                the segments either side of it. */}
            {o.label && (
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

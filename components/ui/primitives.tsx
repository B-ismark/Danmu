'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// The mark is the room the studio builds: a soft dollhouse volume with one
// piece of furniture in it, matching app/icon.svg. It replaced a hard-cornered
// square with tracked monospace caps — a drafting-instrument signature that
// contradicted the brand's "warm, playful, deliberately not CAD" commitment on
// every screen it appeared.
export function DanmuMark({ size = 16, color = 'var(--ink)' as string }: { size?: number; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color }}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M6 21.5 16 26l10-4.5V11L16 6.5 6 11z" fill="var(--accent)" opacity="0.16" />
        <path
          d="M6 21.5V11l10-4.5L26 11v10.5L16 26zM6 11l10 4.5L26 11M16 15.5V26"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="12.6" y="17.9" width="6.8" height="4.2" rx="1.6" fill="var(--accent-2)" />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: size + 1,
          fontWeight: 560,
          letterSpacing: '-0.015em',
        }}
      >
        Danmu
      </span>
    </div>
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
      title="Rename"
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

export function IOSFrame({
  children,
  width = 402,
  height = 874,
  dark,
}: {
  children: ReactNode;
  width?: number;
  height?: number;
  dark?: boolean;
}) {
  return (
    <div className="ios-frame" style={{ width, height }}>
      <div className="ios-frame__notch" />
      <div className="ios-frame__inner" style={dark ? { background: '#0A0A08' } : undefined}>
        {children}
      </div>
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
}: {
  options: { value: T; label?: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
  size?: number;
}) {
  return (
    <div className="toolbar" role="group" aria-label={ariaLabel}>
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
              padding: o.label ? '0 12px' : 0,
              width: o.label ? 'auto' : size,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              border: 'none',
              background: active ? 'var(--accent-tint)' : 'transparent',
              color: active ? 'var(--accent-text)' : 'var(--ink-2)',
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

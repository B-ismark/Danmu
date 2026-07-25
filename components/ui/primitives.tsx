import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function DanmuMark({ size = 14, color = 'var(--ink)' as string }: { size?: number; color?: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="14" height="14" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="8" cy="8" r="2.3" fill="var(--accent)" />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: size - 2,
          letterSpacing: '0.14em',
          fontWeight: 500,
        }}
      >
        DANMU
      </span>
    </div>
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

export function StepHeader({
  step,
  total,
  title,
  subtitle,
}: {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="ds-label" style={{ color: 'var(--accent)' }}>
          Step <span className="mono">{String(step).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          lineHeight: 1.15,
        }}
      >
        {title}
      </div>
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

export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      style={{
        width: 44,
        height: 24,
        borderRadius: 'var(--r-full)',
        border: '1px solid var(--hairline-strong)',
        background: on ? 'var(--accent)' : 'var(--paper-2)',
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        transition: 'all 0.15s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: 'var(--r-full)',
          background: '#fff',
          border: '1px solid var(--hairline-strong)',
          transition: 'left 0.15s',
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
      style={{ width: size, height: size, ...style }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

// Small status pill — tinted background + tinted text from one tone. Replaces
// the hand-built "Locked" / status chips that were duplicated across panels.
const PILL_TONES: Record<string, [string, string]> = {
  locked: ['--locked-tint', '--locked'],
  accent: ['--accent-tint', '--accent'],
  sage: ['--accent-2-tint', '--accent-2'],
  danger: ['--danger-tint', '--danger'],
  neutral: ['--paper-2', '--ink-2'],
};

export function Pill({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: 'locked' | 'accent' | 'sage' | 'danger' | 'neutral';
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
              color: active ? 'var(--accent)' : 'var(--ink-2)',
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

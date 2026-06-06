import type { CSSProperties, ReactNode } from 'react';

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

export function CornerRegs({
  color = 'currentColor',
  inset = 10,
  size = 12,
}: {
  color?: string;
  inset?: number;
  size?: number;
}) {
  const line = 1;
  const arm = size;
  const mark = (
    pos: { top?: number; left?: number; right?: number; bottom?: number },
    flipX: boolean,
    flipY: boolean,
    key: string,
  ) => (
    <div
      key={key}
      style={{ position: 'absolute', ...pos, width: arm, height: arm, pointerEvents: 'none' }}
    >
      <div
        style={{
          position: 'absolute',
          [flipX ? 'right' : 'left']: 0,
          top: '50%',
          width: arm,
          height: line,
          background: color,
          opacity: 0.4,
        }}
      />
      <div
        style={{
          position: 'absolute',
          [flipY ? 'bottom' : 'top']: 0,
          left: '50%',
          width: line,
          height: arm,
          background: color,
          opacity: 0.4,
        }}
      />
    </div>
  );
  return (
    <>
      {mark({ top: inset, left: inset }, false, false, 'tl')}
      {mark({ top: inset, right: inset }, true, false, 'tr')}
      {mark({ bottom: inset, left: inset }, false, true, 'bl')}
      {mark({ bottom: inset, right: inset }, true, true, 'br')}
    </>
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
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
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
          background: '#fff',
          border: '1px solid var(--hairline-strong)',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}

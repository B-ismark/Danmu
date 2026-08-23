'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

// A small, self-contained HSV color picker styled to the design system — a
// saturation/value square, a hue slider, and a hex field. Replaces the browser's
// native <input type="color"> (whose popup can't be themed) so the picker looks
// like the rest of Danmu. No dependencies.

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  // Keep HSV locally so dragging is smooth and hue survives at s=0 / v=0 (where
  // it's mathematically undefined). Re-sync only when the external hex changes
  // to something our current HSV doesn't already represent.
  const [hsv, setHsv] = useState<[number, number, number]>(() => {
    const rgb = hexToRgb(value) ?? [201, 169, 142];
    return rgbToHsv(...rgb);
  });
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());

  useEffect(() => {
    if (hsvToHex(...hsv).toLowerCase() !== value.toLowerCase()) {
      const rgb = hexToRgb(value);
      if (rgb) setHsv(rgbToHsv(...rgb));
    }
    setHexDraft(value.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const [h, s, v] = hsv;

  function emit(next: [number, number, number]) {
    setHsv(next);
    onChange(hsvToHex(...next));
  }

  // Shared pointer-drag: run the handler on down + every move until release,
  // with pointer capture so a drag off the element keeps tracking.
  function dragHandler(handler: (e: PointerEvent | ReactPointerEvent) => void) {
    return (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      handler(e);
      const move = (ev: PointerEvent) => handler(ev);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  const satRef = useRef<HTMLDivElement>(null);
  const onSat = (e: PointerEvent | ReactPointerEvent) => {
    const r = satRef.current?.getBoundingClientRect();
    if (!r) return;
    emit([h, clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]);
  };

  const hueRef = useRef<HTMLDivElement>(null);
  const onHue = (e: PointerEvent | ReactPointerEvent) => {
    const r = hueRef.current?.getBoundingClientRect();
    if (!r) return;
    emit([clamp((e.clientX - r.left) / r.width, 0, 1) * 360, s, v]);
  };

  // Both tracks were pointer-only, which made recolouring a wall impossible
  // without a mouse. Arrows step 1%, Shift or PageUp/Down steps 10%, Home/End
  // jump to the ends of the axis (WCAG 2.1.1 + the ARIA slider keyboard model).
  // stopPropagation so arrow keys never reach a studio-wide key handler.
  function onSatKey(e: ReactKeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let ns = s;
    let nv = v;
    switch (e.key) {
      case 'ArrowLeft': ns = clamp(s - step, 0, 1); break;
      case 'ArrowRight': ns = clamp(s + step, 0, 1); break;
      case 'ArrowUp': nv = clamp(v + step, 0, 1); break;
      case 'ArrowDown': nv = clamp(v - step, 0, 1); break;
      // The square has two axes, so Page/Home/End take the brightness axis —
      // saturation already has a full-range shortcut via Shift+arrows.
      case 'PageUp': nv = clamp(v + 0.1, 0, 1); break;
      case 'PageDown': nv = clamp(v - 0.1, 0, 1); break;
      case 'Home': nv = 0; break;
      case 'End': nv = 1; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    emit([h, ns, nv]);
  }

  function onHueKey(e: ReactKeyboardEvent) {
    const step = e.shiftKey ? 15 : 1;
    let nh = h;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': nh = clamp(h - step, 0, 360); break;
      case 'ArrowRight': case 'ArrowUp': nh = clamp(h + step, 0, 360); break;
      case 'PageDown': nh = clamp(h - 30, 0, 360); break;
      case 'PageUp': nh = clamp(h + 30, 0, 360); break;
      case 'Home': nh = 0; break;
      case 'End': nh = 360; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    emit([nh, s, v]);
  }

  const satPct = Math.round(s * 100);
  const valPct = Math.round(v * 100);
  const huePct = Math.round(h);

  function commitHex(raw: string) {
    const rgb = hexToRgb(raw);
    if (rgb) {
      const hex = `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
      setHsv(rgbToHsv(...rgb));
      onChange(hex);
    } else {
      setHexDraft(value.toUpperCase()); // revert bad input
    }
  }

  // Literal white + a dark halo, not tokens: the thumb sits on an arbitrary hue,
  // so its ring has to stay legible against *any* colour the user lands on. Same
  // reason the gradients below use raw hex — this is colour space, not styling.
  const thumbRing = '2px solid #fff';
  const thumbShadow = '0 0 0 1px rgba(0,0,0,0.35)';

  return (
    // 220px is what this wants, not what it demands. A bare `width: 220` made
    // the picker the widest fixed thing in the inspector and therefore the floor
    // of the whole right rail — a rail one pixel narrower clipped it silently,
    // since `.rail` has no overflow of its own to put a scrollbar on. As a
    // ceiling it costs nothing at full width and reflows below it.
    <div style={{ width: 'min(220px, 100%)', userSelect: 'none' }}>
      {/* Saturation × value square */}
      <div
        ref={satRef}
        onPointerDown={dragHandler(onSat)}
        onKeyDown={onSatKey}
        tabIndex={0}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={satPct}
        aria-valuetext={`Saturation ${satPct}%, brightness ${valPct}%`}
        style={{
          position: 'relative',
          width: '100%',
          height: 132,
          borderRadius: 'var(--r-2)',
          cursor: 'crosshair',
          touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            width: 14,
            height: 14,
            transform: 'translate(-50%, -50%)',
            borderRadius: 'var(--r-full)',
            border: thumbRing,
            boxShadow: thumbShadow,
            background: hsvToHex(h, s, v),
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        onPointerDown={dragHandler(onHue)}
        onKeyDown={onHueKey}
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={huePct}
        aria-valuetext={`${huePct} degrees`}
        style={{
          position: 'relative',
          width: '100%',
          height: 12,
          marginTop: 12,
          borderRadius: 'var(--r-full)',
          cursor: 'pointer',
          touchAction: 'none',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${(h / 360) * 100}%`,
            top: '50%',
            width: 16,
            height: 16,
            transform: 'translate(-50%, -50%)',
            borderRadius: 'var(--r-full)',
            border: thumbRing,
            boxShadow: thumbShadow,
            background: `hsl(${h} 100% 50%)`,
          }}
        />
      </div>

      {/* Hex field + live preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span
          style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 'var(--r-1)', border: '1px solid var(--hairline-strong)', background: hsvToHex(h, s, v) }}
        />
        <input
          className="field"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          spellCheck={false}
          aria-label="Hex color"
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
        />
      </div>
    </div>
  );
}

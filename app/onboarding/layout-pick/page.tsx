'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { useDimUnit, useRoom, useSettings, type DimUnit } from '@/lib/store';
import { useMediaQuery } from '@/lib/use-media-query';
import { footprintForLayout, type LayoutId } from '@/lib/footprint';
import { polygonArea } from '@/lib/geometry';
import { ROOM_AXES, type RoomAxis } from '@/lib/dimension-ranges';
import { formatArea, formatLength, stepFor, UNIT_OPTIONS } from '@/lib/units';
import {
  axisBounds,
  badAxes,
  drawnDims,
  enteredDims,
  rangeSentence,
  shownText,
  typeInto,
  type SizeEntry,
} from '@/lib/size-entry';
import { Icon } from '@/components/ui/Icon';
import { NumberField, fieldMinWidth } from '@/components/ui/NumberField';
import { Select } from '@/components/ui/Select';
import { FlowStepper } from '@/components/ui/FlowStepper';
import { BackButton, DocShell } from '@/components/ui/DocShell';
import { ROOM_PRESETS as PRESETS, createPresetRoom, typicalOf } from '@/lib/room-presets';


// The drawing and the area label are both DERIVED from footprintForLayout — the
// same function that builds the room. Hand-authored versions of each had drifted:
//
//   · The T-Shape path drew a plus/cross (arms both sides, narrowed top bar)
//     while the footprint is a full-width north bar with one south stem. The
//     shape you recognised was not the shape you got.
//   · Every `area` string was the bounding box, so the presets that cut a
//     quadrant or a notch overstated their floor — L by 21%, U by 28%, T by 45%.
//     The figure is also inside each option's aria-label, so it was the number a
//     screen-reader user chose on. On a product whose promise is trustworthy
//     dimensions, a stale hand-typed area is the wrong thing to be wrong about.
//   · The preview's dimension line was the third: a fixed 200-unit stroke labelled
//     `width × 1000 mm`, so it spanned the viewBox rather than the room and spoke
//     millimetres to someone who had chosen feet. Now that the size can be typed,
//     a square room would have carried a line twice its own width. It is measured
//     off the same box the path is drawn in, and written in the user's unit.
//
// All of it is computed per render rather than once per preset, because the size
// is no longer the preset's: a typed room draws every outline at the typed size.
const VIEW = { w: 240, h: 180, pad: 20 };

/** Footprint polygon → SVG path in the fixed 240×180 viewBox, preserving aspect,
 *  plus the box it was drawn in (for the dimension lines) and its real floor area. */
function planFor(layout: LayoutId, w: number, d: number) {
  const poly = footprintForLayout(layout, w, d);
  const innerW = VIEW.w - VIEW.pad * 2;
  const innerH = VIEW.h - VIEW.pad * 2;
  const scale = Math.min(innerW / w, innerH / d);
  const box = { x: (VIEW.w - w * scale) / 2, y: (VIEW.h - d * scale) / 2, w: w * scale, h: d * scale };
  const path =
    poly
      .map(([x, z], i) => {
        const px = box.x + (x + w / 2) * scale;
        const pz = box.y + (z + d / 2) * scale;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${pz.toFixed(1)}`;
      })
      .join(' ') + ' Z';
  return { path, box, area: polygonArea(poly) };
}

/** The preview at screen scale: how many drawing units one CSS pixel is, and the
 *  caption step in pixels, read off the page rather than copied from it.
 *
 *  The drawing is a fixed 240×180 viewBox stretched to its card, so anything
 *  authored in the drawing's own units grows with the card — a label at 8 units read
 *  9px on a phone and 22px across a tablet, and a hairline went from one pixel to
 *  three. Figures a person reads belong to the interface's type scale, not the
 *  plan's. Null until measured: the labels wait one frame rather than guess a size,
 *  and the SVG's own `aria-label` carries the same numbers in the meantime. */
function useScreenScale(ref: RefObject<SVGSVGElement | null>): ScreenScale | null {
  const [scale, setScale] = useState<ScreenScale | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const caption = Number.parseFloat(getComputedStyle(el).getPropertyValue('--fs-caption'));
      if (r.width <= 0 || r.height <= 0 || !Number.isFinite(caption)) return;
      // `meet`: the viewBox is fitted by whichever side runs out first.
      const unit = Math.max(VIEW.w / r.width, VIEW.h / r.height);
      setScale((s) => (s && s.unit === unit && s.caption === caption ? s : { unit, caption }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

type ScreenScale = { unit: number; caption: number };

export default function LayoutPickPage() {
  const router = useRouter();
  // The double-click shortcut is offered to a mouse or trackpad only: a finger's
  // double tap is a zoom, or nothing, and the copy follows the pointer.
  const touch = useMediaQuery('(pointer: coarse)');
  const setRoomId = useRoom((s) => s.setRoomId);
  const dimUnit = useDimUnit();
  const setDimUnit = useSettings((s) => s.setDimUnit);
  const [sel, setSel] = useState<(typeof PRESETS)[number]['id']>('rect');
  const [saving, setSaving] = useState<null | 'model' | 'capture'>(null);
  const [error, setError] = useState<string | null>(null);
  // Arriving from the Rooms page's "Photograph your room" (`?then=photos`): the
  // same two ways on, with the photo one leading. Read from the address after
  // mount rather than through `useSearchParams`, which would make the whole page
  // wait on a Suspense boundary for one boolean.
  const [photoFirst, setPhotoFirst] = useState(false);
  useEffect(() => {
    setPhotoFirst(new URLSearchParams(window.location.search).get('then') === 'photos');
  }, []);
  // Roving tabindex needs the DOM nodes: arrow keys move focus, not just state.
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The size, as `lib/size-entry.ts` describes it: `null` until the user types,
  // and then theirs whichever outline they try on.
  const [entry, setEntry] = useState<SizeEntry | null>(null);
  // A field that is not a size yet is ordinary mid-typing, so it is only called
  // out once the user has LEFT it, or pressed a button that needs it. Red under a
  // box you are still typing in is a scold, not a help.
  const [left, setLeft] = useState<ReadonlySet<RoomAxis>>(() => new Set());
  const [tried, setTried] = useState(false);
  const sizeRef = useRef<HTMLDivElement>(null);
  const planRef = useRef<SVGSVGElement>(null);
  const screen = useScreenScale(planRef);

  const preset = PRESETS.find((p) => p.id === sel)!;
  const text = shownText(entry, typicalOf(preset), dimUnit);
  // Nothing typed is never wrong: the fields hold the shape's own typical size.
  const bad = entry ? badAxes(text, dimUnit) : [];
  const flagged = bad.filter((a) => tried || left.has(a));

  const layouts = PRESETS.map((p) => {
    const size = drawnDims(entry, typicalOf(p));
    const plan = planFor(p.id, size.width, size.depth);
    return { ...p, size, ...plan, areaText: formatArea(plan.area, dimUnit) };
  });
  const layout = layouts.find((l) => l.id === sel)!;
  const wText = formatLength(layout.size.width * 1000, dimUnit);
  const dText = formatLength(layout.size.depth * 1000, dimUnit);

  function resetSize() {
    setEntry(null);
    setLeft(new Set());
    setTried(false);
  }

  // One save path for both CTAs and the double-click — no duplicated persistence
  // logic to drift. The shape is passed rather than read from `sel`, so a
  // double-click starts the shape it landed on.
  async function createRoom(dest: 'model' | 'capture', shapeId: (typeof PRESETS)[number]['id'] = sel) {
    if (saving) return;
    const shape = PRESETS.find((p) => p.id === shapeId)!;
    // Refused, not repaired: a size outside the room range is named with its range
    // and the room is not made. Saving the two good sides of a half-typed room, or
    // clamping a typed 80 m to 50, would build a room nobody described.
    const dims = entry ? enteredDims(entry, dimUnit) : typicalOf(shape);
    if (!dims) {
      setTried(true);
      const inputs = sizeRef.current?.querySelectorAll('input');
      inputs?.[ROOM_AXES.indexOf(bad[0])]?.focus();
      return;
    }
    setSaving(dest);
    setError(null);
    let id: string;
    try {
      // Untouched boxes are the shape's size, not theirs, and the studio says so
      // until they set one — which is what passing no size means.
      id = await createPresetRoom(shapeId, entry ? dims : undefined);
    } catch {
      // Storage can genuinely refuse (private windows, full disk). Say so and
      // hand the button back rather than sitting in "Creating…" forever.
      setSaving(null);
      setError("This browser wouldn't save the room. Free up some space, or try a normal (non-private) window.");
      return;
    }
    setRoomId(id);
    router.push(dest === 'model' ? `/room/${id}/model` : '/onboarding/capture');
  }

  // A radiogroup promises arrow-key navigation; without this it only had Tab.
  function onOptionKeyDown(e: React.KeyboardEvent, i: number) {
    const last = PRESETS.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    setSel(PRESETS[next].id);
    optionRefs.current[next]?.focus();
  }

  const decorateButton = (
    <button
      onClick={() => createRoom('model')}
      disabled={saving !== null}
      className={`ds-btn ds-btn--lg ds-btn--block-compact${photoFirst ? '' : ' ds-btn--accent'}`}
    >
      {/* Named for the detour it skips when the page arrived for photos, so the
          second button does not read as a second way to do the same thing. */}
      {saving === 'model' ? 'Creating your room…' : photoFirst ? 'Skip photos and start decorating' : (<>Start decorating<Icon name="arrow-right" size={14} color="var(--on-accent)" /></>)}
    </button>
  );
  const photoButton = (
    <button
      onClick={() => createRoom('capture')}
      disabled={saving !== null}
      className={`ds-btn ds-btn--lg ds-btn--block-compact${photoFirst ? ' ds-btn--accent' : ''}`}
    >
      <Icon name="camera" size={14} color={photoFirst ? 'var(--on-accent)' : undefined} />
      {saving === 'capture' ? 'Creating your room…' : photoFirst ? 'Continue to photos' : 'Photograph my real room first'}
    </button>
  );

  return (
    <DocShell
      variant="hero"
      trail={[{ label: 'Rooms', href: '/' }, { label: 'New room' }]}
      // Kept as history, not folded into the breadcrumb: arriving here from the
      // rooms page and arriving from the capture screen's "pick a shape first"
      // card are different journeys, and Back is the only control that honours
      // both. The breadcrumb offers the fixed destination alongside it. No step
      // counter beside it: the primary CTA here goes straight to the studio, so
      // "02 / 04" was promising a sequence most people never walk.
      back={<BackButton onBack={() => router.back()} />}
    >
      {/* No `page-pad` here: DocShell's hero variant already applies it AND
          already centres its measured column. */}
      {photoFirst && <FlowStepper current="Shape" />}
      {/* Two columns: the shapes to choose from on the left, and on the right one
          card holding everything about the chosen one — its drawing, its size and
          the two ways on — so the buttons sit beside the choice they act on rather
          than under the fold. Stacks to one column on a narrow window. */}
      <div className="pick">
        <div className="pick__main">
          <h1 className="pick__title">Which footprint is closest to your room?</h1>
          <p className="pick__lede">You can drag the walls to the exact size later.</p>
        <div role="radiogroup" aria-label="Room footprint" className="shape-options">
          {layouts.map((l, i) => {
            const active = sel === l.id;
            return (
              <button
                key={l.id}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                role="radio"
                aria-checked={active}
                aria-label={`${l.name}, ${l.areaText} of floor, starts as a ${l.starter.toLowerCase()}`}
                // Roving tabindex: one stop for the whole group, arrows move
                // within it — the standard radiogroup keyboard contract.
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => onOptionKeyDown(e, i)}
                onClick={() => setSel(l.id)}
                // The first click of the two has already picked it; this opens it, on
                // whichever route the page is leading with.
                onDoubleClick={() => createRoom(photoFirst ? 'capture' : 'model', l.id)}
                // The shortcut is said where it works, on the card and to a mouse
                // only, rather than in a standing sentence over the whole row.
                title={touch ? undefined : 'Double-click to start with this shape'}
                className="shape-option"
                data-active={active || undefined}
              >
                <span className="shape-option__thumb" aria-hidden="true">
                  <svg viewBox="0 0 240 180">
                    <path
                      d={l.path}
                      fill={active ? 'var(--accent-tint)' : 'var(--paper)'}
                      stroke={active ? 'var(--accent)' : 'var(--ink-2)'}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
                <span className="shape-option__name">{l.name}</span>
                <span className="t-small">{l.starter}</span>
                <span className="shape-option__size">
                  {formatLength(l.size.width * 1000, dimUnit)} × {formatLength(l.size.depth * 1000, dimUnit)} · {l.areaText}
                </span>
              </button>
            );
          })}
        </div>
        </div>

        <section className="pick-side" aria-label={`${layout.name}, the chosen footprint`}>
          <figure>
            <div className="pick-side__plan">
              <svg ref={planRef} viewBox="0 0 240 180" style={{ width: '100%', height: '100%', display: 'block' }} role="img" aria-label={`${layout.name} footprint, ${wText} by ${dText}, ${layout.areaText} of floor`}>
                <path
                  d={layout.path}
                  fill="var(--accent-tint)"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {screen && <PlanDimensions box={layout.box} width={wText} depth={dText} screen={screen} />}
              </svg>
            </div>
            <figcaption className="pick-side__caption">
              <span className="pick-side__name">{layout.name}</span>
              <span className="t-small">
                <span style={{ whiteSpace: 'nowrap' }}>{wText} × {dText}</span> · floor area{' '}
                <span style={{ whiteSpace: 'nowrap' }}>{layout.areaText}</span>
              </span>
            </figcaption>
          </figure>

          <div>
            {/* ROOM SIZE — optional, and it says so before anything else. Most people
                do not know their room's measurements, so the fields arrive filled with
                the shape's typical size and follow the shape until someone types. */}
            <section aria-labelledby="room-size-title">
              <div className="size-entry__head">
                <h2 id="room-size-title" className="size-entry__title">
                  Room size <span className="t-hint">· optional</span>
                </h2>
                {/* The app's one unit setting, not a local one: the studio opens in
                    whatever is chosen here, so the numbers on this screen and the
                    numbers on the next are the same numbers. */}
                <Select
                  value={dimUnit}
                  onChange={(u) => setDimUnit(u as DimUnit)}
                  options={UNIT_OPTIONS.map((u) => ({ value: u.id, label: u.label, short: u.id }))}
                  ariaLabel="Units"
                  title="Applies everywhere in Danmu"
                  width={72}
                />
              </div>
              <div ref={sizeRef} className="fields-row" style={{ ['--field-min' as string]: fieldMinWidth(text) }}>
                {ROOM_AXES.map((axis, i) => {
                  const b = axisBounds(axis, dimUnit);
                  return (
                    <label
                      key={axis}
                      className="size-entry__field"
                      // Left means focus went out of the FIELD, not out of the input.
                      // A chevron press used to move focus to the chevron, and counting
                      // that judged the box live while the person was still working it;
                      // it leaves focus where it was now (`NumberField`), and the check
                      // stays on the label so that holds whatever else joins the field.
                      onBlur={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                        setLeft((s) => (s.has(axis) ? s : new Set(s).add(axis)));
                      }}
                    >
                      <span className="t-note">{AXIS_LABEL[axis]}</span>
                      <NumberField
                        min={b.min}
                        max={b.max}
                        step={stepFor(dimUnit)}
                        value={text[i]}
                        onChange={(v) => setEntry(typeInto(entry, typicalOf(preset), dimUnit, i as 0 | 1 | 2, v))}
                        ariaInvalid={flagged.includes(axis)}
                        ariaLabel={`${AXIS_LABEL[axis]} in ${dimUnit}`}
                        height={40}
                      />
                    </label>
                  );
                })}
              </div>
              {/* Always mounted, so a sentence arriving in it is announced. */}
              <div aria-live="polite" className="size-entry__error">
                {flagged.map((a) => rangeSentence(a, dimUnit)).join(' ')}
              </div>
              <div className="size-entry__foot">
                <p className="t-note">
                  {/* What leaving the boxes alone means, said before anyone asks —
                      the studio marks such a room rough (≈) until a size is given. */}
                  {entry ? 'Wall to wall, at the widest point.' : 'Left as is, the room is marked rough (≈) until you confirm its size.'}
                </p>
                {entry && (
                  <button type="button" onClick={resetSize} className="ds-btn ds-btn--sm ds-btn--ghost size-entry__reset">
                    <Icon name="rotate-ccw" size={13} />
                    Use a typical size
                  </button>
                )}
              </div>
            </section>

            {error && (
              <p
                role="status"
                aria-live="polite"
                style={{
                  margin: '16px 0 0',
                  padding: '10px 12px',
                  borderRadius: 'var(--r-2)',
                  background: 'var(--danger-tint)',
                  color: 'var(--danger-text)',
                  fontSize: 'var(--fs-small)',
                  lineHeight: 1.45,
                }}
              >
                {error}
              </p>
            )}

            {/* The order is the DOM's, not a CSS reversal, so Tab walks them in the
                order they read — and a phone's stacked grid gets the same lead. */}
            <div className="action-row pick-side__actions">
              {photoFirst ? (
                <>
                  {photoButton}
                  {decorateButton}
                </>
              ) : (
                <>
                  {decorateButton}
                  {photoButton}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </DocShell>
  );
}

const AXIS_LABEL: Record<RoomAxis, string> = { width: 'Width', depth: 'Depth', height: 'Height' };

/** A plan's two dimension lines, drawn on the room's own box: the width along the
 *  top, the depth down the right side, each with its figure on a patch of paper so
 *  the line does not run through the digits. Sized in screen pixels (`screen.unit`
 *  drawing units each), so the figures are caption type and the lines one pixel at
 *  every card width. The box sits `VIEW.pad` inside the viewBox, which is the room
 *  a line and half its label need: 10 + 8.25px at a phone's 0.86 units per pixel
 *  is 16 units of the 20. */
function PlanDimensions({ box, width, depth, screen }: { box: { x: number; y: number; w: number; h: number }; width: string; depth: string; screen: ScreenScale }) {
  const px = (n: number) => n * screen.unit;
  const fs = px(screen.caption);
  // Mono digits: Geist Mono's 0.6em advance, as `fieldMinWidth` measures it.
  const patchW = (s: string) => s.length * 0.6 * fs + px(8);
  const patchH = fs + px(5);
  const top = box.y - px(10);
  const side = box.x + box.w + px(10);
  const midX = box.x + box.w / 2;
  const midY = box.y + box.h / 2;
  const tick = px(4);
  return (
    <g fontFamily="var(--font-mono)" fontSize={fs} fill="var(--accent-text)" stroke="var(--accent)" strokeWidth={1}>
      <line x1={box.x} y1={top} x2={box.x + box.w} y2={top} vectorEffect="non-scaling-stroke" />
      <line x1={box.x} y1={top - tick} x2={box.x} y2={top + tick} vectorEffect="non-scaling-stroke" />
      <line x1={box.x + box.w} y1={top - tick} x2={box.x + box.w} y2={top + tick} vectorEffect="non-scaling-stroke" />
      <line x1={side} y1={box.y} x2={side} y2={box.y + box.h} vectorEffect="non-scaling-stroke" />
      <line x1={side - tick} y1={box.y} x2={side + tick} y2={box.y} vectorEffect="non-scaling-stroke" />
      <line x1={side - tick} y1={box.y + box.h} x2={side + tick} y2={box.y + box.h} vectorEffect="non-scaling-stroke" />
      <rect x={midX - patchW(width) / 2} y={top - patchH / 2} width={patchW(width)} height={patchH} fill="var(--paper)" stroke="none" />
      <text x={midX} y={top} textAnchor="middle" dominantBaseline="central" stroke="none">{width}</text>
      <g transform={`rotate(-90 ${side} ${midY})`}>
        <rect x={side - patchW(depth) / 2} y={midY - patchH / 2} width={patchW(depth)} height={patchH} fill="var(--paper)" stroke="none" />
        <text x={side} y={midY} textAnchor="middle" dominantBaseline="central" stroke="none">{depth}</text>
      </g>
    </g>
  );
}


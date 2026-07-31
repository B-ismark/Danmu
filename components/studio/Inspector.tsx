'use client';

import { useEffect, useRef, useState } from 'react';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import { useRoomPart } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { fromMM, toMM, stepFor, precisionFor, formatDim, UNIT_OPTIONS } from '@/lib/units';
import { clampDims, dimRangeFor } from '@/lib/dimension-ranges';
import { Icon } from '@/components/ui/Icon';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Select } from '@/components/ui/Select';
import { NumberField } from '@/components/ui/NumberField';
import { EditableText, IconButton, Pill } from '@/components/ui/primitives';
import { SwapModelModal } from './RegenerateModal';
import { removeParts } from './KeyboardShortcuts';
import { SCENE, defaultBodyColor } from '@/lib/scene-palette';
import { isWallMountedPart, supportsDecor, autoSurfaceDecor, isLightFixture, lightFor, DECOR_KINDS, type LibraryItem, type ScenePart, type DecorItem, type DecorKind, type PartLight } from '@/lib/scene-spec';
import { findSupportUnder, groundY, snapToWall as snapToWallPhys } from '@/lib/physics';
import { wallSegments } from '@/lib/footprint';
import { moveWallCarrying } from '@/lib/wall-actions';

// The right rail is a DECORATING panel, not a properties palette. Order matters:
// colour → finish → decor → where it sits → which model → and only then the
// exact millimetres, folded away behind a disclosure. Selecting a sofa used to
// open on a mono W / D / H triple and a unit dropdown, which reads as CAD; every
// warm verb was below the fold. Nothing was removed, only re-ranked.
export function Inspector() {
  const id = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);
  const part = useRoomPart(id);
  const baseDim = useScene((s) => s.parts.find((p) => p.id === id)?.dimMM);
  // The rotation a swap will LAND on: swapModel calls resetTransforms, so the
  // effective (overridden) rot is about to be discarded and must not be the one
  // the new model's footprint is measured with.
  const baseRot = useScene((s) => s.parts.find((p) => p.id === id)?.rot) ?? 0;
  const hasOverrides = useStudio((s) => !!id && (!!s.positions[id] || !!s.rotations[id] || !!s.dims[id]));
  const setDim = useStudio((s) => s.setDim);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const positions = useStudio((s) => s.positions);
  // Both also feed the support snapshot below — findSupportUnder weighs how much
  // of a piece rests on a surface, so a neighbour's live rotation and size change
  // the answer the same way its position does.
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const updatePart = useScene((s) => s.updatePart);
  const allParts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);

  const [swapOpen, setSwapOpen] = useState(false);

  if (selectedWall !== null) return <WallInspector index={selectedWall} />;

  if (!part || !id)
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
        Click a piece of furniture to recolour, restyle or move it — or click a wall to paint it.
      </div>
    );

  const currentDim = part.dimMM;
  const defaultDim = baseDim ?? part.dimMM;

  function currentXYZ(): [number, number, number] {
    const override = positions[id!];
    if (override) return override;
    return [part!.pos[0], part!.pos[1], part!.pos[2]];
  }

  /** Every part in its CURRENT effective transform, so surface snapping works
   *  against the world the user is looking at rather than the original scene. */
  function partSnapshot() {
    return allParts.map((p) => ({
      id: p.id,
      pos: positions[p.id] ?? p.pos,
      rot: rotations[p.id] ?? p.rot,
      dimMM: dims[p.id] ?? p.dimMM,
      category: p.category,
      wallMounted: p.wallMounted,
    }));
  }

  function groundToFloor() {
    const [x, , z] = currentXYZ();
    setPosition(id!, [x, 0, z]);
  }

  // Hybrid swap — replace this part's model with a library one, keeping its
  // position + colour. Re-grounds Y for the new dims / mount type and clears
  // stale transform overrides (old scale would distort the new base dims).
  // `dimOverride` carries sizes the user named in the "Describe it" tab; both
  // entry points land here so re-grounding only ever happens in one place.
  function swapModel(item: LibraryItem, dimOverride?: [number, number, number]) {
    const dimMM = dimOverride ?? ([...item.dimMM] as [number, number, number]);
    const [x, y, z] = currentXYZ();
    const wallMounted = isWallMountedPart(item.category, item.shape);
    const h = dimMM[2] / 1000;
    let ny = y;
    if (wallMounted) {
      ny = Math.max(h / 2 + 0.02, Math.min(room.height - h / 2 - 0.02, groundY(item.category, item.shape, dimMM, room.height)));
    } else {
      const support = findSupportUnder(partSnapshot(), id!, x, z, dimMM, baseRot);
      ny = support !== null && support > 0.3 ? support : 0;
    }
    resetTransforms(id!); // drop stale rotate/scale overrides
    // Update the name too — leaving it stale is how a swapped-in door kept its
    // old "tall mirror" identity, so hover/tree showed a wrong, conflicting label.
    updatePart(id!, { name: item.label, category: item.category, shape: item.shape, dimMM, wallMounted });
    setPosition(id!, [x, ny, z]);
    setSwapOpen(false);
  }

  function snapToNearestWall() {
    const [x, y, z] = currentXYZ();
    const snapped = snapToWallPhys([x, y, z], part!.dimMM, room.footprint);
    setPosition(id!, [snapped.x, y, snapped.z]);
    if (snapped.rot !== undefined) setRotation(id!, snapped.rot);
  }

  function snapToSurface() {
    const [x, , z] = currentXYZ();
    const support = findSupportUnder(partSnapshot(), id!, x, z, part!.dimMM, part!.rot);
    setPosition(id!, [x, support ?? 0, z]);
  }

  // No confirm — the shared delete path answers with an Undo toast instead of a
  // dialog (see `removeParts` in KeyboardShortcuts).
  function onDelete() {
    removeParts([id!]);
  }

  const isGeneric = part.shape === 'box';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EditableText
            value={part.name}
            label="Furniture name"
            onCommit={(next) => updatePart(id!, { name: next })}
            style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}
            inputStyle={{ fontSize: 16, fontWeight: 500, height: 32 }}
          />
          {part.locked && <Pill tone="locked" style={{ flexShrink: 0 }}>Locked</Pill>}
        </div>

        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, paddingLeft: 4, textTransform: 'capitalize' }}>
          {/* shape ids are hyphenated internally ("chair-armchair") — say it in words */}
          {part.category} · {part.shape.replace(/-/g, ' ')}
        </div>
      </div>

      {/* ── The decorating verbs, first ─────────────────────────────────── */}
      <PaintPicker
        label="Colour"
        value={part.color}
        // Shape AND category: the swatch has to be the exact colour the renderer
        // falls back to, and within one category the shapes do not match (a
        // dining chair is walnut, an office chair is charcoal).
        fallback={defaultBodyColor(part.category, part.shape)}
        fallbackNote="Default for this piece"
        onChange={(c) => updatePart(id!, { color: c })}
        onReset={() => updatePart(id!, { color: undefined })}
      />

      <SurfaceFinish value={part.finish} onChange={(f) => updatePart(id!, { finish: f })} />

      {isLightFixture(part.shape) && (
        <LightControls part={part} onChange={(light) => updatePart(id!, { light })} />
      )}

      {supportsDecor(part.category, part.shape) && (
        <DecorCollection part={part} onChange={(decor) => updatePart(id!, { decor })} />
      )}

      {/* Placement — surfaced as visible buttons (was buried in a ⋯ menu). */}
      <Section label="Where it sits">
        <div style={{ display: 'grid', gridTemplateColumns: part.wallMounted ? '1fr' : 'repeat(3, 1fr)', gap: 6 }}>
          <button onClick={snapToNearestWall} className="ds-btn" title="Move to the nearest wall and face the room" style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
            <Icon name="snap-wall" size={13} /> Wall
          </button>
          {!part.wallMounted && (
            <>
              <button onClick={snapToSurface} className="ds-btn" title="Drop onto the highest surface below — table, shelf, or floor" style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
                <Icon name="snap-surface" size={13} /> Surface
              </button>
              <button onClick={groundToFloor} className="ds-btn" title="Force this part to sit on the floor" style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
                <Icon name="snap-floor" size={13} /> Floor
              </button>
            </>
          )}
        </div>
        {part.wallMounted && (
          <MountHeightRow
            key={`${id}-${currentXYZ()[1]}`}
            bottomMM={(currentXYZ()[1] - part.dimMM[2] / 2000) * 1000}
            maxBottomMM={(room.height - part.dimMM[2] / 1000) * 1000}
            onCommit={(bottomMM) => {
              const [x, , z] = currentXYZ();
              const h = part!.dimMM[2] / 1000;
              const y = Math.max(h / 2 + 0.02, Math.min(room.height - h / 2 - 0.02, bottomMM / 1000 + h / 2));
              setPosition(id!, [x, y, z]);
            }}
          />
        )}
      </Section>

      {/* One entry point to the model library. Generic-box parts (low-confidence
          detections) read poorly, so for those the same button leads with why. */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={() => setSwapOpen(true)}
          className={isGeneric ? 'ds-btn' : 'ds-btn ds-btn--primary'}
          title="Browse the catalog, or describe the piece in words"
          style={{
            width: '100%',
            height: 34,
            fontSize: 12,
            gap: 6,
            justifyContent: 'center',
            ...(isGeneric
              ? { background: 'var(--accent-tint)', borderColor: 'var(--accent-text)', color: 'var(--accent-text)' }
              : null),
          }}
        >
          <Icon name="swap" size={13} />
          {isGeneric ? 'Generic shape — pick a real model' : 'Change the model'}
        </button>
        {hasOverrides && (
          <button
            onClick={() => resetTransforms(id!)}
            className="ds-btn"
            title="Undo the moves, turns and resizes you made to this piece"
            style={{ width: '100%', height: 30, gap: 6, justifyContent: 'center', fontSize: 11 }}
          >
            <Icon name="refresh" size={12} /> Back to where it started
          </button>
        )}
      </div>

      {/* Precise millimetres last, folded away — and the plain-language size tier
          stays on screen either way, because that clamp is the app's promise that
          nothing can end up a fantasy size. */}
      <DimensionEditor partId={id} category={part.category} shape={part.shape} value={currentDim} defaultDim={defaultDim} onChange={(d) => setDim(id, d)} />

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px', background: 'var(--paper-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={onDelete}
          className="ds-btn"
          style={{
            width: '100%',
            height: 32,
            fontSize: 12,
            justifyContent: 'center',
            color: 'var(--danger)',
            borderColor: 'var(--danger)',
          }}
        >
          <Icon name="trash" size={12} />
          Delete from scene
        </button>
      </div>

      {swapOpen && (
        <SwapModelModal part={part} onClose={() => setSwapOpen(false)} onSwap={swapModel} />
      )}
    </div>
  );
}

// Surface finish — the material *sheen* (roughness/metalness), distinct from
// colour. Applied to the part's meshes by Draggable's FinishApplier. 'auto'
// keeps each shape's hand-tuned default.
const SURFACE_FINISHES: Array<{ id: NonNullable<ScenePart['finish']>; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'matte', label: 'Matte' },
  { id: 'satin', label: 'Satin' },
  { id: 'polished', label: 'Polished' },
  { id: 'metal', label: 'Metal' },
];

function SurfaceFinish({
  value,
  onChange,
}: {
  value?: ScenePart['finish'];
  onChange: (f: ScenePart['finish']) => void;
}) {
  const active = value ?? 'auto';
  return (
    <Section label="Finish">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SURFACE_FINISHES.map((f) => {
          const on = active === f.id;
          return (
            <button
              key={f.id}
              onClick={() => onChange(f.id)}
              aria-pressed={on}
              className={`ds-chip ${on ? 'ds-chip--accent' : ''}`}
              style={{ cursor: 'pointer', height: 28, fontWeight: 600, background: on ? 'var(--accent-tint)' : 'var(--paper)' }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// What a fixture emits, in the units printed on the box it came in. Shown only
// for lamps (isLightFixture), because everything else emits nothing.
//
// Real units are the point: 800 lm really is twice 400 lm in the scene, and 2700 K
// really is a warm bulb. The alternative — an abstract 0-to-1 "brightness" — would
// have made this another slider to fiddle with rather than a decision about a
// lamp you could go and buy.
const WARMTHS: Array<{ k: number; label: string }> = [
  { k: 2200, label: 'Candle' },
  { k: 2700, label: 'Warm' },
  { k: 4000, label: 'Neutral' },
  { k: 6500, label: 'Daylight' },
];

function LightControls({
  part,
  onChange,
}: {
  part: ScenePart;
  onChange: (light: PartLight) => void;
}) {
  const spec = lightFor(part);
  if (!spec) return null;
  const set = (patch: Partial<PartLight>) => onChange({ ...spec, ...patch });
  return (
    <Section label="Light">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label htmlFor={`lm-${part.id}`} style={{ fontSize: 12, color: 'var(--ink-2)', minWidth: 66 }}>
          Brightness
        </label>
        <NumberField
          value={String(spec.lumens)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) set({ lumens: n });
          }}
          step={50}
          min={0}
          max={5000}
          height={30}
          ariaLabel="Brightness in lumens"
          style={{ width: 104 }}
        />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>lm</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {WARMTHS.map((w) => {
          const on = spec.kelvin === w.k;
          return (
            <button
              key={w.k}
              onClick={() => set({ kelvin: w.k })}
              aria-pressed={on}
              className={`ds-chip ${on ? 'ds-chip--accent' : ''}`}
              style={{ cursor: 'pointer', height: 28, fontWeight: 600, background: on ? 'var(--accent-tint)' : 'var(--paper)' }}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
        A typical bulb is 400–800 lm. Switch the room to Evening to see what this
        one actually does.
      </p>
    </Section>
  );
}

// Editable decor collection on a part's surface. Starts from the suggested
// arrangement; the user can add props, remove them, clear, or reset to auto.
const DECOR_LABEL: Record<DecorKind, string> = {
  books: 'Books', vase: 'Vase', plant: 'Plant', bowl: 'Bowl', candle: 'Candle',
};
function DecorCollection({ part, onChange }: { part: ScenePart; onChange: (decor: DecorItem[] | undefined) => void }) {
  const isAuto = part.decor === undefined;
  const items = part.decor ?? autoSurfaceDecor(part.category, part.shape, part.dimMM, part.id);
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;

  function add(kind: DecorKind) {
    const next: DecorItem = {
      id: `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      kind,
      x: (Math.random() - 0.5) * w * 0.66,
      z: (Math.random() - 0.5) * d * 0.55,
    };
    onChange([...items, next]); // materialises the suggested set, then appends
  }

  return (
    <Section label="On the surface">
      {isAuto && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Showing suggested props. Add or remove to make it your own.
        </div>
      )}
      {items.length === 0 && !isAuto && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Bare surface. Add something below, or go back to the suggestion.
        </div>
      )}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {items.map((it) => (
            <div key={it.id} className="list-row" style={{ cursor: 'default', padding: '5px 8px', background: 'var(--paper-2)' }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{DECOR_LABEL[it.kind]}</span>
              <IconButton
                icon="x"
                label={`Remove ${DECOR_LABEL[it.kind].toLowerCase()}`}
                onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                size={24}
                iconSize={12}
              />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {DECOR_KINDS.map((k) => (
          <button key={k} onClick={() => add(k)} className="ds-chip" style={{ cursor: 'pointer', height: 28, fontWeight: 600 }}>
            <Icon name="plus" size={11} /> {DECOR_LABEL[k]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => onChange([])} className="ds-btn" style={{ flex: 1, height: 28, fontSize: 11, justifyContent: 'center' }}>
          Clear
        </button>
        {!isAuto && (
          <button onClick={() => onChange(undefined)} className="ds-btn" style={{ flex: 1, height: 28, fontSize: 11, justifyContent: 'center' }}>
            <Icon name="refresh" size={10} /> Suggested
          </button>
        )}
      </div>
    </Section>
  );
}

// Compass label for a wall from its inward normal (wallSegments yaw encodes it).
// Falls back to "Wall n" for the extra edges of L / T / U footprints.
function wallName(yaw: number, index: number, edgeCount: number): string {
  if (edgeCount !== 4) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'North wall' : 'South wall';
  return inX > 0 ? 'West wall' : 'East wall';
}

// Wall editor — shown when a wall is selected instead of a part. Paint one wall
// or all walls, reset, and nudge the wall in/out (drag in the 3D / plan views is
// the primary move affordance; these buttons are the precise fallback).
function WallInspector({ index }: { index: number }) {
  const room = useScene((s) => s.room);
  const setWallColor = useScene((s) => s.setWallColor);
  const setAllWallColors = useScene((s) => s.setAllWallColors);
  const resetWallColor = useScene((s) => s.resetWallColor);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);

  const segs = wallSegments(room.footprint);
  const seg = segs[index];
  const name = seg ? wallName(seg.yaw, index, room.footprint.length) : `Wall ${index + 1}`;
  const painted = room.wallColors?.[index] !== undefined;
  const current = room.wallColors?.[index] ?? SCENE.wall;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
          {seg ? (
            <>
              <span className="mono">{seg.len.toFixed(2)} m</span> wide ·{' '}
              <span className="mono">{room.height.toFixed(2)} m</span> tall
            </>
          ) : null}
        </div>
      </div>

      <PaintPicker
        label="Wall colour"
        value={room.wallColors?.[index]}
        fallback={SCENE.wall}
        fallbackNote="Default shell colour"
        onChange={(hex) => setWallColor(index, hex)}
        onReset={() => resetWallColor(index)}
        footer={
          <button
            onClick={() => setAllWallColors(current)}
            className="ds-btn"
            title={painted ? 'Paint every wall this colour' : 'Paint every wall the default colour'}
            style={{ width: '100%', height: 32, fontSize: 12, justifyContent: 'center', gap: 6, marginTop: 10 }}
          >
            <Icon name="layers" size={13} /> Use this colour on every wall
          </button>
        }
      />

      {/* Move */}
      <Section label="Move wall">
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Drag the handle on the wall in the 3D or plan view — or nudge it here.
          Only this wall moves, and anything mounted on it or standing against it
          comes along.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => moveWallCarrying(index, 0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={12} /> Out 10 cm
          </button>
          <button onClick={() => moveWallCarrying(index, -0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
            <Icon name="minus" size={12} /> In 10 cm
          </button>
        </div>
      </Section>

      <div style={{ flex: 1 }} />

      <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 16px', background: 'var(--paper-2)' }}>
        <button onClick={() => setSelectedWall(null)} className="ds-btn" style={{ width: '100%', height: 32, fontSize: 12, justifyContent: 'center', gap: 6 }}>
          <Icon name="x" size={12} /> Done
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="section section--flush">
      <span className="section-title" style={{ marginBottom: 8, display: 'block' }}>{label}</span>
      {children}
    </div>
  );
}

function DimensionEditor({
  partId,
  category,
  shape,
  value,
  onChange,
  defaultDim,
}: {
  partId: string;
  category: ScenePart['category'];
  shape: ScenePart['shape'];
  value: [number, number, number];
  onChange: (d: [number, number, number]) => void;
  defaultDim: [number, number, number];
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const setDimUnit = useSettings((s) => s.setDimUnit);
  const prec = precisionFor(dimUnit);
  const step = stepFor(dimUnit);
  const range = dimRangeFor(category, shape);
  // Collapsed by default — same disclosure the room shell uses. Typing exact
  // millimetres is the rare path; dragging and recolouring are the common ones.
  const [open, setOpen] = useState(false);

  // Destructured so the resync effect can depend on the three numbers rather
  // than the tuple identity — the parent rebuilds `value` every render.
  const [valW, valD, valH] = value;

  const [local, setLocal] = useState<[string, string, string]>(() => [
    fromMM(valW, dimUnit).toFixed(prec),
    fromMM(valD, dimUnit).toFixed(prec),
    fromMM(valH, dimUnit).toFixed(prec),
  ]);

  useEffect(() => {
    setLocal([
      fromMM(valW, dimUnit).toFixed(prec),
      fromMM(valD, dimUnit).toFixed(prec),
      fromMM(valH, dimUnit).toFixed(prec),
    ]);
  }, [partId, valW, valD, valH, dimUnit, prec]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commitDebounced(idx: 0 | 1 | 2, raw: string) {
    const next = [...local] as [string, string, string];
    next[idx] = raw;
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const mm = next.map((s) => toMM(parseFloat(s), dimUnit));
      if (mm.some((n) => Number.isNaN(n) || n <= 0)) return;
      // Clamp into the shape's trustable real-world range — same gate the scale
      // gizmo and every other size path go through.
      onChange(clampDims(category, shape, [mm[0], mm[1], mm[2]]));
    }, 120);
  }

  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];
  // The tier, in plain language: this is the promise that a size can't go silly.
  const tier =
    range.flex === 'fixed' ? 'Standard product size' : range.flex === 'standard' ? 'Typical size range' : 'Made to measure';

  return (
    <div className="section" style={{ background: 'var(--paper)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <Icon name="chevron-right" size={14} />
        </span>
        <span className="section-title" style={{ color: 'var(--ink)' }}>Exact size</span>
        {!open && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', marginLeft: 'auto' }}>
            {local.join(' × ')} {dimUnit}
          </span>
        )}
      </button>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, paddingLeft: 22 }}>{tier}</div>

      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
            {labels.map((axis, i) => (
              <label key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>{axis}</span>
                {/* .field owns the border + focus ring; mono is here only because
                    these are measurements. The stepper is ours — the native one
                    is suppressed app-wide (see globals.css). */}
                <NumberField
                  min={0.001}
                  step={step}
                  value={local[i]}
                  onChange={(v) => commitDebounced(i as 0 | 1 | 2, v)}
                  height={34}
                />
              </label>
            ))}
          </div>

          {/* The values every edit is clamped into. */}
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.6 }}>
            Anything you type lands inside{' '}
            <span className="mono">
              {formatDim(range.min[0], dimUnit)}–{formatDim(range.max[0], dimUnit)} wide ·{' '}
              {formatDim(range.min[1], dimUnit)}–{formatDim(range.max[1], dimUnit)} deep ·{' '}
              {formatDim(range.min[2], dimUnit)}–{formatDim(range.max[2], dimUnit)} tall
            </span>{' '}
            ({dimUnit}).
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {/* One display unit for the whole app — Settings owns it, and this is
                the same preference, labelled, where the numbers actually are. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>
              Units
              <Select
                value={dimUnit}
                onChange={(u) => setDimUnit(u as DimUnit)}
                options={UNIT_OPTIONS.map((u) => ({ value: u.id, label: u.label, short: u.id }))}
                ariaLabel="Display units"
                title="Applies everywhere in Danmu"
                width={64}
                height={26}
                fontSize={11}
              />
            </label>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => onChange(defaultDim)}
              className="ds-btn ds-btn--ghost"
              title="Back to the size it came with"
              style={{ height: 26, padding: '0 8px', fontSize: 11, fontWeight: 600, color: 'var(--accent-text)', gap: 4 }}
            >
              <Icon name="refresh" size={11} /> Original size
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Curated palette — named, and grouped so no single decision is 24 options wide.
// The names are what a screen reader announces and what the tooltip shows: "#E8E5DB"
// told nobody anything. 8 columns keeps every target ≥ 32px in a 320px rail.
type Swatch = { hex: string; name: string };
const SWATCH_GROUPS: Array<{ label: string; items: Swatch[] }> = [
  {
    label: 'Neutrals',
    items: [
      { hex: '#E8E5DB', name: 'Chalk' },
      { hex: '#EDE6D6', name: 'Cream' },
      { hex: '#D6C7AE', name: 'Linen' },
      { hex: '#DCE4E2', name: 'Mist' },
      { hex: '#D8C7A8', name: 'Oat' },
      { hex: '#3A3733', name: 'Charcoal' },
      { hex: '#3A3A3A', name: 'Graphite' },
      { hex: '#131311', name: 'Ink' },
    ],
  },
  {
    label: 'Woods & metals',
    items: [
      { hex: '#C9A98E', name: 'Pale oak' },
      { hex: '#C9A87C', name: 'Warm oak' },
      { hex: '#9A6A48', name: 'Teak' },
      { hex: '#6F4A2F', name: 'Walnut' },
      { hex: '#5D3820', name: 'Espresso' },
      { hex: '#A86E5A', name: 'Clay' },
      { hex: '#B08D4F', name: 'Brass' },
      { hex: '#D8C36A', name: 'Ochre' },
    ],
  },
  {
    label: 'Colours',
    items: [
      { hex: '#8FA98C', name: 'Sage' },
      { hex: '#5D8A5D', name: 'Fern' },
      { hex: '#A9C4C0', name: 'Eucalyptus' },
      { hex: '#6E94C8', name: 'Cornflower' },
      { hex: '#4F6D8C', name: 'Denim' },
      { hex: '#3F5670', name: 'Navy' },
      { hex: '#C57B53', name: 'Terracotta' },
      { hex: '#C44A3A', name: 'Paprika' },
    ],
  },
];

const SWATCH_NAME = new Map(
  SWATCH_GROUPS.flatMap((g) => g.items).map((s) => [s.hex.toLowerCase(), s.name] as const),
);

// One paint control, used for furniture AND for walls — the two used to be
// separate 24-swatch grids that could drift apart.
function PaintPicker({
  label,
  value,
  fallback,
  fallbackNote,
  onChange,
  onReset,
  footer,
}: {
  label: string;
  /** the user's chosen colour, or undefined while the default applies */
  value?: string;
  /** colour actually on screen when `value` is unset */
  fallback: string;
  fallbackNote: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = value ?? fallback;
  const named = value ? SWATCH_NAME.get(value.toLowerCase()) : undefined;

  return (
    <div className="section section--flush">
      <div className="section-head">
        <span className="section-title">{label}</span>
        {value && (
          <button
            onClick={onReset}
            className="ds-btn ds-btn--ghost"
            title="Back to the default colour"
            style={{ height: 24, padding: '0 8px', fontSize: 11, fontWeight: 600, color: 'var(--accent-text)', gap: 4 }}
          >
            <Icon name="refresh" size={11} /> Default
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, position: 'relative' }}>
        {/* Brand-styled picker (replaces the unthemeable native <input type=color>). */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Mix a custom colour"
          aria-expanded={open}
          title="Mix a custom colour"
          className="swatch"
          style={{ width: 34, height: 34, flexShrink: 0, background: current, aspectRatio: 'auto' }}
        />
        <span style={{ fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink-3)', minWidth: 0 }}>
          {value ? (
            named ?? <span className="mono" style={{ letterSpacing: '0.04em' }}>{value.toUpperCase()}</span>
          ) : (
            fallbackNote
          )}
        </span>
        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-popover)' }} onClick={() => setOpen(false)} />
            <div className="popover" style={{ position: 'absolute', top: 42, left: 0, zIndex: 'var(--z-popover)', padding: 12 }}>
              <ColorPicker value={current} onChange={onChange} />
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {SWATCH_GROUPS.map((g) => (
          <div key={g.label}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4 }}>{g.label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
              {g.items.map((s) => {
                const on = value?.toLowerCase() === s.hex.toLowerCase();
                return (
                  <button
                    key={s.hex}
                    onClick={() => onChange(s.hex)}
                    title={s.name}
                    aria-label={s.name}
                    aria-pressed={on}
                    className={`swatch${on ? ' is-selected' : ''}`}
                    style={{ background: s.hex }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}

// Numeric mount-height editor for wall/ceiling-mounted parts — bottom edge
// height off the floor, in the user's display unit. Pairs with the gizmo's
// Y axis (drag preserves whatever height is set here).
function MountHeightRow({
  bottomMM,
  maxBottomMM,
  onCommit,
}: {
  bottomMM: number;
  maxBottomMM: number;
  onCommit: (bottomMM: number) => void;
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [draft, setDraft] = useState(() => formatDim(Math.max(0, bottomMM), dimUnit));
  useEffect(() => {
    setDraft(formatDim(Math.max(0, bottomMM), dimUnit));
  }, [bottomMM, dimUnit]);

  function commit() {
    const v = parseFloat(draft);
    if (!Number.isFinite(v)) return setDraft(formatDim(Math.max(0, bottomMM), dimUnit));
    const mm = Math.max(0, Math.min(maxBottomMM, toMM(v, dimUnit)));
    onCommit(mm);
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1 }}>Height off the floor</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        className="field"
        style={{ width: 72, height: 28, fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}
      />
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{dimUnit}</span>
    </label>
  );
}

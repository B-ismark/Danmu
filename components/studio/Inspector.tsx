'use client';

import { useEffect, useRef, useState } from 'react';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import { useRoomPart } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { fromMM, toMM, stepFor, precisionFor, formatDim, UNIT_OPTIONS } from '@/lib/units';
import { clampDims, dimRangeFor } from '@/lib/dimension-ranges';
import { Icon } from '@/components/ui/Icon';
import { useConfirm } from '@/components/ui/Confirm';
import { RegenerateModal } from './RegenerateModal';
import { LibraryPicker } from './LibraryPicker';
import { isWallMountedPart, supportsDecor, autoSurfaceDecor, DECOR_KINDS, type LibraryItem, type ScenePart, type DecorItem, type DecorKind } from '@/lib/scene-spec';
import { findSupportUnder, groundY, snapToWall as snapToWallPhys } from '@/lib/physics';
import { wallSegments } from '@/lib/footprint';

export function Inspector() {
  const id = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);
  const part = useRoomPart(id);
  const baseDim = useScene((s) => s.parts.find((p) => p.id === id)?.dimMM);
  const hasOverrides = useStudio((s) => !!id && (!!s.positions[id] || !!s.rotations[id] || !!s.dims[id]));
  const setDim = useStudio((s) => s.setDim);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const positions = useStudio((s) => s.positions);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const updatePart = useScene((s) => s.updatePart);
  const deletePart = useScene((s) => s.deletePart);
  const allParts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const setSelected = useStudio((s) => s.setSelected);
  const confirm = useConfirm();

  const [regenOpen, setRegenOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');

  if (selectedWall !== null) return <WallInspector index={selectedWall} />;

  if (!part || !id)
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
        Click a part or a wall to edit it.
      </div>
    );

  const currentDim = part.dimMM;
  const defaultDim = baseDim ?? part.dimMM;

  function commitLabel() {
    const t = labelDraft.trim();
    if (t && t !== part!.name) updatePart(id!, { name: t });
    setEditingLabel(false);
  }

  function currentXYZ(): [number, number, number] {
    const override = positions[id!];
    if (override) return override;
    return [part!.pos[0], part!.pos[1], part!.pos[2]];
  }

  function groundToFloor() {
    const [x, , z] = currentXYZ();
    setPosition(id!, [x, 0, z]);
  }

  // Hybrid swap — replace this part's model with a library one, keeping its
  // position + colour. Re-grounds Y for the new dims / mount type and clears
  // stale transform overrides (old scale would distort the new base dims).
  function swapModel(item: LibraryItem) {
    const [x, y, z] = currentXYZ();
    const wallMounted = isWallMountedPart(item.category, item.shape);
    const h = item.dimMM[2] / 1000;
    let ny = y;
    if (wallMounted) {
      ny = Math.max(h / 2 + 0.02, Math.min(room.height - h / 2 - 0.02, groundY(item.category, item.shape, item.dimMM, room.height)));
    } else {
      const snapshot = allParts.map((p) => ({
        id: p.id,
        pos: positions[p.id] ?? p.pos,
        dimMM: p.dimMM,
        category: p.category,
        wallMounted: p.wallMounted,
      }));
      const support = findSupportUnder(snapshot, id!, x, z, item.dimMM);
      ny = support !== null && support > 0.3 ? support : 0;
    }
    resetTransforms(id!); // drop stale rotate/scale overrides
    // Update the name too — leaving it stale is how a swapped-in door kept its
    // old "tall mirror" identity, so hover/tree showed a wrong, conflicting label.
    updatePart(id!, { name: item.label, category: item.category, shape: item.shape, dimMM: item.dimMM, wallMounted });
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
    // Build a snapshot of parts in their CURRENT effective positions so we snap
    // against the latest user-edited world, not the original detection scene.
    const snapshot = allParts.map((p) => ({
      id: p.id,
      pos: positions[p.id] ?? p.pos,
      dimMM: p.dimMM,
      category: p.category,
      wallMounted: p.wallMounted,
    }));
    const support = findSupportUnder(snapshot, id!, x, z, part!.dimMM);
    setPosition(id!, [x, support ?? 0, z]);
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Delete "${part!.name}"?`,
      body: 'Removes it from the scene. You can add it back later.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    deletePart(id!);
    setSelected(null);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="ds-label" style={{ color: 'var(--accent)' }}>INSPECTOR</span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              color: part.locked ? 'var(--locked)' : 'var(--accent)',
              letterSpacing: '0.08em',
              padding: '2px 6px',
              border: `1px solid ${part.locked ? 'var(--locked)' : 'var(--accent)'}`,
            }}
          >
            {part.locked ? 'LOCKED' : 'NEW BUILD'}
          </span>
        </div>

        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              else if (e.key === 'Escape') setEditingLabel(false);
            }}
            style={{
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              padding: '4px 6px',
              border: '1px solid var(--accent)',
              borderRadius: 2,
              outline: 'none',
              width: '100%',
              fontFamily: 'var(--font-sans)',
              background: 'var(--paper)',
              color: 'var(--ink)',
            }}
          />
        ) : (
          <div
            onClick={() => {
              setLabelDraft(part.name);
              setEditingLabel(true);
            }}
            title="Click to rename"
            style={{
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              padding: '4px 6px',
              cursor: 'text',
              borderRadius: 2,
            }}
          >
            {part.name}
          </div>
        )}

        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', marginTop: 2, paddingLeft: 6 }}>
          {part.category.toUpperCase()} · {part.shape.toUpperCase()}
        </div>
      </div>

      <DimensionEditor partId={id} category={part.category} shape={part.shape} value={currentDim} defaultDim={defaultDim} onChange={(d) => setDim(id, d)} />

      <ColorEditor
        value={part.color}
        onChange={(c) => updatePart(id!, { color: c })}
        onReset={() => updatePart(id!, { color: undefined })}
      />

      <SurfaceFinish value={part.finish} onChange={(f) => updatePart(id!, { finish: f })} />

      {supportsDecor(part.category, part.shape) && (
        <DecorCollection part={part} onChange={(decor) => updatePart(id!, { decor })} />
      )}

      {/* Placement — surfaced as visible buttons (was buried in a ⋯ menu). */}
      <Section label="Placement">
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

      {/* Generic-box parts (low-confidence detections) read poorly — nudge the
          user to swap in a real library model. */}
      {part.shape === 'box' && (
        <div style={{ padding: '10px 16px 0' }}>
          <button
            onClick={() => setSwapOpen(true)}
            className="ds-btn"
            style={{
              width: '100%',
              height: 32,
              fontSize: 12,
              justifyContent: 'center',
              background: 'var(--accent-tint)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              gap: 6,
            }}
          >
            <Icon name="swap" size={13} /> Generic shape — swap for a library model
          </button>
        </div>
      )}

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setSwapOpen(true)}
            className="ds-btn ds-btn--primary"
            title="Replace with a model from the library — free, instant"
            style={{ flex: 1, height: 34, gap: 6, justifyContent: 'center', fontSize: 12 }}
          >
            <Icon name="swap" size={13} /> Swap model
          </button>
          <button
            onClick={() => setRegenOpen(true)}
            className="ds-btn"
            title="AI re-shapes this model from a description — uses your daily quota"
            style={{ height: 34, padding: '0 12px', justifyContent: 'center', fontSize: 12 }}
          >
            <Icon name="sparkles" size={12} />
            AI refine
          </button>
        </div>
        {hasOverrides && (
          <button
            onClick={() => resetTransforms(id!)}
            className="ds-btn"
            title="Revert move / rotate / scale to detected"
            style={{ width: '100%', height: 30, gap: 6, justifyContent: 'center', fontSize: 11 }}
          >
            <Icon name="refresh" size={12} /> Reset transforms
          </button>
        )}
      </div>

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

      {regenOpen && id && part && (
        <RegenerateModal
          partId={id}
          part={part}
          onClose={() => setRegenOpen(false)}
        />
      )}

      {swapOpen && (
        <div
          onClick={() => setSwapOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(19,19,17,0.55)', display: 'grid', placeItems: 'center', zIndex: 100, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(520px, 92vw)', background: 'var(--paper)', border: '1px solid var(--ink)', boxShadow: '0 30px 80px rgba(0,0,0,0.4)' }}
          >
            <div style={{ height: 4, background: 'var(--accent)' }} />
            <div style={{ padding: '20px 24px' }}>
              <div className="ds-kicker" style={{ marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="swap" size={13} /> Swap model</div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 14px' }}>
                Replace <b>{part.name}</b> with a library model. Keeps its position and colour.
              </p>
              <LibraryPicker onPick={swapModel} />
            </div>
            <div style={{ padding: '14px 24px', background: 'var(--paper-2)', borderTop: '1px solid var(--hairline)', display: 'flex' }}>
              <button onClick={() => setSwapOpen(false)} className="ds-btn" style={{ flex: 1, height: 36, fontSize: 13, justifyContent: 'center' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
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
              className={`ds-chip ${on ? 'ds-chip--accent' : ''}`}
              style={{ cursor: 'pointer', height: 28, fontWeight: 600, border: 0, background: on ? 'var(--accent-tint)' : 'var(--paper)' }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
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
    <Section label="Decor">
      {isAuto && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Showing suggested props. Add or remove to make it your own.
        </div>
      )}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {items.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--paper-2)', borderRadius: 'var(--r-1)' }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{DECOR_LABEL[it.kind]}</span>
              <button
                onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                aria-label={`Remove ${it.kind}`}
                title="Remove"
                style={{ width: 22, height: 22, border: 'none', background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              >
                <Icon name="x" size={12} />
              </button>
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
  const moveWall = useScene((s) => s.moveWall);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);

  const segs = wallSegments(room.footprint);
  const seg = segs[index];
  const name = seg ? wallName(seg.yaw, index, room.footprint.length) : `Wall ${index + 1}`;
  const current = room.wallColors?.[index] ?? '#ECE9E1';
  const painted = room.wallColors?.[index] !== undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="ds-label" style={{ color: 'var(--accent)' }}>WALL</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--accent)', letterSpacing: '0.08em', padding: '2px 6px', border: '1px solid var(--accent)' }}>
            SHELL
          </span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em', padding: '4px 6px' }}>{name}</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', marginTop: 2, paddingLeft: 6 }}>
          {seg ? `${seg.len.toFixed(2)} M WIDE · ${room.height.toFixed(2)} M TALL` : ''}
        </div>
      </div>

      {/* Paint */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="section-title">Wall colour</span>
          {painted && (
            <button
              onClick={() => resetWallColor(index)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em', color: 'var(--accent)', background: 'transparent', border: '1px solid var(--accent)', padding: '2px 6px', cursor: 'pointer' }}
            >
              ↺ DEFAULT
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <label
            title="Pick a custom colour"
            style={{ position: 'relative', width: 34, height: 34, borderRadius: 3, border: '1px solid var(--hairline-strong)', background: current, cursor: 'pointer', flexShrink: 0 }}
          >
            <input
              type="color"
              value={current}
              onChange={(e) => setWallColor(index, e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </label>
          <span className="mono" style={{ fontSize: 12, color: painted ? 'var(--ink)' : 'var(--ink-3)', letterSpacing: '0.04em' }}>
            {painted ? current.toUpperCase() : 'default shell'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              onClick={() => setWallColor(index, hex)}
              title={hex}
              aria-label={hex}
              style={{
                aspectRatio: '1',
                borderRadius: 2,
                background: hex,
                border: current.toLowerCase() === hex.toLowerCase() ? '2px solid var(--accent)' : '1px solid var(--hairline-strong)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
        <button
          onClick={() => setAllWallColors(current)}
          className="ds-btn"
          style={{ width: '100%', height: 32, fontSize: 12, justifyContent: 'center', gap: 6, marginTop: 10 }}
        >
          <Icon name="layers" size={13} /> Apply this colour to all walls
        </button>
      </div>

      {/* Move */}
      <Section label="Move wall">
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Drag the handle on the wall in the 3D or plan view — or nudge it here.
          The room resizes around its centre.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => moveWall(index, 0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={12} /> Out 10 cm
          </button>
          <button onClick={() => moveWall(index, -0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
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

  const [local, setLocal] = useState<[string, string, string]>(() => [
    fromMM(value[0], dimUnit).toFixed(prec),
    fromMM(value[1], dimUnit).toFixed(prec),
    fromMM(value[2], dimUnit).toFixed(prec),
  ]);

  useEffect(() => {
    setLocal([
      fromMM(value[0], dimUnit).toFixed(prec),
      fromMM(value[1], dimUnit).toFixed(prec),
      fromMM(value[2], dimUnit).toFixed(prec),
    ]);
  }, [partId, value[0], value[1], value[2], dimUnit, prec]);

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
      // gizmo and the AI paths go through.
      onChange(clampDims(category, shape, [mm[0], mm[1], mm[2]]));
    }, 120);
  }

  function reset() {
    onChange(defaultDim);
  }

  const labels: ['W', 'D', 'H'] = ['W', 'D', 'H'];

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <span className="section-title" style={{ color: 'var(--ink)' }}>Dimensions</span>
        <select
          value={dimUnit}
          onChange={(e) => setDimUnit(e.target.value as DimUnit)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            padding: '3px 6px',
            border: '1px solid var(--hairline-strong)',
            background: 'var(--paper)',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u.id} value={u.id}>{u.id.toUpperCase()}</option>
          ))}
        </select>
        <button
          onClick={reset}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.06em',
            color: 'var(--accent)',
            background: 'transparent',
            border: '1px solid var(--accent)',
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          ↺ RESET
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {labels.map((axis, i) => (
          <label key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink)', letterSpacing: '0.1em', fontWeight: 600 }}>
              {axis}
            </span>
            <input
              type="number"
              min={0.001}
              step={step}
              value={local[i]}
              onChange={(e) => commitDebounced(i as 0 | 1 | 2, e.target.value)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                fontWeight: 600,
                padding: '8px 10px',
                border: '1.5px solid var(--ink)',
                borderRadius: 2,
                background: 'var(--paper)',
                color: 'var(--ink)',
                outline: 'none',
                width: '100%',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--ink)')}
            />
          </label>
        ))}
      </div>
      {/* Real-world range hint — the values any edit is clamped into. */}
      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.06em', marginTop: 8, lineHeight: 1.6 }}>
        ↳ {dimUnit.toUpperCase()} · live ·{' '}
        {range.flex === 'fixed' ? 'standard product size' : range.flex === 'standard' ? 'typical size range' : 'made-to-measure'}
        <br />
        W {formatDim(range.min[0], dimUnit)}–{formatDim(range.max[0], dimUnit)} · D{' '}
        {formatDim(range.min[1], dimUnit)}–{formatDim(range.max[1], dimUnit)} · H{' '}
        {formatDim(range.min[2], dimUnit)}–{formatDim(range.max[2], dimUnit)}
      </div>
    </div>
  );
}

// Curated swatches — neutrals, woods, upholstery tones + accents. Two rows of
// 12; the warm "finish" tones (oak, walnut, sage, clay, brass…) live here too,
// so Colour is the single place to pick a tone.
const SWATCHES = [
  '#E8E5DB', '#EDE6D6', '#D8C7A8', '#C9A87C', '#C9A98E', '#9A6A48',
  '#6F4A2F', '#5D3820', '#3A3733', '#3A3A3A', '#131311', '#D6C7AE',
  '#8FA98C', '#5D8A5D', '#6E94C8', '#4F6D8C', '#3F5670', '#C57B53',
  '#A86E5A', '#C44A3A', '#B08D4F', '#D8C36A', '#A9C4C0', '#DCE4E2',
];

function ColorEditor({
  value,
  onChange,
  onReset,
}: {
  value?: string;
  onChange: (hex: string) => void;
  onReset: () => void;
}) {
  const current = value ?? '#C9A98E';
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="section-title">Colour</span>
        {value && (
          <button
            onClick={onReset}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
              color: 'var(--accent)',
              background: 'transparent',
              border: '1px solid var(--accent)',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            ↺ DEFAULT
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {/* Native picker + live hex. The label wraps the input so the whole
            swatch is clickable. */}
        <label
          title="Pick a custom colour"
          style={{
            position: 'relative',
            width: 34,
            height: 34,
            borderRadius: 3,
            border: '1px solid var(--hairline-strong)',
            background: current,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
          />
        </label>
        <span className="mono" style={{ fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink-3)', letterSpacing: '0.04em' }}>
          {value ? value.toUpperCase() : 'default · per shape'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
        {SWATCHES.map((hex) => (
          <button
            key={hex}
            onClick={() => onChange(hex)}
            title={hex}
            aria-label={hex}
            style={{
              aspectRatio: '1',
              borderRadius: 2,
              background: hex,
              border: value?.toLowerCase() === hex.toLowerCase() ? '2px solid var(--accent)' : '1px solid var(--hairline-strong)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: 1 }}>Mount height (bottom edge)</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        inputMode="decimal"
        className="ds-input"
        style={{ width: 72, height: 28, fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}
      />
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{dimUnit}</span>
    </div>
  );
}

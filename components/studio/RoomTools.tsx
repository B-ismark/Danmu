'use client';

// Practical room-planning tools, floating over the 3D view:
//   · Room check — deterministic ergonomics audit (door swings, walkways,
//     storage clearance, bed access, TV distance, crowding). Click a finding to
//     select the parts involved.
//   · Furniture list — every piece with its real dimensions in the user's
//     display unit; copy as text or download CSV to take shopping.
//   · Layouts — named arrangement snapshots ("Layout A / B") with mini floor
//     plans, so competing arrangements can be saved and flipped between.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useScene } from '@/lib/scene-store';
import { useStudio, useSettings } from '@/lib/store';
import { analyzeRoom, type ClearanceIssue } from '@/lib/clearance';
import { roomStore, type LayoutVariant, type Transforms } from '@/lib/storage';
import { footprintBounds, type Footprint } from '@/lib/footprint';
import { formatDim } from '@/lib/units';
import { Icon } from '@/components/ui/Icon';
import type { ScenePart } from '@/lib/scene-spec';

export function RoomTools() {
  const [open, setOpen] = useState<'check' | 'list' | 'layouts' | null>(null);

  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const draggingId = useStudio((s) => s.draggingId);

  // Effective scene = base parts + user transform overrides. Recomputed on
  // commit (stores don't change during a live drag), so this stays cheap.
  const effParts = useMemo<ScenePart[]>(
    () =>
      parts.map((p) => ({
        ...p,
        pos: positions[p.id] ?? p.pos,
        rot: rotations[p.id] ?? p.rot,
        dimMM: dims[p.id] ?? p.dimMM,
      })),
    [parts, positions, rotations, dims],
  );

  const report = useMemo(
    () => analyzeRoom(effParts, { footprint: room.footprint, height: room.height }),
    [effParts, room.footprint, room.height],
  );
  const problems = report.issues.filter((i) => i.severity !== 'info').length;

  if (draggingId) return null; // stay out of the way mid-drag

  return (
    <div style={{ position: 'absolute', bottom: 48, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, zIndex: 25 }}>
      {open === 'check' && <CheckPanel issues={report.issues} freeShare={report.freeFloorShare} onClose={() => setOpen(null)} />}
      {open === 'list' && <ListPanel parts={effParts} onClose={() => setOpen(null)} />}
      {open === 'layouts' && <LayoutsPanel effParts={effParts} footprint={room.footprint} onClose={() => setOpen(null)} />}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => setOpen(open === 'check' ? null : 'check')}
          className="ds-btn"
          title="Check walkways, door swings, storage clearance and viewing distances"
          style={{
            height: 30,
            fontSize: 11,
            gap: 6,
            background: 'var(--paper)',
            borderColor: problems > 0 ? 'var(--danger)' : 'var(--hairline-strong)',
            color: problems > 0 ? 'var(--danger)' : 'var(--ink-2)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          }}
        >
          <Icon name="info" size={12} />
          Room check
          <span
            className="mono"
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 8,
              background: problems > 0 ? 'var(--danger)' : 'var(--accent)',
              color: '#fff',
            }}
          >
            {problems > 0 ? problems : '✓'}
          </span>
        </button>
        <button
          onClick={() => setOpen(open === 'list' ? null : 'list')}
          className="ds-btn"
          title="Furniture list with real dimensions — copy or download CSV"
          style={{ height: 30, fontSize: 11, gap: 6, background: 'var(--paper)', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}
        >
          <Icon name="layers" size={12} />
          List
        </button>
        <button
          onClick={() => setOpen(open === 'layouts' ? null : 'layouts')}
          className="ds-btn"
          title="Save this arrangement as a layout and flip between saved layouts"
          style={{ height: 30, fontSize: 11, gap: 6, background: 'var(--paper)', boxShadow: '0 2px 6px rgba(0,0,0,0.06)' }}
        >
          <Icon name="grid" size={12} />
          Layouts
        </button>
      </div>
    </div>
  );
}

const SEV_COLOR: Record<ClearanceIssue['severity'], string> = {
  error: 'var(--danger)',
  warn: '#C07A1B',
  info: 'var(--ink-3)',
};
const SEV_LABEL: Record<ClearanceIssue['severity'], string> = {
  error: 'FIX',
  warn: 'TIGHT',
  info: 'NOTE',
};

function CheckPanel({ issues, freeShare, onClose }: { issues: ClearanceIssue[]; freeShare: number; onClose: () => void }) {
  const setSelection = useStudio((s) => s.setSelection);
  const frameSelected = useStudio((s) => s.frameSelected);

  return (
    <div className="ds-card" style={{ width: 300, maxHeight: 340, overflow: 'auto', padding: 0, boxShadow: '0 12px 36px rgba(0,0,0,0.16)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--hairline)' }}>
        <span className="ds-label" style={{ color: 'var(--accent)' }}>ROOM CHECK</span>
        <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
          <Icon name="x" size={12} />
        </button>
      </div>

      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.05em', padding: '8px 12px', borderBottom: '1px solid var(--hairline)' }}>
        {Math.round(freeShare * 100)}% OF THE FLOOR IS FREE
      </div>

      {issues.length === 0 ? (
        <div style={{ padding: '18px 12px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Everything fits — doors open, walkways are comfortable, and seating distances look right.
        </div>
      ) : (
        issues.map((issue) => (
          <button
            key={issue.id}
            onClick={() => {
              if (issue.partIds.length > 0) {
                setSelection(issue.partIds, issue.partIds[0]);
                frameSelected();
              }
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '10px 12px',
              border: 'none',
              borderBottom: '1px solid var(--hairline)',
              background: 'transparent',
              cursor: issue.partIds.length > 0 ? 'pointer' : 'default',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: '#fff', background: SEV_COLOR[issue.severity], padding: '1px 5px', borderRadius: 2 }}>
                {SEV_LABEL[issue.severity]}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{issue.title}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.45 }}>{issue.detail}</div>
          </button>
        ))
      )}
    </div>
  );
}

function ListPanel({ parts, onClose }: { parts: ScenePart[]; onClose: () => void }) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [copied, setCopied] = useState(false);

  // Group identical pieces (same name + dims) into one line with a count.
  const rows = useMemo(() => {
    const map = new Map<string, { part: ScenePart; count: number }>();
    for (const p of parts) {
      const key = `${p.name}|${p.dimMM.join('x')}|${p.color ?? ''}`;
      const e = map.get(key);
      if (e) e.count += 1;
      else map.set(key, { part: p, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.part.name.localeCompare(b.part.name));
  }, [parts]);

  function asText(): string {
    return rows
      .map(({ part: p, count }) => {
        const dims = `${formatDim(p.dimMM[0], dimUnit)} × ${formatDim(p.dimMM[1], dimUnit)} × ${formatDim(p.dimMM[2], dimUnit)} ${dimUnit} (W×D×H)`;
        return `${count > 1 ? `${count}× ` : ''}${p.name} — ${dims}${p.color ? ` — ${p.color.toUpperCase()}` : ''}`;
      })
      .join('\n');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  function downloadCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [
      ['Qty', 'Name', 'Category', `Width (${dimUnit})`, `Depth (${dimUnit})`, `Height (${dimUnit})`, 'Colour'].join(','),
      ...rows.map(({ part: p, count }) =>
        [
          count,
          esc(p.name),
          p.category,
          formatDim(p.dimMM[0], dimUnit),
          formatDim(p.dimMM[1], dimUnit),
          formatDim(p.dimMM[2], dimUnit),
          p.color ? p.color.toUpperCase() : '',
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'furniture-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ds-card" style={{ width: 320, maxHeight: 360, overflow: 'auto', padding: 0, boxShadow: '0 12px 36px rgba(0,0,0,0.16)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--hairline)', position: 'sticky', top: 0, background: 'var(--paper)' }}>
        <span className="ds-label" style={{ color: 'var(--accent)' }}>FURNITURE LIST</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={copy} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button onClick={downloadCsv} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
            CSV
          </button>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>

      {rows.map(({ part: p, count }, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--hairline)' }}>
          {p.color ? (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: p.color, border: '1px solid var(--hairline-strong)', flexShrink: 0 }} />
          ) : (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--paper-2)', border: '1px dashed var(--hairline-strong)', flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {count > 1 && <span style={{ color: 'var(--accent)' }}>{count}× </span>}
              {p.name}
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
              {formatDim(p.dimMM[0], dimUnit)} × {formatDim(p.dimMM[1], dimUnit)} × {formatDim(p.dimMM[2], dimUnit)} {dimUnit}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Layouts — named arrangement snapshots ─────────────────────────────────

function LayoutsPanel({
  effParts,
  footprint,
  onClose,
}: {
  effParts: ScenePart[];
  footprint: Footprint;
  onClose: () => void;
}) {
  const { roomId } = useParams<{ roomId: string }>();
  const [layouts, setLayouts] = useState<LayoutVariant[]>([]);
  const setParts = useScene((s) => s.setParts);
  const baseParts = useScene((s) => s.parts);
  const loadTransforms = useStudio((s) => s.loadTransforms);

  useEffect(() => {
    if (!roomId) return;
    roomStore.listLayouts(roomId).then(setLayouts);
  }, [roomId]);

  async function saveCurrent() {
    if (!roomId) return;
    const t = useStudio.getState();
    const transforms: Transforms = { positions: t.positions, rotations: t.rotations, dims: t.dims };
    const v: LayoutVariant = {
      id: `l-${Date.now().toString(36)}`,
      name: `Layout ${String.fromCharCode(65 + (layouts.length % 26))}`,
      createdAt: Date.now(),
      parts: baseParts,
      transforms,
    };
    await roomStore.saveLayout(roomId, v);
    setLayouts((prev) => [...prev, v]);
  }

  function apply(v: LayoutVariant) {
    setParts(v.parts as ScenePart[]);
    loadTransforms(v.transforms);
  }

  async function remove(v: LayoutVariant) {
    if (!roomId) return;
    await roomStore.deleteLayout(roomId, v.id);
    setLayouts((prev) => prev.filter((x) => x.id !== v.id));
  }

  return (
    <div className="ds-card" style={{ width: 320, maxHeight: 380, overflow: 'auto', padding: 0, boxShadow: '0 12px 36px rgba(0,0,0,0.16)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--hairline)', position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 1 }}>
        <span className="ds-label" style={{ color: 'var(--accent)' }}>LAYOUTS</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={saveCurrent} className="ds-btn" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
            + Save current
          </button>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>

      {/* Current arrangement, for visual comparison against the saved ones. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--hairline)', background: 'var(--paper-2)' }}>
        <MiniPlan parts={effParts} footprint={footprint} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Current</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{effParts.length} pieces</div>
        </div>
      </div>

      {layouts.length === 0 ? (
        <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          No saved layouts yet. Arrange the room, then <b>Save current</b> — save a second
          arrangement and flip between them to compare.
        </div>
      ) : (
        layouts.map((v) => {
          const vParts = (v.parts as ScenePart[]).map((p) => ({
            ...p,
            pos: v.transforms.positions[p.id] ?? p.pos,
            rot: v.transforms.rotations[p.id] ?? p.rot,
            dimMM: v.transforms.dims[p.id] ?? p.dimMM,
          }));
          return (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--hairline)' }}>
              <MiniPlan parts={vParts} footprint={footprint} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</div>
                <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{new Date(v.createdAt).toLocaleString()}</div>
              </div>
              <button onClick={() => apply(v)} className="ds-btn ds-btn--primary" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>
                Apply
              </button>
              <button onClick={() => remove(v)} aria-label={`Delete ${v.name}`} title="Delete layout" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', padding: 2 }}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

/** Tiny top-down floor plan — footprint outline + furniture rectangles. */
function MiniPlan({ parts, footprint }: { parts: ScenePart[]; footprint: Footprint }) {
  const b = footprintBounds(footprint);
  const W = 84;
  const H = Math.max(36, Math.round((W * b.depth) / Math.max(0.1, b.width)));
  const sx = W / b.width;
  const sy = H / b.depth;
  const s = Math.min(sx, sy);
  const px = (x: number) => (x - b.minX) * s + (W - b.width * s) / 2;
  const pz = (z: number) => (z - b.minZ) * s + (H - b.depth * s) / 2;
  return (
    <svg width={W} height={H} style={{ flexShrink: 0, background: 'var(--paper)', border: '1px solid var(--hairline-strong)', borderRadius: 3 }}>
      <polygon
        points={footprint.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}
        fill="var(--paper-2)"
        stroke="var(--ink-3)"
        strokeWidth={1}
      />
      {parts
        .filter((p) => !p.wallMounted)
        .map((p) => {
          const w = (p.dimMM[0] / 1000) * s;
          const d = (p.dimMM[1] / 1000) * s;
          return (
            <rect
              key={p.id}
              x={px(p.pos[0]) - w / 2}
              y={pz(p.pos[2]) - d / 2}
              width={w}
              height={d}
              transform={`rotate(${(-p.rot * 180) / Math.PI} ${px(p.pos[0])} ${pz(p.pos[2])})`}
              fill={p.color ?? 'var(--accent)'}
              fillOpacity={0.55}
              stroke="var(--ink-2)"
              strokeWidth={0.5}
            />
          );
        })}
    </svg>
  );
}

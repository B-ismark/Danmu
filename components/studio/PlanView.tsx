'use client';

import { useRef, useState, useEffect } from 'react';
import { useStudio } from '@/lib/store';
import { useRoomScene } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { collidesAt } from '@/lib/scene-spec';
import { pointInFootprint } from '@/lib/footprint';

const SCALE = 100; // px per meter at zoom=1
const PAD = 80;

export function PlanView() {
  const ROOM_DYN = useScene((s) => s.room);
  const baseW = ROOM_DYN.width * SCALE + PAD * 2;
  const baseH = ROOM_DYN.depth * SCALE + PAD * 2;
  const parts = useRoomScene();
  const selected = useStudio((s) => s.selectedPartId);
  const setSelected = useStudio((s) => s.setSelected);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setDragging = useStudio((s) => s.setDragging);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'translate' | 'rotate';
    startAngle: number;
    startRot: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [, force] = useState(0);

  // Pan + zoom + rotate
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** view rotation in radians around viewport center */
  const [rot, setRot] = useState(0);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const rotRef = useRef<{ startAngle: number; startRot: number } | null>(null);

  function fit() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRot(0);
  }

  function svgToWorld(e: React.PointerEvent | PointerEvent): { x: number; z: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (baseW / rect.width);
    const py = (e.clientY - rect.top) * (baseH / rect.height);
    // undo view rotation around viewport center
    const cx = baseW / 2;
    const cy = baseH / 2;
    const dx = px - cx;
    const dy = py - cy;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const ux = dx * cos - dy * sin + cx;
    const uy = dx * sin + dy * cos + cy;
    // undo pan + zoom
    const sx = (ux - offset.x) / zoom;
    const sy = (uy - offset.y) / zoom;
    return {
      x: (sx - PAD) / SCALE - ROOM_DYN.width / 2,
      z: (sy - PAD) / SCALE - ROOM_DYN.depth / 2,
    };
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (baseW / rect.width);
    const cy = (e.clientY - rect.top) * (baseH / rect.height);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextZoom = Math.max(0.4, Math.min(4, zoom * factor));
    // zoom toward cursor
    const k = nextZoom / zoom;
    setOffset({ x: cx - (cx - offset.x) * k, y: cy - (cy - offset.y) * k });
    setZoom(nextZoom);
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (dragRef.current) return;
    if (e.target !== svgRef.current) return;
    if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setSelected(null);
    }
    // Alt+drag → rotate view; Middle / right / Shift+left → pan.
    if (e.altKey) {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (baseW / rect.width);
      const cy = (e.clientY - rect.top) * (baseH / rect.height);
      rotRef.current = {
        startAngle: Math.atan2(cy - baseH / 2, cx - baseW / 2),
        startRot: rot,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    const startPan = e.button === 1 || e.button === 2 || e.shiftKey;
    if (!startPan) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerDown(e: React.PointerEvent, id: string, mode: 'translate' | 'rotate') {
    e.stopPropagation();
    setSelected(id);
    setDragging(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    const part = parts.find((p) => p.id === id);
    if (!part) return;

    if (mode === 'rotate') {
      const w = svgToWorld(e);
      const startAngle = Math.atan2(w.z - part.pos[2], w.x - part.pos[0]);
      dragRef.current = { id, mode, startAngle, startRot: part.rot, startX: e.clientX, startY: e.clientY, moved: false };
    } else {
      dragRef.current = { id, mode: 'translate', startAngle: 0, startRot: 0, startX: e.clientX, startY: e.clientY, moved: false };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Rotate-view handling first
    if (rotRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (baseW / rect.width);
      const cy = (e.clientY - rect.top) * (baseH / rect.height);
      const a = Math.atan2(cy - baseH / 2, cx - baseW / 2);
      setRot(rotRef.current.startRot + (a - rotRef.current.startAngle));
      return;
    }
    if (panRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (e.clientX - panRef.current.startX) * (baseW / rect.width);
      const dy = (e.clientY - panRef.current.startY) * (baseH / rect.height);
      setOffset({ x: panRef.current.ox + dx, y: panRef.current.oy + dy });
      return;
    }

    if (!dragRef.current) return;
    if (!dragRef.current.moved) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) dragRef.current.moved = true;
    }
    const { id, mode } = dragRef.current;
    const part = parts.find((p) => p.id === id);
    if (!part) return;
    const w = svgToWorld(e);

    if (mode === 'translate') {
      // Footprint-aware containment (matches the 3D Draggable) so an object's
      // rotated footprint can't cross the wall outline in plan view.
      const halfW = part.dimMM[0] / 2000;
      const halfD = part.dimMM[1] / 2000;
      const c = Math.abs(Math.cos(part.rot));
      const s = Math.abs(Math.sin(part.rot));
      const extX = halfW * c + halfD * s;
      const extZ = halfW * s + halfD * c;
      const x = clamp(w.x, -ROOM_DYN.width / 2 + extX, ROOM_DYN.width / 2 - extX);
      const z = clamp(w.z, -ROOM_DYN.depth / 2 + extZ, ROOM_DYN.depth / 2 - extZ);
      // Keep the centre inside the (possibly non-rectangular) footprint.
      if (!pointInFootprint(x, z, ROOM_DYN.footprint)) return;
      if (collidesAt(parts, id, [x, part.pos[1], z], part.rot, part.dimMM)) return;
      setPosition(id, [x, part.pos[1], z]);
    } else {
      const a = Math.atan2(w.z - part.pos[2], w.x - part.pos[0]);
      const delta = -(a - dragRef.current.startAngle);
      setRotation(id, dragRef.current.startRot + delta);
    }
    force((v) => v + 1);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (rotRef.current) {
      rotRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (panRef.current) {
      panRef.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
    if (dragRef.current) {
      dragRef.current = null;
      setDragging(null);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
  }

  // Keyboard +/- zoom while plan focused
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === '0') fit();
      if (e.key === '=' || e.key === '+') setZoom((z) => Math.min(4, z * 1.15));
      if (e.key === '-' || e.key === '_') setZoom((z) => Math.max(0.4, z / 1.15));
      if (e.key === '[') setRot((r) => r - Math.PI / 12);
      if (e.key === ']') setRot((r) => r + Math.PI / 12);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toLocal = (x: number, z: number) => ({
    x: PAD + (x + ROOM_DYN.width / 2) * SCALE,
    y: PAD + (z + ROOM_DYN.depth / 2) * SCALE,
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${baseW} ${baseH}`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        style={{ width: '100%', height: '100%', maxWidth: 1100, touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'default' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="lockHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#2B6FD4" strokeWidth="0.4" opacity="0.35" />
          </pattern>
        </defs>

        <g transform={`rotate(${(rot * 180) / Math.PI} ${baseW / 2} ${baseH / 2}) translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          <path
            d={
              ROOM_DYN.footprint
                .map((p, i) => {
                  const l = toLocal(p[0], p[1]);
                  return `${i ? 'L' : 'M'}${l.x} ${l.y}`;
                })
                .join(' ') + ' Z'
            }
            fill="rgba(19,19,17,0.03)"
            stroke="var(--ink)"
            strokeWidth="3"
          />

          {/* Wall labels */}
          <WallLabel
            text="N · North"
            x={PAD + (ROOM_DYN.width * SCALE) / 2}
            y={PAD - 32}
            anchor="middle"
          />
          <WallLabel
            text="S · South"
            x={PAD + (ROOM_DYN.width * SCALE) / 2}
            y={PAD + ROOM_DYN.depth * SCALE + 36}
            anchor="middle"
          />
          <WallLabel
            text="W · West"
            x={PAD - 14}
            y={PAD + (ROOM_DYN.depth * SCALE) / 2}
            anchor="end"
            rotate={-90}
          />
          <WallLabel
            text="E · East"
            x={PAD + ROOM_DYN.width * SCALE + 14}
            y={PAD + (ROOM_DYN.depth * SCALE) / 2}
            anchor="start"
            rotate={90}
          />

          {/* Width dimension line */}
          <g fontFamily="var(--font-mono)" fontSize="10" fill="var(--accent)">
            <line x1={PAD} y1={PAD - 18} x2={PAD + ROOM_DYN.width * SCALE} y2={PAD - 18} stroke="var(--accent)" strokeWidth="0.8" />
            <line x1={PAD} y1={PAD - 22} x2={PAD} y2={PAD - 14} stroke="var(--accent)" />
            <line x1={PAD + ROOM_DYN.width * SCALE} y1={PAD - 22} x2={PAD + ROOM_DYN.width * SCALE} y2={PAD - 14} stroke="var(--accent)" />
            <rect x={PAD + ROOM_DYN.width * SCALE / 2 - 24} y={PAD - 26} width="48" height="14" fill="var(--paper)" />
            <text x={PAD + ROOM_DYN.width * SCALE / 2} y={PAD - 16} textAnchor="middle">{(ROOM_DYN.width * 1000).toFixed(0)}</text>
          </g>

          {parts.map((part) => {
            const pos = part.pos;
            const rotY = part.rot;
            const fpW = part.dimMM[0] / 1000;
            const fpD = part.dimMM[1] / 1000;
            const center = toLocal(pos[0], pos[2]);
            const wpx = fpW * SCALE;
            const hpx = fpD * SCALE;
            const color = part.locked ? '#2B6FD4' : '#E2613A';
            const fill = part.locked ? 'rgba(43,111,212,0.14)' : 'rgba(232,84,42,0.10)';
            const isSel = selected === part.id;
            const rotDeg = -(rotY * 180) / Math.PI;
            return (
              <g
                key={part.id}
                transform={`translate(${center.x} ${center.y}) rotate(${rotDeg})`}
                onPointerDown={(e) => onPointerDown(e, part.id, 'translate')}
                style={{ cursor: 'grab' }}
              >
                {part.circle ? (
                  <circle
                    cx={0}
                    cy={0}
                    r={wpx / 2}
                    fill={fill}
                    stroke={color}
                    strokeWidth={isSel ? 2.5 : 1.4}
                    strokeDasharray={part.locked ? undefined : '4 3'}
                  />
                ) : (
                  <>
                    <rect
                      x={-wpx / 2}
                      y={-hpx / 2}
                      width={wpx}
                      height={hpx}
                      fill={fill}
                      stroke={color}
                      strokeWidth={isSel ? 2.5 : 1.4}
                      strokeDasharray={part.locked ? undefined : '4 3'}
                    />
                    {part.locked && <rect x={-wpx / 2} y={-hpx / 2} width={wpx} height={hpx} fill="url(#lockHatch)" />}
                    <line x1={0} y1={-hpx / 2} x2={0} y2={-hpx / 2 - 8} stroke={color} strokeWidth="1.4" />
                  </>
                )}
                {/* Counter-rotate label so it stays upright regardless of part + view rotation */}
                <g transform={`rotate(${-rotDeg - (rot * 180) / Math.PI})`}>
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fontFamily="var(--font-sans)"
                    fontSize="9"
                    fill={color}
                    fontWeight="500"
                    style={{ pointerEvents: 'none' }}
                  >
                    {part.name.split(' ')[0].slice(0, 8)}
                  </text>
                </g>

                {isSel && (
                  <g transform={`translate(0 ${-hpx / 2 - 26})`}>
                    <line x1={0} y1={18} x2={0} y2={hpx / 2 + 26 - 8} stroke={color} strokeWidth="1.2" strokeDasharray="2 2" />
                    <circle
                      cx={0}
                      cy={0}
                      r={9}
                      fill="var(--paper)"
                      stroke={color}
                      strokeWidth={2}
                      onPointerDown={(e) => onPointerDown(e, part.id, 'rotate')}
                      style={{ cursor: 'grab' }}
                    />
                    <path d="M -4 -1 A 4 4 0 1 1 4 -1" fill="none" stroke={color} strokeWidth="1.4" />
                    <polygon points="3,-1 5,-3 3,-3" fill={color} />
                  </g>
                )}
              </g>
            );
          })}

          {/* North compass */}
          <g transform={`translate(${PAD - 30} ${PAD - 30})`}>
            <circle r="14" fill="var(--paper)" stroke="var(--ink)" />
            <path d="M0 -9 L3 0 L0 9 L-3 0 Z" fill="var(--accent)" />
            <text y="-18" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink)" letterSpacing="0.1em" fontWeight="600">N</text>
          </g>
        </g>
      </svg>

      {/* Pan/zoom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          display: 'flex',
          gap: 6,
          background: 'var(--paper)',
          border: '1px solid var(--hairline-strong)',
          padding: 4,
        }}
      >
        <ZoomBtn onClick={() => setZoom((z) => Math.min(4, z * 1.15))} label="+" />
        <ZoomBtn onClick={() => setZoom((z) => Math.max(0.4, z / 1.15))} label="−" />
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
          }}
        >
          {(zoom * 100).toFixed(0)}%
        </span>
        <div style={{ width: 1, background: 'var(--hairline)' }} />
        <ZoomBtn onClick={() => setRot((r) => r - Math.PI / 12)} label="↺" />
        <ZoomBtn onClick={() => setRot((r) => r + Math.PI / 12)} label="↻" />
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-3)',
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
          }}
        >
          {(((rot * 180) / Math.PI) % 360).toFixed(0)}°
        </span>
        <div style={{ width: 1, background: 'var(--hairline)' }} />
        <ZoomBtn onClick={fit} label="Fit" wide />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          background: 'var(--paper)',
          border: '1px solid var(--hairline-strong)',
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--ink-3)',
          display: 'flex',
          gap: 12,
        }}
      >
        <span>Scroll · zoom</span>
        <span style={{ color: 'var(--hairline-strong)' }}>·</span>
        <span>Shift-drag · pan</span>
        <span style={{ color: 'var(--hairline-strong)' }}>·</span>
        <span>Alt-drag · rotate</span>
        <span style={{ color: 'var(--hairline-strong)' }}>·</span>
        <span><span className="mono">[ ]</span> · step</span>
        <span style={{ color: 'var(--hairline-strong)' }}>·</span>
        <span><span className="mono">0</span> · reset</span>
      </div>
    </div>
  );
}

function WallLabel({
  text,
  x,
  y,
  anchor,
  rotate = 0,
}: {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  rotate?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
      fontFamily="var(--font-sans)"
      fontSize="11"
      fill="var(--ink)"
      fontWeight="600"
    >
      {text}
    </text>
  );
}

function ZoomBtn({ onClick, label, wide }: { onClick: () => void; label: string; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: wide ? 44 : 28,
        height: 28,
        background: 'var(--paper)',
        border: '1px solid var(--hairline-strong)',
        cursor: 'pointer',
        fontSize: 11,
        color: 'var(--ink-2)',
      }}
    >
      {label}
    </button>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

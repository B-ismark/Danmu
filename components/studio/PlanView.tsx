'use client';

// The 2D plan. It used to be the 3D view minus features; it now has two things
// the 3D view cannot do:
//
//   · It shades the ergonomic rules from lib/clearance.ts as actual floor
//     regions — the walkway a person needs between bulky pieces, the arc a door
//     sweeps, the strip beside a bed. Those rules previously only existed as a
//     list of complaints in Room check. Here they are geometry you can design
//     against before you get told off.
//   · It is reachable without a pointer. Pieces, walls and the rotate handle are
//     focusable and take arrow keys, and the view pinches, pans and zooms by
//     touch instead of by modifier key.
//
// It also no longer refuses work silently: a drag that collides tints red and
// slides along whatever it hit, matching the 3D Draggable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudio, useSettings } from '@/lib/store';
import { useRoomScene } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { collidesAt, type ScenePart } from '@/lib/scene-spec';
import { entranceComponents, floorBlockers } from '@/lib/clearance';
import { buildClearanceField, fieldRuns, FREE_CELL, WALK_RADIUS } from '@/lib/clearance-field';
import { accessZones } from '@/lib/layout-rules';
import { obbFromPart } from '@/lib/geometry';
import { pointInFootprint, wallSegments, footprintBounds } from '@/lib/footprint';
import { formatDim } from '@/lib/units';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { HelpGroup, HelpLine, HelpToggle, Kb } from './HelpCard';
import { announce, removeParts, studioSurfaceFocused } from './KeyboardShortcuts';

const SCALE = 100; // px per metre at zoom = 1, in viewBox units
const PAD = 80;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
/** How far one arrow press moves a wall. */
const WALL_STEP = 0.05;

// There are no ergonomic thresholds in this file. There used to be: 600 mm in
// front of doors and drawers, a 500 mm bedside strip, and the three categories
// that get a front band — a third hand-kept copy of numbers that also live in the
// room report and the layout solver, with nothing tying any of them together. The
// bands are read off `accessZones` now, which is where the rules are, so the plan
// draws exactly what Room check measures and what Suggest optimises. It also gains
// the rules it never knew about: a desk's chair, a dining table's seats, a window's
// band, and the difference between a single bed (one side) and a double (both).
//
// Circulation went the same way earlier: the walkway used to be each bulky piece's
// footprint inflated by half of 600 mm, which is a decent picture of one rule and a
// poor picture of the room. `lib/clearance-field.ts` owns it, and the plan reads
// the same raster the room report does.

/** Run states for the circulation overlay. */
const WALKABLE = 0;
const CUT_OFF = 1;

export function PlanView({
  onViewChange,
  showComfort = false,
}: {
  /** Reports the live magnification so the page's scale chip can tell the truth. */
  onViewChange?: (v: { zoom: number }) => void;
  showComfort?: boolean;
}) {
  const ROOM_DYN = useScene((s) => s.room);
  // Footprints can be off-centre (independent wall moves), so map world↔pixels
  // through the bounding box, not ±width/2.
  const bounds = footprintBounds(ROOM_DYN.footprint);
  const baseW = bounds.width * SCALE + PAD * 2;
  const baseH = bounds.depth * SCALE + PAD * 2;
  const parts = useRoomScene();
  const dimUnit = useSettings((s) => s.dimUnit);
  const selected = useStudio((s) => s.selectedPartId);
  const setSelected = useStudio((s) => s.setSelected);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setDragging = useStudio((s) => s.setDragging);
  const selectedWall = useStudio((s) => s.selectedWall);
  const setSelectedWall = useStudio((s) => s.setSelectedWall);
  const snapMode = useStudio((s) => s.snapMode);
  const moveWall = useScene((s) => s.moveWall);

  // Circulation, straight off the same field lib/clearance.ts reports from — and
  // only while the overlay is on, since building it costs a distance transform.
  const walkRuns = useMemo(() => {
    if (!showComfort) return [];
    const blockers = floorBlockers(parts);
    const field = buildClearanceField(
      blockers.map((p) => obbFromPart(p.pos, p.rot, p.dimMM)),
      ROOM_DYN.footprint,
    );
    if (!field) return [];
    // No door means no way to know which side anyone comes in from, so every
    // walkable region is drawn as walkable rather than guessed at.
    const entrance = entranceComponents(field, parts);
    return fieldRuns(field, (at) => {
      if (field.cover[at] !== FREE_CELL) return -1;
      const id = field.component[at];
      if (id < 0) return -1; // free floor, but too tight to stand in
      return !entrance || entrance.has(id) ? WALKABLE : CUT_OFF;
    });
  }, [showComfort, parts, ROOM_DYN.footprint]);

  // Keyboard steps track the gizmo's snap setting so the two agree: 10 mm / 15°
  // fine, 50 mm / 45° coarse. "Off" still steps — a key press has to be discrete.
  const nudge = snapMode === 'coarse' ? 0.05 : 0.01;
  const spin = snapMode === 'coarse' ? Math.PI / 4 : Math.PI / 12;

  // Wall-drag bookkeeping — measure the pointer along the wall's outward normal
  // and feed incremental width/depth deltas to the store (matches the 3D handle).
  const wallDragRef = useRef<{ index: number; outX: number; outZ: number; downAlong: number; prevTotal: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
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

  // Which piece is currently refusing to move, and which element has keyboard
  // focus (SVG shapes get no :focus-visible ring of their own).
  const [blockedId, setBlockedId] = useState<string | null>(null);
  const blockedRef = useRef(false);
  const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // Pan + zoom + rotate
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** view rotation in radians around viewport center */
  const [rot, setRot] = useState(0);
  const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const rotRef = useRef<{ startAngle: number; startRot: number } | null>(null);
  // Live touch points, so two fingers can pinch. Without this the plan was
  // buttons-only for zoom and had no pan gesture at all on a touch screen.
  const touchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number; cx: number; cy: number; ox: number; oy: number } | null>(null);

  useEffect(() => () => {
    if (blockTimer.current) clearTimeout(blockTimer.current);
  }, []);

  useEffect(() => {
    onViewChange?.({ zoom });
  }, [zoom, onViewChange]);

  const fit = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setRot(0);
  }, []);

  function toViewBox(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left) * (baseW / rect.width), y: (clientY - rect.top) * (baseH / rect.height) };
  }

  function svgToWorld(e: React.PointerEvent | PointerEvent): { x: number; z: number } {
    const p = toViewBox(e.clientX, e.clientY);
    // undo view rotation around viewport center
    const cx = baseW / 2;
    const cy = baseH / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const ux = dx * cos - dy * sin + cx;
    const uy = dx * sin + dy * cos + cy;
    // undo pan + zoom
    const sx = (ux - offset.x) / zoom;
    const sy = (uy - offset.y) / zoom;
    return {
      x: (sx - PAD) / SCALE + bounds.minX,
      z: (sy - PAD) / SCALE + bounds.minZ,
    };
  }

  function zoomAbout(next: number, cx: number, cy: number, fromZoom: number, ox: number, oy: number) {
    const k = next / fromZoom;
    setOffset({ x: cx - (cx - ox) * k, y: cy - (cy - oy) * k });
    setZoom(next);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const p = toViewBox(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAbout(clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM), p.x, p.y, zoom, offset.x, offset.y);
  }

  // ── Moving a piece ────────────────────────────────────────────────────────

  /** Keep a rotated footprint inside the room's bounding box. */
  function clampToRoom(part: ScenePart, x: number, z: number): [number, number] {
    const halfW = part.dimMM[0] / 2000;
    const halfD = part.dimMM[1] / 2000;
    const c = Math.abs(Math.cos(part.rot));
    const s = Math.abs(Math.sin(part.rot));
    const extX = halfW * c + halfD * s;
    const extZ = halfW * s + halfD * c;
    return [clamp(x, bounds.minX + extX, bounds.maxX - extX), clamp(z, bounds.minZ + extZ, bounds.maxZ - extZ)];
  }

  function clearBlocked() {
    blockedRef.current = false;
    if (blockTimer.current) clearTimeout(blockTimer.current);
    // Let the red linger a moment so a refusal is still visible if the user lets
    // go the instant it happens.
    blockTimer.current = setTimeout(() => setBlockedId(null), 500);
  }

  /** Try the full move, then each axis alone, so a piece slides along whatever it
   *  hit rather than freezing. Returns false if nothing was possible — and says
   *  so, out loud and in colour, instead of returning silently. */
  function moveTo(part: ScenePart, rawX: number, rawZ: number): boolean {
    const [x, z] = clampToRoom(part, rawX, rawZ);
    const candidates: Array<[number, number]> = [
      [x, z],
      [x, part.pos[2]],
      [part.pos[0], z],
    ];
    for (const [tx, tz] of candidates) {
      if (!pointInFootprint(tx, tz, ROOM_DYN.footprint)) continue;
      if (collidesAt(parts, part.id, [tx, part.pos[1], tz], part.rot, part.dimMM)) continue;
      if (tx !== part.pos[0] || tz !== part.pos[2]) setPosition(part.id, [tx, part.pos[1], tz]);
      if (blockedRef.current) clearBlocked();
      return true;
    }
    // Cancel any pending fade — a second refusal must not be wiped by the
    // timer the first one left behind.
    if (blockTimer.current) clearTimeout(blockTimer.current);
    setBlockedId(part.id);
    if (!blockedRef.current) {
      blockedRef.current = true;
      announce(`${part.name} will not fit there — something is in the way.`);
    }
    return false;
  }

  // ── Pointer handling ──────────────────────────────────────────────────────

  function onCanvasPointerDown(e: React.PointerEvent) {
    if (dragRef.current) return;
    if (e.target !== svgRef.current) return;
    if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setSelected(null);
    }

    // Touch: one finger pans, two fingers pinch. There are no modifier keys on a
    // touch screen, so the desktop gestures below are unreachable there.
    if (e.pointerType === 'touch') {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (touchRef.current.size >= 2) {
        const [a, b] = [...touchRef.current.values()];
        const mid = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          zoom,
          cx: mid.x,
          cy: mid.y,
          ox: offset.x,
          oy: offset.y,
        };
        panRef.current = null;
      } else {
        panRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
      }
      e.preventDefault();
      return;
    }

    // Alt+drag → rotate view; Middle / right / Shift+left → pan.
    if (e.altKey) {
      const p = toViewBox(e.clientX, e.clientY);
      rotRef.current = {
        startAngle: Math.atan2(p.y - baseH / 2, p.x - baseW / 2),
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
    if (e.pointerType === 'touch' && touchRef.current.has(e.pointerId)) {
      touchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchRef.current && touchRef.current.size >= 2) {
      const [a, b] = [...touchRef.current.values()];
      const p = pinchRef.current;
      const next = clamp((p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist, MIN_ZOOM, MAX_ZOOM);
      zoomAbout(next, p.cx, p.cy, p.zoom, p.ox, p.oy);
      return;
    }

    // Rotate-view handling first
    if (rotRef.current) {
      const p = toViewBox(e.clientX, e.clientY);
      const a = Math.atan2(p.y - baseH / 2, p.x - baseW / 2);
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

    if (wallDragRef.current) {
      const wd = wallDragRef.current;
      const w = svgToWorld(e);
      const total = w.x * wd.outX + w.z * wd.outZ - wd.downAlong;
      const step = total - wd.prevTotal;
      wd.prevTotal = total;
      // Only the grabbed wall moves; it tracks the pointer 1:1 along its normal.
      if (step !== 0) moveWall(wd.index, step);
      force((v) => v + 1);
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
      moveTo(part, w.x, w.z);
    } else {
      const a = Math.atan2(w.z - part.pos[2], w.x - part.pos[0]);
      const delta = -(a - dragRef.current.startAngle);
      setRotation(id, dragRef.current.startRot + delta);
    }
    force((v) => v + 1);
  }

  function onWallPointerDown(e: React.PointerEvent, index: number) {
    e.stopPropagation();
    setSelectedWall(index);
    setDragging('__wall__');
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const seg = wallSegments(ROOM_DYN.footprint)[index];
    if (!seg) return;
    // Outward normal (away from centroid). wallSegments yaw encodes the inward
    // normal as (sin yaw, cos yaw); negate for outward.
    const outX = -Math.sin(seg.yaw);
    const outZ = -Math.cos(seg.yaw);
    const w = svgToWorld(e);
    wallDragRef.current = { index, outX, outZ, downAlong: w.x * outX + w.z * outZ, prevTotal: 0 };
  }

  function onPointerUp(e: React.PointerEvent) {
    if (e.pointerType === 'touch') {
      touchRef.current.delete(e.pointerId);
      if (touchRef.current.size < 2) pinchRef.current = null;
    }
    if (wallDragRef.current) {
      wallDragRef.current = null;
      setDragging(null);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    }
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
    if (blockedRef.current) clearBlocked();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  // View keys are armed only while focus is inside the plan or on the studio
  // surface itself — they were bound to `window` behind a comment claiming they
  // were scoped, so typing "0" anywhere in the studio reset the plan's view.
  useEffect(() => {
    function armed(): boolean {
      const root = rootRef.current;
      if (root && document.activeElement && root.contains(document.activeElement)) return true;
      return studioSurfaceFocused();
    }
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!armed()) return;
      if (e.key === '0') fit();
      else if (e.key === '=' || e.key === '+') setZoom((z) => Math.min(MAX_ZOOM, z * 1.15));
      else if (e.key === '-' || e.key === '_') setZoom((z) => Math.max(MIN_ZOOM, z / 1.15));
      else if (e.key === '[') setRot((r) => r - Math.PI / 12);
      else if (e.key === ']') setRot((r) => r + Math.PI / 12);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

  function onPartKeyDown(e: React.KeyboardEvent, part: ScenePart) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(part.id);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeParts([part.id]);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(part.id);
    if (e.shiftKey) {
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      const next = part.rot + dir * spin;
      setRotation(part.id, next);
      announce(`${part.name} turned to ${Math.round((next * 180) / Math.PI)} degrees.`);
      return;
    }
    const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0;
    const dz = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0;
    moveTo(part, part.pos[0] + dx, part.pos[2] + dz);
    force((v) => v + 1);
  }

  function onRotateKeyDown(e: React.KeyboardEvent, part: ScenePart) {
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = part.rot + dir * spin;
    setRotation(part.id, next);
    announce(`${part.name} turned to ${Math.round((next * 180) / Math.PI)} degrees.`);
  }

  function onWallKeyDown(e: React.KeyboardEvent, index: number, label: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedWall(index);
      return;
    }
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const out = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? WALL_STEP : -WALL_STEP;
    setSelectedWall(index);
    moveWall(index, out);
    force((v) => v + 1);
    const b = footprintBounds(useScene.getState().room.footprint);
    announce(
      `${label} moved ${out > 0 ? 'out' : 'in'}. Room is now ${formatDim(b.width * 1000, dimUnit)} by ${formatDim(
        b.depth * 1000,
        dimUnit,
      )} ${dimUnit}.`,
    );
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  const toLocal = (x: number, z: number) => ({
    x: PAD + (x - bounds.minX) * SCALE,
    y: PAD + (z - bounds.minZ) * SCALE,
  });

  const segs = wallSegments(ROOM_DYN.footprint);
  // Compass names only mean something on a four-edge room. An L / T / U footprint
  // has six or eight edges, and the Inspector already falls back to "Wall n".
  const useCompass = ROOM_DYN.footprint.length === 4;
  const viewRotDeg = (rot * 180) / Math.PI;

  const widthLabel = `${formatDim(bounds.width * 1000, dimUnit)} ${dimUnit}`;
  const depthLabel = `${formatDim(bounds.depth * 1000, dimUnit)} ${dimUnit}`;
  const planW = bounds.width * SCALE;
  const planH = bounds.depth * SCALE;

  return (
    <div ref={rootRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${baseW} ${baseH}`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        style={{ width: '100%', height: '100%', maxWidth: 1100, touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'default' }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="lockHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--locked)" strokeWidth="0.4" opacity="0.35" />
          </pattern>
        </defs>

        <g transform={`rotate(${viewRotDeg} ${baseW / 2} ${baseH / 2}) translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          <path
            d={
              ROOM_DYN.footprint
                .map((p, i) => {
                  const l = toLocal(p[0], p[1]);
                  return `${i ? 'L' : 'M'}${l.x} ${l.y}`;
                })
                .join(' ') + ' Z'
            }
            fill="var(--hairline-soft)"
            stroke="var(--ink)"
            strokeWidth="3"
          />

          {/* Where a person actually fits, cell by cell. Runs rather than cells:
              a 6 x 4 m room is ~10 000 cells but only a few hundred horizontal
              runs, so this stays plain SVG and keeps reading the design tokens
              instead of needing a canvas and a fourth copy of the palette.
              A half-cell overlap on each rect closes the hairlines that otherwise
              show between rows at high zoom. */}
          {showComfort && walkRuns.length > 0 && (
            <g style={{ pointerEvents: 'none' }} aria-hidden="true">
              {walkRuns.map((r, i) => {
                const a = toLocal(r.x, r.z);
                return (
                  <rect
                    key={`walk-${i}`}
                    x={a.x}
                    y={a.y}
                    width={r.w * SCALE + 0.5}
                    height={r.h * SCALE + 0.5}
                    fill={r.state === CUT_OFF ? 'var(--warn-tint)' : 'var(--accent-2-tint)'}
                  />
                );
              })}
            </g>
          )}

          {/* Comfort zones — the per-piece clearance rules as floor regions, under
              the furniture so a piece is never obscured by its own band. */}
          {showComfort && (
            <g style={{ pointerEvents: 'none' }}>
              {parts.map((part) => {
                const bands = comfortBands(part);
                if (!bands) return null;
                const c = toLocal(part.pos[0], part.pos[2]);
                return (
                  <g key={`comfort-${part.id}`} transform={`translate(${c.x} ${c.y}) rotate(${-(part.rot * 180) / Math.PI})`}>
                    {bands}
                  </g>
                );
              })}
            </g>
          )}

          {/* Interactive wall edges — click or focus to select, drag or arrow to
              resize. Wide transparent hit line over a thin visible accent. */}
          {ROOM_DYN.footprint.map((a, i) => {
            const b = ROOM_DYN.footprint[(i + 1) % ROOM_DYN.footprint.length];
            const la = toLocal(a[0], a[1]);
            const lb = toLocal(b[0], b[1]);
            const sel = selectedWall === i;
            const focused = focusKey === `wall:${i}`;
            const label = wallLabelFor(segs[i]?.yaw ?? 0, i, useCompass);
            return (
              <g
                key={`wall-${i}`}
                tabIndex={0}
                role="button"
                aria-label={`${label}. Arrow keys move it.`}
                style={{ cursor: 'grab', outline: 'none' }}
                onPointerDown={(e) => onWallPointerDown(e, i)}
                onKeyDown={(e) => onWallKeyDown(e, i, label)}
                onFocus={() => setFocusKey(`wall:${i}`)}
                onBlur={() => setFocusKey(null)}
              >
                <line x1={la.x} y1={la.y} x2={lb.x} y2={lb.y} stroke="transparent" strokeWidth={16} strokeLinecap="round" />
                {(sel || focused) && (
                  <line
                    x1={la.x}
                    y1={la.y}
                    x2={lb.x}
                    y2={lb.y}
                    stroke="var(--accent)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeDasharray={focused && !sel ? '7 4' : undefined}
                  />
                )}
              </g>
            );
          })}

          {/* Wall labels — placed from each edge's own midpoint and outward
              normal, so they stay correct on a six-edge L or U room. */}
          {segs.map((seg, i) => {
            const l = toLocal(seg.x, seg.z);
            const x = l.x - Math.sin(seg.yaw) * 26;
            const y = l.y - Math.cos(seg.yaw) * 26;
            return (
              <text
                key={`wall-label-${i}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${-viewRotDeg} ${x} ${y})`}
                fontFamily="var(--font-sans)"
                fontSize="11"
                fill="var(--ink-2)"
                fontWeight="600"
                style={{ pointerEvents: 'none' }}
              >
                {wallLabelFor(seg.yaw, i, useCompass)}
              </text>
            );
          })}

          {/* Overall dimensions, in the unit Settings owns — this used to print a
              bare millimetre number with no unit at all. */}
          <g fontFamily="var(--font-mono)" fontSize="10" fill="var(--accent-text)" style={{ pointerEvents: 'none' }}>
            <line x1={PAD} y1={PAD - 18} x2={PAD + planW} y2={PAD - 18} stroke="var(--accent-text)" strokeWidth="0.8" />
            <line x1={PAD} y1={PAD - 22} x2={PAD} y2={PAD - 14} stroke="var(--accent-text)" />
            <line x1={PAD + planW} y1={PAD - 22} x2={PAD + planW} y2={PAD - 14} stroke="var(--accent-text)" />
            <rect
              x={PAD + planW / 2 - (widthLabel.length * 3.3 + 6)}
              y={PAD - 26}
              width={widthLabel.length * 6.6 + 12}
              height="15"
              fill="var(--paper)"
            />
            <text x={PAD + planW / 2} y={PAD - 15} textAnchor="middle">
              {widthLabel}
            </text>

            <line x1={PAD + planW + 18} y1={PAD} x2={PAD + planW + 18} y2={PAD + planH} stroke="var(--accent-text)" strokeWidth="0.8" />
            <line x1={PAD + planW + 14} y1={PAD} x2={PAD + planW + 22} y2={PAD} stroke="var(--accent-text)" />
            <line x1={PAD + planW + 14} y1={PAD + planH} x2={PAD + planW + 22} y2={PAD + planH} stroke="var(--accent-text)" />
            <g transform={`rotate(90 ${PAD + planW + 18} ${PAD + planH / 2})`}>
              <rect
                x={PAD + planW + 18 - (depthLabel.length * 3.3 + 6)}
                y={PAD + planH / 2 - 13}
                width={depthLabel.length * 6.6 + 12}
                height="15"
                fill="var(--paper)"
              />
              <text x={PAD + planW + 18} y={PAD + planH / 2 - 2} textAnchor="middle">
                {depthLabel}
              </text>
            </g>
          </g>

          {parts.map((part) => {
            const pos = part.pos;
            const rotY = part.rot;
            const fpW = part.dimMM[0] / 1000;
            const fpD = part.dimMM[1] / 1000;
            const center = toLocal(pos[0], pos[2]);
            const wpx = fpW * SCALE;
            const hpx = fpD * SCALE;
            const blocked = blockedId === part.id;
            // Stroke tokens are boundaries (≥3:1); the label uses the *-text pair
            // because 9px type has to clear 4.5:1.
            const color = blocked ? 'var(--danger)' : part.locked ? 'var(--locked)' : 'var(--accent)';
            const labelColor = blocked ? 'var(--danger-text)' : part.locked ? 'var(--locked)' : 'var(--accent-text)';
            const fill = blocked ? 'var(--danger-tint)' : part.locked ? 'var(--locked-tint)' : 'var(--accent-tint)';
            const isSel = selected === part.id;
            const focused = focusKey === `part:${part.id}`;
            const rotDeg = -(rotY * 180) / Math.PI;
            return (
              <g
                key={part.id}
                transform={`translate(${center.x} ${center.y}) rotate(${rotDeg})`}
                tabIndex={0}
                role="button"
                aria-label={`${part.name}. Arrow keys move it, hold Shift to turn it.`}
                onPointerDown={(e) => onPointerDown(e, part.id, 'translate')}
                onKeyDown={(e) => onPartKeyDown(e, part)}
                onFocus={() => setFocusKey(`part:${part.id}`)}
                onBlur={() => setFocusKey(null)}
                style={{ cursor: 'grab', outline: 'none' }}
              >
                {focused && (
                  <rect
                    x={-wpx / 2 - 5}
                    y={-hpx / 2 - 5}
                    width={wpx + 10}
                    height={hpx + 10}
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    rx={4}
                  />
                )}
                {part.circle ? (
                  // An ellipse, not a circle of radius W/2: a round part is
                  // authored square, but W and D are separately editable, and
                  // `lib/geometry`'s Foot models the inscribed ELLIPSE — so a
                  // stretched plant pot has to draw as the shape the collision
                  // and coverage maths is using.
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={wpx / 2}
                    ry={hpx / 2}
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
                <g transform={`rotate(${-rotDeg - viewRotDeg})`}>
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fontFamily="var(--font-sans)"
                    fontSize="9"
                    fill={labelColor}
                    fontWeight="600"
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
                      stroke={focusKey === `rot:${part.id}` ? 'var(--accent-text)' : color}
                      strokeWidth={focusKey === `rot:${part.id}` ? 3 : 2}
                      tabIndex={0}
                      role="button"
                      aria-label={`Turn ${part.name}. Arrow keys turn it.`}
                      onPointerDown={(e) => onPointerDown(e, part.id, 'rotate')}
                      onKeyDown={(e) => onRotateKeyDown(e, part)}
                      onFocus={() => setFocusKey(`rot:${part.id}`)}
                      onBlur={() => setFocusKey(null)}
                      style={{ cursor: 'grab', outline: 'none' }}
                    />
                    <path d="M -4 -1 A 4 4 0 1 1 4 -1" fill="none" stroke={color} strokeWidth="1.4" style={{ pointerEvents: 'none' }} />
                    <polygon points="3,-1 5,-3 3,-3" fill={color} style={{ pointerEvents: 'none' }} />
                  </g>
                )}
              </g>
            );
          })}

          {/* North rose. The needle turns with the drawing — that is the point of
              it — but the letter stays upright and readable. */}
          <g transform={`translate(${PAD - 30} ${PAD - 30})`} style={{ pointerEvents: 'none' }}>
            <circle r="14" fill="var(--paper)" stroke="var(--ink)" />
            <path d="M0 -9 L3 0 L0 9 L-3 0 Z" fill="var(--accent)" />
            <g transform={`rotate(${-viewRotDeg})`}>
              <text y="-18" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="9" fill="var(--ink)" fontWeight="700">
                N
              </text>
            </g>
          </g>
        </g>
      </svg>

      {/* The bottom-left cluster, laid out the way the 3D tab lays out its own:
          the help chip sits above the controls and opens over them, so the drawing
          itself is never covered by something the user did not ask for. */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          zIndex: 'var(--z-canvas-hint)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
          maxWidth: 'min(340px, calc(100% - 32px))',
        }}
      >
        <HelpToggle>
          <HelpGroup title="Moving furniture">
            <HelpLine>Drag a piece to move it. It stops against whatever is in the way, and tints red if it cannot go there.</HelpLine>
            <HelpLine>Drag the handle on a selected piece to turn it.</HelpLine>
            <HelpLine>Click a wall to paint it, or drag it to make the room bigger or smaller.</HelpLine>
          </HelpGroup>
          <HelpGroup title="Getting around">
            <HelpLine>Pinch or scroll to zoom. Two fingers, Shift-drag or right-drag to pan.</HelpLine>
            <HelpLine>Alt-drag turns the page — the drawing, not the furniture.</HelpLine>
          </HelpGroup>
          <HelpGroup title="Keys" note="Click the drawing first — these stay quiet while you are using a panel.">
            <HelpLine>
              <Kb>↑</Kb>
              <Kb>↓</Kb>
              <Kb>←</Kb>
              <Kb>→</Kb> nudge whatever is focused · hold <Kb>Shift</Kb> to turn it
            </HelpLine>
            <HelpLine>
              <Kb>Tab</Kb> steps through the pieces and the walls · <Kb>Esc</Kb> deselects
            </HelpLine>
          </HelpGroup>
        </HelpToggle>

        <div className="toolbar" role="group" aria-label="Plan view" style={{ gap: 6, padding: 4 }}>
        <IconButton
          icon="plus"
          label="Zoom in"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.15))}
          disabled={zoom >= MAX_ZOOM - 0.001}
          variant="outline"
          size={28}
          iconSize={15}
        />
        <IconButton
          icon="minus"
          label="Zoom out"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.15))}
          disabled={zoom <= MIN_ZOOM + 0.001}
          variant="outline"
          size={28}
          iconSize={15}
        />
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
        <IconButton
          icon="rotate-ccw"
          label="Turn the page left"
          onClick={() => setRot((r) => r - Math.PI / 12)}
          variant="outline"
          size={28}
          iconSize={14}
        />
        <IconButton
          icon="rotate-cw"
          label="Turn the page right"
          onClick={() => setRot((r) => r + Math.PI / 12)}
          variant="outline"
          size={28}
          iconSize={14}
        />
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
        <button
          onClick={fit}
          title="Back to the default view"
          className="ds-btn"
          style={{ height: 28, fontSize: 11, padding: '0 9px', gap: 5 }}
        >
          <Icon name="fit" size={12} />
          Fit
        </button>
        </div>
      </div>

      {/* The key for the shading, and ONLY when the shading is on. It used to be a
          permanent four-line paragraph pinned over the bottom-right of the drawing:
          three of those lines were how-to-drive text, which belongs in the help card
          exactly as it does on the 3D tab, and the fourth described colours that
          were not on screen unless Comfort zones was switched on. */}
      {showComfort && (
        <div
          className="popover"
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 'var(--z-canvas-hint)',
            padding: '7px 10px',
            fontSize: 11,
            color: 'var(--ink-3)',
            lineHeight: 1.45,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Swatch fill="var(--accent-2-tint)" />
            Room to stand and walk — {WALK_RADIUS * 200} cm across
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Swatch fill="var(--accent-2-tint)" dashed />
            Room each piece needs to be used
          </span>
          {walkRuns.some((r) => r.state === CUT_OFF) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warn-text)' }}>
              <Swatch fill="var(--warn-tint)" />
              No route from the door to here
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Swatch({ fill, dashed }: { fill: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14,
        height: 10,
        flexShrink: 0,
        background: fill,
        border: dashed ? '1px dashed var(--accent-2)' : '1px solid var(--edge)',
        borderRadius: 2,
      }}
    />
  );
}

/** The comfort bands for one piece, drawn in its own local frame — which is
 *  exactly the frame `accessZones` authors them in, so this is a unit conversion
 *  and nothing more. Returns null when the piece has no rule attached to it.
 *
 *  Local +y here is the piece's front. `accessZones` returns world coordinates for
 *  a placement, so it is asked for the zones of a piece at the origin facing +z,
 *  and its `cz` is that same local +y. Nothing about the geometry is restated. */
function comfortBands(part: ScenePart): React.ReactNode[] | null {
  const zones = accessZones(part, 0, 0, 0);
  if (zones.length === 0) return null;
  const soft = { fill: 'var(--accent-2-tint)', stroke: 'var(--accent-2)', strokeWidth: 0.8, strokeDasharray: '5 4' };
  return zones.map((zn, i) => (
    <rect
      key={`${zn.rule.id}-${zn.side}-${i}`}
      x={(zn.foot.cx - zn.foot.hw) * SCALE}
      y={(zn.foot.cz - zn.foot.hd) * SCALE}
      width={zn.foot.hw * 2 * SCALE}
      height={zn.foot.hd * 2 * SCALE}
      {...soft}
      fillOpacity={0.9}
    />
  ));
}

/** Mirrors the Inspector's wall naming so the two screens can never disagree. */
function wallLabelFor(yaw: number, index: number, useCompass: boolean): string {
  if (!useCompass) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'North wall' : 'South wall';
  return inX > 0 ? 'West wall' : 'East wall';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

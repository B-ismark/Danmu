'use client';

// To-scale floor plan PNG export. Pure canvas drawing — footprint with wall
// stroke, numbered furniture rectangles, room dimension lines, a 1 m scale
// bar, and a legend listing every numbered piece with its real dimensions.
// A printable move-day handout, generated entirely on-device.

import type { ScenePart } from './scene-spec';
import type { Footprint } from './footprint';
import { footprintBounds } from './footprint';
import { formatDim } from './units';
import type { DimUnit } from './store';
import { downloadBlob } from './snapshot';

const PX_PER_M = 90; // plan scale on canvas
const MARGIN = 70;
const LEGEND_LINE = 20;

export function exportPlanPng(
  parts: ScenePart[],
  room: { footprint: Footprint; width: number; depth: number; height: number },
  dimUnit: DimUnit,
  title = 'Floor plan',
) {
  const b = footprintBounds(room.footprint);
  const planW = b.width * PX_PER_M;
  const planH = b.depth * PX_PER_M;

  const floorParts = parts.filter((p) => !p.wallMounted);
  const legendH = floorParts.length * LEGEND_LINE + 56;
  const W = Math.ceil(planW + MARGIN * 2);
  const H = Math.ceil(planH + MARGIN * 2 + legendH);

  const c = document.createElement('canvas');
  c.width = W * 2; // 2× for crisp print
  c.height = H * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);

  ctx.fillStyle = '#FBF8F2';
  ctx.fillRect(0, 0, W, H);

  const px = (x: number) => MARGIN + (x - b.minX) * PX_PER_M;
  const pz = (z: number) => MARGIN + (z - b.minZ) * PX_PER_M;

  // Title + room size.
  ctx.fillStyle = '#1c1c1a';
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillText(title, MARGIN, 30);
  ctx.font = '11px monospace';
  ctx.fillStyle = '#6b6b66';
  ctx.fillText(
    `${formatDim(room.width * 1000, dimUnit)} × ${formatDim(room.depth * 1000, dimUnit)} ${dimUnit} · ceiling ${formatDim(room.height * 1000, dimUnit)} ${dimUnit} · scale 1 m = ${PX_PER_M} px`,
    MARGIN,
    46,
  );

  // Footprint — floor fill + thick wall stroke.
  ctx.beginPath();
  room.footprint.forEach(([x, z], i) => {
    if (i === 0) ctx.moveTo(px(x), pz(z));
    else ctx.lineTo(px(x), pz(z));
  });
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#1c1c1a';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Furniture — numbered, rotated rectangles.
  floorParts.forEach((p, i) => {
    const cx = px(p.pos[0]);
    const cy = pz(p.pos[2]);
    const w = (p.dimMM[0] / 1000) * PX_PER_M;
    const d = (p.dimMM[1] / 1000) * PX_PER_M;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-p.rot);
    ctx.fillStyle = p.color ? `${p.color}55` : 'rgba(62,143,216,0.25)';
    ctx.strokeStyle = '#3a3a36';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-w / 2, -d / 2, w, d);
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
    // Number badge (unrotated, centred).
    ctx.fillStyle = '#1c1c1a';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  });

  // Wall-mounted items as ticks on the wall line (doors, windows, TV…).
  parts
    .filter((p) => p.wallMounted)
    .forEach((p) => {
      const cx = px(p.pos[0]);
      const cy = pz(p.pos[2]);
      const w = (p.dimMM[0] / 1000) * PX_PER_M;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.rot);
      ctx.strokeStyle = '#3E8FD8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.stroke();
      ctx.restore();
    });

  // Dimension lines (overall width below, depth right).
  const dimY = pz(b.maxZ) + 24;
  drawDimLine(ctx, px(b.minX), dimY, px(b.maxX), dimY, `${formatDim(b.width * 1000, dimUnit)} ${dimUnit}`);
  const dimX = px(b.maxX) + 24;
  drawDimLine(ctx, dimX, pz(b.minZ), dimX, pz(b.maxZ), `${formatDim(b.depth * 1000, dimUnit)} ${dimUnit}`, true);

  // Scale bar — 1 m.
  const sbY = pz(b.maxZ) + 44;
  ctx.strokeStyle = '#1c1c1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, sbY);
  ctx.lineTo(MARGIN + PX_PER_M, sbY);
  ctx.stroke();
  ctx.font = '10px monospace';
  ctx.fillStyle = '#6b6b66';
  ctx.fillText(`1 m`, MARGIN + PX_PER_M + 6, sbY + 3);

  // Legend.
  let ly = planH + MARGIN + 70;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.fillStyle = '#1c1c1a';
  ctx.fillText('Furniture', MARGIN, ly);
  ly += 8;
  floorParts.forEach((p, i) => {
    ly += LEGEND_LINE;
    ctx.font = '700 11px monospace';
    ctx.fillStyle = '#3E8FD8';
    ctx.fillText(String(i + 1).padStart(2, ' '), MARGIN, ly);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#1c1c1a';
    ctx.fillText(
      `${p.name} — ${formatDim(p.dimMM[0], dimUnit)} × ${formatDim(p.dimMM[1], dimUnit)} × ${formatDim(p.dimMM[2], dimUnit)} ${dimUnit} (W×D×H)`,
      MARGIN + 24,
      ly,
    );
  });

  c.toBlob((blob) => {
    if (blob) downloadBlob(blob, 'floor-plan.png');
  }, 'image/png');
}

function drawDimLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  vertical = false,
) {
  ctx.strokeStyle = '#9a9a94';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  // end ticks
  if (vertical) {
    ctx.moveTo(x1 - 4, y1);
    ctx.lineTo(x1 + 4, y1);
    ctx.moveTo(x2 - 4, y2);
    ctx.lineTo(x2 + 4, y2);
  } else {
    ctx.moveTo(x1, y1 - 4);
    ctx.lineTo(x1, y1 + 4);
    ctx.moveTo(x2, y2 - 4);
    ctx.lineTo(x2, y2 + 4);
  }
  ctx.stroke();
  ctx.font = '10px monospace';
  ctx.fillStyle = '#6b6b66';
  if (vertical) {
    ctx.save();
    ctx.translate(x1 + 12, (y1 + y2) / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(label, (x1 + x2) / 2, y1 - 6);
    ctx.textAlign = 'left';
  }
}

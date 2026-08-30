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
import { PLAN } from './scene-palette';
import { fileSlug } from './exports';
import { ridesWall } from './physics';

const PX_PER_M = 90; // plan scale on canvas
const MARGIN = 70;
const LEGEND_LINE = 20;
/** Narrowest sheet we will emit, so a small room's legend still has a column to
 *  sit in. A 2 m × 2 m room is only 180 px of plan; its legend rows are not. */
const MIN_SHEET_W = 520;

const TITLE_FONT = '600 16px system-ui, sans-serif';
const META_FONT = '11px monospace';
const LEGEND_HEAD_FONT = '600 12px system-ui, sans-serif';
const LEGEND_INDEX_FONT = '700 11px monospace';
const LEGEND_FONT = '11px system-ui, sans-serif';
const BADGE_FONT = '700 11px system-ui, sans-serif';
const DIM_FONT = '10px monospace';

export function exportPlanPng(
  parts: ScenePart[],
  room: { footprint: Footprint; width: number; depth: number; height: number },
  dimUnit: DimUnit,
  title = 'Floor plan',
) {
  const b = footprintBounds(room.footprint);
  const planW = b.width * PX_PER_M;
  const planH = b.depth * PX_PER_M;

  // `ridesWall`, not `wallMounted`. The flag means "geometry is centred on the
  // origin" and is true for a ceiling fan and a pendant, which belong in this legend
  // with a footprint — they hang over the floor, they are not features of a wall.
  // Reading the wider question dropped the seeded pendant out of the legend entirely
  // and drew it as a bare tick in open floor, mid-room, with no number, while the 2D
  // Plan tab went on drawing it normally: two plans of one room disagreeing.
  const floorParts = parts.filter((p) => !ridesWall(p.category, p.shape));
  const legendH = floorParts.length * LEGEND_LINE + 56;

  // Legend rows carry a user-typed name (up to 80 characters) plus its
  // dimensions, and used to be drawn at whatever width they came out at — so a
  // long name ran straight off the right edge of a narrow plan. Measure them
  // first and let the sheet grow to fit, then ellipsise whatever still overruns.
  const measure = document.createElement('canvas').getContext('2d');
  const legendRows = floorParts.map((p) => legendText(p, dimUnit));
  let widestLegend = 0;
  if (measure) {
    measure.font = LEGEND_FONT;
    for (const row of legendRows) widestLegend = Math.max(widestLegend, measure.measureText(row).width);
    measure.font = META_FONT;
    widestLegend = Math.max(widestLegend, measure.measureText(metaText(room, dimUnit)).width - 24);
  }

  const contentW = Math.max(planW, widestLegend + 24, MIN_SHEET_W - MARGIN * 2);
  const W = Math.ceil(contentW + MARGIN * 2);
  const H = Math.ceil(planH + MARGIN * 2 + legendH);
  /** Right edge legend text must not cross. */
  const legendMaxW = W - MARGIN - (MARGIN + 24);

  const c = document.createElement('canvas');
  c.width = W * 2; // 2× for crisp print
  c.height = H * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);

  ctx.fillStyle = PLAN.paper;
  ctx.fillRect(0, 0, W, H);

  const px = (x: number) => MARGIN + (x - b.minX) * PX_PER_M;
  const pz = (z: number) => MARGIN + (z - b.minZ) * PX_PER_M;

  // Title + room size.
  ctx.fillStyle = PLAN.ink;
  ctx.font = TITLE_FONT;
  ctx.fillText(ellipsise(ctx, title, W - MARGIN * 2), MARGIN, 30);
  ctx.font = META_FONT;
  ctx.fillStyle = PLAN.ink2;
  ctx.fillText(metaText(room, dimUnit), MARGIN, 46);

  // Footprint — floor fill + thick wall stroke.
  ctx.beginPath();
  room.footprint.forEach(([x, z], i) => {
    if (i === 0) ctx.moveTo(px(x), pz(z));
    else ctx.lineTo(px(x), pz(z));
  });
  ctx.closePath();
  ctx.fillStyle = PLAN.floor;
  ctx.fill();
  ctx.strokeStyle = PLAN.ink;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Furniture — numbered, rotated rectangles, in **two passes, and the split is not
  // cosmetic.** This was one loop drawing each piece's footprint and then its badge, so
  // piece `i + 1`'s fill and outline landed on top of piece `i`'s NUMBER — a fan under a
  // sofa, a rug under a table. The legend below is keyed on that digit and has no other
  // join to its row, so losing it does not degrade the sheet, it breaks it, and it does
  // so precisely on the overlaps a floor plan is drawn to show. Footprints first, every
  // badge after: a number can now only be crossed by another number.
  //
  // Seen in an exported PNG before it was understood here — a Ceiling fan's `1` was
  // absent from the sheet while its legend row was present, which reads as the numbering
  // being broken rather than as a draw order.
  floorParts.forEach((p) => {
    const cx = px(p.pos[0]);
    const cy = pz(p.pos[2]);
    const w = (p.dimMM[0] / 1000) * PX_PER_M;
    const d = (p.dimMM[1] / 1000) * PX_PER_M;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-p.rot);
    ctx.fillStyle = `${p.color ?? PLAN.accent}40`;
    ctx.strokeStyle = PLAN.outline;
    ctx.lineWidth = 1.2;
    // `circle`, because `PlanView` draws one — a round piece is tested against the
    // ellipse it draws (`lib/plan-hit.ts`) and has to be DRAWN as one here too, or the
    // exported sheet and the tab it was exported from disagree about the shape of a 1 m
    // object. Latent for round floor pieces (a floor lamp, a plant) and reached the
    // moment `ridesWall` moved the ceiling family into this loop: a 1000 mm ceiling fan
    // was a wall tick before and would otherwise have become a square.
    if (p.circle) {
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, d / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(-w / 2, -d / 2, w, d);
      ctx.strokeRect(-w / 2, -d / 2, w, d);
    }
    ctx.restore();
  });

  // Pass two: the number badges (unrotated, centred), after every footprint.
  ctx.fillStyle = PLAN.ink;
  ctx.font = BADGE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  floorParts.forEach((p, i) => {
    ctx.fillText(String(i + 1), px(p.pos[0]), pz(p.pos[2]));
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Items that ride a wall, as ticks on the wall line (doors, windows, TV…). The
  // ceiling family is deliberately not here — see `floorParts` above.
  parts
    .filter((p) => ridesWall(p.category, p.shape))
    .forEach((p) => {
      const cx = px(p.pos[0]);
      const cy = pz(p.pos[2]);
      const w = (p.dimMM[0] / 1000) * PX_PER_M;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.rot);
      ctx.strokeStyle = PLAN.accent;
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
  ctx.strokeStyle = PLAN.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, sbY);
  ctx.lineTo(MARGIN + PX_PER_M, sbY);
  ctx.stroke();
  ctx.font = DIM_FONT;
  ctx.fillStyle = PLAN.ink2;
  ctx.fillText(`1 m`, MARGIN + PX_PER_M + 6, sbY + 3);

  // Legend.
  let ly = planH + MARGIN + 70;
  ctx.font = LEGEND_HEAD_FONT;
  ctx.fillStyle = PLAN.ink;
  ctx.fillText('Pieces', MARGIN, ly);
  ly += 8;
  floorParts.forEach((_, i) => {
    ly += LEGEND_LINE;
    ctx.font = LEGEND_INDEX_FONT;
    ctx.fillStyle = PLAN.accent;
    ctx.fillText(String(i + 1).padStart(2, ' '), MARGIN, ly);
    ctx.font = LEGEND_FONT;
    ctx.fillStyle = PLAN.ink;
    ctx.fillText(ellipsise(ctx, legendRows[i], legendMaxW), MARGIN + 24, ly);
  });

  c.toBlob((blob) => {
    if (blob) downloadBlob(blob, planFileName(title));
  }, 'image/png');
}

/** `Front Room` → `front-room-floor-plan.png`.
 *
 *  Named for the room, not just for the artefact: `title` is already the room's name
 *  — it is drawn at the top of the sheet — and a fixed `floor-plan.png` meant that
 *  exporting three rooms left three files the browser silently numbered `(1)` and
 *  `(2)`. The equality check is for the parameter's own default, which would otherwise
 *  slug to `floor-plan-floor-plan.png`. */
function planFileName(title: string): string {
  const slug = fileSlug(title);
  return slug === 'floor-plan' ? 'floor-plan.png' : `${slug}-floor-plan.png`;
}

function metaText(
  room: { width: number; depth: number; height: number },
  dimUnit: DimUnit,
): string {
  return `${formatDim(room.width * 1000, dimUnit)} × ${formatDim(room.depth * 1000, dimUnit)} ${dimUnit} · ceiling ${formatDim(room.height * 1000, dimUnit)} ${dimUnit} · scale 1 m = ${PX_PER_M} px`;
}

function legendText(p: ScenePart, dimUnit: DimUnit): string {
  return `${p.name} — ${formatDim(p.dimMM[0], dimUnit)} × ${formatDim(p.dimMM[1], dimUnit)} × ${formatDim(p.dimMM[2], dimUnit)} ${dimUnit} (W×D×H)`;
}

/** Trim to fit `maxW`, ending in an ellipsis. Assumes ctx.font is already set to
 *  the font the text will be drawn in. */
function ellipsise(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0 || ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
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
  ctx.strokeStyle = PLAN.rule;
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
  ctx.font = DIM_FONT;
  ctx.fillStyle = PLAN.ink2;
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

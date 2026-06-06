// Procedural surface textures — generated on a <canvas>, zero binary assets, no
// network. Fits the offline / browser-only architecture. We emit grayscale
// NORMAL maps (and a couple roughness maps) only — never albedo — so the user's
// recolour / theme colours stay intact while surfaces gain believable microrelief.
//
// Each generator is memoised: one CanvasTexture is created and shared across
// every material that uses it (single GPU upload, negligible cost).

import { CanvasTexture, RepeatWrapping, type Texture } from 'three';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

// Convert a grayscale height field to a tangent-space normal map (Sobel).
function heightToNormal(height: HTMLCanvasElement, strength = 2): CanvasTexture {
  const s = height.width;
  const hctx = height.getContext('2d')!;
  const src = hctx.getImageData(0, 0, s, s).data;
  const [out, octx] = canvas(s);
  const img = octx.createImageData(s, s);
  const at = (x: number, y: number) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 128;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(out);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

function grayTexture(c: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

// ─── Wood grain ────────────────────────────────────────────────────────────
function woodHeight(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  // Long vertical-ish grain lines with gentle waviness + fine pores.
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S;
    const w = 0.6 + Math.random() * 1.8;
    const tone = 90 + Math.random() * 90;
    ctx.strokeStyle = `rgb(${tone},${tone},${tone})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= S; y += 8) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    ctx.stroke();
  }
  return c;
}

// ─── Fabric weave ────────────────────────────────────────────────────────────
function fabricHeight(): HTMLCanvasElement {
  const S = 128;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  const step = 6;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const up = ((x / step) + (y / step)) % 2 === 0;
      ctx.fillStyle = up ? '#b0b0b0' : '#606060';
      ctx.fillRect(x, y, step - 1, step - 1);
    }
  }
  return c;
}

// ─── Floor (subtle plank seams + speckle) ────────────────────────────────────
function floorHeight(): HTMLCanvasElement {
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, S, S);
  // plank seams
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 2;
  for (let y = 0; y <= S; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
  }
  // light speckle for terrazzo-ish microrelief
  for (let i = 0; i < 1200; i++) {
    const v = 100 + Math.random() * 90;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5);
  }
  return c;
}

let _wood: Texture | null = null;
let _fabric: Texture | null = null;
let _floorN: Texture | null = null;
let _floorR: Texture | null = null;

export function woodNormal(): Texture {
  if (!_wood) { _wood = heightToNormal(woodHeight(), 1.4); _wood.repeat.set(2, 2); }
  return _wood;
}
export function fabricNormal(): Texture {
  if (!_fabric) { _fabric = heightToNormal(fabricHeight(), 1.1); _fabric.repeat.set(6, 6); }
  return _fabric;
}
export function floorNormal(): Texture {
  if (!_floorN) { _floorN = heightToNormal(floorHeight(), 1.0); _floorN.repeat.set(3, 3); }
  return _floorN;
}
export function floorRoughness(): Texture {
  if (!_floorR) { _floorR = grayTexture(floorHeight()); _floorR.repeat.set(3, 3); }
  return _floorR;
}

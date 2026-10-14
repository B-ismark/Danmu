// A drawing surface that takes the canvas calls the floor-plan sheet is drawn with
// and writes SVG instead of pixels. It exists so the PNG and the SVG are ONE drawing:
// `lib/plan-export.ts` draws the sheet once, against whichever surface it is handed,
// and a second hand-written SVG version would drift from the PNG the first time
// either changed — two exports of one room disagreeing, the same shape of scar as two
// tabs drawing one piece differently.
//
// Only the subset the sheet uses is implemented, and it is typed as that subset
// (`SheetContext`), so drawing with a call this file does not handle is a type error
// rather than a silently missing line.
//
// Two simplifications, both exact for how the sheet draws:
// · A path is recorded in the coordinates it is built in, under the transform current
//   at `beginPath`, and painted with that transform. A canvas maps each point through
//   the transform at the moment it is added; the sheet never changes the transform in
//   the middle of building a path, so the two agree.
// · Only a FULL ellipse is supported (the round-piece footprint). Anything else throws
//   rather than drawing the wrong shape.

/** The 2D-context calls and properties the floor-plan sheet uses. */
export type SheetContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'ellipse'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'strokeRect'
  | 'fillText'
  | 'measureText'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

/** Width of `text` in `font`, in sheet pixels. */
export type MeasureText = (font: string, text: string) => number;

type Matrix = [number, number, number, number, number, number];

type State = {
  m: Matrix;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Rounded so the file is readable and does not carry 1e-15 noise from a rotation. */
const n = (v: number) => String(Math.round(v * 1000) / 1000);

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** `#RRGGBBAA` → a 6-digit colour plus an opacity. Browsers read the 8-digit form, but
 *  Illustrator and Inkscape — where a print-ready sheet gets opened — do not reliably,
 *  and the furniture fills are exactly that form (`${color}40`). */
export function paint(colour: string, prop: 'fill' | 'stroke'): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return `${prop}="${escapeXml(colour)}"`;
  return `${prop}="#${m[1]}" ${prop}-opacity="${n(parseInt(m[2], 16) / 255)}"`;
}

/** `'600 16px system-ui, sans-serif'` → SVG font attributes. The sheet's fonts are all
 *  `[weight] <size>px <family>`. */
export function fontAttrs(font: string): string {
  const m = /^\s*(?:(\d{3}|bold|normal)\s+)?([\d.]+)px\s+(.+)$/.exec(font);
  if (!m) return `font-family="${escapeXml(font)}"`;
  const weight = m[1] && m[1] !== 'normal' ? ` font-weight="${m[1]}"` : '';
  return `font-family="${escapeXml(m[3])}" font-size="${m[2]}"${weight}`;
}

const ANCHOR: Partial<Record<CanvasTextAlign, string>> = { center: 'middle', right: 'end', end: 'end' };
const BASELINE: Partial<Record<CanvasTextBaseline, string>> = { middle: 'central', top: 'hanging', hanging: 'hanging' };

export class SvgSheet {
  private readonly out: string[] = [];
  private readonly stack: State[] = [];
  private s: State = {
    m: IDENTITY,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  private path: string[] = [];
  private pathM: Matrix = IDENTITY;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly measure: MeasureText,
  ) {}

  get fillStyle(): string {
    return this.s.fillStyle;
  }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) {
    this.s.fillStyle = String(v);
  }
  get strokeStyle(): string {
    return this.s.strokeStyle;
  }
  set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
    this.s.strokeStyle = String(v);
  }
  get lineWidth() {
    return this.s.lineWidth;
  }
  set lineWidth(v: number) {
    this.s.lineWidth = v;
  }
  get font() {
    return this.s.font;
  }
  set font(v: string) {
    this.s.font = v;
  }
  get textAlign() {
    return this.s.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.s.textAlign = v;
  }
  get textBaseline() {
    return this.s.textBaseline;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.s.textBaseline = v;
  }

  save() {
    this.stack.push({ ...this.s });
  }
  restore() {
    const prev = this.stack.pop();
    if (prev) this.s = prev;
  }
  translate(x: number, y: number) {
    this.s.m = multiply(this.s.m, [1, 0, 0, 1, x, y]);
  }
  rotate(a: number) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.s.m = multiply(this.s.m, [c, s, -s, c, 0, 0]);
  }
  scale(x: number, y: number) {
    this.s.m = multiply(this.s.m, [x, 0, 0, y, 0, 0]);
  }

  beginPath() {
    this.path = [];
    this.pathM = this.s.m;
  }
  moveTo(x: number, y: number) {
    this.path.push(`M${n(x)} ${n(y)}`);
  }
  lineTo(x: number, y: number) {
    this.path.push(`L${n(x)} ${n(y)}`);
  }
  closePath() {
    this.path.push('Z');
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number) {
    if (rotation !== 0 || start !== 0 || Math.abs(end - Math.PI * 2) > 1e-9) {
      throw new Error('SvgSheet draws only a full, unrotated ellipse');
    }
    // Two half-arcs: SVG cannot draw a whole ellipse as one arc.
    this.path.push(
      `M${n(x + rx)} ${n(y)}`,
      `A${n(rx)} ${n(ry)} 0 1 0 ${n(x - rx)} ${n(y)}`,
      `A${n(rx)} ${n(ry)} 0 1 0 ${n(x + rx)} ${n(y)}`,
      'Z',
    );
  }
  fill() {
    if (this.path.length) this.emitPath(paint(this.s.fillStyle, 'fill'));
  }
  stroke() {
    if (this.path.length) this.emitPath(`fill="none" ${this.strokeAttrs()}`);
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.out.push(`<rect${this.transform(this.s.m)} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${paint(this.s.fillStyle, 'fill')}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.out.push(
      `<rect${this.transform(this.s.m)} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ${this.strokeAttrs()}/>`,
    );
  }
  fillText(text: string, x: number, y: number) {
    const anchor = ANCHOR[this.s.textAlign];
    const baseline = BASELINE[this.s.textBaseline];
    this.out.push(
      `<text${this.transform(this.s.m)} x="${n(x)}" y="${n(y)}" ${fontAttrs(this.s.font)} ${paint(this.s.fillStyle, 'fill')}` +
        `${anchor ? ` text-anchor="${anchor}"` : ''}${baseline ? ` dominant-baseline="${baseline}"` : ''}` +
        // The legend pads its numbers with a leading space; keep it.
        ` xml:space="preserve">${escapeXml(text)}</text>`,
    );
  }
  measureText(text: string): TextMetrics {
    return { width: this.measure(this.s.font, text) } as TextMetrics;
  }

  /** The finished document. */
  toString(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n` +
      this.out.join('\n') +
      `\n</svg>\n`
    );
  }

  private emitPath(paintAttrs: string) {
    this.out.push(`<path${this.transform(this.pathM)} d="${this.path.join(' ')}" ${paintAttrs}/>`);
  }
  private strokeAttrs(): string {
    return `${paint(this.s.strokeStyle, 'stroke')} stroke-width="${n(this.s.lineWidth)}"`;
  }
  private transform(m: Matrix): string {
    if (m.every((v, i) => v === IDENTITY[i])) return '';
    return ` transform="matrix(${m.map(n).join(' ')})"`;
  }
}

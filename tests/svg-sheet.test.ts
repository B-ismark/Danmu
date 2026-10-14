import { describe, expect, it } from 'vitest';
import { SvgSheet, fontAttrs, paint } from '@/lib/svg-sheet';

const measure = (_font: string, text: string) => text.length * 6;

describe('SvgSheet', () => {
  it('splits an 8-digit colour into a colour and an opacity, for design tools', () => {
    expect(paint('#C4A57A40', 'fill')).toBe('fill="#C4A57A" fill-opacity="0.251"');
    expect(paint('#1E1C17', 'stroke')).toBe('stroke="#1E1C17"');
  });

  it('reads the sheet fonts into SVG attributes', () => {
    expect(fontAttrs('600 16px system-ui, sans-serif')).toBe('font-family="system-ui, sans-serif" font-size="16" font-weight="600"');
    expect(fontAttrs('11px monospace')).toBe('font-family="monospace" font-size="11"');
  });

  it('places a rotated rectangle with the transform current when it is drawn', () => {
    const s = new SvgSheet(100, 100, measure);
    s.save();
    s.translate(10, 20);
    s.rotate(Math.PI / 2);
    s.strokeRect(-5, -2, 10, 4);
    s.restore();
    s.fillRect(0, 0, 1, 1);
    const out = s.toString();
    expect(out).toContain('<rect transform="matrix(0 1 -1 0 10 20)" x="-5" y="-2" width="10" height="4" fill="none"');
    // restore() put the identity back: the next rect carries no transform at all.
    expect(out).toContain('<rect x="0" y="0" width="1" height="1"');
  });

  it('draws a full ellipse as two arcs and refuses any other', () => {
    const s = new SvgSheet(10, 10, measure);
    s.beginPath();
    s.ellipse(5, 5, 3, 2, 0, 0, Math.PI * 2);
    s.fill();
    expect(s.toString()).toContain('d="M8 5 A3 2 0 1 0 2 5 A3 2 0 1 0 8 5 Z"');
    expect(() => s.ellipse(5, 5, 3, 2, 0, 0, Math.PI)).toThrow();
  });

  it('escapes text and keeps the legend padding', () => {
    const s = new SvgSheet(10, 10, measure);
    s.fillText(' 1', 0, 0);
    s.fillText('Tom & Jerry <3', 0, 0);
    const out = s.toString();
    expect(out).toContain('xml:space="preserve"> 1</text>');
    expect(out).toContain('>Tom &amp; Jerry &lt;3</text>');
  });

  it('maps canvas text alignment onto SVG anchors', () => {
    const s = new SvgSheet(10, 10, measure);
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillText('7', 1, 2);
    // A dy shift, not dominant-baseline, which older design tools ignore.
    expect(s.toString()).toContain('text-anchor="middle" dy="0.35em"');
  });

  it('drops the control characters XML forbids, so a stray one cannot break the file', () => {
    const s = new SvgSheet(10, 10, measure);
    s.fillText('Den\u000B\u0007\uFFFF 2', 0, 0);
    expect(s.toString()).toContain('>Den 2</text>');
  });

  it('sizes the document in millimetres when given a print scale', () => {
    expect(new SvgSheet(90, 45, measure, 20 / 90).toString()).toContain('width="20mm" height="10mm" viewBox="0 0 90 45"');
    expect(new SvgSheet(90, 45, measure).toString()).toContain('width="90" height="45"');
  });
});

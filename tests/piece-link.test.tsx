// @vitest-environment jsdom
//
// The scan review's piece link, mounted: one hovered piece for the whole screen, drawn on
// both sides of it, and the model a person picks from what they typed becoming a kept
// piece. The colours are `--piece-1..8` in globals.css and `lib/piece-colors.ts`; the look
// of each state is CSS and is in the browser's hands, so what is asserted here is the
// state the CSS keys on (`data-piece-state`, `data-hovered`) and the calls that move it.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PhotoEditor, type PhotoEditorItem } from '@/components/studio/PhotoEditor';
import { DetectionRow } from '@/components/studio/DetectionRow';
import type { Detection } from '@/lib/detection';
import type { LabelCandidate } from '@/lib/label-repair';
import { PIECE_COLOR_COUNT, pieceColor } from '@/lib/piece-colors';
import { keptAfterPick } from '@/lib/review-history';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DETS: Detection[] = [
  { label: 'armchair', conf: 0.9, box: [0.1, 0.5, 0.2, 0.3], category: 'chair', slot: 'n' },
  { label: 'floor lamp', conf: 0.8, box: [0.5, 0.4, 0.1, 0.4], category: 'lamp', slot: 'n' },
  { label: 'picture', conf: 0.7, box: [0.7, 0.1, 0.2, 0.2], category: 'painting', slot: 'n' },
];
const ITEMS: PhotoEditorItem[] = DETS.map((d, index) => ({ index, d, locked: false }));

const rowProps = (i: number) => ({
  d: DETS[i],
  index: i,
  confirmed: false,
  verdict: { status: 'unmeasured' as const },
  repeatOf: null,
  dimUnit: 'cm' as const,
  onThisPhoto: true,
  onToggle: () => {},
  onRename: () => {},
  suggestModels: () => [],
  onRepair: () => {},
  offer: [],
  onDismissOffer: () => {},
  onDelete: () => {},
  onShow: () => {},
});

/** The page's wiring in miniature: one hovered state, handed to the photo and to every row. */
function Screen() {
  const [hover, setHover] = useState<{ index: number; from: 'photo' | 'row' } | null>(null);
  const linked = hover?.index ?? null;
  return (
    <>
      <PhotoEditor
        imageUrl="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        items={ITEMS}
        mode="select"
        onToggleLock={() => {}}
        onDelete={() => {}}
        onAddBox={() => {}}
        hovered={linked}
        onHover={(i) => setHover(i === null ? null : { index: i, from: 'photo' })}
      />
      {DETS.map((_, i) => (
        <DetectionRow
          key={i}
          {...rowProps(i)}
          highlighted={linked === i}
          scrollWhenHovered={linked === i && hover?.from === 'photo'}
          onLink={(on) => setHover(on ? { index: i, from: 'row' } : null)}
        />
      ))}
    </>
  );
}

const box = (i: number) => document.querySelector<HTMLElement>(`[data-piece-box="${i}"]`)!;
const tag = (i: number) => document.querySelector<HTMLElement>(`[data-piece-tag="${i}"]`)!;
const row = (i: number) => document.querySelector<HTMLElement>(`[data-piece-row="${i}"]`)!;
const states = (get: (i: number) => HTMLElement) => DETS.map((_, i) => get(i).dataset.pieceState);
const hovered = () => DETS.map((_, i) => row(i).dataset.hovered);

describe('one hovered piece, both sides', () => {
  it('rests with nothing raised or dimmed', () => {
    render(<Screen />);
    expect(states(box)).toEqual(['rest', 'rest', 'rest']);
    expect(states(tag)).toEqual(['rest', 'rest', 'rest']);
    expect(hovered()).toEqual(['false', 'false', 'false']);
  });

  it('hovering a box on the photo raises it and its row, and dims the other boxes', () => {
    render(<Screen />);
    fireEvent.pointerEnter(screen.getAllByRole('button', { name: /^floor lamp, / })[0]);
    expect(states(box)).toEqual(['dim', 'hover', 'dim']);
    expect(states(tag)).toEqual(['dim', 'hover', 'dim']);
    expect(hovered()).toEqual(['false', 'true', 'false']);
  });

  it('hovering its tag does the same', () => {
    render(<Screen />);
    fireEvent.pointerEnter(tag(2));
    expect(states(box)).toEqual(['dim', 'dim', 'hover']);
    expect(hovered()).toEqual(['false', 'false', 'true']);
  });

  it('hovering a row raises its box on the photo, and leaving puts everything back', () => {
    render(<Screen />);
    fireEvent.mouseEnter(row(0));
    expect(states(box)).toEqual(['hover', 'dim', 'dim']);
    expect(states(tag)).toEqual(['hover', 'dim', 'dim']);
    expect(hovered()).toEqual(['true', 'false', 'false']);
    fireEvent.mouseLeave(row(0));
    expect(states(box)).toEqual(['rest', 'rest', 'rest']);
    expect(hovered()).toEqual(['false', 'false', 'false']);
  });

  it('follows keyboard focus on a box the same way', () => {
    render(<Screen />);
    fireEvent.focus(screen.getAllByRole('button', { name: /^picture, / })[0]);
    expect(hovered()).toEqual(['false', 'false', 'true']);
    fireEvent.blur(screen.getAllByRole('button', { name: /^picture, / })[0]);
    expect(hovered()).toEqual(['false', 'false', 'false']);
  });
});

describe('scrolling the list to a piece hovered on the photo', () => {
  it('brings the row into view for a hover from the photo, without moving focus', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Screen />);
    const before = document.activeElement;
    fireEvent.pointerEnter(tag(1));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(row(1));
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(before);
  });

  it('leaves the list alone for a hover that began on the row itself', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<Screen />);
    fireEvent.mouseEnter(row(1));
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('a colour per piece', () => {
  it('gives the first eight pieces eight different colours and cycles after them', () => {
    const seen = Array.from({ length: PIECE_COLOR_COUNT }, (_, i) => pieceColor(i));
    expect(new Set(seen).size).toBe(PIECE_COLOR_COUNT);
    expect(pieceColor(PIECE_COLOR_COUNT)).toBe(pieceColor(0));
  });

  it('paints a piece’s box, label and row with the same colour', () => {
    render(<Screen />);
    for (const i of [0, 1, 2]) {
      const c = pieceColor(i);
      expect(box(i).style.getPropertyValue('--piece')).toBe(c);
      expect(tag(i).style.getPropertyValue('--piece')).toBe(c);
      expect(row(i).style.getPropertyValue('--piece')).toBe(c);
    }
    expect(new Set([0, 1, 2].map((i) => row(i).style.getPropertyValue('--piece'))).size).toBe(3);
  });
});

describe('choosing a model from what was typed', () => {
  const cand = (shape: string, name: string): LabelCandidate => ({
    category: 'chair',
    name,
    margin: 0.2,
    detection: { ...DETS[0], shape, label: name } as Detection,
  });

  function typeInto(onRepair: (c: LabelCandidate, keep?: boolean) => void) {
    const cands = [cand('armchair', 'Armchair'), cand('stool', 'Stool')];
    render(<DetectionRow {...rowProps(0)} highlighted={false} scrollWhenHovered={false} onLink={() => {}} suggestModels={() => cands} onRepair={onRepair} />);
    fireEvent.click(screen.getByRole('button', { name: /^Piece name: / }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Piece name' }), { target: { value: 'stoo' } });
    return cands;
  }

  it('asks for the piece to be kept when a suggestion is picked', () => {
    const onRepair = vi.fn();
    const cands = typeInto(onRepair);
    fireEvent.mouseDown(screen.getByRole('option', { name: /Stool model/ }));
    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(onRepair).toHaveBeenCalledWith(cands[1], true);
  });

  it('does not, for a name that is only typed and committed', () => {
    const onRepair = vi.fn();
    typeInto(onRepair);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Piece name' }), { key: 'Enter' });
    expect(onRepair).not.toHaveBeenCalled();
  });

  it('adds the piece to the kept set, once, and leaves a removed tick removed', () => {
    const kept = keptAfterPick(new Set([0]), 2);
    expect([...kept].sort()).toEqual([0, 2]);
    const again = keptAfterPick(kept, 2);
    expect(again).toBe(kept);
    // Unticking afterwards is the person's: nothing in a later render re-adds it.
    const after = new Set(kept);
    after.delete(2);
    expect([...after]).toEqual([0]);
  });
});

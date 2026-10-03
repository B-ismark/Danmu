// @vitest-environment jsdom
//
// The scan review row's "same piece" controls, mounted: the guessed repeat asked as a
// question, a settled link with its way back, and the kept piece saying where else it
// was seen. The rules behind them are `lib/sighting-links.ts` and its own test; this
// holds that each control is there when it should be, absent when it should not, and
// calls the handler it names.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DetectionRow } from '@/components/studio/DetectionRow';
import type { Detection } from '@/lib/detection';

afterEach(cleanup);

const bedN: Detection = { uid: 'n', label: 'bed', conf: 0.9, box: [0.2, 0.5, 0.5, 0.4], category: 'bed', slot: 'n' };
const bedE: Detection = { uid: 'e', label: 'bed', conf: 0.9, box: [0.1, 0.5, 0.4, 0.4], category: 'bed', slot: 'e' };

function props(over: Partial<Parameters<typeof DetectionRow>[0]> = {}): Parameters<typeof DetectionRow>[0] {
  return {
    d: bedE,
    index: 1,
    confirmed: false,
    repeatOf: null,
    doubted: false,
    highlighted: false,
    scrollWhenHovered: false,
    onThisPhoto: true,
    onToggle: () => {},
    onRename: () => {},
    suggestModels: () => [],
    onRepair: () => {},
    offer: [],
    onDismissOffer: () => {},
    onDelete: () => {},
    onLink: () => {},
    onShow: () => {},
    sameAs: null,
    alsoSeenOn: [],
    linkOptions: [],
    onLinkTo: () => {},
    onUnlink: () => {},
    onConfirmRepeat: () => {},
    ...over,
  };
}

describe('DetectionRow — same piece', () => {
  it('asks about a guessed repeat, and each answer calls its own handler', () => {
    const yes = vi.fn();
    const no = vi.fn();
    render(<DetectionRow {...props({ repeatOf: bedN, onConfirmRepeat: yes, onToggle: no })} />);
    expect(screen.getByText('Same bed as on Wall 1?')).toBeTruthy();
    fireEvent.click(screen.getByText('Yes, same one'));
    expect(yes).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('No, it’s another'));
    expect(no).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the row is kept', () => {
    render(<DetectionRow {...props({ repeatOf: bedN, confirmed: true })} />);
    expect(screen.queryByText('Yes, same one')).toBeNull();
  });

  it('shows a settled link instead of the question, with Unlink', () => {
    const unlink = vi.fn();
    render(<DetectionRow {...props({ repeatOf: bedN, sameAs: bedN, onUnlink: unlink })} />);
    expect(screen.getByText(/^Same bed as on Wall 1/)).toBeTruthy();
    expect(screen.queryByText('Yes, same one')).toBeNull();
    fireEvent.click(screen.getByText('Unlink'));
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('wears its piece’s tick: kept or left out, on the button and in the line', () => {
    const { rerender } = render(<DetectionRow {...props({ sameAs: bedN, confirmed: true })} />);
    expect(screen.getByRole('button', { name: 'Keep bed' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Same bed as on Wall 1 · kept')).toBeTruthy();
    rerender(<DetectionRow {...props({ sameAs: bedN, confirmed: false })} />);
    expect(screen.getByRole('button', { name: 'Keep bed' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Same bed as on Wall 1 · left out')).toBeTruthy();
  });

  it('says "Built once" only while the piece is in the room', () => {
    const { rerender } = render(<DetectionRow {...props({ d: bedN, index: 0, confirmed: true, alsoSeenOn: ['e'] })} />);
    expect(screen.getByText('Also seen on Wall 2. Built once')).toBeTruthy();
    rerender(<DetectionRow {...props({ d: bedN, index: 0, confirmed: false, alsoSeenOn: ['e'] })} />);
    expect(screen.getByText('Also seen on Wall 2')).toBeTruthy();
  });

  it('says where else a kept piece was seen', () => {
    render(<DetectionRow {...props({ d: bedN, index: 0, confirmed: true, alsoSeenOn: ['e', 's'] })} />);
    expect(screen.getByText(/Also seen on Wall 2 and Wall 3/)).toBeTruthy();
  });

  it('offers "Seen this already?" only when there is something to pick, and never on a linked row', () => {
    const opts = [{ index: 0, label: 'bed · Wall 1' }];
    const { rerender } = render(<DetectionRow {...props()} />);
    expect(screen.queryByText('Seen this already?')).toBeNull();
    rerender(<DetectionRow {...props({ linkOptions: opts })} />);
    expect(screen.getByText('Seen this already?')).toBeTruthy();
    rerender(<DetectionRow {...props({ linkOptions: opts, sameAs: bedN })} />);
    expect(screen.queryByText('Seen this already?')).toBeNull();
  });

  it('links to the row picked from the list', () => {
    const link = vi.fn();
    render(<DetectionRow {...props({ linkOptions: [{ index: 0, label: 'bed · Wall 1' }], onLinkTo: link })} />);
    fireEvent.click(screen.getByText('Seen this already?'));
    fireEvent.click(screen.getByText('bed · Wall 1'));
    expect(link).toHaveBeenCalledWith(0);
  });
});

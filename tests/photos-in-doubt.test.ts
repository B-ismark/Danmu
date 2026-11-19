import { describe, expect, it } from 'vitest';
import { PHOTO_DOUBT_MIN_READ, photosInDoubt, type LabelVerdict } from '@/lib/label-repair';

const ok: LabelVerdict = { status: 'ok' };
const unm: LabelVerdict = { status: 'unmeasured' };
const sus: LabelVerdict = {
  status: 'suspect',
  failed: ['width'],
  allowed: { width: [800, 1200], height: [300, 1300] },
  measured: { width: 706 },
  candidates: [],
};

function judge(rows: [string, LabelVerdict][]) {
  return photosInDoubt(
    rows.map(([slot]) => ({ slot }) as { slot: 'n' | 'e' | 's' | 'w' }),
    rows.map(([, v]) => v),
  );
}

describe('photosInDoubt', () => {
  it('doubts the field-test hotel photo: seven of eight pieces read the wrong size', () => {
    const e: [string, LabelVerdict][] = [['e', ok], ...Array.from({ length: 7 }, () => ['e', sus] as [string, LabelVerdict])];
    expect([...judge(e)]).toEqual(['e']);
  });

  it('needs a strict majority: half is not enough', () => {
    expect(judge([['n', sus], ['n', sus], ['n', ok], ['n', ok]]).size).toBe(0);
    expect(judge([['n', sus], ['n', sus], ['n', ok]]).has('n')).toBe(true);
  });

  it(`needs ${PHOTO_DOUBT_MIN_READ} pieces read: two misfits of two may be two wrong words`, () => {
    expect(PHOTO_DOUBT_MIN_READ).toBe(3);
    expect(judge([['w', sus], ['w', sus]]).size).toBe(0);
    expect(judge([['w', sus], ['w', sus], ['w', sus]]).has('w')).toBe(true);
  });

  it('does not count unmeasured rows either way', () => {
    // Two misfits of two read, however many the camera could not measure.
    expect(judge([['s', sus], ['s', sus], ['s', unm], ['s', unm], ['s', unm]]).size).toBe(0);
    // ...and unmeasured rows do not dilute a real majority.
    expect(judge([['s', sus], ['s', sus], ['s', ok], ['s', unm], ['s', unm], ['s', unm]]).has('s')).toBe(true);
  });

  it('judges each photo on its own pieces', () => {
    const out = judge([['e', sus], ['e', sus], ['e', sus], ['w', ok], ['w', ok], ['w', sus]]);
    expect([...out]).toEqual(['e']);
  });

  it('is empty for an empty list or missing verdicts', () => {
    expect(photosInDoubt([], []).size).toBe(0);
    expect(photosInDoubt([{ slot: 'n' }, { slot: 'n' }, { slot: 'n' }], []).size).toBe(0);
  });
});

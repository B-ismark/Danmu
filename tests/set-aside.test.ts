import { describe, expect, it } from 'vitest';
import { setAsideSentence, setAsideTitle } from '@/lib/set-aside';

describe('what the detect screen says about rows a reply named and could not be placed (§ 49.19)', () => {
  it('counts its own pieces, singular and plural', () => {
    expect(setAsideTitle(1)).toBe('1 piece left out');
    expect(setAsideTitle(3)).toBe('3 pieces left out');
    expect(setAsideSentence(1)).toMatch(/^Google named 1 piece that /);
    expect(setAsideSentence(4)).toMatch(/^Google named 4 pieces that /);
  });

  it('names every reason a row is set aside, so the user knows what to fix', () => {
    expect(setAsideSentence(2)).toMatch(/a wall you didn’t photograph/);
    expect(setAsideSentence(2)).toMatch(/no name or no box inside the photo/);
  });
});

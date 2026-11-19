// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useStudio } from '@/lib/store';

// The right-click menu's "Paint this wall…" and "Change the floor…" used to open
// only the docked rail, which neither sheet layout reads — so on a phone or a
// tablet the row did nothing. `showDetails` is the one request every layout
// answers: the rail through `railRightOpen`, the sheets through the token.
describe('showDetails', () => {
  it('opens the docked rail and bumps the token the sheets watch', () => {
    const before = useStudio.getState();
    if (before.railRightOpen) before.toggleRail('right');
    expect(useStudio.getState().railRightOpen).toBe(false);
    const token = useStudio.getState().detailsToken;
    useStudio.getState().showDetails();
    expect(useStudio.getState().railRightOpen).toBe(true);
    expect(useStudio.getState().detailsToken).toBe(token + 1);
  });

  it('asks again even when the rail is already open', () => {
    const token = useStudio.getState().detailsToken;
    useStudio.getState().showDetails();
    useStudio.getState().showDetails();
    expect(useStudio.getState().railRightOpen).toBe(true);
    expect(useStudio.getState().detailsToken).toBe(token + 2);
  });
});

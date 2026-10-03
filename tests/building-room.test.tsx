// @vitest-environment jsdom
//
// The Building screen states facts about the room, so the facts are pinned: the
// floor is the outline's area and not its box, a rough room says so on every
// figure, and the step it shows is the last one.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BuildingRoom } from '@/components/ui/BuildingRoom';
import { footprintForLayout } from '@/lib/footprint';
import { polygonArea } from '@/lib/geometry';

afterEach(cleanup);

const dd = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent;

describe('BuildingRoom', () => {
  it('an L’s floor is its outline’s area, not the box around it', () => {
    const footprint = footprintForLayout('l', 6, 5);
    const area = polygonArea(footprint);
    expect(area).toBeLessThan(30); // the fixture has to tell the two apart
    render(
      <BuildingRoom
        dimUnit="m"
        facts={{ width: 6, depth: 5, height: 2.7, footprint, rough: false, pieces: 3, photos: 4 }}
      />,
    );
    expect(dd('Floor')).toContain(area.toFixed(1));
    expect(dd('Floor')).not.toContain('30');
    expect(dd('Kept from photos')).toBe('3');
    expect(dd('Photos')).toBe('4');
    expect(screen.getByText(/× .*high\./).textContent).not.toContain('≈');
    expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/Room/);
    // A heading that stays a heading, and a separate live region that says it.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Building your room');
    expect(screen.getByRole('status').textContent).toBe('Building your room');
  });

  it('a rough room marks every figure approximate, and one photo is singular', () => {
    render(
      <BuildingRoom
        dimUnit="m"
        facts={{ width: 4, depth: 3, height: 2.5, footprint: footprintForLayout('rect', 4, 3), rough: true, pieces: 1, photos: 1 }}
      />,
    );
    const lede = screen.getByText(/× .*high\./).textContent!;
    expect(lede.match(/≈/g)).toHaveLength(3);
    expect(dd('Floor')).toMatch(/^≈/);
    expect(dd('Kept from photos')).toBe('1');
    expect(dd('Photo')).toBe('1');
  });

  it('with the room not yet read, says only what it is doing', () => {
    render(<BuildingRoom dimUnit="m" facts={null} />);
    // A heading that stays a heading, and a separate live region that says it.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Building your room');
    expect(screen.getByRole('status').textContent).toBe('Building your room');
    expect(document.querySelector('dl')).toBeNull();
  });

  it('says pieces come in at typical sizes, and keeps the never-squeezed promise', () => {
    render(<BuildingRoom dimUnit="m" facts={null} />);
    const note = document.querySelector('.build-screen__note')!.textContent!;
    expect(note).toMatch(/typical sizes/);
    expect(note).toMatch(/flagged, never squeezed/);
    expect(note).not.toMatch(/real furniture ranges/);
  });

  it('draws a progress cue that assistive tech does not hear', () => {
    render(<BuildingRoom dimUnit="m" facts={null} />);
    expect(document.querySelector('.build-screen__bar')?.getAttribute('aria-hidden')).toBe('true');
  });
});

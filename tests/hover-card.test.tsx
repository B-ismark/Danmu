// @vitest-environment jsdom
// The hover card names a piece the way the Inspector does: its name, and beside it the
// Library shelf (§ 41) — never `category`, the internal key that calls a radiator
// "Fridge".

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useScene } from '@/lib/scene-store';
import { useStudio } from '@/lib/store';
import { HoverCard } from '@/components/studio/HoverCard';
import type { ScenePart } from '@/lib/scene-spec';

const radiator = {
  id: 'radiator', name: 'Radiator', category: 'fridge', shape: 'radiator',
  dimMM: [800, 120, 580], pos: [0, 0, 0], rot: 0, locked: false,
} as ScenePart;

describe('the hover card', () => {
  it('shows the name and its Library shelf, and not the internal category', () => {
    useScene.setState({ parts: [radiator] });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, hoveredPartId: 'radiator', selectedPartId: null });
    render(<HoverCard />);
    expect(screen.getByText('Radiator')).toBeTruthy();
    expect(screen.getByText('Appliances')).toBeTruthy();
    expect(screen.queryByText(/fridge/i)).toBeNull();
  });
});

// @vitest-environment jsdom
// The hover card is a name bubble and nothing else: no shelf, no size, no pills. It
// never prints `category`, the internal key that calls a radiator "Fridge".

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
  it('shows only the name — no shelf, size, pill or internal category', () => {
    useScene.setState({ parts: [radiator] });
    useStudio.setState({ positions: {}, rotations: {}, dims: {}, hoveredPartId: 'radiator', selectedPartId: null });
    render(<HoverCard />);
    expect(screen.getByText('Radiator')).toBeTruthy();
    expect(screen.queryByText('Appliances')).toBeNull();
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.queryByText(/580|800/)).toBeNull();
    expect(screen.queryByText(/fridge/i)).toBeNull();
  });
});

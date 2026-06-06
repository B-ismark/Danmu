import { describe, it, expect } from 'vitest';
import { tierFor, composePrompt, estimateRenderCost, BUDGET_TIERS } from '@/lib/prompt';

describe('tierFor', () => {
  it('maps budget values to the right tier', () => {
    expect(tierFor(0).label).toBe('Artisanal');
    expect(tierFor(25).label).toBe('Artisanal');
    expect(tierFor(26).label).toBe('Mid-market');
    expect(tierFor(85).label).toBe('Premium');
    expect(tierFor(100).label).toBe('Showroom');
  });

  it('clamps out-of-range budgets to the top tier', () => {
    expect(tierFor(999)).toBe(BUDGET_TIERS[BUDGET_TIERS.length - 1]);
  });
});

describe('composePrompt', () => {
  it('includes style tokens and preserved/placed object names', () => {
    const p = composePrompt({
      styleId: 'warm-min',
      budget: 40,
      lockedNames: ['Sofa'],
      ghostNames: ['Rug'],
    });
    expect(p).toContain('preserve Sofa');
    expect(p).toContain('place Rug');
    expect(p).toContain('warm neutral palette');
  });

  it('enumerates moves and removals when supplied', () => {
    const p = composePrompt({
      styleId: 'coastal',
      budget: 50,
      lockedNames: [],
      ghostNames: [],
      movedNames: ['Lamp'],
      removedNames: ['TV'],
    });
    expect(p).toContain('relocate Lamp');
    expect(p).toContain('remove TV');
  });

  it('omits empty clauses', () => {
    const p = composePrompt({ styleId: 'studio', budget: 10, lockedNames: [], ghostNames: [] });
    expect(p).not.toContain('preserve ');
    expect(p).not.toContain('place ');
  });
});

describe('estimateRenderCost', () => {
  it('reports free for the experimental path', () => {
    expect(estimateRenderCost(1, 'exp').isPaid).toBe(false);
    expect(estimateRenderCost(1, 'exp').display).toBe('FREE');
  });

  it('scales paid cost by variant count', () => {
    const one = estimateRenderCost(1, 'ultra', 'USD').amount;
    const three = estimateRenderCost(3, 'ultra', 'USD').amount;
    expect(three).toBeCloseTo(one * 3);
    expect(estimateRenderCost(1, 'ultra', 'USD').isPaid).toBe(true);
  });
});

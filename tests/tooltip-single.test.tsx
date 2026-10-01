// @vitest-environment jsdom
//
// One name per button on hover, not two.
//
// The rail's revert square showed our bubble ("Put everything back") at once and the
// browser's native `title` a second later underneath it, in another font and other
// words. `IconButton` copies its `label` into `title` by default, so wrapping one in a
// `Tooltip` was all it took. Under a `Tooltip` it leaves `title` off now
// (`InsideTooltip`), and the sweep below holds the call sites that wrap a raw element
// to the same rule, since a context cannot reach a `title=` written by hand.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from '@/components/ui/Tooltip';
import { IconButton } from '@/components/ui/primitives';

describe('IconButton under a Tooltip', () => {
  it('leaves the native title off, so the bubble is the only name on hover', () => {
    render(
      <Tooltip label="Start over">
        <IconButton icon="rotate-ccw" label="Start over: put the room back" />
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'Start over: put the room back' });
    expect(btn.hasAttribute('title')).toBe(false);
  });

  it('keeps its title on its own, where the title is the only hover name it has', () => {
    render(<IconButton icon="rotate-ccw" label="Undo" />);
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo');
  });
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('every Tooltip call site', () => {
  const files = [...sources('components'), ...sources('app')];
  const sites = files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const found: Array<{ file: string; child: string }> = [];
    // Everything between the tags: an opening tag cannot be cut at its first `>`,
    // because an `onClick={() => …}` has one.
    for (const m of text.matchAll(/<Tooltip\b[^>]*>([\s\S]*?)<\/Tooltip>/g)) found.push({ file, child: m[1] });
    return found;
  });

  it('is found, so the sweep below is looking at something', () => {
    // RailFooter, the rail strip, the Catalog's re-scan and the lighting moods: one
    // written site each. A literal, so a new call site is a decision to update it.
    expect(sites.map((s) => s.file.split('/').pop()).sort()).toEqual([
      'LightingPicker.tsx',
      'PartTree.tsx',
      'RailFooter.tsx',
      'shell-parts.tsx',
    ]);
  });

  it('wraps an element that does not carry a title of its own', () => {
    const doubled = sites.filter((s) => /\btitle=/.test(s.child)).map((s) => s.file);
    expect(doubled).toEqual([]);
  });
});

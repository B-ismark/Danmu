import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHYSICAL_SURFACES } from '@/components/three/materials';

// A physical-only preset spread onto `meshStandardMaterial` does not fail — three
// drops `sheen` silently and the cloth renders as flat as before. Lamp shades and
// curtains were both drawn that way. `Box` and the instanced primitives choose the
// material themselves; this holds the hand-written materials to the same rule.
const DIR = join(process.cwd(), 'components/three');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));

describe('physical-only surfaces reach a physical material', () => {
  it('scans the renderers it claims to', () => {
    expect(files).toContain('DynamicPart.tsx');
    expect(files).toContain('Box.tsx');
  });

  for (const key of PHYSICAL_SURFACES) {
    it(`no <meshStandardMaterial> spreads SURFACE.${key}`, () => {
      const bad = new RegExp(`<meshStandardMaterial[^>]*\\{\\.\\.\\.SURFACE\\.${key}\\}`);
      const hits = files.filter((f) => bad.test(readFileSync(join(DIR, f), 'utf8')));
      expect(hits).toEqual([]);
    });
  }

  it('the instanced primitives switch on sheen, which is what every physical preset carries', () => {
    const box = readFileSync(join(DIR, 'Box.tsx'), 'utf8');
    expect(box).toMatch(/'sheen' in surface \? \(\s*<meshPhysicalMaterial/);
  });
});

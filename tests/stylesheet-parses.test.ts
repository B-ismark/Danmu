// The one stylesheet has to PARSE. A stray `}` in globals.css passed typecheck, lint
// and every test here — they read tokens out of the file with regexes, which do not
// care about balance — and showed up only as a 500 on every page of `next dev`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

describe('app/globals.css', () => {
  it('is syntactically valid CSS', () => {
    expect(() => postcss.parse(css)).not.toThrow();
  });

  // Tailwind 4 moved from `@tailwind base` to `@import`, and the obvious line —
  // `@import "tailwindcss"` — brings a theme and every utility with it, and puts
  // Preflight in `@layer base`, where it can no longer beat a hand-written rule on
  // specificity the way it did unlayered. The v3 → v4 move was measured at visual
  // parity (every element's computed style, six screens, light / dark / phone) with
  // exactly this import, so this pins it: Preflight alone, unlayered, before any rule.
  it('takes Tailwind as Preflight alone, unlayered, ahead of every rule', () => {
    const root = postcss.parse(css);
    const imports = root.nodes.filter(
      (n): n is postcss.AtRule => n.type === 'atrule' && n.name === 'import',
    );
    expect(imports.map((n) => n.params)).toEqual(["'tailwindcss/preflight.css'"]);
    const first = root.nodes.find((n) => n.type !== 'comment');
    expect(first).toBe(imports[0]);
    // Parsed at-rules, not the raw text: the comment above the import names
    // `@tailwind base` to say where v3 put it.
    const tailwindOnly: string[] = [];
    root.walkAtRules(/^(tailwind|config|theme|plugin|source|utility)$/, (r) => {
      tailwindOnly.push(`@${r.name} ${r.params}`);
    });
    expect(tailwindOnly).toEqual([]);
  });
});

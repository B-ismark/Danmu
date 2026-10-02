// The short front page stays short, and never names a file that is gone.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const PAGE = readFileSync(join(ROOT, 'docs/START-HERE.md'), 'utf8');

describe('docs/START-HERE.md', () => {
  it('stays under 100 lines', () => {
    expect(PAGE.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('keeps exactly ten rules', () => {
    const rules = PAGE.match(/^\d+\. \*\*/gm) ?? [];
    expect(rules).toHaveLength(10);
  });

  it('names only files that exist', () => {
    const paths = new Set<string>();
    for (const m of PAGE.matchAll(/`((?:lib|tests|app|components|docs)\/[\w./-]+\.\w+)`/g)) paths.add(m[1]);
    for (const m of PAGE.matchAll(/`([\w.-]+\.(?:md|mjs))`/g)) paths.add(m[1]);
    for (const m of PAGE.matchAll(/\]\(([^)#]+)\)/g)) paths.add(join('docs', m[1]));
    expect(paths.size).toBeGreaterThan(15);
    const missing = [...paths].filter((p) => !existsSync(join(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it('is linked from the README and from CLAUDE.md', () => {
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain('docs/START-HERE.md');
    expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')).toContain('docs/START-HERE.md');
  });
});

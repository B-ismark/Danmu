// The one stylesheet has to PARSE. A stray `}` in globals.css passed typecheck, lint
// and every test here — they read tokens out of the file with regexes, which do not
// care about balance — and showed up only as a 500 on every page of `next dev`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('app/globals.css', () => {
  it('is syntactically valid CSS', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(() => postcss.parse(css)).not.toThrow();
  });
});

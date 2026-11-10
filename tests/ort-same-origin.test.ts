// The ONNX runtime executes inside this origin, which holds the user's API key and every
// room, and a dynamic import() cannot carry an integrity hash. So it ships same-origin
// (scripts/vendor-ort.mjs, run by `dev` and `build`) and there is no CDN to fall back to.
// This pins both halves: the loader names no remote host, and the served CSP allows no
// third-party script host.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './helpers/source';

type HeaderRule = { headers: Array<{ key: string; value: string }> };

async function servedCsp(): Promise<string> {
  const spec = '../next.config.mjs';
  const { default: cfg } = (await import(spec)) as { default: { headers: () => Promise<HeaderRule[]> } };
  const rules = await cfg.headers();
  const csp = rules.flatMap((r) => r.headers).find((h) => h.key.toLowerCase() === 'content-security-policy');
  if (!csp) throw new Error('no CSP served');
  return csp.value;
}

describe('ONNX Runtime is same-origin only', () => {
  it('the loader contains no remote URL and no CDN host', () => {
    const src = stripComments(readFileSync('lib/local-detect.ts', 'utf8'));
    expect(src).not.toMatch(/jsdelivr|unpkg|cdnjs/i);
    // The runtime import is built from the local base alone.
    expect(src).toContain('${ORT_LOCAL_BASE}${ORT_ENTRY}');
    expect(src).not.toMatch(/ORT_CDN/);
  });

  it('the served CSP names no ORT / jsDelivr host', async () => {
    const csp = await servedCsp();
    expect(csp).not.toMatch(/jsdelivr|unpkg|cdnjs/i);
    const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
    // script-src carries no http(s) host at all.
    expect(script).not.toMatch(/https?:/);
  });

  it('dev and build vendor the runtime first', () => {
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.dev).toMatch(/^node scripts\/vendor-ort\.mjs && /);
    expect(scripts.build).toMatch(/^node scripts\/vendor-ort\.mjs && /);
  });
});

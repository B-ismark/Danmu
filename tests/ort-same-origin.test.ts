// The ONNX runtime executes inside this origin, which holds the user's API key and every
// room, and a dynamic import() cannot carry an integrity hash. So it ships same-origin
// (scripts/vendor-ort.mjs, run by `dev` and `build`) and there is no CDN to fall back to.
// This pins both halves: the loader names no remote host, and the served CSP allows no
// third-party script host.

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('a missing runtime is said, never silently rerouted', () => {
  const setup = async (ort: (n: number) => boolean) => {
    vi.resetModules();
    let n = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/ort/')) return { ok: ort(++n), headers: new Headers() };
      return { ok: true, headers: new Headers() }; // the model is served
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return import('../lib/local-detect');
  };

  it('model present + runtime absent is reported as missing, not as "no model"', async () => {
    const m = await setup(() => false);
    expect(await m.localDetectorAvailable()).toBe(true);
    expect(await m.localRuntimeMissing()).toBe(true);
  });

  it('does not cache a failed probe', async () => {
    const m = await setup((n) => n > 1); // first HEAD fails, then succeeds
    expect(await m.localRuntimeMissing()).toBe(true);
    expect(await m.localRuntimeMissing()).toBe(false);
  });

  it('the scan screen shows the notice and does not take the local branch', () => {
    const src = readFileSync('app/onboarding/detect/page.tsx', 'utf8');
    expect(src).toContain("code: 'LOCAL_UNAVAILABLE'");
    expect(src).toContain('if (runtimeMissing) setNotice(localUnavailable);');
    expect(src).toContain('&& !runtimeMissing) {');
    expect(src).toContain('if (runtimeMissing && !apiKeyRef.current)');
  });
});

describe('vendor-ort is idempotent', () => {
  it('a second run skips and leaves the files untouched', () => {
    const script = join(process.cwd(), 'scripts', 'vendor-ort.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'ort-'));
    try {
      // cwd is a scratch dir, so this never touches the repo's public/ort/.
      const run = () => execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
      expect(run()).toContain('copied');
      const f = join(dir, 'public', 'ort', 'ort.min.mjs');
      const t = statSync(f).mtimeMs;
      expect(run()).toContain('skipped');
      expect(statSync(f).mtimeMs).toBe(t);
      expect(readFileSync(join(dir, 'public', 'ort', '.vendored-version'), 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

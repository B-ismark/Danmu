// The local detector's runtime (onnxruntime-web) is copied into public/ort/ by
// scripts/vendor-ort.mjs and loaded at runtime, never bundled. Two things keep
// that working across a version bump, and before this file both were held only
// by comments:
//
//  1. `ORT_VERSION` in lib/local-detect.ts names the version the app expects. It
//     must equal the exact devDependency in package.json, or the types compiled
//     against drift from the wasm actually executed.
//  2. The vendor script copies only the files `ort.min.mjs` requests. If a new
//     release asks for a file under a new name, the copy omits it and the
//     detector fails to load in the browser — with every gate below the browser
//     green. So the names the entry file actually references are read out of the
//     installed dist and checked against the script's own list.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readSource } from './helpers/source';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { devDependencies: Record<string, string> };
const declared = pkg.devDependencies['onnxruntime-web'];

/** The script's WANTED patterns, read from its source: it runs on import, so it
 *  cannot be imported, and a hand-copied list here would be a second list to drift. */
function wantedPatterns(): RegExp[] {
  const src = readSource('scripts/vendor-ort.mjs');
  const block = src.slice(src.indexOf('const WANTED = ['), src.indexOf('];', src.indexOf('const WANTED = [')));
  const found = [...block.matchAll(/^\s*\/(.+)\/,?\s*$/gm)].map((m) => new RegExp(m[1]));
  return found;
}

function installedDist(): string {
  // The package's exports map hides package.json; its folder under node_modules
  // is where pnpm links it.
  return path.join('node_modules', 'onnxruntime-web', 'dist');
}

describe('onnxruntime-web', () => {
  it('is pinned exactly, with no range, in package.json', () => {
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ORT_VERSION in lib/local-detect.ts is the same version', () => {
    const m = readSource('lib/local-detect.ts').match(/const ORT_VERSION = '([^']+)';/);
    expect(m?.[1]).toBe(declared);
  });

  it('the installed package is the declared version', () => {
    const installed = JSON.parse(readFileSync(path.join('node_modules', 'onnxruntime-web', 'package.json'), 'utf8')) as { version: string };
    expect(installed.version).toBe(declared);
  });

  it('the vendor list is read: four patterns, the entry and the jsep pair among them', () => {
    const wanted = wantedPatterns();
    expect(wanted).toHaveLength(4);
    for (const f of ['ort.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
      expect(wanted.some((re) => re.test(f)), f).toBe(true);
    }
  });

  it('every runtime file the entry requests is one the vendor script copies, and exists', () => {
    const dist = installedDist();
    const entry = readFileSync(path.join(dist, 'ort.min.mjs'), 'utf8');
    const requested = [...new Set(entry.match(/ort-wasm-[a-z0-9.-]+\.mjs/g) ?? [])];
    // The entry names its loader; the loader fetches the .wasm beside it.
    expect(requested).toEqual(['ort-wasm-simd-threaded.jsep.mjs']);
    const wanted = wantedPatterns();
    for (const mjs of requested) {
      for (const f of [mjs, mjs.replace(/\.mjs$/, '.wasm')]) {
        expect(wanted.some((re) => re.test(f)), `${f} is not in vendor-ort's WANTED`).toBe(true);
        expect(existsSync(path.join(dist, f)), `${f} is missing from the dist`).toBe(true);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { major, satisfies } from 'semver';

// This suite exists because of an outage the other 189 tests could not see.
//
// The Next 14 → 15 upgrade left `react` on 18.3.1, reasoning that Next 15's peer
// range still accepts `^18.2`. It does — and it is irrelevant. The App Router
// aliases the CLIENT bundle to Next's OWN vendored React 19, which dropped the
// `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` export that
// `react-reconciler@0.27` — the renderer under @react-three/fiber v8 — reads on
// mount. So every visit to /room/[roomId]/model threw
//
//   TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')
//
// and rendered app/error.tsx instead of the studio. The 3D view is the product,
// and typecheck, lint, build and the whole unit suite were all green while it was
// down: nothing here renders a component, so nothing here noticed.
//
// The invariant these tests guard is the one that was actually violated — the
// React the 3D stack MEETS AT RUNTIME (Next's vendored copy) has to be the React
// the 3D stack was BUILT FOR. Checking the peer ranges alone would not have
// caught it: react@18.3.1 satisfies fiber v8's `>=18 <19` perfectly well.

const ROOT = process.cwd();

function installed(pkg: string): string {
  const p = join(ROOT, 'node_modules', ...pkg.split('/'), 'package.json');
  return JSON.parse(readFileSync(p, 'utf8')).version as string;
}

function peerRange(pkg: string, dep: string): string | undefined {
  const p = join(ROOT, 'node_modules', ...pkg.split('/'), 'package.json');
  const peers = JSON.parse(readFileSync(p, 'utf8')).peerDependencies ?? {};
  return peers[dep] as string | undefined;
}

const peerReact = (pkg: string) => peerRange(pkg, 'react') as string;

/** The React major the App Router actually serves to the browser. */
function vendoredReactMajor(): number {
  const p = join(
    ROOT,
    'node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.development.js',
  );
  const src = readFileSync(p, 'utf8');
  const m = /exports\.version\s*=\s*["']([^"']+)["']/.exec(src);
  // A hard failure, not a skip: if this probe stops resolving, the guard is
  // blind, and a blind guard on this particular invariant already cost the
  // product its main screen once.
  expect(m, 'cannot read Next vendored react-dom version — update this probe').not.toBeNull();
  return major(m![1].replace(/-canary.*$/, ''));
}

const THREE_STACK = ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'];

/** Everything that renders THROUGH three and therefore has to agree with the
 *  copy of it we install. `postprocessing` is the one that actually bites: it is
 *  a plain dependency rather than part of the R3F family, it ships an UPPER
 *  bound, and it is the reason this project sits on r184 rather than the latest
 *  release. */
const THREE_CONSUMERS = [...THREE_STACK, 'three-stdlib', 'postprocessing'];

describe('React runtime matches the 3D stack it renders', () => {
  it('app react major equals the React major Next vendors for the client', () => {
    expect(major(installed('react'))).toBe(vendoredReactMajor());
  });

  it('react-dom moves with react', () => {
    expect(major(installed('react-dom'))).toBe(major(installed('react')));
  });

  it.each(THREE_STACK)('%s declares a react peer range that admits the installed react', (pkg) => {
    const range = peerReact(pkg);
    const react = installed('react');
    expect(range, `${pkg} declares no react peer`).toBeTruthy();
    expect(
      satisfies(react, range, { includePrerelease: true }),
      `${pkg} peers react@${range}, but react@${react} is installed — the 3D route will throw on mount`,
    ).toBe(true);
  });
});

// The same class of fault one layer down. react/fiber was the pairing that took
// the studio out; three/drei/postprocessing is the pairing that can, and a peer
// range with an UPPER bound is the one that goes stale silently — `pnpm add`
// prints a warning and installs anyway, and nothing downstream fails until a
// shader or a class that moved is reached at runtime.
describe('three matches the stack rendering through it', () => {
  it.each(THREE_CONSUMERS)('%s admits the installed three', (pkg) => {
    const range = peerRange(pkg, 'three');
    const three = installed('three');
    expect(range, `${pkg} declares no three peer`).toBeTruthy();
    expect(
      satisfies(three, range!, { includePrerelease: true }),
      `${pkg} peers three@${range}, but three@${three} is installed`,
    ).toBe(true);
  });

  it('types track the runtime three, minor for minor', () => {
    // three is pre-1.0, so its MINOR is its breaking-change axis: @types/three
    // 0.169 against three 0.184 type-checks a fifteen-release-old API and calls
    // it green.
    const runtime = installed('three');
    const types = installed('@types/three');
    expect(types.split('.').slice(0, 2).join('.')).toBe(runtime.split('.').slice(0, 2).join('.'));
  });
});

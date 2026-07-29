// Copy the ONNX Runtime web distribution into public/ort/ so the browser loads it
// from this origin instead of a third-party CDN.
//
// Why this exists: lib/local-detect.ts loads the runtime with a dynamic
// `import()` of a remote URL. A dynamic import cannot carry a subresource
// integrity hash, so nothing verified what came back — and whatever came back ran
// with full access to the page origin, which holds the user's Google API key
// (localStorage) and every room they own (IndexedDB). Version-pinning the CDN
// path is a compatibility control, not an integrity one.
//
// The runtime still must NOT be bundled — `onnxruntime-web`'s prebuilt dists
// break Next's server pass, which is why the import is marked `webpackIgnore`.
// Serving the same files from public/ keeps that property and removes the third
// party. public/ort/ is git-ignored; run this after install.
//
//   node scripts/vendor-ort.mjs      (or: pnpm vendor:ort)
//
// If it has not been run, lib/local-detect.ts falls back to the CDN, so a fresh
// clone still works — it just trusts jsDelivr until this is run.

import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Locate the installed package root.
 *
 *  `require.resolve('onnxruntime-web/package.json')` does NOT work: the package
 *  ships an `exports` map that does not expose ./package.json, so subpath
 *  resolution refuses it. Resolve the module entry instead and walk up until a
 *  package.json with the right name turns up — which also copes with pnpm's
 *  symlinked store layout. */
async function findPackageRoot(name) {
  let dir = path.dirname(require.resolve(name));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(await readFile(candidate, 'utf8'));
      if (pkg.name === name) return { root: dir, version: pkg.version };
    } catch {
      // Not this level — keep climbing.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Only what the wasm/webgpu backends actually request at runtime. The full dist
// is ~40 MB across every backend and variant; this is the subset ort.min.mjs
// pulls in.
const WANTED = [
  /^ort\.min\.mjs$/,
  /^ort\.min\.mjs\.map$/,
  /^ort-wasm-simd-threaded\.(mjs|wasm)$/,
  /^ort-wasm-simd-threaded\.jsep\.(mjs|wasm)$/,
];

async function main() {
  let found = null;
  try {
    found = await findPackageRoot('onnxruntime-web');
  } catch {
    // resolve() itself threw — package absent.
  }
  if (!found) {
    console.error('[vendor-ort] onnxruntime-web is not installed — run your install first.');
    process.exit(1);
  }

  const distDir = path.join(found.root, 'dist');
  try {
    await stat(distDir);
  } catch {
    console.error(`[vendor-ort] no dist directory at ${distDir}`);
    process.exit(1);
  }

  const outDir = path.resolve('public', 'ort');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = await readdir(distDir);
  const picked = files.filter((f) => WANTED.some((re) => re.test(f)));
  if (picked.length === 0) {
    console.error('[vendor-ort] nothing matched — has the onnxruntime-web dist layout changed?');
    process.exit(1);
  }

  let bytes = 0;
  for (const f of picked) {
    const from = path.join(distDir, f);
    await cp(from, path.join(outDir, f));
    bytes += (await stat(from)).size;
  }

  console.log(
    `[vendor-ort] copied ${picked.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB) ` +
      `from onnxruntime-web@${found.version} → public/ort/`,
  );
  console.log('[vendor-ort] the CDN is now only a fallback. Keep ORT_VERSION in lib/local-detect.ts in step with this version.');
}

main().catch((e) => {
  console.error('[vendor-ort]', e);
  process.exit(1);
});

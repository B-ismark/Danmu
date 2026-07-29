// Print SHA-256 digests for the detector weights in public/models/, formatted so
// they can be pasted into MODEL_DIGESTS in lib/local-detect.ts.
//
// Why: the weights are fetched from a public mirror when public/models/ is empty,
// and handed straight to the wasm runtime. A HEAD 200 was the only validation,
// so a substituted graph would have been accepted — at minimum a wrong-results
// vector on the path the product presents as the trustworthy one.
//
// The registry in lib/local-detect.ts is EMPTY by default on purpose. Pinning a
// digest that does not match what the mirror actually serves would fail closed
// and silently disable the detector for every fresh clone, so the pin has to be
// made by someone who can verify both sides:
//
//   1. Export locally:  python scripts/export-detector.py
//   2. Download the mirror copy of each file and confirm it matches:
//        curl -sL https://huggingface.co/DearthAI/danmu-detector/resolve/main/<file> | sha256sum
//   3. Run this script and paste the output into MODEL_DIGESTS.
//
// Until that is done, remote fetches are still format-checked (ONNX protobuf
// magic plus a size range), which catches the realistic failure — an HTML error
// page or an entirely different file — just not a knowing substitution.
//
//   node scripts/hash-models.mjs      (or: pnpm hash:models)

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('public', 'models');

async function main() {
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.onnx') || f.endsWith('.names.json')).sort();
  } catch {
    console.error(`[hash-models] no ${dir} — run scripts/export-detector.py first.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error('[hash-models] public/models/ is empty.');
    process.exit(1);
  }

  console.log('// Paste into MODEL_DIGESTS in lib/local-detect.ts, but read the');
  console.log('// header of scripts/hash-models.mjs first — verify the mirror matches.');
  for (const f of files) {
    const buf = await readFile(path.join(dir, f));
    const digest = createHash('sha256').update(buf).digest('hex');
    console.log(`  '${f}': 'sha256-${digest}', // ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch((e) => {
  console.error('[hash-models]', e);
  process.exit(1);
});

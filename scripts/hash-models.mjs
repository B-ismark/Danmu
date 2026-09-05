// Print SHA-256 digests for the detector weights, and check the local export
// against what the Hugging Face mirror actually serves.
//
// Why: the weights are fetched from a public mirror when public/models/ is empty,
// and handed straight to the wasm runtime. A HEAD 200 was the only validation,
// so a substituted graph would have been accepted — at minimum a wrong-results
// vector on the path the product presents as the trustworthy one.
//
// MODEL_DIGESTS in lib/model-verify.ts is now pinned, and a pin is only sound if
// BOTH sides were checked. Pinning from the local export alone would fail closed
// and silently disable the detector for every fresh clone — worse than the gap it
// closes. So this script does both sides itself rather than leaving the remote
// half as a note someone has to remember:
//
//   node scripts/hash-models.mjs              local digests only
//   node scripts/hash-models.mjs --verify     also fetch the mirror and compare
//
// `--verify` downloads ~62 MB. Run it when re-pinning, when bumping the mirror,
// and in the release check. A mismatch is the signal to STOP and find out why —
// not to delete the entry so the detector works again.
//
// Independent of the registry, remote graphs are also format-checked (ONNX
// protobuf magic plus a size range), which catches the realistic failure — an
// HTML error page or a truncated download — but not a knowing substitution.
//
//   pnpm hash:models              /  pnpm hash:models --verify

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('public', 'models');
const REMOTE_BASE = 'https://huggingface.co/DearthAI/danmu-detector/resolve/main/';
const verify = process.argv.includes('--verify');

const sha256 = (buf) => `sha256-${createHash('sha256').update(buf).digest('hex')}`;

async function remoteDigest(file) {
  const res = await fetch(REMOTE_BASE + file, { redirect: 'follow' });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  return { digest: sha256(buf), bytes: buf.length };
}

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

  console.log('// Paste into MODEL_DIGESTS in lib/model-verify.ts.');
  if (!verify) console.log('// Re-run with --verify to confirm the mirror serves these same bytes.');
  const local = new Map();
  for (const f of files) {
    const buf = await readFile(path.join(dir, f));
    const digest = sha256(buf);
    local.set(f, digest);
    console.log(`  '${f}':\n    '${digest}', // ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  }

  if (!verify) return;

  console.log(`\n[hash-models] fetching ${files.length} file(s) from the mirror to compare…`);
  let bad = 0;
  for (const f of files) {
    const r = await remoteDigest(f);
    if (r.error) {
      console.log(`  ✗ ${f} — mirror unreachable (${r.error})`);
      bad++;
    } else if (r.digest !== local.get(f)) {
      console.log(`  ✗ ${f} — MISMATCH`);
      console.log(`      local  ${local.get(f)}`);
      console.log(`      mirror ${r.digest}`);
      bad++;
    } else {
      console.log(`  ✓ ${f} — matches (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`);
    }
  }
  if (bad > 0) {
    console.error(
      `\n[hash-models] ${bad} file(s) did not match. Do NOT pin these digests — find out why first.`,
    );
    process.exit(1);
  }
  console.log('\n[hash-models] local export and mirror agree. Safe to pin.');
}

main().catch((e) => {
  console.error('[hash-models]', e);
  process.exit(1);
});

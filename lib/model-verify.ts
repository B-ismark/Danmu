// What may be handed to the wasm runtime — the detector's trust boundary, on its own.
//
// This lived inside `lib/local-detect.ts`, where every function in it was
// module-private and every one of them was reachable only through `load()`, which
// dynamically imports `onnxruntime-web`. So the digest pin over a 14 MB and a 50 MB
// download from a public mirror — the one thing standing between that mirror and code
// executing on an origin that holds the user's Google API key and every room they own —
// **had no test at all**, and `pnpm hash:models --verify` (a ~62 MB download, run by
// hand) was the only check that it worked.
//
// Splitting it out changes no behaviour. It moves a security boundary somewhere a test
// can address it directly, with bytes it makes up, in milliseconds. That is the whole
// reason this file exists, and it is the same argument `lib/drag-click.ts` makes for
// living outside `store.ts`.
//
// ─── Weights integrity ──────────────────────────────────────────────────────
//
// A HEAD 200 used to be the only validation on those two graphs.
//
// Each digest below was verified on BOTH sides before being pinned — the local export in
// `public/models/` and the bytes the mirror actually serves over `/resolve/main/` hash
// identically. That check is the whole point: a digest pinned from the local copy alone
// would fail closed and silently disable the detector for every fresh clone, which is
// worse than the gap it closes. `pnpm hash:models` prints the local side; its header
// documents the remote side.
//
// A mismatch means the mirror changed. That is exactly when the detector SHOULD refuse:
// the fetch returns null, the app reports the detector as unavailable, and the Gemini /
// manual-box paths carry on. Re-verify and re-pin deliberately rather than deleting the
// entry to make it work again.
//
// Independent of the registry, every REMOTE file is format-checked: an ONNX file is a
// protobuf, and the realistic failure mode is receiving something that is not one at all
// (an HTML error page, a redirect body, a truncated download). Local files are the
// user's own export and are trusted as-is.
// The three files fetched from the mirror. They live HERE, beside the registry, rather
// than in `local-detect.ts` where they were declared, because "what the app downloads"
// and "what is pinned" drifting apart is the one failure this registry cannot report:
// renaming a graph on one side alone leaves a real download with no digest behind it,
// and `digestMatches` answers TRUE for an unpinned name by design. One list, two readers.
export const MODEL_FILE = 'yolov8n-oiv7.onnx';
export const NAMES_FILE = 'yolov8n-oiv7.names.json';
/** Second, open-vocabulary pass. Optional: when it is absent (e.g. an older local
 *  export) detection still runs on the OIV7 model alone. */
export const WORLD_FILE = 'yolov8s-worldv2-danmu.onnx';
export const REMOTE_FILES = [MODEL_FILE, NAMES_FILE, WORLD_FILE] as const;

export const MODEL_DIGESTS: Record<string, string> = {
  'yolov8n-oiv7.names.json':
    'sha256-8126ccfbc3780e25825a1beae446edf7d663b69223b5ce796d8499ea8c3ce13d',
  'yolov8n-oiv7.onnx':
    'sha256-10833f3633b96c0e7554564d06be8449191ac3c36b3e9d4df7387b41b4187c33',
  'yolov8s-worldv2-danmu.onnx':
    'sha256-3a04741b738b1b6c756e00dfe5fe322765efba93699b331200e625f963d37f5b',
};

/** Plausible size window for a detector graph, so a 400-byte error page or a 1 GB
 *  surprise is refused before it is parsed. */
export const MIN_MODEL_BYTES = 1 * 1024 * 1024;
export const MAX_MODEL_BYTES = 512 * 1024 * 1024;

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when `buf` looks like a serialised ONNX ModelProto. Field 1 (ir_version) is a
 *  varint, so a well-formed file starts with the tag byte 0x08. */
export function looksLikeOnnx(buf: ArrayBuffer): boolean {
  if (buf.byteLength < MIN_MODEL_BYTES || buf.byteLength > MAX_MODEL_BYTES) return false;
  const head = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  if (head[0] !== 0x08) return false;
  // The producer_name / domain strings appear early in every graph we ship. `ai.onnx`
  // is deliberately NOT a third disjunct: it CONTAINS `onnx`, so it could never be the
  // literal that decided an answer, and a reader seeing it there would reasonably think
  // dropping `onnx` was safe. It is not — `pytorch` is the only independent one, which
  // is why deleting THAT is the mutation that goes red and deleting `ai.onnx` was not.
  const text = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(4096, buf.byteLength)));
  return text.includes('onnx') || text.includes('pytorch');
}

/** Whether these bytes may be used for `file`.
 *
 *  **A file with no pinned digest passes**, and that is deliberate: the registry is
 *  allowed to be partial, so adding a model file does not require a release to pin it
 *  first. It is also the reason `MODEL_DIGESTS` is asserted to be non-empty rather than
 *  merely well-formed — an empty registry would let everything through while every
 *  function here still returned the answer it was written to return. */
export async function digestMatches(file: string, buf: ArrayBuffer): Promise<boolean> {
  const expected = MODEL_DIGESTS[file];
  if (!expected) return true;
  return `sha256-${await sha256Hex(buf)}` === expected;
}

/** The two checks a REMOTE graph must pass, in one call, so a caller cannot take one
 *  and forget the other — which is how `fetchNames` came to be a bare `fetch().json()`
 *  beside a pinned digest that was therefore decoration. */
export async function acceptableModel(file: string, buf: ArrayBuffer): Promise<boolean> {
  return looksLikeOnnx(buf) && (await digestMatches(file, buf));
}

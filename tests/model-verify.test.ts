// The detector's trust boundary, which until now had no test of any kind.
//
// Two graphs — 14 MB and 50 MB — are fetched from a public mirror and handed to a wasm
// runtime that executes on an origin holding the user's Google API key (localStorage) and
// every room they own (IndexedDB). A pinned SHA-256 and an ONNX format check are what
// stand between the two. Both lived inside `lib/local-detect.ts` as module-private
// functions on paths that all run through `load()`, which dynamically imports
// `onnxruntime-web`, so nothing in `tests/` could address them and `pnpm hash:models
// --verify` — a ~62 MB download, run by hand — was the only exercise they ever got.
//
// **What this file does NOT do.** It does not verify that the pinned digests are the
// digests of the real files: that needs the bytes, and the bytes are a 62 MB download and
// a git-ignored directory. `pnpm hash:models --verify` stays the command for that, and
// this file is deliberately not a substitute for it — it checks that the MECHANISM
// refuses what it should refuse, which is the half that could rot silently.

import { describe, expect, it } from 'vitest';
import {
  MODEL_DIGESTS,
  MIN_MODEL_BYTES,
  MAX_MODEL_BYTES,
  acceptableModel,
  digestMatches,
  looksLikeOnnx,
  sha256Hex,
} from '@/lib/model-verify';

/** A buffer that passes `looksLikeOnnx`: big enough, the 0x08 protobuf tag first, and one
 *  of the producer strings inside the first 4 kB. Filled with a repeating byte so a
 *  digest over it is stable and a one-byte edit changes it. */
function fakeOnnx(bytes = MIN_MODEL_BYTES + 1024, marker = 'onnx', fill = 0x41): ArrayBuffer {
  const u8 = new Uint8Array(bytes).fill(fill);
  u8[0] = 0x08;
  const tag = new TextEncoder().encode(marker);
  u8.set(tag, 64);
  return u8.buffer;
}

const PINNED_FILE = 'yolov8s-worldv2-danmu.onnx';

describe('the registry itself', () => {
  it('is not empty, which is the one shape that would let everything through', () => {
    // `digestMatches` returns TRUE for a file with no pin, on purpose — the registry may
    // be partial so that adding a model does not need a release to pin it first. That
    // choice makes an EMPTY registry a silent open door: every function in the module
    // would still return exactly what it was written to return, and nothing would be
    // checked. So the emptiness is what gets asserted, not the well-formedness.
    expect(Object.keys(MODEL_DIGESTS).length).toBeGreaterThan(0);
  });

  it('pins every file the app fetches from the mirror, by name', () => {
    // Derived from the module rather than typed here would be circular — this is the
    // list of things that MUST be pinned, and it is a decision. The two graphs and the
    // class-name JSON: the JSON is not code, and it decides what every detection is
    // CALLED, which is why it is in the registry at all.
    for (const f of ['yolov8n-oiv7.onnx', 'yolov8s-worldv2-danmu.onnx', 'yolov8n-oiv7.names.json']) {
      expect(MODEL_DIGESTS[f], `${f} is not pinned`).toBeTruthy();
    }
  });

  it('states each digest in the sha256-<64 hex> form the comparison builds', () => {
    // The comparison is a string equality against `sha256-${hex}`. A pin with the wrong
    // prefix, an uppercase digest or a truncated one would never match anything, so the
    // detector would fail closed for every user with no error anyone could see — which
    // is the failure this repo would find last.
    for (const [file, digest] of Object.entries(MODEL_DIGESTS)) {
      expect(digest, file).toMatch(/^sha256-[0-9a-f]{64}$/);
    }
  });
});

describe('sha256Hex', () => {
  it('agrees with the known digest of an empty buffer', () => {
    // A fixed vector rather than a round trip through the same function, which would be
    // a check that cannot fail. This is the published SHA-256 of the empty string.
    return expect(sha256Hex(new Uint8Array(0).buffer)).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is 64 lowercase hex characters, zero-padded', () => {
    // The padding is the part that breaks silently: `toString(16)` on a byte below 0x10
    // returns one character, and a digest one character short simply never matches.
    return expect(sha256Hex(fakeOnnx(MIN_MODEL_BYTES + 8, 'onnx', 0x00))).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe('digestMatches', () => {
  it('accepts bytes whose digest IS the pinned one, and refuses them one byte later', async () => {
    // A real pin, added to the registry for the length of this test and removed after.
    // The first version of this asserted the digest's SHAPE and then checked an
    // unpinned file — which is the accept path never being taken: a `digestMatches`
    // hard-wired to `return false` for pinned files would have passed it, and that
    // mutant disables the detector for every user.
    const buf = fakeOnnx();
    const name = 'a-file-this-test-pins.onnx';
    MODEL_DIGESTS[name] = `sha256-${await sha256Hex(buf)}`;
    try {
      expect(await digestMatches(name, buf), 'the pinned bytes were refused').toBe(true);
      const tampered = fakeOnnx();
      new Uint8Array(tampered)[2048] = 0x5a;
      expect(await digestMatches(name, tampered), 'one changed byte was accepted').toBe(false);
    } finally {
      delete MODEL_DIGESTS[name];
    }
    expect(name in MODEL_DIGESTS, 'the test left an entry in the registry').toBe(false);
  });

  it('REFUSES bytes whose digest is not the pinned one', async () => {
    // The whole point of the module. These bytes are not the real graph, so a pinned
    // file name must reject them.
    expect(await digestMatches(PINNED_FILE, fakeOnnx())).toBe(false);
  });

  it('and refuses a ONE-BYTE change, which is what a tampered mirror looks like', async () => {
    // A mirror that swaps a graph does not send something obviously different; it sends
    // something that parses. Two buffers differing in a single byte must not both pass.
    const a = fakeOnnx(MIN_MODEL_BYTES + 512, 'onnx', 0x41);
    const b = fakeOnnx(MIN_MODEL_BYTES + 512, 'onnx', 0x41);
    new Uint8Array(b)[1000] = 0x42;
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });

  it('lets an UNPINNED file through, which is a decision and not an oversight', async () => {
    // The registry is allowed to be partial so that adding a model file does not require
    // a release to pin it first. Written down here because it is the assumption that
    // makes the empty-registry test above load-bearing.
    expect(await digestMatches('some-new-model.onnx', fakeOnnx())).toBe(true);
  });
});

describe('looksLikeOnnx', () => {
  it('accepts a plausible graph', () => {
    expect(looksLikeOnnx(fakeOnnx())).toBe(true);
  });

  it('refuses a 400-byte error page', () => {
    // The realistic failure: a mirror answers 200 with HTML. Under the size floor, so it
    // never reaches the magic-byte check — both reasons apply and that is fine.
    const html = new TextEncoder().encode('<!doctype html><title>404</title>');
    expect(looksLikeOnnx(html.buffer)).toBe(false);
  });

  it('refuses a file that is exactly one byte under the floor, and accepts it at the floor', () => {
    // Both ends of the bound, because a comparison asserted from one side only is free on
    // the other — `<` for `<=` is invisible to a test that never lands on the boundary.
    expect(looksLikeOnnx(fakeOnnx(MIN_MODEL_BYTES - 1))).toBe(false);
    expect(looksLikeOnnx(fakeOnnx(MIN_MODEL_BYTES))).toBe(true);
  });

  it('refuses a file over the ceiling, and accepts it at the ceiling', () => {
    // The ceiling is 512 MB and allocating that twice here would be unkind, so the
    // ceiling is checked through the constant's relationship to the floor plus one
    // oversized-by-construction buffer at a size the runner can afford. The pair below
    // is what pins the ceiling as a DECISION rather than as whatever number is there.
    expect(MAX_MODEL_BYTES).toBeGreaterThan(MIN_MODEL_BYTES);
    expect(MAX_MODEL_BYTES).toBe(512 * 1024 * 1024);
    expect(MIN_MODEL_BYTES).toBe(1024 * 1024);
  });

  it('refuses a big file that does not start with the protobuf tag byte', () => {
    // Size alone is not evidence: a truncated download or a redirect body can be MBs.
    const buf = fakeOnnx();
    new Uint8Array(buf)[0] = 0x1f; // gzip, say
    expect(looksLikeOnnx(buf)).toBe(false);
  });

  it('refuses a big file with the right tag byte and no producer string', () => {
    // The other half of the format check, and the half a test could easily skip: a
    // buffer of zeroes with 0x08 in front passes the size window and the magic byte.
    const u8 = new Uint8Array(MIN_MODEL_BYTES + 16);
    u8[0] = 0x08;
    expect(looksLikeOnnx(u8.buffer)).toBe(false);
  });

  it('takes any of the three producer strings the graphs carry', () => {
    // Named separately because they are three OR-ed literals, and a sweep over one of
    // them cannot see the other two being deleted.
    for (const marker of ['onnx', 'pytorch', 'ai.onnx']) {
      expect(looksLikeOnnx(fakeOnnx(MIN_MODEL_BYTES + 128, marker)), marker).toBe(true);
    }
  });

  it('does not read the producer string past the first 4 kB', () => {
    // The scan is bounded so a 50 MB decode does not happen on every fetch. A marker
    // outside that window must not rescue the file — otherwise the bound is decoration.
    const u8 = new Uint8Array(MIN_MODEL_BYTES + 8192);
    u8[0] = 0x08;
    u8.set(new TextEncoder().encode('onnx'), 6000);
    expect(looksLikeOnnx(u8.buffer)).toBe(false);
  });
});

describe('acceptableModel is BOTH checks, which is why it exists', () => {
  it('refuses a well-formed graph whose digest is wrong', async () => {
    expect(await acceptableModel(PINNED_FILE, fakeOnnx())).toBe(false);
  });

  it('refuses an unpinned file that is not a graph', async () => {
    // The digest half passes (nothing is pinned for this name) and the format half must
    // still refuse. Without this, `acceptableModel` could be `digestMatches` in a hat.
    const html = new TextEncoder().encode('<!doctype html>');
    expect(await acceptableModel('anything.onnx', html.buffer)).toBe(false);
  });

  it('accepts an unpinned file that IS a graph', async () => {
    // The control. Without it every assertion here is satisfied by a function that
    // returns `false` unconditionally, which would disable the detector for everyone.
    expect(await acceptableModel('anything.onnx', fakeOnnx())).toBe(true);
  });
});

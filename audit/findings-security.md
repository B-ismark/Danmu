# Security findings — Danmu

> **Status: all fixed** (2026-07-29). The diagnosis below is kept as the record;
> each finding now ends with what changed. Two items originally recorded as open —
> the weights digest pin and the dependency scan — were closed in a follow-up pass
> and are written up in full below, including one further hole found while pinning.
>
> | Finding | Resolution |
> |---|---|
> | No security headers | `next.config.mjs` now sends a CSP plus X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, COOP and X-DNS-Prefetch-Control. Every allowed host is named with its reason. |
> | ORT imported from a CDN unpinned | `pnpm vendor:ort` (`scripts/vendor-ort.mjs`) copies the runtime into `public/ort/`; `lib/local-detect.ts` probes same-origin first and keeps the CDN as fallback. Verified: copies 6 files / 40.2 MB from onnxruntime-web@1.27.0. |
> | Weights fetched with no validation | Remote fetches go through `fetchVerifiedModel` — ONNX protobuf magic + size window + SHA-256 against `MODEL_DIGESTS`. All three files are now **pinned**, verified on both sides by `pnpm hash:models --verify`. The class-name JSON is verified too; it used to bypass this entirely via a bare `fetch().json()`. |
> | Dependency vulnerability scan | **Now run.** `pnpm` reached through Corepack. 40 advisories → 1, and that one is an advisory-range artifact. See that finding. |
> | CSV formula injection | New `lib/csv.ts` (`csvCell` / `toCsv` / `csvBlob`) owns escaping, quoting, CRLF and the UTF-8 BOM. 7 tests in `tests/csv.test.ts`. |
> | API key in localStorage | Unchanged — accepted design decision, now less exposed because of the CSP. |
> | Upload validated by MIME prefix only | `isAcceptedPhoto` enforces a raster allowlist, and the file input's `accept` is generated from the same list. |

**Scope note.** Danmu has no backend, no API routes, no database, no auth, no
sessions, no cron and no server-side redirects. Most of the standard checklist
(route auth, role checks, SQL injection, SSRF, session invalidation, audit log)
has no surface here — see *Not applicable* at the bottom, which lists what was
checked and confirmed absent rather than skipped.

The real attack surface is: (1) two third-party hosts whose bytes are executed
or parsed in the page origin, (2) a live Google API key in `localStorage`,
(3) one file the app writes for a person to open in another program.

---

## [MEDIUM] No security headers of any kind — no CSP, no framing or MIME protection

**File:** `next.config.mjs:1-17`

**Issue:** The Next config sets `reactStrictMode`, `eslint.dirs` and two
`experimental` flags. There is no `headers()` block, so the app ships without
`Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` or
`Strict-Transport-Security`.

This matters more than it would for a static brochure site, because the same
origin holds a usable Google API key (`danmu-settings` in `localStorage`) and
every room the user owns (IndexedDB), *and* it deliberately executes JavaScript
fetched from a third-party CDN at runtime (see the next finding). A CSP with a
`script-src` allowlist is the one control that would bound that. The app also
calls `getUserMedia`, with no `Permissions-Policy` narrowing which frames may.

**Evidence:**
```js
const nextConfig = {
  reactStrictMode: true,
  eslint: { dirs: ['app', 'components', 'lib', 'tests'] },
  experimental: { optimizePackageImports: [...], esmExternals: 'loose' },
};
```
No `async headers()`. Grep for `Content-Security-Policy` across the repo: zero
hits.

**Suggested fix:** Add a `headers()` block. `script-src` has to allow
`cdn.jsdelivr.net` (ORT) and `wasm-unsafe-eval`; `connect-src` needs
`generativelanguage.googleapis.com`, `huggingface.co` and `cdn.jsdelivr.net`;
`img-src` needs `blob: data:`. Write the allowlist down in the config with the
reason for each entry so the CDN dependency becomes visible rather than
implicit.

---

## [MEDIUM] Executable ESM is imported from jsDelivr with no integrity pinning

**File:** `lib/local-detect.ts:195-289` (`ORT_BASE` at :205, `import()` at :259,
`wasmPaths` at :260)

**Issue:** The ONNX Runtime is loaded at runtime by dynamic `import()` of a
remote URL, and the wasm binaries are then fetched from the same base. A dynamic
`import()` cannot carry a subresource-integrity hash, and nothing else in the
code verifies what came back. Anything served from that path runs with full
access to the page origin — which means `localStorage` (the Google API key) and
IndexedDB (every room, every wall photo).

The version is pinned to the devDependency (good, and the comment explains why),
but a version pin is a compatibility control, not an integrity control.

**Evidence:**
```ts
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
...
const ort = (await import(/* webpackIgnore: true */ ortUrl)) as OrtNS;
ort.env.wasm.wasmPaths = ORT_BASE;
```

**Suggested fix:** Copy the `onnxruntime-web/dist` files into `public/ort/` at
install time and point `ORT_BASE` there — this keeps the `webpackIgnore` trick
that the build needs (the bytes still never enter the bundle) while removing the
third party from the trust chain. If the CDN has to stay, at minimum pair it with
the CSP above and record the trust decision next to the constant, the way the
AGPL note is recorded.

---

## [MEDIUM] Model weights are fetched from a third-party host with no hash check

**File:** `lib/local-detect.ts:56` (`REMOTE_BASE`), `:228-245` (`resolveFile`),
`:262-283` (session creation)

**Issue:** When `public/models/` is empty, the detector falls back to
`https://huggingface.co/DearthAI/danmu-detector/resolve/main/` for a 14 MB and a
50 MB `.onnx` file plus a `.names.json`, and hands them straight to the wasm
runtime. There is no digest to compare against. A substituted graph is at
minimum a wrong-results vector (the whole point of the local path is that it is
the trustworthy one) and at worst an attack on the runtime's parser.

The `.names.json` is `JSON.parse`d and then used only as a lookup table, so it is
not a code-execution path — but it silently controls what every detection is
called.

**Evidence:**
```ts
const r = await fetch(candidate + file, { method: 'HEAD' });
if (r.ok) return candidate;
...
const session = await ort.InferenceSession.create(modelBase + MODEL_FILE, {...});
```
`HEAD` 200 is the only validation performed.

**Suggested fix:** Ship expected SHA-256 digests for the three files next to the
constants, fetch as an `ArrayBuffer`, verify with `crypto.subtle.digest`, and
pass the buffer to `InferenceSession.create`. Fail closed to "detector
unavailable" on mismatch — the fallback path (Gemini / manual boxes) already
exists and is already the documented behaviour when the model is missing.

**Fixed, including the pin.** `fetchVerifiedModel` fetches remote files as an
`ArrayBuffer`, checks the ONNX protobuf magic and a 1 MB–512 MB size window,
checks SHA-256 against `MODEL_DIGESTS`, and returns null (→ "detector
unavailable") on any failure. Local files are the user's own export and are still
opened by URL.

`MODEL_DIGESTS` was initially left **empty**, because a digest pinned from the
local export alone would fail closed and silently disable the detector for every
fresh clone — a worse outcome than the gap being closed. That has now been done
properly: all three files are pinned, and each was verified on **both** sides —
the local export and the bytes `huggingface.co/.../resolve/main/` actually serves
hash identically.

Rather than leave the remote half as a note someone has to remember,
`scripts/hash-models.mjs` gained a `--verify` mode that does it:

```
pnpm hash:models --verify
  ✓ yolov8n-oiv7.names.json — matches (0.0 MB)
  ✓ yolov8n-oiv7.onnx — matches (13.6 MB)
  ✓ yolov8s-worldv2-danmu.onnx — matches (48.1 MB)
[hash-models] local export and mirror agree. Safe to pin.
```

**A second hole found while pinning.** The `.names.json` was fetched with a bare
`fetch(namesBase + NAMES_FILE).json()`, never routed through the verifier — so a
digest pinned for it would have been pure decoration. It is not code, but this
finding's own diagnosis says it "silently controls what every detection is
called". `fetchNames` now digest-checks a remote copy (it cannot use
`looksLikeOnnx` — as JSON of a few kB it fails both the magic byte and the size
window by design), and a missing or unparseable table is now a hard failure
instead of an unhandled rejection inside the loader.

---

## [MEDIUM] CSV export is not formula-injection safe

**File:** `components/studio/RoomTools.tsx:340-363`

**Issue:** `esc()` doubles quotes and wraps in quotes, which is correct CSV
*quoting* but does nothing about *formula* injection. A furniture name beginning
with `=`, `+`, `-`, `@`, a tab or a carriage return is written through verbatim,
and Excel / Google Sheets / LibreOffice evaluate leading-`=` cells on open —
`=HYPERLINK(...)`, `=WEBSERVICE(...)`, or a DDE payload in older Excel.

Part names are user-editable (`EditableText` in the Inspector and the part tree)
and are also populated from AI photo labels, so the content is not a fixed
vocabulary.

**Severity justification — Medium, not High:** in a single-user local-first app
the author of the string and the person opening the file are normally the same
person, so this is not a cross-user attack. It is not Low either: the CSV is
explicitly a shareable artifact ("a printable move-day handout" is the sibling
feature's framing), and the fix is three characters of prefix.

**Evidence:**
```ts
const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
...
esc(p.name),
```

**Suggested fix:** Prefix any cell whose first character is in `= + - @ \t \r`
with a single quote (or a leading tab) before quoting. Apply it in one place —
the same `esc` — so the header row and any future column inherit it.

---

## [LOW] Google API key held in plaintext `localStorage`

**File:** `lib/store.ts:193-211`

**Issue / status:** Recorded as an **accepted design decision**, not a defect.
There is no server to hold the key, the Settings screen states plainly where the
key goes and that pressing *Test* transmits it, and it recommends restricting
the key to the site in the provider console. Nothing logs it and nothing else
reads it.

The only reason it appears here is coupling: any script that reaches this origin
reads it, which is what makes the two CDN findings above worth fixing rather than
merely worth noting.

**Suggested fix:** None required. Optionally add a "clear key on close" opt-in
for shared machines.

---

## [LOW] Image upload validated only by MIME prefix

**File:** `app/onboarding/capture/page.tsx:110-127`

**Issue:** `Array.from(list).filter((f) => f.type.startsWith('image/'))` accepts
`image/svg+xml`. An SVG rendered through a blob URL in `<img>` cannot execute
script, so this is not an XSS path — but an SVG has no natural pixel content, so
`scoreQuality` and `sampleBoxColor` produce meaningless numbers, and the file is
then base64-encoded and uploaded to Google as if it were a photograph. There is
also no size ceiling (see `findings-performance.md` for the consequences of
that).

**Suggested fix:** Allowlist the raster types the pipeline actually handles
(`image/jpeg|png|webp|heic|heif`) and reject the rest with the existing
`setAnnounce` message, which already has the right copy.

---

## [HIGH] Dependency advisories — 40 found, 39 fixed

**Originally filed as INFO / not performed:** `pnpm` is not on `PATH` here. It is
reachable through **Corepack** (`corepack pnpm audit`), which ships with Node —
so the check was run after all, and it was not empty.

**Starting point:** 40 advisories — 1 critical, 20 high, 17 moderate, 2 low,
across 603 packages.

| | Before | After |
|---|---|---|
| critical | 1 | **0** |
| high | 20 | 1 (see below) |
| moderate | 17 | **0** |
| low | 2 | **0** |

What they were, and what was done:

- **`next` — 22 advisories (8 high, 12 moderate, 2 low).** Every one of them, and
  the whole `postcss` cluster underneath. Next 14 has no patched line: the fixes
  land in `>=15.5.21`. **Upgraded 14.2.35 → 15.5.22.**

  The upgrade was smaller than it looks. Next 15 still accepts `react ^18.2`, so
  React stays on 18 and `@react-three/fiber` stays on v8 — a React 19 move would
  have dragged the entire 3D stack (R3F v9, drei v10) into a change with no
  browser here to verify it in. The only breaking change this app touches is
  `params` becoming a Promise, in the single server component that reads a route
  param (`app/room/[roomId]/page.tsx`); everything else uses `useParams()`
  client-side. `experimental.esmExternals: 'loose'` was dropped — Next 15 warns
  about it and resolves the three/three-stdlib graph without it, verified by
  building both ways.

  **Most of these advisories did not reach this app in the first place**, which is
  worth recording so the upgrade is not mistaken for a breach response. No Server
  Actions, no middleware, no rewrites, no i18n, no custom server, no `images`
  config, no `next/image`, no CSP nonces, no `beforeInteractive` scripts. That
  rules out the SSRF, request-smuggling, Image-Optimizer, middleware-bypass and
  nonce-XSS findings outright. The genuinely-applicable subset is the RSC
  DoS/cache-poisoning cluster against the two dynamic routes — which carry no
  data, since everything lives in the browser.

- **`vitest` — 1 critical.** Fixed in `>=3.2.6`; **upgraded to 4.1.10**, which
  also cleared the `vite` (3) and `esbuild` (1) advisories at source rather than
  by override. `vite` had to be declared explicitly as a devDependency: it is only
  a *peer* of vitest, so pnpm kept resolving the old 5.x from the lockfile.
- **`sharp` — 1 high** (inherited libvips CVEs), arriving via Next 15. Overridden
  to `^0.35.0`. Unreachable here regardless: sharp exists for the Image Optimizer,
  which this app has no `images` config for and never calls.
- **`postcss`, `protobufjs`, `js-yaml`, `glob`, `brace-expansion`** — transitive,
  nothing depends on them directly, so they are pinned in `pnpm.overrides`.

**A trap worth writing down.** The first pass used `>=` ranges in the overrides:
`"brace-expansion@1": ">=1.1.16"`. That silently promoted *every* line in the tree
onto 5.x, because `5.0.8` also satisfies `>=1.1.16` — three separate majors
collapsed onto one. The overrides now use carets so each consumer stays on the
major it was written against.

**The one remaining high is an advisory-range artifact, not an exposure.** The
`brace-expansion` DoS advisory declares its vulnerable range as `<=5.0.7`, which
in semver literally includes the whole 1.x line — so `1.1.17` matches it, even
though 1.x got its own backport in `1.1.16` and there is no `5.0.8` for a 1.x
consumer to move to. It arrives under `eslint@8 > minimatch@3`, is dev-only, and
clearing it would mean an ESLint 9 flat-config migration for a glob-matcher DoS in
a lint run. Deliberately not chased.

---

## Not applicable / verified absent

Checked and confirmed, so they are not silently missing from this report:

- **API routes / auth / authorization / roles / session invalidation** — there
  are no route handlers and no server actions. Every route under `app/` is a
  page. Nothing to authenticate.
- **SQL injection** — no database, no query builder. Persistence is `idb-keyval`
  with template-literal *key* construction only (`room:${roomId}:meta`).
- **SSRF / open redirects** — the only outbound targets are three hard-coded
  hosts; no user input reaches a fetch URL. `redirect()` is used once, with a
  path built from a route param that is only ever a uuid the app minted
  (`app/room/[roomId]/page.tsx:4`).
- **Secrets in the client bundle** — no `process.env` reference anywhere, no
  `NEXT_PUBLIC_*`, nothing secret in the repo. `weights/` and `public/models/`
  are git-ignored.
- **XSS sinks** — zero hits for `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `new Function`, `document.write`.
- **`images.remotePatterns` wildcard** — no `images` config at all; the previous
  Unsplash pattern was removed with the render pipeline (documented in the config
  comment).
- **Cron endpoints failing open** — none exist.

## False positives noted during the scan

- `app/global-error.tsx:13-17` hard-codes hex values for `--paper`, `--ink`,
  `--danger` etc. That is **correct**: a global error boundary may render when
  the stylesheet has not loaded. Each constant carries the token name in a
  comment.
- `components/ui/ColorPicker.tsx:170,194,233` uses `#fff`, `#000`, `#f00`… Those
  are the HSV field and hue-strip gradients — a colour picker must draw literal
  colours. The `#fff` thumb ring is explained in the file's own comment as
  needing to stay legible against any colour the user lands on.

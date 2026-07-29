# Performance findings — Danmu

> **Status: all fixed** (2026-07-29). The diagnosis below is kept as the record.
>
> | Finding | Resolution |
> |---|---|
> | **HIGH** Full-resolution uploads break detection | `normalizePhoto` re-encodes every incoming photo to ≤1600 px / JPEG q0.9 before it is stored or sent (`lib/capture.ts`), and `snapToBlob` uses the same cap. `detectAcrossImages` also guards the encoded payload against a 16 MB ceiling and throws `PHOTOS_TOO_BIG`, which has its own notice with a working instruction. |
> | Sequential IndexedDB round-trips | `Promise.all` in `loadCaptures`, `listLayouts`, `clearRoom`, `restoreRoom`, `purgeTrash`, `destroyRoom`, `meshCache.list` / `delete` / `clearAll`, the workspace's bulk delete and undo, `addFiles`, and the detect screen's colour sampling. |
> | Detect re-runs when the API key changes | Key read from a ref at call time; dep array is `[roomId]`. |
> | CSV revoked its object URL synchronously | Uses the shared `downloadBlob`. |
> | Clearance probe cost | The 2 cm march is gone — `faceClearance` now uses an analytic ray/OBB slab test (`rayToObb`), which is both exact and constant-time, so widening it to 5 probes per face costs less than the old single one. |
> | Tailwind bridge | Theme emptied; `globals.css` is the sole token source. |
> | Three duplicate media-query hooks | One `lib/use-media-query.ts`. |
> | Studio reflowed after first paint | `useStackedStudio` returns `ready`; both studio pages hold their shell until the query has answered. |
>
> Bundle after the changes: shared 87.4 kB (unchanged), studio route 154 kB
> (+2 kB), detect route 196 kB (+7 kB — the codec, the new notices and uuid).

**Scope note.** No server, no connection pool, no SSR data fetching, no cold
start, no caching layer, no SSE. Eleven routes, all but two statically
prerendered. The performance surface is: the browser bundle, the IndexedDB access
pattern, the R3F render loop, and the size of the photos the app moves around.

**Measured baseline** (`next build`, clean, exit 0):

| Route | Route JS | First Load JS |
|---|---|---|
| shared by all | — | 87.4 kB |
| `/onboarding/detect` | 22.5 kB | 189 kB |
| `/settings` | 5.68 kB | 171 kB |
| `/room/[roomId]/model` | 12.3 kB | 152 kB |
| `/room/[roomId]/plan` | 8.24 kB | 148 kB |
| `/workspace` | 6.9 kB | 115 kB |

three.js, drei, postprocessing and the whole R3F scene sit behind
`dynamic(..., { ssr: false })`, which is why the studio route is 152 kB rather
than ~600 kB. ONNX Runtime (~8 MB) and the model weights (14 MB + 50 MB) are
outside the bundle entirely.

---

## [HIGH] Full-resolution photo uploads will exceed Gemini's inline-request limit, and the failure reads as "something went wrong"

**Files:** `app/onboarding/capture/page.tsx:96-127` (`persistBlob`, `addFiles`),
`lib/detection.ts:166-180, 234-244` (`blobToBase64`)

**Issue:** Uploaded photos are persisted and transmitted at their original
resolution. Nothing in the pipeline resizes or re-encodes them:

- `addFiles` filters on MIME and hands the raw `File` to `persistBlob`.
- `persistBlob` writes that blob straight into IndexedDB.
- `detectAcrossImages` base64-encodes all four blobs into one `inlineData`
  request.

A photo straight from a phone camera roll is typically 3–5 MB (12 MP). Four of
them is 12–20 MB of raw bytes, which base64 inflates by 4/3 to roughly
16–27 MB — at or over the ~20 MB ceiling for inline request data on the
`generateContent` endpoint. Above it the call fails, and because the thrown error
does not match any of the patterns in `classifyDetect`, it lands in the `UNKNOWN`
bucket and the user is told *"Danmu couldn't finish looking through your photos.
Trying again often works"* — advice that will never work, on the app's default
input path.

The camera path is bounded and fine: `snapToBlob` renders at the video's
resolution (ideal 1920×1440) as JPEG q0.92, ≈400–600 kB each. It is only *Upload*
— the tab that is selected by default — that is unbounded.

The same photos also sit unresized in IndexedDB, so a handful of rooms pushes at
the browser's storage quota. That path at least has a toast
(`storage.ts:6-18`); the detection path has nothing.

**Evidence:**
```ts
const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
...
await roomStore.saveCapture(roomId, { slot, blob, takenAt: Date.now() });
```
No `canvas.toBlob`, no `createImageBitmap` resize, no size check anywhere between
the file input and the request.

**Suggested fix:** Downscale on ingest — decode to an `ImageBitmap`, draw to a
canvas capped at ~1600 px on the long edge, re-encode as JPEG ~0.85, and store
*that*. The detector runs at 640×640 and `photo-geometry` works in normalized
coordinates, so nothing downstream needs the extra pixels. It cuts the request
by roughly an order of magnitude and shrinks the IndexedDB footprint by the same
factor. Add a defensive total-payload check in `detectAcrossImages` with its own
`DetectError` code so the failure, if it still happens, is nameable.

---

## [MEDIUM] Sequential IndexedDB round-trips in six loops

**Files:** `lib/storage.ts:138-149`, `:234-245`, `:248-260`, `:263-271`;
`lib/mesh-cache.ts:57-67`; `app/workspace/page.tsx:147-148`;
`app/onboarding/capture/page.tsx:121`; `app/onboarding/detect/page.tsx:370-380`

**Issue:** `listRooms` was already optimised — one key scan, then a `Promise.all`
fan-out, with the previous "~160 serialised round trips" recorded in the comment.
The same pattern is still present everywhere else:

| Site | Shape |
|---|---|
| `loadCaptures` | `keys()`, then one `await get()` per matching key |
| `clearRoom` | `await get` + `await set` + `await del` per key |
| `restoreRoom` | same, per key |
| `purgeTrash` | `await del` per expired key |
| `meshCache.list` | `await get` per `mesh:*:meta` key |
| `removeRooms` (workspace) | `await clearRoom` per selected room |
| `addFiles` (capture) | `await persistBlob` per file |
| colour-sample effect (detect) | `await sampleBoxColor` per detection |

`loadCaptures` is the one that is on a hot path — it runs on mount of both the
capture and detect screens, and each `get` returns a multi-megabyte blob. The
last two are worse than IDB latency: `persistBlob` and `sampleBoxColor` each do a
full decode, so four photos decode strictly one after another.

**Suggested fix:** `Promise.all` over the mapped keys, exactly as `listRooms`
already does. For the delete/restore loops, keep the ordering constraint from
`findings-data.md` (`meta` last / first) and parallelise the rest.

---

## [MEDIUM] Changing the API key re-runs the whole detection pipeline

**File:** `app/onboarding/detect/page.tsx:229-357` (dep array at `:357`)

**Issue:** The mount effect depends on `[roomId, apiKey]`. `apiKey` lives in a
`persist`-backed zustand store, so editing it in Settings — including in another
tab, since `localStorage` writes propagate — re-enters the effect. That means:
re-reading every capture blob, re-running `buildCals` (which decodes each photo
twice, once for aspect and once for the floor line), re-minting object URLs, and
— if the room has no cached detections — **firing another billed detection run**.

The `apiKey` dependency exists because the value is passed to
`detectAcrossImages`, but it only needs to be *current at call time*, not a
trigger.

**Suggested fix:** Read the key from a ref (or `useSettings.getState()`) at the
call site and drop it from the dep array, leaving `[roomId]`.

---

## [LOW] `downloadCsv` revokes its object URL synchronously after `.click()`

**File:** `components/studio/RoomTools.tsx:356-363`

**Issue:** The shared helper gets this right — `lib/snapshot.ts:27` delays the
revoke by 5 s specifically so the browser has time to start the download. The CSV
export inlines its own copy of the same six lines and revokes immediately, which
some browsers treat as a cancelled download.

**Suggested fix:** Call `downloadBlob(blob, name)` from `lib/snapshot.ts`. Two
implementations of "download a blob" is the actual defect; the timing bug is the
symptom.

---

## [LOW] Clearance analysis is O(N²) with a 200-step probe per face

**Files:** `lib/geometry.ts:198-233` (`faceClearance`), `lib/clearance.ts:86-149`

**Issue:** `faceClearance` marches a point outward in 2 cm steps up to 4 m — up
to 200 `pointInObb` calls per obstacle, per face — and it is called for every
wardrobe/fridge/shelf front plus both sides of every bed, each time against every
other solid part. The walkway check adds a pairwise `obbGap` (32 point-to-segment
tests each) over all bulky parts.

**Why Low:** `RoomTools.tsx:78-81` memoises `analyzeRoom` on
`[effParts, room.footprint, room.height]`, so it recomputes only when a transform
commits, not per frame — and real rooms hold tens of parts, not hundreds. Worth
knowing before anyone raises `maxRange` or drops the memo.

**Suggested fix:** No change needed now. If it ever shows up, replace the march
with an analytic ray-vs-OBB intersection (the OBB is convex; a slab test is
exact and constant-time) — which also fixes the correctness problem recorded in
`findings-ui-code.md`.

---

## [LOW] Tailwind ships Preflight and a 25-token bridge for zero utility classes

**Files:** `tailwind.config.ts`, `app/globals.css:1-3`

**Issue:** The config mirrors ~25 CSS custom properties into Tailwind's theme so
"a utility can never introduce a second design vocabulary". No utilities are
used. Every `className` in the app resolves to a hand-written class in
`globals.css`: `auto-grid`, `auto-grid--wide`, `row-grid`, `ds-grid-bg`,
`ds-btn`, `ds-card`, `rail`, `section`, `field`, `list-row`, `chrome-bar`,
`split`, `popover`, `toolbar`, `icon-btn`, `ds-chip`, `sr-only`, `mono`.

So the cost is Preflight in the CSS output plus a second copy of the token table
that has to be kept in sync by hand — and the stated benefit (constraining
utilities) protects against something nobody does.

**Suggested fix:** Either drop Tailwind and keep `@layer`-less plain CSS with
`postcss-preset-env`, or keep it and delete the colour/radius/z bridge, since no
utility consumes it. Whichever way, one source of tokens.

---

## [LOW] Three near-identical media-query hooks

**Files:** `app/workspace/page.tsx:57-67` (`useMediaQuery`),
`app/onboarding/capture/page.tsx:26-36` (`useNarrow`),
`components/studio/NarrowViewportBanner.tsx:34-44` (`useStackedStudio`)

**Issue:** Same `matchMedia` + listener + cleanup body, three times, with three
names and three breakpoint constants. `useStackedStudio` is already exported for
cross-file reuse, which shows the intent — it just did not absorb the other two.

**Suggested fix:** One `useMediaQuery(query)` in `components/ui/`, with the named
breakpoint helpers built on it.

---

## [LOW] `useStackedStudio` returns `false` on first render, so the studio reflows after paint

**File:** `components/studio/NarrowViewportBanner.tsx:35-42`, consumed by
`app/room/[roomId]/model/page.tsx:42` and `app/room/[roomId]/plan/page.tsx:19`

**Issue:** The state initialises to `false` and is corrected in an effect, so on
a narrow viewport the first paint uses the three-column shell
(`260px 1fr 320px`) and then jumps to the stacked layout — including a change of
DOM order, since the stacked branch reorders the children array. That is a layout
shift on exactly the devices least able to absorb one.

**Suggested fix:** Gate the shell on a `mounted` flag and render the loading
state until the query has resolved, or move the two-column/stacked decision into
CSS container queries so no JS round-trip is involved. The reason it is in JS is
documented (the canvas must come first in stacked order, which a media query
cannot reorder in an inline-styled grid) — a `flex-direction: column-reverse`
variant or an `order` property would.

---

## Verified sound (not findings)

The 3D layer has clearly already been through a performance pass, and the
reasoning is written down. Recording it so it does not get re-audited:

- **`frameloop="demand"`** — the canvas paints on change, not at 60 fps. The
  comment records what it replaced: a full render + SSAO + SMAA + a 1024² depth
  pass + two blurs, 60×/s, on an idle room.
- **`PerformanceMonitor` gated on a hot-loop detector** (`FrameRateGate`), so an
  idle on-demand canvas is not mistaken for a struggling GPU and downscaled.
- **`AdaptiveDpr`** while the camera moves; `dpr={[1, dprMax]}`.
- **`Environment frames={1}`** — the studio env is baked once, no HDR fetched.
- **`ContactShadows` re-bake window** — opens for ~300 ms on change rather than
  `frames={1}` (which spent its one bake on the wrong frame) or `Infinity`, with
  `scale` quantised to 0.5 m specifically because drei's `useMemo` orphans the
  render-target pair it replaces.
- **`EffectComposer` dropped entirely on 'Fast'**, so the quality toggle actually
  buys something.
- **`react-query` removed** — `app/providers.tsx` documents that the whole
  runtime was shipping for an app that makes no queries.
- **Procedural textures memoised** to one shared `CanvasTexture` each
  (`lib/textures.ts:108-128`); zero binary texture assets.
- **`optimizePackageImports` for drei and three**, and `onnxruntime-web` kept out
  of the bundle with `webpackIgnore`.
- **No oversized images in `public/`** — the only committed asset is
  `app/icon.svg`. There are no raster assets to convert to WebP/AVIF.

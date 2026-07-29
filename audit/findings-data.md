# Data integrity findings — Danmu

> **Status: all fixed** (2026-07-29). The diagnosis below is kept as the record.
>
> | Finding | Resolution |
> |---|---|
> | **HIGH** Detect re-visit strips placement/yaw/shape | One codec, `toRecord`/`fromRecord`, used by both directions on the detect screen. Adding a field to one now fails to compile without the other. |
> | **HIGH** Positional part ids | Detections carry a `uid` (minted on first save) that becomes the ScenePart id. Records without one fall back to the ordinal, so existing rooms keep their transforms. 12 tests in `tests/scene-build.test.ts`. |
> | `dedupe()` collapses distinct furniture | Cross-slot merging now requires the estimated 3D positions to agree (<0.6 m), not just the label. Exported as `dedupeDetections`; 7 tests. |
> | Parse failure reported as "empty room" | Throws `DetectError('BAD_RESPONSE')`; the detect screen has its own notice for it, distinct from NOTHING_FOUND. |
> | Undo missed hide/unhide | `hidden` is in `Snapshot`, in the change check, and restored by `applySnapshot`. |
> | `applySnapshot` mutated state directly | `useHistory.setState({ suspended: true })`. |
> | Quota day used a fixed UTC-8 | `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'`. |
> | Non-atomic trash operations | `meta` retired first on delete, written last on restore; the rest fans out with `Promise.all`. **Note:** the *Suggested fix* line under that finding says "meta last on delete and first on restore" — that was backwards, and the reasoning two paragraphs above it is the correct one. |
> | `restoreRoom` overwrote a live room | Refuses when `room:{id}:meta` already exists. |
> | Footprint areas were bounding boxes | Both the area label and the SVG preview are derived from `footprintForLayout` — see also the T-Shape mismatch in `findings-ui-code.md`, same root cause. |
> | No schema version | `ROOM_SCHEMA_VERSION` stamped on every write; absent reads as 0. |

**Scope note.** There is no relational database, so no views/JOINs, no
`ALTER TABLE` migrations, no server-side enum enforcement, no foreign keys and no
audit log. The equivalents here are: the IndexedDB record shape (`RoomData`,
`Transforms`, `LayoutVariant` in `lib/storage.ts`), the detect→scene translation
(`lib/scene-spec.ts`), the undo stack (`lib/history.ts`), and the soft-delete
trash namespace. Those are what was audited.

---

## [HIGH] Re-opening the detect screen silently strips placement, yaw and shape from the saved room

**File:** `app/onboarding/detect/page.tsx:271-286` (read) vs `:496-509` (write)

**Issue:** `finish()` persists nine fields per detection, including
`position`, `yaw` and `shape` — the geometry-derived placement that
`geoRefine()` computed from the calibrated camera. The cache-read path that runs
when the page is re-entered rebuilds `Detection` objects from the same record but
**omits those three fields**. Because `finish()` is the only way forward off the
screen and its button is always enabled, the next press writes `undefined` over
all three.

This is one click away from the studio: the top bar's **Rescan** button links
straight to `/onboarding/detect`
(`app/room/[roomId]/layout.tsx:35`). Open Rescan, press *Continue to the
studio*, and the room's detection record has lost its projective-geometry
placement permanently.

**Evidence:**
```ts
// read (cache path) — no position, no yaw, no shape
const cached: Detection[] = room.detectedObjects.map((d) => ({
  label: d.label.replace(/__slot:[nesw]$/, ''),
  conf: d.conf, box: d.box as Box,
  category: (d.category ?? 'other') as Detection['category'],
  slot: (...),
  dimMM: d.dimMM, color: d.color, meshHash: d.meshHash,
}));
```
```ts
// write — reads them back off the same objects
position: d.position,   // undefined
yaw: d.yaw,             // undefined
shape: d.shape,         // undefined
```

**Blast radius, stated honestly:** the *visible* room usually survives, because
`RoomSync` prefers the saved `ScenePart[]` snapshot over rebuilding from
detections (`components/studio/RoomSync.tsx:44`). The damage shows up when there
is no snapshot yet, or when anything rebuilds from `detectedObjects` — at which
point `buildSceneFromRoom` falls back to `placementForSlot()` wall-snapping and
`refineShape()` guessing, i.e. the pre-geometry behaviour, with no indication
that anything was lost.

**Suggested fix:** Make the cache read the exact inverse of the write. A single
mapper used by both directions would make the asymmetry impossible; a test that
round-trips one detection through `finish()` and the cache path would have caught
it.

---

## [HIGH] Generated part ids are positional, but transforms are keyed by id

**File:** `lib/scene-spec.ts:100` (`defaultScene`), `:431-432`
(`buildSceneFromRoom`)

**Issue:** Both scene builders mint ids by counting occurrences of a category:
`sofa-1`, `chair-1`, `chair-2`, `table-1`. Meanwhile every per-part user edit is
stored in a map keyed by that id — `positions`, `rotations`, `dims` and `hidden`
in `useStudio`, persisted per room by `RoomSync`.

The id is therefore not an identity, it is an ordinal. Anything that changes the
composition of the scene re-points existing transforms at different objects:

- Re-running detection with a different set of objects: the old `sofa-1`'s saved
  position, rotation, scale and hidden flag now apply to whatever the new
  `sofa-1` is.
- Moving between the starter scene and a detected scene: `defaultScene` and
  `buildSceneFromRoom` share the same id namespace, so the starter coffee
  table's transforms are inherited by a detected table.
- Deleting a detection on the detect screen shifts every subsequent index, so all
  ids after it shift by one.

Parts the user adds are correct — `AddPartButton.tsx:138`, `CatalogPanel.tsx:22`,
`Room.tsx:107`, `KeyboardShortcuts.tsx:264` all append `uuid().slice(0, 6)`.
Only the generated ones collide.

**Evidence:**
```ts
counters[cat] = (counters[cat] ?? 0) + 1;
const id = `${cat}-${counters[cat]}`;
```
against
```ts
roomStore.saveTransforms(roomId, { positions, rotations, dims, hidden });
```

**Suggested fix:** Give each detection a stable id at detection time (uuid,
stored on the record) and have `buildSceneFromRoom` use it, keeping the
`category-n` string only as a display fallback. Existing rooms need a one-time
migration that maps old positional ids onto the new ones in the same order,
otherwise this fix itself loses transforms.

---

## [MEDIUM] `dedupe()` collapses genuinely distinct furniture that shares a label

**File:** `lib/detection.ts:211-232`

**Issue:** The de-duplication has two branches. The first is sound: same slot,
same category, bbox centres within 12% on both axes. The second matches on
`label + category` **anywhere in the room, with no positional test at all** —
so any two objects the model names identically collapse to one.

Four matching dining chairs, a pair of nightstands either side of a bed, two
curtains on the same wall, a set of identical shelves: all reduced to a single
detection. On the one path in the product that costs the user quota, this quietly
discards correct results.

**Evidence:**
```ts
// Same label string (case-insensitive) anywhere — likely double-counted across walls
if (o.label.toLowerCase().trim() === d.label.toLowerCase().trim() && o.category === d.category) {
  return true;
}
```
The prompt already asks the model to report continuity explicitly via
`alsoSeenIn` (`detection.ts:86`), which is the intended mechanism; this branch is
a belt-and-braces guess that overreaches.

**Suggested fix:** Restrict the cross-slot branch to cases where the model
*omitted* `alsoSeenIn` **and** the two detections' estimated 3D `position` are
within a small distance of each other. Label equality alone is not evidence of
identity in a room that contains matching furniture.

---

## [MEDIUM] A malformed detection response is reported to the user as "your room is empty"

**File:** `lib/detection.ts:199-205`, surfaced at
`app/onboarding/detect/page.tsx:325-336`

**Issue:** If the response body is not parseable JSON, `detectAcrossImages`
returns `[]`. The page cannot distinguish that from a successful run that found
nothing, so it shows the `NOTHING_FOUND` notice, whose copy asserts the
conclusion: *"couldn't pick out any furniture — which is exactly right for an
empty room"*.

A parse failure and an empty room are different outcomes, and only one of them
should be described as *all clear*. The quota was also already spent.

**Evidence:**
```ts
try {
  const parsed = JSON.parse(text) as Detection[];
  ...
} catch {
  return [];
}
```

**Suggested fix:** Throw a `DetectError('UNKNOWN', …)` on parse failure so the
existing error notice (which offers Retry) handles it. The distinction already
has a home in the `Notice` taxonomy; only the signal is missing.

---

## [MEDIUM] Undo does not cover hide/unhide, and `hidden` is absent from the snapshot

**File:** `lib/history.ts:13-25` (`Snapshot`), `:114-123` (subscription)

**Issue:** `Snapshot` carries `positions`, `rotations`, `dims`, `parts`, `room`
and `lighting`. It does not carry `hidden`, and the studio subscription does not
watch `hidden`, so toggling visibility neither records a snapshot nor is restored
by one.

Consequences: pressing `V` then `Ctrl+Z` undoes the *previous* edit instead, and
an undo that walks back past a hide leaves the part hidden in a state the history
stack does not describe. The help card (`app/room/[roomId]/model/page.tsx:337`)
advertises `Ctrl+Z` without qualification, and `V` is listed two lines above it.

`hidden` is persisted per room (`Transforms.hidden`), so this is a gap in history
specifically, not a persistence gap.

**Suggested fix:** Add `hidden` to `Snapshot`, to the subscription's change
check, and to `applySnapshot` (which already has `setHiddenMap` available).

---

## [MEDIUM] `applySnapshot` mutates zustand state directly to suspend recording

**File:** `lib/history.ts:145-159`

**Issue:** `const h = useHistory.getState(); h.suspended = true;` writes to the
state object in place instead of going through `setState`. It happens to work
because `push` reads `get().suspended` off the same object reference, and the
un-suspend at the end *does* use `setState`.

This is a latent break rather than a live bug: adding immer, `structuredClone` in
a middleware, or anything that hands out a frozen or copied state object turns
the assignment into a silent no-op, and then every programmatic restore pushes
itself onto the stack and wipes the redo branch. The mixed idiom in one function
(direct mutation to set, `setState` to clear) is also what makes it easy to miss.

**Suggested fix:** `useHistory.setState({ suspended: true })`.

---

## [MEDIUM] The daily quota boundary uses a fixed UTC-8 offset

**File:** `lib/quota.ts:24-28`

**Issue:** `pacificDay()` subtracts a constant eight hours to derive the Pacific
calendar day. Pacific is UTC-7 under daylight time, which is roughly eight months
of the year, so for most of the year the counter rolls over an hour away from the
real reset. A run made in that window is either counted against the wrong day or
double-counted.

The Settings copy ("resets each day") and the detect screen's
`DAILY_QUOTA` notice ("resets at Pacific midnight") both make a claim the code
does not quite keep.

**Evidence:**
```ts
const d = new Date(Date.now() - 8 * 60 * 60 * 1000);
return d.toISOString().slice(0, 10);
```

**Suggested fix:** `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())`
yields `YYYY-MM-DD` in the right zone with no offset arithmetic.

---

## [LOW] Trash operations are non-atomic key-by-key loops

**File:** `lib/storage.ts:234-245` (`clearRoom`), `:248-260` (`restoreRoom`),
`:263-271` (`purgeTrash`)

**Issue:** All three walk `keys()` and `await` a `get`/`set`/`del` per key. There
is no transaction, so a tab closed or navigated mid-loop leaves a room split
across the `room:` and `trash:` namespaces. `listRooms` keys off the presence of
`room:{id}:meta`, so a half-deleted room can appear in the workspace with its
scene, transforms and photos already moved to trash — a room that opens empty.

Low rather than Medium because the window is milliseconds and the data is
recoverable by hand from the trash keys.

**Suggested fix:** Order the writes so the key that decides visibility flips
exactly once — `meta` **first** on delete (the room vanishes immediately; what is
left behind is invisible and gets swept) and **last** on restore (the room
reappears only once it is whole). A single manifest key per room would be the
fuller fix.

*(An earlier draft of this line had the two the wrong way round. The reasoning in
the Issue paragraph above is the correct one, and is what was implemented.)*

---

## [LOW] `restoreRoom` overwrites a live room without checking

**File:** `lib/storage.ts:248-260`

**Issue:** Restore reconstructs the original key names and `set`s them
unconditionally. If a room with that id exists live, it is silently replaced.
Not reachable through the current UI (ids are uuids and the undo token is
short-lived), but it is a public method on `roomStore` with no guard.

**Suggested fix:** Bail (or restore under a fresh id) when `room:{id}:meta`
already exists.

---

## [LOW] Footprint-picker area labels are bounding-box areas, not room areas

**File:** `app/onboarding/layout-pick/page.tsx:12-16` vs `lib/footprint.ts:13-55`

**Issue:** Each preset carries a hard-coded `area` string that equals
`width × depth`. For the three non-rectangular presets the built footprint has a
quadrant or notch removed, so the label overstates the floor:

| Preset | Label | Actual polygon | Error |
|---|---|---|---|
| Rectangle 6.0 × 4.0 | 24 m² | 24.0 m² | — |
| L-Shape 6.0 × 4.7 | 28 m² | 23.2 m² | +21% |
| T-Shape 5.5 × 4.7 | 26 m² | 17.9 m² | **+45%** |
| U-Shape 6.0 × 5.0 | 30 m² | 23.4 m² | +28% |
| Open Plan 7.5 × 5.6 | 42 m² | 42.0 m² | — |

The number is also inside each option's `aria-label`, so it is the figure a
screen-reader user chooses on. On a product whose stated promise is that its
dimensions are trustworthy, a stale hand-typed area is the wrong thing to be
wrong about.

**Suggested fix:** Compute it — `polygonArea(footprintForLayout(id, w, d))` is
already exported from `lib/clearance.ts`. Deleting the literal removes the
possibility of drift.

---

## [LOW] `RoomData` has no schema version

**File:** `lib/storage.ts:32-62`

**Issue:** New optional fields are read defensively and the reasons are
documented (`wallColors?`, `footprint?`, `hidden?`), which handles additive
change well. There is no `version` field, so a future change that is *not*
additive — a renamed field, a units change, a restructured `detectedObjects` —
has nothing to branch on and no way to detect an old record.

**Suggested fix:** Add `version: 1` on write now, while every record is
schema-identical, and read it as `?? 0`.

---

## Verified sound (not findings)

Worth recording so a future audit does not re-litigate them:

- **Soft delete is real.** `clearRoom` moves keys to a `trash:{ts}:` namespace
  with a 30-day TTL, `restoreRoom` reverses it, and every delete affordance
  (workspace card, bulk select, Settings danger zone) routes through the same
  path and offers a working Undo toast. `destroyRoom` exists for a permanent
  erase and is not wired to the ordinary path.
- **Empty vs missing is handled correctly.** `RoomSync.tsx:40-44` distinguishes a
  saved `[]` (a room the user emptied) from `undefined` (nothing saved), with the
  regression it fixes written down.
- **Debounced writes are flushed on unmount** for both transforms and scene
  parts, so navigating away inside the 300 ms window does not drop the last edit.
- **`touched` is a separate key**, so the debounced saves do not read-modify-write
  the whole room record.
- **`QuotaExceededError` is surfaced**, not swallowed — `storage.ts:6-18` wraps
  `set` and dispatches a window event the `StorageToast` listens for.
- **Every dimension write goes through `clampDims`** (`buildSceneFromRoom`, the
  Inspector's numeric fields, the scale gizmo), and the AI's `dimMM` is validated
  finite-and-positive before it is even offered to the clamp.
- **`loadCaptures` / `deleteCapture` keep slots consistent** — the move/swap path
  deletes the vacated source key, with the duplicate-wall bug it fixes recorded
  in the comment.

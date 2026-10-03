# Start here

If you read nothing else, read this page. It is short on purpose. Everything below
is said at length, with the history of why, in [`CLAUDE.md`](../CLAUDE.md). That
file wins when the two disagree, and this page is then fixed to match it.

**Danmu** is a browser-only interior decoration studio. Pick or photograph a
room, it rebuilds the room in 3D to scale (scanned furniture at approximate, catalogue
sizes), and you redecorate it. There is no
backend and no account. The 3D studio *is* the product.

## The ten rules

1. **No AI image generation, ever.** AI here only *detects* furniture in photos,
   and it is optional. Do not bring back any render, compose or image-to-3D path,
   or any AI model, cost or quota wording in the UI.
2. **Sizes come from code, not AI.** Every size goes through `clampDims`
   (`lib/dimension-ranges.ts`). A detector's size is a hint. When something does
   not fit, **say so; never quietly resize it to fit.** A piece built from a scan is
   *approximate by decision* (2026-10-03): catalogue size, default colour, never a
   photo measurement or a photo-sampled colour (`approximateDims`).
3. **One source of truth for furniture:** `lib/scene-spec.ts` (+
   `lib/parts-catalog.ts`). Adding a shape has a written contract in `Design.md`
   § Adding a shape, and `tests/shape-contract.test.ts` holds it. Clearance numbers
   live in `lib/layout-rules.ts`, never in a consumer.
4. **Arrange against the room, never its bounding box.** A footprint is a polygon,
   and an L, T or U is not its box. Use `lib/room-bays.ts` and gate with
   `footInsidePoly`.
5. **One drag, one resolve.** Where a dragged piece lands is `lib/drag-resolve.ts`,
   and who moves with it is `lib/drag-convoy.ts`. Both the 3D and 2D tabs call
   them. Never re-implement a step in a component.
6. **Never write `positions[p.id] ?? p.pos`.** A part's user edits sit over its
   authored transform. Read them through `lib/transforms.ts` or
   `lib/room-scene.ts`; a test fails on a hand-written fallback.
7. **No hard-coded design values.** Colours, spacing, type, radii, motion and
   z-index are tokens in `app/globals.css`. The 3D scene and canvas read
   `lib/scene-palette.ts`. Every colour token has a **night-mode value** too: edit
   the `[data-theme="dark"]` block, then run `node scripts/sync-dark-palette.mjs`.
   A control that does not fit must **reflow, not spill or vanish.**
8. **Local-first.** Rooms stay in IndexedDB, settings in localStorage. The only
   data that leaves the device is the optional Gemini detection call, with the
   user's own key. A shared room is a file the user saves, and it carries **no
   photos**. Every outside host is allow-listed in `next.config.mjs`.
9. **No carpenter spec.** No cut lists, build costs, prices, and no furniture CSV.
   The Room panel's list and its **Copy** are the sanctioned "what is in the room".
10. **A check nobody reads is not a check.** Mutate what you just wrote, guards
    included. Treat a note in `docs/` as a claim to re-derive, not a fact. Name the
    commit a number came from.

## Before you push

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

A warning fails `pnpm lint`. CI runs the same four gates on every pull request.

## Where to look next

| You want | Read |
|---|---|
| How the app is built | [`Design.md`](../Design.md) |
| The full rules and why each exists | [`CLAUDE.md`](../CLAUDE.md) |
| Who it is for | [`PRODUCT.md`](../PRODUCT.md) |
| What needs a human to look at | [`docs/visual-check.md`](visual-check.md) |
| What is open or decided against | [`docs/what-is-still-open.md`](what-is-still-open.md) — search it, never read it end to end |
| A symptom that has bitten before | [`docs/traps.md`](traps.md) — search by what you see |

## Keeping this page useful

Stay under 100 lines. A rule earns a place here only if breaking it has cost real
work. When a rule changes in `CLAUDE.md`, change it here in the same commit.
`tests/start-here.test.ts` fails if this page grows past its limit or names a file
that no longer exists.

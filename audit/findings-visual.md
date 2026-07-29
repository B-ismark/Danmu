# Visual audit — not performed

**Status: blocked, no findings.** No browser automation or screenshot tool is
available in this environment. I checked rather than assumed: the only
screenshot-capable tool present is Figma's node renderer
(`mcp__claude_ai_Figma__get_screenshot`), which renders Figma canvas nodes and
cannot load a `localhost` page. There is no Playwright, Puppeteer or Chrome
DevTools tool.

So Phase 2 of the audit spec — screenshots of every route at 375 / 768 / 1280 px
— did not happen, and nothing in this file should be read as a visual pass.

## What the spec asked for that does not apply here anyway

Two parts of the visual matrix have no subject in this codebase:

- **Light and dark themes.** Danmu ships one theme. `app/globals.css` has no
  `prefers-color-scheme` block and no `[data-theme]` selector; `:root` is the
  only token scope, and the palette is a fixed warm cream. There is no
  `localStorage['mrbs-theme']` equivalent. So "screenshot both themes" reduces to
  one.
- **Per-role flows.** There is no auth, no accounts and no roles — the app is
  local-first with a single implicit user. "admin / regular / view_only" has no
  analogue.

## What was substituted

Static verification that covers some of the same ground:

- **Production build compiles and prerenders.** `next build` exits 0 and
  generates all 11 routes (9 static, 2 dynamic). No route fails to render
  server-side, which rules out the blank-page class of failure that the spec's
  "flag blank screens" check is aimed at.
- **Breakpoint logic reviewed in source** rather than in a viewport:
  `app/globals.css:410-425` (the 720 px block), `useStackedStudio` at 1023 px,
  `useNarrow` on the capture page, `NarrowViewportBanner`'s pointer-type gate.
  Two real observations came out of that review and are filed where they belong —
  the first-render layout shift (`findings-performance.md`) and the fact that the
  CSS and JS stacking thresholds are 720 px and 1023 px respectively (not a
  defect: the JS handles the band between them).
- **Empty, loading and error states enumerated per surface** — see the
  *Verified sound* section of `findings-ui-code.md`. Every list view has an empty
  state and every async operation has a loading state, confirmed by reading the
  components.
- **Contrast ratios read from the token file's own measurements**
  (`app/globals.css:13-92`), which are documented per token. One real issue came
  out of that — interactive boundaries at ≈1.14:1 — and is filed in
  `findings-ui-code.md`.

## To run this phase properly

```bash
pnpm build && pnpm start -p 3000
```

Then drive a headless browser over: `/`, `/onboarding/welcome`,
`/onboarding/layout-pick`, `/onboarding/capture`, `/onboarding/detect`,
`/workspace`, `/room/{id}/model`, `/room/{id}/plan`, `/settings` at 375 / 768 /
1280 px. Seed IndexedDB with at least one room first — most routes redirect or
show a gate without one, and `/room/{id}/*` needs a real uuid.

Waiting strategy: `domcontentloaded`, then wait for `--paper` to resolve on
`:root`. Do **not** wait on `networkidle` on the studio route — the 3D canvas
loads lazily and the detector probes two remote hosts.

Three things are worth photographing specifically, because they are the ones this
static pass could not settle:

1. **The studio at 768 px.** The rails stack via a JS breakpoint that also
   reorders the children array; the reflow is the least-exercised layout in the
   app.
2. **The detect screen with four photos and ~20 detections.** The right rail is a
   fixed 380 px track that becomes a sheet under the photo on narrow screens, and
   the box overlay layer is positioned in normalised percentages over an
   `object-fit` image.
3. **The exported floor-plan PNG.** Two filed findings predict visible defects
   there — off-brand colours and legend text running off the canvas — and a
   single export at a long room name would confirm both in one image.

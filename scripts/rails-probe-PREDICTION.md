# Prediction for `rails.mjs` — written BEFORE the first run

Branch `fix/third-agent-rails`. Baseline is the third agent's own snapshot,
`third-agent/mobile-ux-pass` @ `8fbfd85`, whose parent is `main` @ `6c3c0c9`.

## Why a probe

Every defect below is a **pixel or a computed style**. jsdom resolves no `var()`, has no
layout, and returns zeros from `getBoundingClientRect`, so the vitest file that covers
these gestures asserts the store and the property *string* and says so in its own header.
The numbers — 208 versus 228, a grid with three columns versus none, a label's
`scrollWidth` against its `clientWidth` — exist only in a browser.

## The scenarios

| # | scenario | on `8fbfd85` | on the fix | discriminates? |
|---|---|---|---|---|
| S1 | at 1100px, press-and-release a **closed** left sash: the rail's width after | **FAIL** — 228px, and `railLeftW` is a number | PASS — 208px, `railLeftW` null | **YES** |
| S2 | **double-click** the sash on a never-dragged rail: `grid-template-columns` after | **FAIL** — `none` | PASS — three tracks | **YES** |
| S3 | grab-open then push-closed, reopen: `grid-template-columns` | **FAIL** — `none` | PASS — three tracks | **YES** |
| S4 | at 1100px, the **Shuffle** label's `scrollWidth` vs `clientWidth`, idle and busy | **FAIL** — truncated | PASS — not truncated | **YES** |
| S5 | the NorthDial light-direction sentence is in the document without hovering | **FAIL** — only inside a tooltip | PASS — standing text | **YES** |
| S6 | the Room rail section, **collapsed**, still states the room's size | **FAIL** — no meta | PASS — `6.0×5.0m` | **YES** |
| S7 | **measurement, not a gate**: the right rail's fixed stack against the rail's own height at a short window | prints | prints | **NO** — this is F7, unverified either way until it prints |
| S8 | control — the studio grid has three tracks on a plain load, both builds | PASS | PASS | **NO** — separates "lost the variable" from "never had one" |

**S7 is a measurement and is not evidence for the change.** It exists because the
components review raised the footer spilling past `.rail` (which is `overflow: visible`)
on a short window and could not measure it. Whatever it prints goes in the PR as a
finding or as a refutation, not as a pass.

## What I expect the baseline to print

S1–S6 red, S7 printing, S8 green. Any other combination means the probe is measuring
something else:

- if **S8 goes red on either build**, the shell never rendered and every other reading in
  the run is void;
- if **S2 or S3 goes GREEN on `8fbfd85`**, React restored a property I have argued it
  cannot, and the whole `DockedShell` change needs rethinking rather than shipping;
- if **S4 goes green on `8fbfd85`**, my 35px arithmetic is wrong about a real font and
  the wrap is a preference rather than a fix — say so and revert to the grid.

## Known ways this probe could lie

1. **`grid-template-columns: none` computes as the string `none`,** but a grid whose
   columns are simply not yet laid out can also read oddly during load. Read it after the
   shell has painted, and assert the three-track case positively rather than asserting
   "not none".
2. **`scrollWidth > clientWidth` is the truncation test**, and it is off by a subpixel on
   some fonts. Use a 1px tolerance and print both numbers, so a marginal answer is
   visible rather than rounded into a verdict.
3. **The compact step is 1024–1279px.** A viewport set outside it measures `--rail-left`
   and the whole S1 arithmetic changes. Assert the width band before trusting S1.
4. `railLeftW` lives in `localStorage` under `danmu-studio-prefs` — NOT `STUDIO_PREFS`,
   which is the name of the comment describing the persisted set. So a scenario that stores
   one **poisons every later scenario in the same context**. Each starts from a cleared
   store.

---

# Second round — S9, S10, S11, and S4's busy half

Written before the run, same as the first round, and for the same reason: a prediction
read after the fact is not a prediction. Five review lenses and a peer's independent
browser probe measured four more ways to move a rail nobody asked to move. **Three of the
four are present on `main` at `11f7a4f` and were measured there**, so the discriminating
comparison for these is against `main`, not against `8fbfd85`.

| | scenario | predicted on `main` | predicted here |
|---|---|---|---|
| S9-left | press the left sash and drag straight DOWN | **FAIL — 208 → 228px** | PASS — 208px |
| S9-left-var | `--sash-left` after that release | **FAIL — the literal `228px`** | PASS — an expression |
| S9-right | the same gesture on the right sash | **FAIL — 248 → 37px, the Inspector shuts** | PASS — 248px |
| S9-right-var | `--sash-right` after it | **FAIL** | PASS |
| S10-left | `aria-valuenow` inside `[min, max]` | **FAIL — 208 in [228, 512]** | PASS |
| S10-right | same, right rail | **FAIL — 248 in [276, 512]** | PASS |
| S11 | one ArrowLeft on the focused left sash | **FAIL — 208 → 228, stored 228** | PASS — no widening |
| S11-home | `Home`, which means "smallest" | **FAIL — 208 → 228** | PASS |
| S11-grow | control: ArrowRight still resizes | PASS | PASS |
| S4-busy | the `Shuffling…` label, polled rather than slept | (not run there) | PASS — whole |

**What would mean the probe is measuring something else**

- if **S11-grow fails**, the keyboard guard refuses everything, which is the exact shape
  of the mistake this branch already made once with `m.width >= m.floor`. A guard that
  rejects needs an input it accepts, or it is satisfied by refusing every input;
- if **S9-right passes on `main`**, the collapse arithmetic is not what closed the rail
  there and my single-root reading is wrong — three fixes then need re-deriving, not one;
- if **S10 passes on `main`**, the attributes are not what the lens read and the
  measurement came from somewhere else;
- if **S4-busy fails to catch the label at all**, the polling is still too slow and the
  scenario is unmeasured — which is a FAIL here on purpose. The first version printed
  "not counted either way" and both recorded runs reported 10 of a possible 11 checks,
  which is the arithmetic that says it never executed once, on either build. An
  assertion that opts out when its subject is missing is not an assertion.

**What this round cannot settle.** Whether the busy label is *cut* on a real font at a
real DPI is one 1px-tolerance measurement on one machine; and the row reflowing on press
— two side-by-side buttons becoming two stacked full-width ones, so the control under a
pointer that has not moved is no longer the one that was pressed — is printed as a
measurement and fixed by nothing here.

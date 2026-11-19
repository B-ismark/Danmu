# Field rooms

Four real rooms, photographed wall by wall at two lenses, with what each room really
holds and what the app made of them. Use this kit to measure the capture route again
after a change, and to compare against the numbers recorded here.

**These are not photos of anyone's home.** Each one is cut from a free, public-domain
(CC0) 360° panorama on [Poly Haven](https://polyhaven.com). That is why they may live in
the repo, while a user's own captures never leave their device (CLAUDE.md rule 5). The
photos carry no GPS. Their EXIF holds only a 35 mm focal length and a shutter time.

| Room | Panorama | Author | Room (w × d × h) | Camera |
|---|---|---|---|---|
| `empty-room` | [small_empty_room_1](https://polyhaven.com/a/small_empty_room_1) | Sergej Majboroda | 2.9 × 4.4 × 2.45 m | 1.47 m, near the centre |
| `hotel-room` | [hotel_room](https://polyhaven.com/a/hotel_room) | Greg Zaal | 3.0 × 3.05 × 2.45 m | 1.38 m, 0.4 m toward Wall 4 |
| `seaview-suite` | [relax_inn_seaview_suite](https://polyhaven.com/a/relax_inn_seaview_suite) | Dario Barresi & Jenelle van Heerden | 4.85 × 5.5 × 2.6 m | 1.53 m, 0.47 m toward Wall 4 |
| `family-lounge` | [anniversary_lounge](https://polyhaven.com/a/anniversary_lounge) | Greg Zaal | 4.3 × 4.2 × 2.6 m | ≈1.0 m (low), off-centre toward Walls 1 and 4 |

## What is here

| Path | What it is |
|---|---|
| `photos/<room>-wall<N>-<lens>.jpg` | 32 photos: 4 rooms × 4 walls × 2 lenses, 1600 × 1200, level, square-on. |
| `rooms.json` | The ground truth: sizes, camera spot, the panorama yaw of each wall, what each wall should yield, things to watch, and a top-down plan of every piece. |
| `runs/<room>-<lens>-1234/` | The last full run of all eight sets through the app (see below). |
| `report/index.html` | The field-test report written from the first runs, with annotated photos. |
| `tools/` | The Python that made and checked the photos: `slice.py`, `measure.py`, `grid.py`. |
| `../../../scripts/field-rooms-run.mjs` | The browser walk that produced `runs/`. |

### The two lenses

| Lens | 35 mm focal (EXIF) | Horizontal view |
|---|---|---|
| `ultrawide` | 13 mm | 106.1° |
| `1x` | 27 mm | 65.3° |

The view angle is `2·atan(17.3 / focal)`, which is what `slice.py` uses. Walls 1–4 run
clockwise. `rooms.json` gives each wall's panorama yaw (`wallYawDeg`), so any photo can
be cut again or at a new angle.

### Shutter times

The shutter times are 20 s apart in wall order: empty room 10:00, hotel 10:10, suite
10:20, lounge 10:30, all on 2026-11-19. That is what lets the capture screen put shuffled
uploads back on the right walls.

The fourth wall's time is written as `…:60` seconds, which is not a valid clock time. The
app still sorted every set correctly. Keep this quirk, as it tests the parser on a
malformed field.

## How sure the ground truth is

Room sizes, camera heights and piece positions are **my reading of each panorama**. They
come from door heights, the floor and ceiling lines, and the camera height. Treat them as
**±10%, not tape-measured**. The plans in `rooms.json` are how I read each room, not a
survey.

Firm enough to measure against:
- which pieces exist, and on which wall;
- whether a piece is a duplicate of one seen on another wall;
- whether a size is in the right band (a double bed is not a single).

Too soft to measure against: a few centimetres of position.

## What was observed

### First runs (report/index.html)

Run on a production build with the local finder only.

- **Wall order: perfect.** 24 of 24 shuffled photos landed on the right wall, from their
  shutter times. The wall-length labels matched the room.
- **Placement: mostly right.** In the hotel room, the bed, bedside tables, desk, doors and
  TV landed within about 20 cm of the plan.
- **Too many rows offered.** The rooms hold roughly 14 (hotel), 18 (suite), 12 (lounge)
  and 3 (empty) pieces. The ultrawide sets offered 27, 42, 35 and 4 rows.
  - The lounge's one L-shaped sofa became 11 rows.
  - The suite's wall mirror produced a ghost bed, chair and lamp.
- **Tall things cut short.** Zoomed tiles boxed only the top of doors and curtains. This
  was fixed in [B-ismark/Danmu#325](https://github.com/B-ismark/Danmu/pull/325):
  - hotel door 1.17 → 1.93 m;
  - suite curtains 1.08 → 1.99 m;
  - window 0.77 → 1.58 m.
- **A low camera pushes everything back.** The lounge was shot from about 1 m. Without a
  known lens the app assumes 1.5 m, so pieces read about a third too far away and ended
  up against the walls. This is the most useful failure case in the kit.
- **Ultrawide is not better.** It found more, but gave roughly twice the duplicates. 1×
  was calmer and missed corners.

### The recorded runs (`runs/`)

All eight sets were run with photos in wall order (`1234`) and every row ticked. The
build was the branch at `ee834e0`, the last commit before the runs, around 14:39 UTC on
2026-11-19. It came before [#326](https://github.com/B-ismark/Danmu/pull/326) and
[#327](https://github.com/B-ismark/Danmu/pull/327), so re-run before comparing against
`main`.

| Set | Rows offered | Pre-ticked | Walls right |
|---|---|---|---|
| empty-room · 1× | 10 | 0 | 4/4 |
| empty-room · ultrawide | 4 | 0 | 4/4 |
| hotel-room · 1× | 18 | 2 | 4/4 |
| hotel-room · ultrawide | 26 | 4 | 4/4 |
| seaview-suite · 1× | 28 | 9 | 4/4 |
| seaview-suite · ultrawide | 42 | 14 | 4/4 |
| family-lounge · 1× | 19 | 6 | 4/4 |
| family-lounge · ultrawide | 32 | 10 | 4/4 |

`room.json` holds every detection the app saved: label, box in the photo, wall, size and
position. That is what to diff against `rooms.json`'s plan.

`probe.json` and `cals.json` came from a temporary debugging hook (`window.__probe`,
`window.__cals`) that is **not in the app**. A fresh run will not write them unless that
hook is added back locally.

### Hidden feet ([#327](https://github.com/B-ismark/Danmu/pull/327))

A nightstand standing behind the bed shows only from the mattress up. Read that way, it
came out too near and too small.

| Case | Before | After |
|---|---|---|
| Seaview ultrawide, east wall: the tucked nightstand | 702 × 610, flagged | 542 × 736, ok |
| Seaview ultrawide, east wall: the nightstand standing clear on the tiles | 621 × 697, ok | unchanged |
| Hotel nightstands | flagged | still flagged, read narrower (the camera position is the main error there) |

The nightstand standing clear on the tiles reaches 24 thousandths of the frame into the
bed's box. That is why a piece only counts as hidden when the nearer piece covers its
**whole width**.

## Measuring again

1. Build and serve production:

   ```bash
   pnpm build && pnpm exec next start -p 3061
   ```

2. Walk one set. The order is the upload order, so `4231` tests the shutter-time sort:

   ```bash
   BASE=http://localhost:3061 OUT=/some/scratch/runs node scripts/field-rooms-run.mjs seaview-suite ultrawide 1234
   ```

   Playwright is not a dependency here. Set `PW_ROOT` to wherever it is installed, as
   `scripts/capture-route-probe.mjs` explains. `KEEP=none` leaves the app's own ticks in
   place, which measures the pre-ticked selection rather than the worst case.

3. Compare the new `room.json` and `log.txt` with `runs/` here and with the plan in
   `rooms.json`. If the change is meant to move these numbers, replace `runs/` and update
   the tables above. Write down which build the new runs came from.

### Cutting a photo again

Download a panorama from the Poly Haven link above; the photos were cut from a downloaded
copy, 3–45 MB each. Then, from a scratch directory:

```bash
python3 tests/fixtures/field-rooms/tools/slice.py hotel_room.jpg out.jpg 105 --hfov 106.1 --focal35 13 --exif-time "2026:11:19 10:10:20"
```

The third argument is the yaw, from `rooms.json` `wallYawDeg`. `--pitch` tilts the camera
and `--guide` draws a measuring grid instead of writing EXIF. `measure.py` cuts degree-ruled
strips at given yaws to read heights off the panorama. `grid.py` draws a 10° grid over a
whole panorama.

The panoramas themselves are not committed. They are 230 MB in all, and Poly Haven keeps
them.

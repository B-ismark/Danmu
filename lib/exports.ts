// What to call a file the user is taking away.
//
// Three downloads leave the app — the 3D view as a PNG, the floor plan as a PNG, and
// the room itself as a `.danmu.json` — and each of them was naming itself. The scene
// file slugged the room's name with a length cap, the export menu slugged it without
// one, and the floor plan did not slug anything at all: it downloaded as
// `floor-plan.png` every time, so exporting three rooms left three files that a
// browser silently numbered `(1)` and `(2)`. They agree here now.
//
// The cap matters for the same reason the slug does. A room named by paste rather
// than by hand can be arbitrarily long, and a 300-character filename is one the OS
// may simply refuse to write — which surfaces as a download that did nothing.
//
// Two things this module used to hold, and deliberately no longer does:
//
//   · The furniture CSV. Retired in `9a75a42` on product grounds, not tidiness:
//     non-negotiable 6 forbids reinstating the carpenter spec, and a parts list
//     minus the prices is what that was. The on-screen list and its plain-text Copy
//     — which do serve "communicate a plan" — are untouched. Do not bring it back
//     with a spreadsheet writer attached.
//   · Applying the user's live transforms. That merge belongs to `lib/transforms.ts`
//     (`resolveParts`) and, for anything drawing or exporting the whole room, to
//     `lib/rider-height.ts`'s `resolveScene` — which is that merge plus the height a
//     rider takes from a support the user resized. `tests/room-scene.test.ts` fails
//     the build if a hand-written copy of the fallback reappears anywhere, or if a
//     new caller reaches for the plain merge — this file having briefly carried one.

/** Filenames are capped well under every filesystem's limit, and the caller adds an
 *  extension on top — so the budget is for the name, not for the whole thing. */
const MAX_SLUG = 60;

/** Downloads carry the room's name, so a folder of exports from three rooms is still
 *  readable a week later. `Front Room!` → `front-room`. */
export function fileSlug(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'room';
  // Trailing separator trimmed AGAIN after the cut: slicing mid-word can leave the
  // name ending in a hyphen, which reads like the filename was truncated by accident.
  return slug.slice(0, MAX_SLUG).replace(/-+$/, '') || 'room';
}

/** `Front Room` → `front-room-snapshot.png`. The last of the three downloads to
 *  join the agreement the header above describes: the 3D PNG shipped as a fixed
 *  `room-snapshot.png`, indistinguishable across rooms — the header's own claim
 *  that the three names agree was false until this function existed. An unnamed
 *  room slugs to `room`, which lands on the old fixed name, so the fallback
 *  changes nothing. */
export function snapshotFileName(roomName: string): string {
  return `${fileSlug(roomName)}-snapshot.png`;
}

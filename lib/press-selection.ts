// What was selected when the press landed — for the one question that has to be asked
// about the moment BEFORE a gesture, not the moment after it.
//
// The drill-in (`selectionForPick`) asks whether a pick came from INSIDE the group, and
// the gesture itself may have already answered that: `Draggable`'s touch hold-to-pick-up
// and its drag-start both select an unselected set WHOLE before any click arrives, so
// reading the live selection in `onClick` would drill into the press's own answer and a
// single tap on a merged set could never select the set at all.
//
// **Why this is a module and not a ref on the component.** It was a ref on `Pickable`,
// stamped in that component's own `onPointerDown` — and that handler does not always
// run. Once a piece is selected the gizmo appears, and R3F cannot see the gizmo: drei's
// `TransformControls` is a `<primitive>` with no handlers, so its invisible translate
// plane sits over the selected furniture and takes the press without R3F dispatching
// anything to the mesh underneath. The DOM click still arrives at the mesh. So `onClick`
// ran with a `selDown` left over from the LAST press that did reach it — `[]`, from
// before anything was selected — and `selectionForPick` concluded the pick came from
// outside the group and handed back the whole group. Every time.
//
// That is § 14: "selecting a member of a group individually by clicking it doesn't work,
// though it works when you click it in the layer list." `PartTree` calls `setSelected`
// directly and never consults this, which is exactly why it was the half that worked.
// The 2D plan works too — it has no gizmo, so its own press always lands.
//
// A window listener in the CAPTURE phase is what fixes it: capture runs before any React
// or R3F handler and before the gizmo's own `mousedown`, so it sees every press on the
// way down, whoever ends up claiming it. It is deliberately not in `store.ts` — same
// reason as `lib/drag-click.ts` — so this can be tested without zustand's `persist` and
// a localStorage shim.

let atPress: readonly string[] = [];
let detach: (() => void) | null = null;

/**
 * Start recording the selection as each press begins.
 *
 * Idempotent: many `Pickable`s mount, and they must share ONE listener and one answer.
 * A per-component listener would record the same thing many times and, worse, would
 * stop recording when that particular component unmounted.
 *
 * `read` is injected rather than imported so this module never pulls in the store —
 * see the note above.
 */
export function armPressSelection(read: () => readonly string[]): void {
  if (detach || typeof window === 'undefined') return;
  const onDown = () => {
    atPress = read();
  };
  window.addEventListener('pointerdown', onDown, true);
  detach = () => window.removeEventListener('pointerdown', onDown, true);
}

/** The selection as the current press landed. `[]` before any press. */
export function selectionAtPress(): readonly string[] {
  return atPress;
}

/** Test seam, and the reason it exists rather than being exported state: a module-level
 *  recorder that cannot be reset makes every test after the first depend on the one
 *  before it. Production never calls this. */
export function resetPressSelection(): void {
  detach?.();
  detach = null;
  atPress = [];
}

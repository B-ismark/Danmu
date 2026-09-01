// Re-settling what stands ON something, after the something changed size.
//
// `settleHeights` answers entirely in `dimMM`, and a resize does not touch `dimMM`
// — it writes a `dims` override. So the load path settles against the AUTHORED size
// and then applies the saved sizes over the top, with nothing settling afterwards:
// shrink a desk, reopen the room, and the lamp hangs in the air at the height the
// desk used to be. Reported by eye, and the prediction in `visual-check.md` was
// exact.
//
// **Why this is a module and not four lines in the load effect.** The application
// rule below is the whole content, and it is the reason the fix was recorded as a
// decision rather than a patch (`what-is-still-open.md` § B.16): re-settling on load
// "writes position overrides, and every override pins that value against a re-detect
// and persists it — that stamps the user's room to fix a display bug." That is true
// of CREATING an override and false of correcting one that is already there, and the
// difference is exactly what this file encodes. Four lines at the call site would
// have made that distinction invisible and unreachable from a test.

import { settleHeights } from './layout-settle';
import { resolveParts, type TransformOverrides } from './transforms';
import type { ScenePart } from './scene-spec';

export type RiderSettle = {
  /** The parts list with authored `pos[1]` corrected, or the input array
   *  unchanged (by identity) when nothing needed it — so a caller can skip the
   *  store write, and `useScene`'s subscribers do not see a no-op change. */
  parts: ScenePart[];
  /** The `positions` map with EXISTING entries corrected. Never gains a key.
   *  Returned by identity when unchanged, for the same reason. */
  positions: Record<string, [number, number, number]>;
  /** Which pieces moved, and by how far, so a caller can report rather than guess. */
  moved: { id: string; from: number; to: number }[];
};

/** Below this a correction is not worth a store write. Floating-point churn from
 *  re-deriving the same settle is nanometres; the defect this exists for is
 *  measured in hundreds of millimetres. */
const EPS_M = 0.0005;

/**
 * Put riders back on whatever they are standing on, given the sizes actually in
 * force.
 *
 * **It never creates a position override.** A fix lands on the layer that already
 * holds that part's position: an existing `positions[id]`, or the authored
 * `part.pos`. A piece the user has never moved keeps having no override, so a
 * re-detect still reaches it and nothing new is pinned against it — which is the
 * objection that kept this unfixed, answered rather than overruled.
 *
 * Pure. The caller decides whether the two results are worth writing.
 */
export function settleRiders(
  parts: ScenePart[],
  o: Partial<TransformOverrides>,
  roomHeight: number,
): RiderSettle {
  // Settle against what the user is LOOKING at — authored geometry with their own
  // sizes, positions and rotations applied. Handing `settleHeights` the raw parts
  // is the defect itself, one layer up.
  const resolved = resolveParts(parts, o);
  const fixes = settleHeights(resolved, roomHeight);
  if (fixes.length === 0) return { parts, positions: o.positions ?? {}, moved: [] };

  const byId = new Map(resolved.map((p) => [p.id, p]));
  const moved: RiderSettle['moved'] = [];
  let nextParts: ScenePart[] | null = null;
  let nextPositions: Record<string, [number, number, number]> | null = null;

  for (const fix of fixes) {
    const now = byId.get(fix.id);
    if (!now || Math.abs(now.pos[1] - fix.y) < EPS_M) continue;
    moved.push({ id: fix.id, from: now.pos[1], to: fix.y });

    const override = o.positions?.[fix.id];
    if (override) {
      // Already pinned by the user's own drag. Correcting the Y of an entry that
      // exists adds no pinning that was not there a moment ago.
      nextPositions ??= { ...(o.positions ?? {}) };
      nextPositions[fix.id] = [override[0], fix.y, override[2]];
    } else {
      // Never moved by hand, so there is nothing to correct but the authored
      // position — and writing one here would be the stamp this avoids.
      nextParts ??= [...parts];
      const k = nextParts.findIndex((p) => p.id === fix.id);
      if (k >= 0) {
        const p = nextParts[k];
        nextParts[k] = { ...p, pos: [p.pos[0], fix.y, p.pos[2]] };
      }
    }
  }

  return {
    parts: nextParts ?? parts,
    positions: nextPositions ?? o.positions ?? {},
    moved,
  };
}

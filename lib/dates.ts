// Timestamp formatting, in one place — the counterpart to lib/units.ts.
//
// Dimensions have always gone through a shared formatter; dates had not. The
// workspace hand-rolled a relative label with its own toLocaleTimeString /
// toLocaleDateString and a year-conditional option object, while the saved-layouts
// panel used a bare toLocaleString(), so the same kind of fact was presented two
// different ways on two screens.

const DAY = 24 * 60 * 60 * 1000;

/** Midnight this morning, local time. The reference point every relative label
 *  is measured against — passed in rather than recomputed per row so a long list
 *  cannot straddle a boundary mid-render. */
export function startOfToday(now: number = Date.now()): number {
  const n = new Date(now);
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Edited 3:40 pm" / "Edited yesterday, 3:40 pm" / "Edited 4 Mar, 3:40 pm".
 *
 *  Date AND time: two rooms edited on the same day were otherwise
 *  indistinguishable. The year appears only when it is not the current one. */
export function editedLabel(ts: number, today: number = startOfToday()): string {
  const d = new Date(ts);
  const time = timeOf(d);
  if (ts >= today) return `Edited ${time}`;
  if (ts >= today - DAY) return `Edited yesterday, ${time}`;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return `Edited ${d.toLocaleDateString(undefined, opts)}, ${time}`;
}

/** Absolute date + time for a saved artifact — a layout variant, an export.
 *  Deliberately not relative: "yesterday" is the wrong register for something the
 *  user is choosing between several of. */
export function savedLabel(ts: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString(undefined, opts)}, ${timeOf(d)}`;
}

/** Recency buckets for grouping a list. A flat grid of identical cards stops
 *  being navigable at roughly eight rooms, and "when did I last touch this" is
 *  the axis people actually search on. */
export const RECENCY_GROUPS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Earlier this week' },
  { id: 'month', label: 'Earlier this month' },
  { id: 'older', label: 'Older' },
] as const;

export type RecencyGroupId = (typeof RECENCY_GROUPS)[number]['id'];

export function recencyBucket(ts: number, today: number = startOfToday()): RecencyGroupId {
  if (ts >= today) return 'today';
  if (ts >= today - 6 * DAY) return 'week';
  if (ts >= today - 29 * DAY) return 'month';
  return 'older';
}

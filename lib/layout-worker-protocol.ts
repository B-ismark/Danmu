// What crosses the thread boundary between the studio and `layout.worker.ts`.
//
// One module both sides import, so a request the page builds and the request the
// worker reads are the same type — a hand-kept pair on either side of a
// `postMessage` is the drift `toRecord`/`fromRecord` already cost this repo once.
//
// Everything here must survive the structured clone. `SolveOptions.pick` is a
// function and cannot, which is why the request carries a named subset of the
// options rather than `SolveOptions` itself: the compiler refuses a caller that
// tries to send one, where a spread would have failed at runtime with a
// `DataCloneError` from inside the worker's queue.

import type { Footprint } from './footprint';
import type { SolveOptions, SolveResult } from './layout-solve';
import type { ShuffleOptions, ShuffleOutcome, ShuffleRoom } from './layout-shuffle';
import type { ScenePart } from './scene-spec';

export type SolveArgs = {
  parts: ScenePart[];
  footprint: Footprint;
  locked: boolean[];
  opts: Pick<SolveOptions, 'seed' | 'mode' | 'placed'>;
};

export type ShuffleArgs = {
  parts: ScenePart[];
  room: ShuffleRoom;
  locked: boolean[];
  opts: Pick<ShuffleOptions, 'attempt' | 'history'>;
};

export type LayoutRequest =
  | { id: number; kind: 'solve'; args: SolveArgs }
  | { id: number; kind: 'shuffle'; args: ShuffleArgs };

export type LayoutResponse =
  | { id: number; kind: 'solve'; ok: true; value: SolveResult }
  | { id: number; kind: 'shuffle'; ok: true; value: ShuffleOutcome | null }
  | { id: number; ok: false; error: string };

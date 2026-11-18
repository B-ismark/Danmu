// What the walls are finished in — one choice for the whole room, beside each wall's
// own paint colour. Pure data and validation; the textures are drawn in
// `lib/textures.ts` (`wallFinishFields`) and spread in `components/three/RoomShell.tsx`.
//
// ── Why one finish per room and a colour per wall ────────────────────────────
//
// A finish is how the room was BUILT — brick, panelling, a plaster skim — and a room is
// built one way far more often than four. A colour is how it was PAINTED, and painting
// one wall a different colour is the everyday case the app already supports. So the
// finish multiplies each wall's own colour: a pale wall over brick is painted brick, a
// green one over panelling is green panelling. Nothing here takes a colour.
//
// Grout (the mortar, on brick) is dark-only for the floor's reason: the tone map
// multiplies, so a joint can be drawn darker than its face and never paler.
//
// **A wall nobody chose is the wall the app always had** — painted plaster — so every
// room saved before this opens unchanged, and `walls` is optional wherever it is stored.

import { GROUTS, type Grout } from './floor-finish';

export const WALL_KINDS = ['plaster', 'paint', 'limewash', 'panelling', 'brick', 'tile'] as const;
export type WallKind = (typeof WALL_KINDS)[number];

/** The room's wall finish. `grout` is read only for a kind that has joints. */
export type WallFinish = { kind: WallKind; grout?: Grout };

export type WallKindSpec = {
  readonly label: string;
  /** One line under the choice, saying what is being picked. */
  readonly note: string;
  /** Whether the finish has joints to colour (brick's mortar, tile's grout). */
  readonly joints: boolean;
  /** What the joints are called, for the control's label. */
  readonly jointLabel: string | null;
  /** The material's roughness at its roughest; the roughness map scales it down. */
  readonly roughness: number;
  /** Strength of the relief, for `normalScale`. */
  readonly relief: number;
};

export const WALL_SPEC: Record<WallKind, WallKindSpec> = {
  plaster: {
    label: 'Plaster',
    note: 'Painted plaster with a soft roller texture.',
    joints: false,
    jointLabel: null,
    roughness: 0.96,
    relief: 0.5,
  },
  paint: {
    label: 'Smooth',
    note: 'A flat, even eggshell coat.',
    joints: false,
    jointLabel: null,
    roughness: 0.9,
    relief: 0.3,
  },
  limewash: {
    label: 'Limewash',
    note: 'Chalky and cloudy, the colour moving in soft patches.',
    joints: false,
    jointLabel: null,
    roughness: 1,
    relief: 0.5,
  },
  panelling: {
    label: 'Panelling',
    note: 'Painted boards standing up the wall, 120 mm wide.',
    joints: false,
    jointLabel: null,
    roughness: 0.85,
    relief: 0.8,
  },
  brick: {
    label: 'Brick',
    note: 'Painted brick in a running bond.',
    joints: true,
    jointLabel: 'Mortar',
    roughness: 1,
    relief: 0.9,
  },
  tile: {
    label: 'Metro tile',
    note: 'Bevelled 150 × 75 mm glazed tiles.',
    joints: true,
    jointLabel: 'Grout',
    roughness: 0.9,
    relief: 0.7,
  },
};

export const DEFAULT_WALLS: WallFinish = { kind: 'plaster' };

export type ResolvedWalls = { kind: WallKind; grout: Grout };

export function resolveWalls(w: WallFinish | undefined): ResolvedWalls {
  const kind = w?.kind ?? DEFAULT_WALLS.kind;
  return { kind, grout: WALL_SPEC[kind].joints ? (w?.grout ?? 'match') : 'match' };
}

/** Reads a wall finish from bytes someone else produced — a saved record or a room
 *  file. Lossy and never silent, as `readFloorFinish` is: what it could not keep is
 *  pushed onto `dropped`. */
export function readWallFinish(v: unknown, dropped?: string[]): WallFinish | null {
  if (v === undefined) return null;
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  const kind = o && (WALL_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as WallKind) : null;
  if (!o || !kind) {
    dropped?.push("the walls' finish was unreadable, so plain plaster was used");
    return null;
  }
  const out: WallFinish = { kind };
  if (o.grout !== undefined && !WALL_SPEC[kind].joints) dropped?.push(`${WALL_SPEC[kind].label.toLowerCase()} walls have no joints, so the grout given was left out`);
  if (o.grout !== undefined && WALL_SPEC[kind].joints) {
    if ((GROUTS as readonly unknown[]).includes(o.grout)) out.grout = o.grout as Grout;
    else dropped?.push(`the walls' ${WALL_SPEC[kind].jointLabel?.toLowerCase()} was unreadable, so a matching one was used`);
  }
  return out;
}

import { roomFootprint } from './footprint';
import { polygonArea } from './geometry';
import type { RoomShape } from './scene-store';

// The room at a glance, for the empty Inspector: how many pieces, how big, how
// much floor.
//
// The AREA is the footprint polygon's and not `width × depth`. Those are the
// bounding box's sides, and an L, T or U is not its bounding box. An L's cut-away
// quadrant is floor it does not have, and the bounding-box sum reports it anyway.
// CLAUDE.md rule 3 says to arrange against the room and never its bounding box.
// A number printed about the room answers to the same rule (rule 2: a displayed
// measurement is derived). The two sides ARE the box, and the panel labels them
// "Size", the room's overall extent, which is true of every shape.

export type RoomFacts = {
  pieces: number;
  /** Overall extent, millimetres, for `formatDim`. */
  widthMM: number;
  depthMM: number;
  /** Floor actually enclosed by the walls, m². */
  areaM2: number;
  /** The room still stands at its shape's typical size, so every number is a guess. */
  rough: boolean;
};

export function roomFacts(
  room: Pick<RoomShape, 'width' | 'depth' | 'layoutId' | 'footprint' | 'roughSize'>,
  pieces: number,
): RoomFacts {
  return {
    pieces,
    widthMM: room.width * 1000,
    depthMM: room.depth * 1000,
    areaM2: polygonArea(roomFootprint(room)),
    rough: room.roughSize === true,
  };
}

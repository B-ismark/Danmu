// The five room shapes a new room can start from, and the one way a room is made
// from one of them.
//
// Two screens make rooms: the New room page (any shape, any size) and the empty
// Rooms page's "Try the starter room" (the rectangle at its typical size, straight
// into the studio). They share this so the starter room is not a second recipe for
// a room that could drift from the first — a different name, a missing
// `roughSize`, a forgotten request to keep storage.

import { v4 as uuid } from 'uuid';
import { roomStore } from './storage';
import { requestPersistentStorage } from './backup-nudge';
import type { RoomDims } from './dimension-ranges';

export const ROOM_PRESETS = [
  { id: 'rect' as const, name: 'Rectangle', width: 6.0, depth: 4.0, starter: 'Living room' },
  { id: 'l' as const, name: 'L-Shape', width: 6.0, depth: 4.7, starter: 'Living + reading nook' },
  { id: 't' as const, name: 'T-Shape', width: 5.5, depth: 4.7, starter: 'Living + dining' },
  { id: 'u' as const, name: 'U-Shape', width: 6.0, depth: 5.0, starter: 'Bedroom' },
  { id: 'open' as const, name: 'Open Plan', width: 7.5, depth: 5.6, starter: 'Living + dining loft' },
];

export type RoomPreset = (typeof ROOM_PRESETS)[number];
export type PresetId = RoomPreset['id'];

export const PRESET_HEIGHT = 2.8;

/** The shape's typical size — what the room is built at when nothing is typed. */
export const typicalOf = (p: RoomPreset): RoomDims => ({ width: p.width, depth: p.depth, height: PRESET_HEIGHT });

export function presetById(id: PresetId): RoomPreset {
  return ROOM_PRESETS.find((p) => p.id === id)!;
}

/** Save a new room from a preset and return its id. `dims` omitted means the
 *  shape's typical size, and the room says so (`roughSize`) until the user sets
 *  one; a typed size is theirs even where it equals the preset's.
 *
 *  Throws when storage refuses (private windows, a full disk); the caller says so. */
export async function createPresetRoom(id: PresetId, dims?: RoomDims): Promise<string> {
  const shape = presetById(id);
  const size = dims ?? typicalOf(shape);
  // The press that makes a room is the moment to ask the browser to keep rooms.
  void requestPersistentStorage();
  const roomId = uuid();
  await roomStore.saveRoom({
    id: roomId,
    // Named after the preset it started from. Every room used to be called
    // "My Room", which turned the workspace into a grid of identical cards.
    name: shape.starter,
    createdAt: Date.now(),
    layoutId: id,
    width: size.width,
    depth: size.depth,
    height: size.height,
    ...(dims ? {} : { roughSize: true as const }),
  });
  return roomId;
}

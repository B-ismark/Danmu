// @vitest-environment jsdom
//
// The rooms list and the studio have to agree on what is in a room. A room nobody has
// edited has no saved scene — the starter is rebuilt on every open, never written — and
// the card counted only the saved scene, so a 6 × 4 m starter room that opened with
// twelve pieces read "0 pieces" over a drawing of an empty floor.
//
// `partsOnOpen` is the one answer, and the first clause holds it to the STORE rather than
// to a number: whatever `loadFromRoom` puts on screen for an unsaved room is what the card
// must count. A literal 12 would pass for as long as the starter happened to have twelve.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { clear } from 'idb-keyval';
import type { RoomData } from '@/lib/storage';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock(null));

const { roomStore } = await import('@/lib/storage');
const { partsOnOpen, buildSceneFromRoom } = await import('@/lib/scene-spec');
const { useScene } = await import('@/lib/scene-store');
const { PlanThumb } = await import('@/components/studio/PlanThumb');

const room = (id: string, extra: Partial<RoomData> = {}): RoomData =>
  ({ id, createdAt: 1, name: id, layoutId: 'rect', width: 6, depth: 4, height: 2.7, ...extra }) as RoomData;

beforeEach(async () => {
  cleanup();
  await clear();
});

describe('the pieces a room opens with', () => {
  it('are, with nothing saved, exactly what the studio builds on open', () => {
    for (const r of [room('rect'), room('l', { layoutId: 'l' }), room('u', { layoutId: 'u', width: 7, depth: 5 })]) {
      useScene.getState().loadFromRoom(r);
      const onScreen = useScene.getState().parts;
      expect(onScreen.length, r.id).toBeGreaterThan(0);
      expect(partsOnOpen(r, undefined).map((p) => p.id), r.id).toEqual(onScreen.map((p) => p.id));
    }
  });

  it('are the saved scene when there is one, and an emptied room stays empty', () => {
    const saved = buildSceneFromRoom(room('x')).slice(0, 3);
    expect(partsOnOpen(room('x'), saved).map((p) => p.id)).toEqual(saved.map((p) => p.id));
    expect(partsOnOpen(room('x'), [])).toEqual([]);
  });
});

describe('the room card', () => {
  it('counts the starter furniture of a room nobody has edited', async () => {
    await roomStore.saveRoom(room('fresh'));
    const [summary] = await roomStore.listRooms();
    expect(summary.itemCount).toBe(buildSceneFromRoom(room('fresh')).length);
    expect(summary.itemCount).toBeGreaterThan(0);
  });

  it('still counts a room the user emptied as empty', async () => {
    await roomStore.saveRoom(room('bare'));
    await roomStore.saveSceneParts('bare', []);
    const [summary] = await roomStore.listRooms();
    expect(summary.itemCount).toBe(0);
  });

  it('costs a record it cannot build its own count, not the whole list', async () => {
    await roomStore.saveRoom(room('good'));
    // Detections that are not a list: the builder throws on it (checked below, so this
    // cannot quietly become a record it tolerates).
    const broken = room('broken', { detectedObjects: { length: 1 } as unknown as RoomData['detectedObjects'] });
    expect(() => buildSceneFromRoom(broken)).toThrow();
    await roomStore.saveRoom(broken);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows = await roomStore.listRooms();
    quiet.mockRestore();
    expect(rows.map((r) => r.id).sort()).toEqual(['broken', 'good']);
    expect(rows.find((r) => r.id === 'broken')!.itemCount).toBe(0);
    expect(rows.find((r) => r.id === 'good')!.itemCount).toBeGreaterThan(0);
  });

  it('draws the starter furniture, not "Empty room"', async () => {
    await roomStore.saveRoom(room('drawn'));
    render(<PlanThumb roomId="drawn" />);
    const n = buildSceneFromRoom(room('drawn')).length;
    const img = await waitFor(() => screen.getByRole('img'));
    expect(img.getAttribute('aria-label')).toContain(`${n} pieces of furniture`);
    expect(screen.queryByText('Empty room')).toBeNull();
  });
});

// @vitest-environment jsdom
//
// `SoundCues` as mounted: one action is several store writes, and it must be heard
// as ONE sound — the diff `cueFor` was written for — and only when a person did it.
// The first version asked per write, and Add played "place" then "select".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const played: string[] = [];
vi.mock('@/lib/sound', () => ({
  playSound: (n: string) => played.push(n),
  glide: () => {},
  glideStop: () => {},
}));

const { SoundCues } = await import('@/components/studio/SoundCues');
const { useStudio } = await import('@/lib/store');
const { useScene } = await import('@/lib/scene-store');

const vase = {
  id: 'vase-9',
  category: 'decor',
  shape: 'vase',
  label: 'Vase',
  dimMM: [150, 150, 300],
  pos: [0, 0, 0],
  rot: 0,
} as unknown as Parameters<ReturnType<typeof useScene.getState>['addPart']>[0];

beforeEach(async () => {
  vi.useFakeTimers();
  played.length = 0;
  useScene.getState().setHydrated('room-a');
  render(<SoundCues />);
  // Past the settle after a room opens.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const press = () => window.dispatchEvent(new Event('pointerdown'));

describe('SoundCues', () => {
  it('hears an Add — a part AND a selection — as one place', async () => {
    press();
    await act(async () => {
      useScene.getState().addPart(vase);
      useStudio.getState().setSelected(vase.id);
    });
    expect(played).toEqual(['place']);
  });

  it('hears a delete that moves the selection on as one remove', async () => {
    useScene.getState().addPart(vase);
    await act(async () => {});
    played.length = 0;
    press();
    await act(async () => {
      useScene.getState().setParts(useScene.getState().parts.filter((p) => p.id !== vase.id));
      useStudio.getState().setSelected(null);
    });
    expect(played).toEqual(['remove']);
  });

  it('says nothing for a change nobody pressed for', async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      useScene.getState().addPart({ ...vase, id: 'vase-late' });
    });
    expect(played).toEqual([]);
  });
});

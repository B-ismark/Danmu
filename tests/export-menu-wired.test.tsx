// @vitest-environment jsdom
//
// The floor-plan export, pressed from the menu. `exportPlanPng` returns a promise and
// the menu item did not await it, so an encode failure rejected a promise nobody held:
// the menu closed, no file arrived, and the "Could not export" toast written for
// exactly that never fired. And a success said nothing either, which on a phone, where
// a download is a small icon in a corner, reads as a press that did nothing.
//
// `exportPlanPng` is replaced (it draws on a canvas jsdom does not have), and only it;
// the menu's own handling is what is under test.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ToastSpec } from '@/components/ui/StorageToast';

vi.mock('next/navigation', async () => (await import('./helpers/mount')).navigationMock('export-room'));

const toasts: ToastSpec[] = [];
vi.mock('@/components/ui/StorageToast', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/StorageToast')>('@/components/ui/StorageToast');
  return { ...actual, toast: (spec: ToastSpec) => toasts.push(spec) };
});

let fail = false;
vi.mock('@/lib/plan-export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-export')>('@/lib/plan-export');
  return {
    ...actual,
    exportPlanPng: () => (fail ? Promise.reject(new Error('could not be encoded')) : Promise.resolve()),
  };
});

const { useExportItems } = await import('@/components/studio/ExportMenu');
const { planFileName } = await import('@/lib/plan-export');
const { roomStore } = await import('@/lib/storage');

beforeEach(() => {
  toasts.length = 0;
  fail = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function pressFloorPlan() {
  await roomStore.saveRoom({ id: 'export-room', name: 'Front Room', createdAt: 1, version: 1, layoutId: 'rect', width: 6, depth: 4, height: 2.6 } as never);
  const { result } = renderHook(() => useExportItems());
  const item = result.current.find((i) => i.label === 'Floor plan')!;
  await act(async () => {
    item.onClick();
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('the floor-plan export says how it went', () => {
  it('a failure is reported, not dropped', async () => {
    fail = true;
    await pressFloorPlan();
    expect(toasts.map((t) => t.title)).toEqual(['Could not export the floor plan']);
  });

  it('a success names the file it saved', async () => {
    await pressFloorPlan();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe('Floor plan saved');
    // The file said is the file `planFileName` writes for this room's name.
    expect(toasts[0].message).toBe(planFileName('Front Room'));
  });
});

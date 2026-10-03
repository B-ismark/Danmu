// @vitest-environment jsdom
//
// The 3D canvas outlives the 3D tab (lib/room-host.ts): mounted once by the room
// layout, shown by `/model`, parked while the plan is up. Two halves, because the
// mechanism is half state and half wiring and either alone can regress silently:
// the state machine is exercised for real, and the wiring is pinned in source,
// since a switch that rebuilds the canvas fails no pure-logic assertion.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { roomHost } from '@/lib/room-host';
import { stripComments } from './helpers/source';

const src = (p: string) => stripComments(readFileSync(p, 'utf8'));

describe('roomHost state', () => {
  beforeEach(() => roomHost.reset());

  it('creates one node, parked, inert and hidden', () => {
    const el = roomHost.mount(document);
    expect(roomHost.mount(document)).toBe(el); // strict mode runs effects twice
    expect(document.querySelectorAll('[data-room-host]')).toHaveLength(1);
    expect(roomHost.get().attached).toBe(false);
    expect(el.style.visibility).toBe('hidden');
    expect(el.hasAttribute('inert')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows in a slot, then parks again keeping the SAME node (the canvas survives)', () => {
    const el = roomHost.mount(document);
    const slot = document.body.appendChild(document.createElement('div'));
    roomHost.attach(slot);
    expect(el.parentElement).toBe(slot);
    expect(roomHost.get()).toMatchObject({ attached: true, wanted: true });
    expect(el.style.visibility).toBe('');
    expect(el.hasAttribute('inert')).toBe(false);
    expect(el.style.top).toBe('0px');
    expect(el.style.right).toBe('0px');

    // Leaving the tab: the slot is torn down, the host is not.
    roomHost.detach(document);
    slot.remove();
    expect(roomHost.get().attached).toBe(false);
    expect(roomHost.get().wanted).toBe(true); // the canvas stays wanted
    expect(el.isConnected).toBe(true);
    expect(el.style.visibility).toBe('hidden');
    expect(el.hasAttribute('inert')).toBe(true);

    // Returning re-attaches the identical node, not a rebuilt one.
    const slot2 = document.body.appendChild(document.createElement('div'));
    roomHost.attach(slot2);
    expect(el.parentElement).toBe(slot2);
    expect(roomHost.mount(document)).toBe(el);
  });

  it('frees the node when the layout goes (another room is a fresh canvas)', () => {
    const el = roomHost.mount(document);
    roomHost.unmount();
    expect(el.isConnected).toBe(false);
    expect(roomHost.get()).toMatchObject({ host: null, wanted: false, drawn: false });
  });

  it('notifies subscribers, which is how the frame loop learns it is parked', () => {
    const el = roomHost.mount(document);
    void el;
    let n = 0;
    const off = roomHost.subscribe(() => n++);
    roomHost.attach(document.body.appendChild(document.createElement('div')));
    roomHost.detach(document);
    off();
    expect(n).toBe(2);
  });
});

describe('the 3D canvas is not owned by the 3D page', () => {
  it('the room layout mounts the host provider', () => {
    expect(src('app/room/[roomId]/layout.tsx')).toMatch(/<RoomHostProvider\s*\/>/);
  });

  it('the model page borrows the canvas through a slot and never mounts Room itself', () => {
    const page = src('app/room/[roomId]/model/page.tsx');
    expect(page).toMatch(/<RoomSlot\s*\/>/);
    expect(page).not.toMatch(/<Room[\s/>]/);
    expect(page).not.toMatch(/components\/three\/Room'/);
  });

  it('a parked canvas stops drawing and stops answering the keyboard', () => {
    expect(src('components/three/RoomHost.tsx')).toMatch(/paused=\{!attached\}/);
    expect(src('components/three/Room.tsx')).toMatch(/frameloop=\{paused \? 'never' : 'demand'\}/);
    expect(src('components/three/CameraRig.tsx')).toMatch(/if \(!roomHost\.get\(\)\.attached\) return;/);
  });
});

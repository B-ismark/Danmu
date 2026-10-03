// Where the 3D canvas lives between the two studio tabs.
//
// The room's WebGL canvas used to be mounted by `/model` and destroyed by leaving
// it, so every 2D -> 3D switch rebuilt the context, every geometry and material,
// every shader and the shadow maps. Loading the module (which the plan page already
// warms) is the small half of that; the rebuild is the large one, and is the same
// work whether or not anything changed while you were away.
//
// So the canvas is mounted ONCE, by the room layout, into a DOM node this module
// owns, and the tabs only decide where that node is shown: the model page attaches it
// to its canvas area, leaving detaches it and parks it off-screen at its last size
// with rendering stopped. Pure state, no React, so the rule is testable without a DOM
// framework: `attached` is the single fact the canvas's frame loop and keyboard
// handlers read to know whether they are the visible tab.

type Listener = () => void;

type State = {
  /** The node the canvas is portalled into; null until the layout has mounted it. */
  host: HTMLElement | null;
  /** True while the 3D tab is showing the host. False = parked, paused, inert. */
  attached: boolean;
  /** The 3D view has drawn a frame at least once, for the loading veil. */
  drawn: boolean;
  /** The 3D tab has been opened once, so the canvas is worth keeping. */
  wanted: boolean;
};

const EMPTY: State = { host: null, attached: false, drawn: false, wanted: false };
let state: State = EMPTY;
const listeners = new Set<Listener>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function show(el: HTMLElement) {
  const s = el.style;
  s.position = 'absolute';
  // Longhands, one by one: a shorthand followed by clearing a longhand undoes it.
  s.top = '0';
  s.left = '0';
  s.right = '0';
  s.bottom = '0';
  s.width = '';
  s.height = '';
  s.visibility = '';
  s.pointerEvents = '';
  el.removeAttribute('inert');
  el.removeAttribute('aria-hidden');
}

function park(el: HTMLElement, w = 0, h = 0) {
  const s = el.style;
  s.position = 'fixed';
  s.top = '0';
  s.left = '-10000px';
  s.right = 'auto';
  s.bottom = 'auto';
  // The size it had, not 0x0: a canvas told it is 0 px resizes its drawing buffer
  // and has to resize it back on return, which is a visible re-layout.
  s.width = w ? `${w}px` : '';
  s.height = h ? `${h}px` : '';
  s.visibility = 'hidden';
  s.pointerEvents = 'none';
  el.setAttribute('inert', '');
  el.setAttribute('aria-hidden', 'true');
}

export const roomHost = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  get: () => state,
  /** Layout mount: create the node. Idempotent (strict mode runs effects twice). */
  mount(doc: Document): HTMLElement {
    if (state.host) return state.host;
    const el = doc.createElement('div');
    el.setAttribute('data-room-host', '');
    park(el);
    doc.body.appendChild(el);
    set({ host: el, attached: false, drawn: false });
    return el;
  },
  /** Layout unmount (leaving the room, or switching rooms): free the node. */
  unmount() {
    state.host?.remove();
    state = EMPTY;
    listeners.forEach((l) => l());
  },
  /** The 3D tab is on screen: show the host inside `slot`. */
  attach(slot: HTMLElement) {
    const el = state.host;
    if (!el) return;
    slot.appendChild(el);
    show(el);
    set({ attached: true, wanted: true });
  },
  /** The 3D tab left: hide the host, keeping its last size so nothing resizes. */
  detach(doc: Document) {
    const el = state.host;
    if (!el) return;
    const r = el.getBoundingClientRect();
    park(el, r.width, r.height);
    doc.body.appendChild(el);
    set({ attached: false });
  },
  markDrawn() {
    if (!state.drawn) set({ drawn: true });
  },
  /** Test seam. */
  reset() {
    state = EMPTY;
    listeners.clear();
  },
};

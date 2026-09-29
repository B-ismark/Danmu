import { create } from 'zustand';

// "Open the left rail AT this section": one request, taken once.
//
// Asked for by a collapsed rail's icons (press Style on the strip and the rail
// opens on Style, not wherever it was left) and by the empty Inspector's
// "restyle the room" path, which is aimed at a section in the OTHER rail. The
// piece tree owns which of its sections are open. It is local state and
// deliberately unpersisted (see `PartTree`), so a caller outside it cannot set
// that directly. It leaves a request here and the tree takes it.
//
// Not in `useStudio`: that store is persisted, and a request is not something to
// wake up to in the next room. A request nobody takes (the rail was never opened)
// is harmless, because the next ask replaces it.

export type LeftSection = 'room' | 'style' | 'pieces';

type RailIntent = {
  left: LeftSection | null;
  /** Ask the left rail to open on `section`. Opening the rail itself is the
   *  caller's job (`toggleRail`), so that one store owns whether a rail is open. */
  askLeft: (section: LeftSection) => void;
  /** The tree's half: read the request and clear it, in one step. */
  takeLeft: () => LeftSection | null;
};

export const useRailIntent = create<RailIntent>((set, get) => ({
  left: null,
  askLeft: (section) => set({ left: section }),
  takeLeft: () => {
    const s = get().left;
    if (s) set({ left: null });
    return s;
  },
}));

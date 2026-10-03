// The last step of the photo route: shown while the reviewed list is written into
// the room and the studio opens. Everything it says is a fact about this room —
// its size from the room's own outline, the pieces this review kept, the photos used — and
// nothing in it is a scripted stage: the save is quick and real, so there is no
// checklist ticking off steps on a timer. The drawing is the illustration the Rooms
// page uses, its pieces settling in; it is decoration and hidden from assistive tech.

import { useEffect, useState } from 'react';
import { FlowStepper } from './FlowStepper';
import { HERO_PIECES, HERO_ROOM, IsoRoom } from './IsoRoom';
import { polygonArea } from '@/lib/geometry';
import { formatArea, formatLength } from '@/lib/units';
import type { DimUnit } from '@/lib/store';
import type { Footprint } from '@/lib/footprint';

export type BuildingFacts = {
  /** Metres, as the room record holds them. */
  width: number;
  depth: number;
  height: number;
  footprint: Footprint;
  /** The room's size was never confirmed, so every figure is approximate. */
  rough: boolean;
  pieces: number;
  photos: number;
};

export function BuildingRoom({ facts, dimUnit }: { facts: BuildingFacts | null; dimUnit: DimUnit }) {
  const about = facts?.rough ? '≈' : '';
  const len = (m: number) => about + formatLength(m * 1000, dimUnit);
  // Filled in after mount, not rendered with the page: a live region is announced
  // when its text CHANGES, so text present from the first paint is usually not read.
  const [announce, setAnnounce] = useState('');
  useEffect(() => setAnnounce('Building your room'), []);
  return (
    <main className="build-screen" aria-busy="true">
      <FlowStepper current="Room" />
      <div className="build-screen__layout">
        <div className="build-screen__art">
          <IsoRoom room={HERO_ROOM} pieces={HERO_PIECES} settle />
        </div>
        <>
          <h1 className="build-screen__title">Building your room</h1>
          <p className="sr-only" role="status">
            {announce}
          </p>
          <div className="build-screen__bar" aria-hidden="true" />
          {facts && (
            <>
              <p className="build-screen__lede">
                {len(facts.width)} × {len(facts.depth)}, {len(facts.height)} high.
              </p>
              <dl className="build-screen__stats">
                <div>
                  <dt>Floor</dt>
                  <dd>{about + formatArea(polygonArea(facts.footprint), dimUnit)}</dd>
                </div>
                <div>
                  {/* What this review kept, and named as that: an empty list opens a starter
                      arrangement, and a room already arranged keeps its own pieces, so
                      the room's own count is not this number. */}
                  <dt>Kept from photos</dt>
                  <dd>{facts.pieces}</dd>
                </div>
                <div>
                  <dt>{facts.photos === 1 ? 'Photo' : 'Photos'}</dt>
                  <dd>{facts.photos}</dd>
                </div>
              </dl>
            </>
          )}
          <p className="build-screen__note">
            Pieces come in at typical sizes. Anything that does not fit is flagged, never squeezed.
          </p>
        </>
      </div>
    </main>
  );
}

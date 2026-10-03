'use client';

import { useStudio } from '@/lib/store';
import { CatalogPanel, CatalogToggle, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { usePhoneStudio } from '@/components/studio/NarrowViewportBanner';
import { SceneContextMenu } from '@/components/studio/SceneContextMenu';
import { SwapModelHost } from '@/components/studio/RegenerateModal';
import { HoverCard } from '@/components/studio/HoverCard';
import { TransformToolbar } from '@/components/studio/TransformToolbar';
import { StudioShell } from '@/components/studio/StudioShell';
import { CanvasVeil } from '@/components/studio/CanvasVeil';
import { ViewGizmo } from '@/components/studio/ViewGizmo';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { CanvasTools, CanvasView, CanvasAide, CanvasDay } from '@/components/studio/CanvasChrome';
import { DayStrip } from '@/components/studio/DayStrip';
import { RoomSlot, useRoomHost } from '@/components/three/RoomHost';

export default function ModelPage() {
  // In the store, not in this page: the rail's catalog button opens the same
  // panel from the other side of the studio, and on the 2D tab as well.
  const catalogOpen = useStudio((s) => s.catalogOpen);
  const phone = usePhoneStudio();
  // The canvas itself is the layout's (lib/room-host.ts), so returning from the plan
  // shows the room that was already built; `drawn` is true again at once and the veil
  // never comes back. Its chunk and first frame are still what the veil waits on the
  // first time.
  const { drawn } = useRoomHost();

  const canvas = (
    <main
      key="canvas"
      id={STUDIO_CANVAS_ID}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--paper-2)', minHeight: 0 }}
    >
      {/* The room is the page. Its heading is for the document outline and for
          screen readers — putting it on screen would just repeat the top bar. */}
      <h1 className="sr-only">Your room in 3D</h1>
      <RoomSlot />
      <CanvasVeil building={!drawn} />

      {/* ONE tool cluster, top-centre. This tab had four occupied corners plus the
          bottom centre; the slots are CanvasChrome's now, and both tabs use them. */}
      <CanvasTools>
        <TransformToolbar />
        {/* A phone's Add is its toolbar's primary action, under the thumb; a second
            one up here would be two buttons for one verb. */}
        {!phone && <CatalogToggle />}
      </CanvasTools>

      {/* The day, under the tools: a strip painted as the sky it scrubs, the sun
          or moon riding it, and still wherever the camera goes. */}
      <CanvasDay>
        <DayStrip />
      </CanvasDay>

      <CanvasView>
        <UndoRedo />
      </CanvasView>

      {/* Drag lands here and only here: Room's onDrop raycasts the drop point. */}
      {catalogOpen && <CatalogPanel canDrag ghostDrag belowDay />}

      <HoverCard />

      {/* The one bottom-right aide, and the only thing left on any canvas edge —
          the same slot the 2D tab gives its comfort legend. */}
      <CanvasAide>
        <ViewGizmo />
      </CanvasAide>

      {/* Positions itself against this element's box. */}
      <SceneContextMenu />
      <SwapModelHost />
    </main>
  );

  return <StudioShell loadingLabel="Setting up your studio…">{canvas}</StudioShell>;
}

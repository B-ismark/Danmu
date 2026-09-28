'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { useStudio } from '@/lib/store';
import { CatalogPanel, CatalogToggle, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { usePhoneStudio } from '@/components/studio/NarrowViewportBanner';
import { SceneContextMenu } from '@/components/studio/SceneContextMenu';
import { HoverCard } from '@/components/studio/HoverCard';
import { TransformToolbar } from '@/components/studio/TransformToolbar';
import { StudioShell } from '@/components/studio/StudioShell';
import { CanvasVeil } from '@/components/studio/CanvasVeil';
import { ViewGizmo } from '@/components/studio/ViewGizmo';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { CanvasTools, CanvasView, CanvasAide } from '@/components/studio/CanvasChrome';

// No `loading` fallback of its own: `CanvasVeil` covers the canvas until the 3D
// view has drawn its first frame, which includes the wait for this chunk.
const Room = dynamic(() => import('@/components/three/Room').then((m) => m.Room), { ssr: false, loading: () => null });

export default function ModelPage() {
  // In the store, not in this page: the rail's catalog button opens the same
  // panel from the other side of the studio, and on the 2D tab as well.
  const catalogOpen = useStudio((s) => s.catalogOpen);
  const phone = usePhoneStudio();
  const [drawn, setDrawn] = useState(false);
  const onFirstFrame = useCallback(() => setDrawn(true), []);

  const canvas = (
    <main
      key="canvas"
      id={STUDIO_CANVAS_ID}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--paper-2)', minHeight: 0 }}
    >
      {/* The room is the page. Its heading is for the document outline and for
          screen readers — putting it on screen would just repeat the top bar. */}
      <h1 className="sr-only">Your room in 3D</h1>
      <Room onFirstFrame={onFirstFrame} />
      <CanvasVeil building={!drawn} />

      {/* ONE tool cluster, top-centre. This tab had four occupied corners plus the
          bottom centre; the slots are CanvasChrome's now, and both tabs use them. */}
      <CanvasTools>
        <TransformToolbar />
        {/* A phone's Add is its toolbar's primary action, under the thumb; a second
            one up here would be two buttons for one verb. */}
        {!phone && <CatalogToggle />}
      </CanvasTools>

      <CanvasView>
        <UndoRedo />
      </CanvasView>

      {/* Drag lands here and only here: Room's onDrop raycasts the drop point. */}
      {catalogOpen && <CatalogPanel canDrag />}

      <HoverCard />

      {/* The one bottom-right aide, and the only thing left on any canvas edge —
          the same slot the 2D tab gives its comfort legend. */}
      <CanvasAide>
        <ViewGizmo />
      </CanvasAide>

      {/* Positions itself against this element's box. */}
      <SceneContextMenu />
    </main>
  );

  return <StudioShell loadingLabel="Setting up your studio…">{canvas}</StudioShell>;
}

'use client';

import dynamic from 'next/dynamic';
import { useStudio } from '@/lib/store';
import { CatalogPanel, CatalogToggle, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { SceneContextMenu } from '@/components/studio/SceneContextMenu';
import { HoverCard } from '@/components/studio/HoverCard';
import { TransformToolbar } from '@/components/studio/TransformToolbar';
import { StudioShell } from '@/components/studio/StudioShell';
import { ViewGizmo } from '@/components/studio/ViewGizmo';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { CanvasTools, CanvasView, CanvasAide, ChromeDivider } from '@/components/studio/CanvasChrome';

const Room = dynamic(() => import('@/components/three/Room').then((m) => m.Room), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      Loading your 3D room…
    </div>
  ),
});

export default function ModelPage() {
  // In the store, not in this page: the rail's catalog button opens the same
  // panel from the other side of the studio, and on the 2D tab as well.
  const catalogOpen = useStudio((s) => s.catalogOpen);

  const canvas = (
    <main
      key="canvas"
      id={STUDIO_CANVAS_ID}
      style={{ position: 'relative', overflow: 'hidden', background: 'var(--paper-2)', minHeight: 0 }}
    >
      {/* The room is the page. Its heading is for the document outline and for
          screen readers — putting it on screen would just repeat the top bar. */}
      <h1 className="sr-only">Your room in 3D</h1>
      <Room />

      {/* ONE tool cluster, top-centre. This tab had four occupied corners plus the
          bottom centre; the slots are CanvasChrome's now, and both tabs use them. */}
      <CanvasTools>
        <TransformToolbar />
        <ChromeDivider />
        <CatalogToggle />
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

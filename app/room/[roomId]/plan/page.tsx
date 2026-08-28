'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PlanView, type PlanViewHandle } from '@/components/studio/PlanView';
import { PlanViewControls, ComfortLegend } from '@/components/studio/PlanChrome';
import { CanvasTools, CanvasView, CanvasAide, ChromeDivider } from '@/components/studio/CanvasChrome';
import { UndoRedo } from '@/components/studio/UndoRedo';
import { SceneContextMenu } from '@/components/studio/SceneContextMenu';
import { HoverCard } from '@/components/studio/HoverCard';
import { CatalogPanel, STUDIO_CANVAS_ID } from '@/components/studio/CatalogPanel';
import { StudioShell } from '@/components/studio/StudioShell';
import { Icon } from '@/components/ui/Icon';
import { useStudio, useSettings } from '@/lib/store';
import { roomStore } from '@/lib/storage';
import { UNIT_OPTIONS } from '@/lib/units';

export default function PlanPage() {
  const dimUnit = useSettings((s) => s.dimUnit);
  const { roomId } = useParams<{ roomId: string }>();
  // Only the setter is read — the name is written into the export filename from
  // the ref below, not rendered, so the value binding was dead.
  const [, setRoomName] = useState('Floor plan');
  // Live from PlanView, which owns the zoom. The old chip hard-coded "1:50 · cm"
  // while the drawing labelled millimetres, rendered at 100 px/m, and zoomed
  // 0.4×–4× — three false claims on the one screen someone might measure from.
  const [view, setView] = useState({ zoom: 1, rot: 0, hasCutOff: false });
  const [comfort, setComfort] = useState(true);

  // Warm the 3D chunk while the user is here, because from this page the 3D tab is
  // the likeliest next click and its module graph is the heaviest in the app —
  // three, R3F, drei and postprocessing. `/model` loads `Room` through
  // `next/dynamic` with `ssr: false`, so nothing fetches it until that page mounts.
  //
  // In an idle callback so it cannot compete with this page's own first paint, and
  // behind a `requestIdleCallback` check because Safari has only recently had one.
  // The `catch` is deliberate and empty: this is a speculative fetch, so a failure
  // means the user waits as long as they would have anyway, and surfacing it would
  // be reporting a problem they do not have.
  //
  // It buys the FETCH only. Mounting still rebuilds the WebGL context, every
  // geometry and material and every compiled shader, which is the larger half of the
  // switch cost and not something a warm import can touch.
  useEffect(() => {
    const warm = () => {
      import('@/components/three/Room').catch(() => {});
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (ric) {
      ric(warm);
      return;
    }
    const t = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(t);
  }, []);
  // PlanView owns the drawing's transform (wheel, pinch and drag all write it);
  // the page drives it through this handle. See PlanViewHandle.
  const planApi = useRef<PlanViewHandle | null>(null);
  const catalogOpen = useStudio((s) => s.catalogOpen);

  useEffect(() => {
    if (!roomId) return;
    roomStore.loadRoom(roomId).then((r) => {
      if (r?.name) setRoomName(r.name);
    });
  }, [roomId]);

  const onViewChange = useCallback((v: { zoom: number; rot: number; hasCutOff: boolean }) => setView(v), []);

  const unitName = UNIT_OPTIONS.find((u) => u.id === dimUnit)?.label ?? dimUnit;

  // No exportPlan() here any more: the plan PNG, the 3D snapshot and the scene
  // file are one Export menu in the top bar. A page-level copy is how the two tabs
  // came to offer different subsets of the same downloads.

  const plan = (
    <main
      key="plan"
      id={STUDIO_CANVAS_ID}
      style={{ position: 'relative', overflow: 'hidden', minHeight: 0 }}
      className="ds-grid-bg"
    >
      <h1 className="sr-only">Your room as a floor plan</h1>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
        }}
      >
        <PlanView ref={planApi} onViewChange={onViewChange} showComfort={comfort} />
      </div>

      {/* Same right-click menu as the 3D tab; it positions itself against this
          element's box. */}
      <SceneContextMenu />

      {/* And the same hover card. It only ever worked on the 3D tab because the
          plan never wrote `hoveredPartId`; now that it does, the card is a mount
          away — it is `position: fixed` and tracks the pointer itself, so it does
          not care which surface is underneath. */}
      <HoverCard />

      {/* ONE tool cluster, top-centre — the shared slot. What used to be here was
          a readout chip and a toggle top-left, an export button top-right, a help
          card and a zoom toolbar bottom-left (inside PlanView), and a legend
          bottom-right: four corners, on the tab that also had the least to say. */}
      <CanvasTools>
        <button
          onClick={() => setComfort((v) => !v)}
          aria-pressed={comfort}
          className={`ds-chip ${comfort ? 'ds-chip--accent' : ''}`}
          title="Shade the floor a person needs to walk, open a door, and get into bed"
          style={{
            cursor: 'pointer',
            fontWeight: 700,
            borderColor: comfort ? 'var(--accent-text)' : 'var(--edge)',
            background: comfort ? 'var(--accent-tint)' : 'var(--paper)',
          }}
        >
          <Icon name="crosshair" size={10} />
          Comfort zones
        </button>
      </CanvasTools>

      <CanvasView>
        <UndoRedo />
        <ChromeDivider />
        <PlanViewControls api={planApi} zoom={view.zoom} rot={view.rot} dimUnit={unitName.toLowerCase()} />
      </CanvasView>

      {/* The tab's one bottom-right aide, and only while the shading is on. */}
      {comfort && (
        <CanvasAide>
          <ComfortLegend hasCutOff={view.hasCutOff} />
        </CanvasAide>
      )}

      {/* The same library the 3D tab uses, opened by the same rail button — and
          its rows ARE draggable here now: `PlanView` catches the drop and puts the
          piece where the pointer let go, which on a map of the floor is the whole
          point. Click-to-drop-in-the-centre still works for anyone who would
          rather not drag. */}
      {catalogOpen && <CatalogPanel bottomGap={100} canDrag />}

    </main>
  );

  return <StudioShell loadingLabel="Drawing your floor plan…">{plan}</StudioShell>;
}

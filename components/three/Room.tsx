'use client';

// Renders all parts from useScene. Each becomes a Draggable wrapping a shape-dispatched geometry.
// Replaces the prior hand-coded Sofa/TV/Closet/Chair/etc imports.

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ContactShadows, Environment, Lightformer, AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, Raycaster, Vector2, Vector3, Plane, type Camera, type WebGLRenderer } from 'three';
import { v4 as uuid } from 'uuid';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { placeNewPart, DND_MIME, type Category, type Shape } from '@/lib/scene-spec';
import { footprintBounds } from '@/lib/footprint';
import { useSnapshot, downloadBlob } from '@/lib/snapshot';
import { RoomShell } from './RoomShell';
import { WallHandles } from './WallHandles';
import { MeasureGuides } from './MeasureGuides';
import { Draggable } from './Draggable';
import { PartGeometry } from './DynamicPart';
import { Dressing } from './Dressing';
import { CameraRig } from './CameraRig';

// Catalog drag-drop payload (set by CatalogPanel's draggable items).
type DropItem = { label: string; category: Category; shape: Shape; dimMM: [number, number, number] };

// Reused across drops — raycast the pointer onto the floor plane (y=0).
const _raycaster = new Raycaster();
const _ndc = new Vector2();
const _floor = new Plane(new Vector3(0, 1, 0), 0);
const _hit = new Vector3();

// Lighting moods — background, hemisphere sky/ground, key + fill, and the
// emissive environment panels all shift together so the room reads as daylight,
// warm evening, or cool overcast.
const LIGHTING = {
  day: {
    bg: '#FBF8F2',
    hemi: ['#ffffff', '#cfc7b6', 0.85] as [string, string, number],
    key: { color: '#fff4e2', intensity: 1.1 },
    fill: { color: '#dfe7ff', intensity: 0.25 },
    env: ['#fffaf0', '#eef3ff', '#fff3e0'] as [string, string, string],
    exposure: 1.0,
  },
  evening: {
    bg: '#27201C',
    hemi: ['#ffd9a8', '#3a2c20', 0.5] as [string, string, number],
    key: { color: '#ffb15e', intensity: 1.25 },
    fill: { color: '#6a4b8a', intensity: 0.35 },
    env: ['#ffce93', '#ff9d5c', '#5b4a8a'] as [string, string, string],
    exposure: 1.05,
  },
  cool: {
    bg: '#EAEEF1',
    hemi: ['#eaf1ff', '#c4cdd4', 0.95] as [string, string, number],
    key: { color: '#eef4ff', intensity: 0.95 },
    fill: { color: '#d6e2ee', intensity: 0.4 },
    env: ['#f2f6ff', '#dfe9f5', '#e8eef5'] as [string, string, string],
    exposure: 0.95,
  },
} as const;

export function Room() {
  const hidden = useStudio((s) => s.hidden);
  const lighting = useStudio((s) => s.lighting);
  const quality = useStudio((s) => s.quality);
  const dressed = useStudio((s) => s.dressed);
  const hi = quality === 'high';
  const L = LIGHTING[lighting];
  const parts = useScene((s) => s.parts).filter((p) => !hidden[p.id]);
  // Drop the upper DPR bound when FPS regresses (large scenes / weak GPUs);
  // AdaptiveDpr cuts further while interacting. Keeps AO affordable.
  const [dprMax, setDprMax] = useState(2);
  // True only while frames are flowing continuously — see FrameRateGate.
  const hotLoop = useRef(false);

  // Camera + canvas handle, stashed by DropConnector so the DOM drop handler
  // (outside the R3F tree) can raycast the drop point into the scene.
  const dropApi = useRef<{ camera: Camera; gl: WebGLRenderer } | null>(null);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    let item: DropItem;
    try { item = JSON.parse(raw); } catch { return; }
    const api = dropApi.current;
    if (!api) return;
    const rect = api.gl.domElement.getBoundingClientRect();
    _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_ndc, api.camera);
    if (!_raycaster.ray.intersectPlane(_floor, _hit)) return;

    const { room: r, parts: ps } = useScene.getState();
    const { pos, wallMounted } = placeNewPart(item.category, item.shape, item.dimMM, r, ps);
    let [x, y, z] = pos;
    if (!wallMounted) {
      // Drop where the pointer hit the floor, kept inside the (possibly
      // off-centre) footprint bounds.
      const b = footprintBounds(r.footprint);
      const insetX = item.dimMM[0] / 2000;
      const insetZ = item.dimMM[1] / 2000;
      x = Math.max(b.minX + insetX, Math.min(b.maxX - insetX, _hit.x));
      z = Math.max(b.minZ + insetZ, Math.min(b.maxZ - insetZ, _hit.z));
    }
    const id = `${item.category}-${uuid().slice(0, 6)}`;
    useScene.getState().addPart({
      id, category: item.category, name: item.label, shape: item.shape,
      pos: [x, y, z], rot: 0, dimMM: item.dimMM, locked: false, wallMounted,
    });
    useStudio.getState().setSelected(id);
  }

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={onDrop}
    >
    <Canvas
      shadows={hi}
      camera={{ fov: 38, position: [5, 4.5, 5.5], near: 0.05, far: 100 }}
      dpr={[1, dprMax]}
      // ACES tone mapping + sRGB output = the single biggest realism win for
      // zero runtime cost: it maps linear HDR lighting to a filmic curve so
      // bright surfaces roll off instead of clipping to flat white.
      // preserveDrawingBuffer OFF; SceneCapture reads the canvas synchronously.
      gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: L.exposure }}
      // On-demand rendering: paint only when something actually changed. R3F
      // invalidates itself for every declarative change, drei's Orbit/Transform
      // controls invalidate on move, and the handful of things that mutate the
      // scene imperatively ask for their own frames (Motion's fan/plant/pendant
      // tick, Draggable's live drag, CameraRig's tween + keyboard nav).
      // Previously this was "always", so an untouched room paid a full render +
      // SSAO + SMAA + a 1024² depth pass + two blur passes ~60×/second while
      // sitting still — and every invalidate() in the tree was a no-op.
      frameloop="demand"
      onPointerMissed={() => useStudio.getState().setSelected(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Opaque paper background — THE fix for the moving-object "shadow trail":
          with a transparent canvas the EffectComposer (N8AO) blended each frame
          over the last, so contact shadows + gizmos smeared. An explicit scene
          background makes three's WebGLBackground CLEAR the colour buffer at the
          top of every render call.
          Still correct under frameloop="demand": the clear is tied to the render
          CALL, not to the wall clock, so a frame painted on request clears
          exactly as one painted continuously did. Nothing about this fix depended
          on how often we paint.
          (The page's grid-bg sat behind a transparent canvas before; its lines
          are ~invisible at 0.03 alpha, so matching --paper here is no visible
          loss and kills the ghosting outright.) */}
      <color attach="background" args={[L.bg]} />

      {/* Hemisphere (sky → ground gradient) gives soft, directionally-aware
          ambient — far less flat than a single ambientLight. One key light adds
          form; a dim back-fill keeps shadowed faces readable. No shadow maps
          (we ground objects with ContactShadows below — cheaper + softer). */}
      <hemisphereLight args={L.hemi} />
      <directionalLight
        position={[5, 8, 4]}
        intensity={L.key.intensity}
        color={L.key.color}
        castShadow={hi}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0004}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={30}
      />
      <directionalLight position={[-4, 3, -5]} intensity={L.fill.intensity} color={L.fill.color} />

      {/* Offline studio environment built from emissive panels — gives metals
          something to reflect and adds soft specular gloss to all standard
          materials. Baked once, in a layout effect (frames={1}), so it costs
          nothing per frame and works under frameloop="demand". No CDN/HDR file
          fetched, so it suits the browser-only architecture.
          It is NOT dropped on 'Fast': without an environment every metalness > 0
          surface (chair bases, lamp poles, handles) goes near-black. Halving the
          cube resolution keeps the bake cheap while preserving that. */}
      <Environment key={`${lighting}-${quality}`} resolution={hi ? 256 : 128} frames={1}>
        <Lightformer intensity={0.7} position={[0, 5, 0]} scale={[8, 8, 1]} rotation={[Math.PI / 2, 0, 0]} color={L.env[0]} />
        <Lightformer intensity={0.35} position={[5, 2, 3]} scale={[4, 6, 1]} color={L.env[1]} />
        <Lightformer intensity={0.3} position={[-5, 2, -3]} scale={[4, 6, 1]} color={L.env[2]} />
      </Environment>

      <Suspense fallback={null}>
        <RoomShell />
        <WallHandles />
        {parts.map((part) => (
          <Draggable key={part.id} partId={part.id}>
            <PartGeometry part={part} locked={part.locked} />
          </Draggable>
        ))}
        {dressed && parts.map((part) => <Dressing key={`dress-${part.id}`} part={part} />)}
        <MeasureGuides />
        <GroundShadows hi={hi} />
      </Suspense>

      {/* Ambient occlusion — the biggest "CG → real" jump for interiors:
          darkens corners + where objects meet the floor. N8AO is the
          performance-oriented SSAO variant; half-res + SMAA keeps it light.
          'Fast' drops the composer entirely. It is by far the most expensive
          thing in the frame, and leaving it on made the quality toggle look
          broken — someone who picks Fast because the room stutters was still
          paying for SSAO. Without the composer the canvas' own MSAA
          (gl.antialias) handles edges, so Fast stays smooth, just flatter. */}
      {hi && (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <N8AO aoRadius={0.5} intensity={1.1} distanceFalloff={1} halfRes />
          <SMAA />
        </EffectComposer>
      )}

      {/* Perf guards: PerformanceMonitor lowers the DPR ceiling on FPS decline;
          AdaptiveDpr drops resolution while the camera is moving.
          The decline is gated on hotLoop: under frameloop="demand" an idle canvas
          legitimately renders a handful of frames per second, and to a monitor
          that only counts rendered frames that is indistinguishable from a GPU on
          its knees — it would quietly halve the resolution of a scene that is
          performing perfectly. */}
      <FrameRateGate hot={hotLoop} />
      <PerformanceMonitor
        onDecline={() => {
          if (hotLoop.current) setDprMax(1);
        }}
        onIncline={() => setDprMax(2)}
      />
      <AdaptiveDpr pixelated />

      <CameraRig />
      <SceneCapture />
      <DropConnector apiRef={dropApi} />
    </Canvas>
    </div>
  );
}

// Soft grounding shadow under the furniture.
//
// drei's ContactShadows defaults to frames={Infinity} — it re-renders the whole
// scene into a 1024² depth target and runs two (or with `smooth`, four) blur
// passes EVERY frame, whether or not anything moved. Its internal frame counter
// resets on every React render, so this wrapper subscribes to everything that
// changes where a shadow should fall and a commit re-opens the pass.
//
// It re-bakes over a short WINDOW rather than for a single frame. `frames={1}`
// spends its one allowed bake on the first frame that runs after the re-render,
// and that frame is not reliably the one where the edit is on screen — deleting
// a piece baked its shadow one last time and then froze, leaving furniture
// shadows on an empty floor until some unrelated re-render (a Decor or Quality
// toggle) happened to open the pass again. Holding it open for ~300ms and
// keeping frames flowing means the last bake in the window is the true one.
//
// A drag is the same problem for a different reason: the mesh moves imperatively,
// outside React, so nothing re-renders and the shadow would stay under the old
// spot. Subscribing to a boolean rather than the drag-live channel keeps that to
// two re-renders per drag instead of one per tick.
function GroundShadows({ hi }: { hi: boolean }) {
  const footprint = useScene((s) => s.room.footprint);
  const width = useScene((s) => s.room.width);
  const depth = useScene((s) => s.room.depth);
  const height = useScene((s) => s.room.height);
  // Re-bake triggers: a part added/removed/edited, any committed transform, and
  // the two view switches that add or remove casters (hiding a piece, dropping
  // the decor layer).
  const parts = useScene((s) => s.parts);
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);
  const hidden = useStudio((s) => s.hidden);
  const dressed = useStudio((s) => s.dressed);
  const dragging = useStudio((s) => s.draggingId !== null);
  const invalidate = useThree((s) => s.invalidate);
  const [baking, setBaking] = useState(true);
  useEffect(() => {
    setBaking(true);
    const t = setTimeout(() => setBaking(false), 300);
    return () => clearTimeout(t);
  }, [parts, positions, rotations, dims, hidden, dressed, footprint, width, depth, height]);
  // frameloop="demand": without this the window would open on a canvas that
  // never paints again, and nothing would re-bake.
  useFrame(() => {
    if (baking) invalidate();
  });
  const b = footprintBounds(footprint);
  // Quantised to 0.5m. `scale` feeds drei's internal useMemo, which allocates two
  // WebGLRenderTargets and never disposes the pair it replaces — so a continuous
  // value would orphan a couple of megabytes of VRAM per committed wall move.
  // The plane is already oversized (×1.3) and only has to cover the room, so
  // rounding up costs nothing visually.
  const span = Math.ceil(Math.max(width, depth) * 1.3 * 2) / 2;
  return (
    <ContactShadows
      position={[b.cx, 0.004, b.cz]}
      scale={span}
      // 512 on 'Fast' — a quarter of the texels to fill and blur.
      resolution={hi ? 1024 : 512}
      far={height}
      blur={2.4}
      // The second, softer blur pair is the polish half of the cost.
      smooth={hi}
      frames={dragging || baking ? Infinity : 1}
      opacity={0.45}
      color="#3a342b"
    />
  );
}

// Records whether the render loop is currently running hot (consecutive frames
// milliseconds apart) or merely ticking on demand. PerformanceMonitor cannot
// tell the difference on its own.
function FrameRateGate({ hot }: { hot: MutableRefObject<boolean> }) {
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    hot.current = now - last.current < 40;
    last.current = now;
  });
  return null;
}

// Publishes the live camera + renderer to a ref the DOM drop handler can read.
function DropConnector({ apiRef }: { apiRef: React.MutableRefObject<{ camera: Camera; gl: WebGLRenderer } | null> }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    apiRef.current = { camera, gl };
  }, [apiRef, camera, gl]);
  return null;
}

// On-demand scene snapshot — the TopBar Snapshot button bumps useSnapshot's
// token; we capture the next frame (helpers hidden) and download it as a PNG.
function SceneCapture() {
  const { gl, scene, camera, invalidate } = useThree();
  const token = useSnapshot((s) => s.token);
  const done = useRef(useSnapshot.getState().token);

  // Under frameloop="demand" a useFrame poll is not enough: on an idle canvas the
  // next frame might never come, and the button would appear to do nothing. Ask
  // for one the moment the token moves.
  useEffect(() => {
    if (token !== done.current) invalidate();
  }, [token, invalidate]);

  useFrame(() => {
    const want = useSnapshot.getState().token;
    if (want === done.current) return;
    done.current = want;
    // Hide editor-only helpers (selection highlight + transform gizmo) so they
    // don't bake into the image. Restore after the synchronous copy.
    const hidden: Array<{ obj: { visible: boolean } }> = [];
    scene.traverse((o) => {
      const t = (o as { type?: string }).type ?? '';
      const isHelper =
        (o as { userData?: { helper?: boolean } }).userData?.helper === true ||
        t.startsWith('TransformControls') ||
        (o as { isTransformControls?: boolean }).isTransformControls === true;
      if (isHelper && (o as { visible: boolean }).visible) {
        hidden.push({ obj: o as { visible: boolean } });
        (o as { visible: boolean }).visible = false;
      }
    });
    try {
      // Render the raw scene from the CURRENT camera to the WebGL buffer, then
      // COPY it into a 2D canvas synchronously (before the un-preserved buffer
      // clears). toBlob runs async off that copy.
      gl.render(scene, camera);
      const src = gl.domElement;
      const snap = document.createElement('canvas');
      snap.width = src.width;
      snap.height = src.height;
      const ctx = snap.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(src, 0, 0);
      snap.toBlob((blob) => {
        if (blob) downloadBlob(blob, 'room-snapshot.png');
      }, 'image/png');
    } catch {
      /* canvas not ready / context lost — skip this snapshot */
    } finally {
      hidden.forEach((h) => (h.obj.visible = true));
    }
  });
  return null;
}

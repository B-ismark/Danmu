'use client';

// Renders all parts from useScene. Each becomes a Draggable wrapping a shape-dispatched geometry.
// Replaces the prior hand-coded Sofa/TV/Closet/Chair/etc imports.

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ContactShadows, Environment, Lightformer, AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, Raycaster, Vector2, Vector3, Plane, type Camera, type DirectionalLight, type Scene, type WebGLRenderer } from 'three';
import { v4 as uuid } from 'uuid';
import { useStudio } from '@/lib/store';
import { consumeGizmoClick } from '@/lib/gizmo-press';
import { useScene } from '@/lib/scene-store';
import { useRoomScene } from '@/lib/room-scene';
import { placeNewPart, DND_MIME, type Category, type Shape } from '@/lib/scene-spec';
import { footprintBounds } from '@/lib/footprint';
import { daylightKelvin } from '@/lib/solar';
import { LIGHTING, moodSunDirection, KEY_DIR, DEFAULT_BEARING_DEG } from '@/lib/lighting-moods';
import { shadowFit } from '@/lib/shadow-fit';
import { hexFromKelvin } from '@/lib/light-units';
import { useSnapshot, downloadBlob } from '@/lib/snapshot';
import { snapshotFileName } from '@/lib/exports';
import { pickIdsFrom } from '@/lib/pick-through';
import { openSceneMenu } from '@/components/studio/SceneContextMenu';
import { RoomShell } from './RoomShell';
import { WallHandles } from './WallHandles';
import { MeasureGuides } from './MeasureGuides';
import { Draggable } from './Draggable';
import { PartGeometry } from './DynamicPart';
import { Dressing } from './Dressing';
import { CameraRig } from './CameraRig';

/** Drop the hover highlight when the pointer leaves the canvas.
 *
 *  R3F derives hover from pointer MOVES over the canvas: `onPointerOut` fires when
 *  a later move lands somewhere else, and a pointer that leaves the canvas
 *  entirely — onto the inspector, the toolbar, another window — sends no later
 *  move. So the last part under the cursor kept its highlight indefinitely, which
 *  reads as a selection that cannot be dismissed. It reads that way in particular
 *  because the hover box is only 3% larger than the mesh and IS depth-tested
 *  (Highlight.tsx), so all that survives is the fragment of each edge near a
 *  corner — eight little brackets around the piece, exactly the vocabulary every
 *  other tool uses for "selected".
 *
 *  Listeners go on the canvas element rather than the wrapper div: the overlays are
 *  siblings of the canvas inside that div, so a wrapper-level `pointerleave` would
 *  not fire for the most common case of all — moving from a chair to the panel
 *  describing it. */
function HoverReset() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const clear = () => {
      if (useStudio.getState().hoveredPartId) useStudio.getState().setHovered(null);
    };
    el.addEventListener('pointerleave', clear);
    // Touch: a tap sets hover and then the finger is gone. Also covers a pointer
    // the browser takes away mid-gesture.
    el.addEventListener('pointercancel', clear);
    // Leaving through the window edge, or switching tab/app mid-hover, fires
    // neither of the above.
    window.addEventListener('blur', clear);
    return () => {
      el.removeEventListener('pointerleave', clear);
      el.removeEventListener('pointercancel', clear);
      window.removeEventListener('blur', clear);
    };
  }, [gl]);
  return null;
}

// Catalog drag-drop payload (set by CatalogPanel's draggable items).
type DropItem = { label: string; category: Category; shape: Shape; dimMM: [number, number, number] };

// Reused across drops — raycast the pointer onto the floor plane (y=0).
/** What a DOM handler outside the R3F tree needs to raycast back into it. */
type SceneApi = { camera: Camera; gl: WebGLRenderer; scene: Scene };

const _raycaster = new Raycaster();
const _ndc = new Vector2();
const _floor = new Plane(new Vector3(0, 1, 0), 0);
const _hit = new Vector3();

export function Room() {
  const hidden = useStudio((s) => s.hidden);
  const lighting = useStudio((s) => s.lighting);
  const quality = useStudio((s) => s.quality);
  const dressed = useStudio((s) => s.dressed);
  const panKey = useStudio((s) => s.panKeyHeld);
  const hi = quality === 'high';
  const L = LIGHTING[lighting];
  const parts = useScene((s) => s.parts).filter((p) => !hidden[p.id]);

  // The sun, in the moods that have one. Null in a studio mood, and null when the
  // angle is below the horizon — which is a real answer, not a missing one, and
  // the key light has to go out rather than shine up through the floor. No
  // shipped preset is below it, but the branch stays because `moodSunDirection` is
  // the thing that decides, not this call site.
  //
  // The only per-room input is the bearing: it rotates all four angles together,
  // so which wall the light comes through is still the user's answer. Everything
  // else is derived from the preset's two numbers, which is why there is no
  // ticker here any more — the app's one `setInterval` existed to follow the
  // device clock for a mood that no longer asks what time it is.
  const bearingDeg = useScene((s) => s.room.site?.bearingDeg) ?? DEFAULT_BEARING_DEG;
  const sun = useMemo(() => {
    if (!L.sun) return null;
    const { elevationDeg } = L.sun;
    // Through `moodSunDirection` rather than `sunDirection` directly: `NorthDial`
    // draws the same angle on its rim, and rule 3's point is that the second copy
    // of a derivation is where the two silently drift — a bearing sign that
    // disagreed between them would put the light in the right place and the marker
    // on the dial in the wrong one.
    const dir = moodSunDirection(lighting, bearingDeg);
    if (!dir) return null;
    return {
      dir,
      color: hexFromKelvin(daylightKelvin(elevationDeg)),
      // Air mass, roughly: the sun is dimmer near the horizon because its light
      // takes a longer path through the atmosphere. sin(altitude) is the standard
      // first approximation and it is what makes Sunrise read as sunrise rather
      // than as Day pointed sideways.
      intensity: 0.25 + 1.35 * Math.sin((elevationDeg * Math.PI) / 180),
    };
  }, [L.sun, lighting, bearingDeg]);
  // Drop the upper DPR bound when FPS regresses (large scenes / weak GPUs);
  // AdaptiveDpr cuts further while interacting. Keeps AO affordable.
  const [dprMax, setDprMax] = useState(2);
  // True only while frames are flowing continuously — see FrameRateGate.
  const hotLoop = useRef(false);

  // Camera, canvas and scene, stashed by DropConnector so the DOM handlers that
  // sit OUTSIDE the R3F tree can still raycast into it. Two need to: the drop
  // handler, which turns a drop point into a floor position, and the right-click
  // handler, which has to know everything under the cursor and not just the piece
  // that happens to be hovered.
  const dropApi = useRef<SceneApi | null>(null);

  /** Every piece under a viewport point, nearest first. The R3F pointer events
   *  give this away for free (`e.intersections`), but a native contextmenu on the
   *  wrapper element is not one of them, so it is cast by hand. */
  function partsUnder(clientX: number, clientY: number): string[] {
    const api = dropApi.current;
    if (!api) return [];
    const rect = api.gl.domElement.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_ndc, api.camera);
    return pickIdsFrom(_raycaster.intersectObjects(api.scene.children, true));
  }

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
    // The drop point goes in: a wall part takes the wall nearest where it was
    // aimed rather than the wall nearest the room's centre.
    const { pos, rot, wallMounted } = placeNewPart(item.category, item.shape, item.dimMM, r, ps, [
      _hit.x,
      _hit.z,
    ]);
    // `placeNewPart` was handed the drop point and has already clamped it into the
    // footprint. This used to re-derive x/z from `_hit` with a second, unguarded
    // clamp, and the plan deleted its copy of exactly that this same change — so
    // the two tabs disagreed about where an oversized piece lands: for a 2 m bed
    // dropped into a 1.5 m-deep room, `intoRoom` centres it while `max(minZ + 1.0,
    // min(maxZ - 1.0, hit))` lets the min beat the max and pins it at +0.25.
    const [x, y, z] = pos;
    const id = `${item.category}-${uuid().slice(0, 6)}`;
    useScene.getState().addPart({
      id, category: item.category, name: item.label, shape: item.shape,
      pos: [x, y, z], rot, dimMM: item.dimMM, locked: false, wallMounted,
    });
    useStudio.getState().setSelected(id);
  }

  return (
    <div
      // The cursor lives on this element rather than on <body> so it beats the
      // 'pointer' that Pickable writes to body while a piece is hovered — Space
      // over a sofa is still a pan, and has to look like one.
      style={{ position: 'absolute', inset: 0, cursor: panKey ? 'grab' : undefined }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={onDrop}
      // Right-click. OrbitControls no longer pans on this button, so it opens the
      // studio's context menu instead — on the piece under the cursor if there is
      // one (hover already knows which), on the room if there is not.
      onContextMenu={(e) => {
        e.preventDefault();
        // The candidates come along so the menu can offer "Select what's here" —
        // the second door to the Alt-click picker, for a window manager that eats
        // Alt, a browser that claims it, and a touch screen that has no modifiers
        // at all.
        openSceneMenu(e.clientX, e.clientY, useStudio.getState().hoveredPartId, partsUnder(e.clientX, e.clientY));
      }}
    >
    <Canvas
      shadows={hi}
      camera={{ fov: 38, position: [5, 4.5, 5.5], near: 0.05, far: 100 }}
      dpr={[1, dprMax]}
      // Which of these two numbers does what is not what the names suggest, and it
      // is worth stating because the obvious reading is wrong. `react-use-measure`
      // wires its **ResizeObserver** callback through `debounce.scroll` and only
      // the window `resize` **event** listener through `debounce.resize`. R3F
      // defaults to `{ scroll: 50, resize: 0 }`, so:
      //
      //   · an element resize — a rail collapsing, a divider being dragged, the
      //     stacked layout reflowing — was already debounced 50ms, and a trailing
      //     debounce means a continuous drag costs no setSize at all until the
      //     pointer settles. That path was fine.
      //   · dragging the window's own edge was NOT debounced, and each of those
      //     intermediate widths buys a setSize plus a render, which here is SSAO +
      //     SMAA + a shadow pass.
      //
      // So 90 is for the window drag. `scroll` is restated rather than inherited
      // because R3F spreads this object over its defaults — `debounce` is replaced
      // wholesale, not merged, so leaving it out would take the observer's own
      // debounce from 50 to 0 and make the element-resize path worse than it was.
      // Same shape of trap as `gap` / `row-gap` in globals.css.
      resize={{ debounce: { scroll: 50, resize: 90 } }}
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
      onPointerMissed={() => {
        // A pan that ends over bare floor is not a click on nothing.
        if (useStudio.getState().panKeyHeld) return;
        // Neither is a gizmo gesture whose ring was over bare floor. R3F only calls
        // this when the click moved 2px or less, so a real rotate does not reach
        // here — but a press on a handle that turned nothing does, and it must not
        // deselect the piece the handle belongs to. It also stops the gate being
        // left armed with nothing to consume it. See lib/gizmo-press.ts.
        if (consumeGizmoClick()) return;
        useStudio.getState().setSelected(null);
      }}
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
          form; a dim back-fill keeps shadowed faces readable. The key light DOES
          cast a real shadow map on 'high' (see KeyLight); ContactShadows below is
          the soft contact grounding on top of it, not a replacement for it. */}
      <hemisphereLight args={L.hemi} />
      {/* In a sun mood the key light IS the sun — and if the angle is below the
          horizon there is no key light at all, which is the honest picture of a
          room after dark and the reason this is a conditional rather than a
          dimmer. */}
      {L.sun ? (
        sun && <KeyLight intensity={sun.intensity} color={sun.color} cast={hi} dir={sun.dir} />
      ) : (
        <KeyLight intensity={L.key.intensity} color={L.key.color} cast={hi} />
      )}
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
        <Lightformer intensity={0.7 * L.envMul} position={[0, 5, 0]} scale={[8, 8, 1]} rotation={[Math.PI / 2, 0, 0]} color={L.env[0]} />
        <Lightformer intensity={0.35 * L.envMul} position={[5, 2, 3]} scale={[4, 6, 1]} color={L.env[1]} />
        <Lightformer intensity={0.3 * L.envMul} position={[-5, 2, -3]} scale={[4, 6, 1]} color={L.env[2]} />
      </Environment>

      <HoverReset />
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

// The key light, with its shadow frustum fitted to the room.
//
// The frustum used to be hard-coded to ±6m — a 12×12m box — and two separate
// things were wrong with that:
//
//   · **It clipped.** `MAX_ROOM` is 40m. Anything further than ~6m from the room
//     centre fell outside the shadow camera and cast nothing at all, with a hard
//     line across the floor where the frustum ended. The Open Plan preset
//     (7.5×5.6m) already sits on that edge before the user drags a single wall.
//   · **`shadow-bias` alone cannot keep the depth comparison honest.** The floor
//     and the wall planes are lit at a grazing angle, so their own depth rounds
//     across a texel boundary and they shadow THEMSELVES — streaks and smudges
//     with nothing casting them, which is what the bleeding is. `normalBias` is
//     the parameter three exposes for exactly this (it walks the sample along the
//     surface normal in proportion to texel size) and it was never set.
//
// (The comment at the light used to claim this scene had "no shadow maps" at all.
// It has had one since `shadows={hi}` went on the Canvas. Nobody reconciled the
// comment, so nobody tuned the map.)
//
// The fit itself is `lib/shadow-fit.ts` and not four expressions in here, because
// it is geometry with a handedness and a wrong answer is silent — an ortho shadow
// camera does not complain about what falls outside it, it just stops recording it.
// That module is also where the fit changed shape when the room became a closed
// shell: the walls cast now, so every caster and every receiver is inside the
// room's own box, and the frustum no longer has to cover the metres of empty floor
// outside the house that the tallest piece of furniture could theoretically reach.
function KeyLight({
  intensity,
  color,
  cast,
  dir,
}: {
  intensity: number;
  color: string;
  cast: boolean;
  /** Unit vector from the room toward the light. Defaults to the studio key's
   *  fixed three-quarter position; the sun mood passes a real solar direction, and
   *  the frustum re-fits for it — a low sun sees the room in elevation rather than
   *  in plan, so a wall's top corner lands further across the map than its base. */
  dir?: [number, number, number];
}) {
  const ref = useRef<DirectionalLight>(null);
  const footprint = useScene((s) => s.room.footprint);
  const height = useScene((s) => s.room.height);
  const parts = useRoomScene();
  const invalidate = useThree((s) => s.invalidate);

  const d = dir ?? KEY_DIR;
  const b = footprintBounds(footprint);
  // Read off the RESOLVED parts, or a stretched wardrobe would be measured at its
  // original height. It only matters when something is taller than the room, though:
  // `lib/clearance.ts` reports a piece that does not fit and deliberately does not
  // resize it, so a 3m wardrobe in a 2.4m room really does stand through the ceiling
  // and really does have to be in the map. Every other caster is inside the shell.
  const tallest = parts.reduce((m, p) => Math.max(m, p.dimMM[2] / 1000), 0);
  const { extent, mapSize, dist, near, far, normalBias } = shadowFit(
    b.width,
    b.depth,
    height,
    tallest,
    d,
  );

  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    // Aim at the room, not the world origin: an independently-moved wall leaves
    // the footprint off-centre, and a frustum fitted this tightly would then clip
    // its own shadows at the far edge.
    l.target.position.set(b.cx, 0, b.cz);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    // R3F sets the `shadow-camera-*` props for us but never calls this, and an
    // ortho camera ignores its bounds until it does.
    cam.updateProjectionMatrix();
    // Setting `shadow-mapSize` does nothing once the depth target exists — three
    // allocates it on first use and then reuses it at its original size forever.
    // Without this, a room dragged past the 8m step kept its 1024² map while
    // `normalBias` above was already being computed for 2048², which halves the
    // bias and lets the bleeding straight back in at the size that needs it most.
    if (l.shadow.map && l.shadow.map.width !== mapSize) {
      l.shadow.map.dispose();
      l.shadow.map = null;
    }
    l.shadow.needsUpdate = true;
    // frameloop="demand" — nothing else asks for the frame that shows the re-fit.
    invalidate();
  }, [b.cx, b.cz, extent, mapSize, invalidate]);

  return (
    <directionalLight
      ref={ref}
      position={[b.cx + d[0] * dist, d[1] * dist, b.cz + d[2] * dist]}
      intensity={intensity}
      color={color}
      castShadow={cast}
      shadow-mapSize-width={mapSize}
      shadow-mapSize-height={mapSize}
      // normalBias carries the offset now, so the constant bias only has to cover
      // faces square to the light and can stay small — a large negative bias is
      // what detaches a shadow from its object ("peter-panning").
      shadow-bias={-0.0001}
      shadow-normalBias={normalBias}
      shadow-camera-near={near}
      shadow-camera-far={far}
    />
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
  //
  // Fitted to the footprint, per axis. It used to be ONE square span of
  // max(width, depth) × 1.3, which on a 5.6×4.2m room put the plane 1m past the
  // long walls and 1.65m past the short ones. That matters because of what drei
  // actually does in the pass (read its source, not its name): it sets
  // `scene.overrideMaterial` to a MeshDepthMaterial and renders the WHOLE scene
  // through a top-down ortho camera the size of this plane, hiding only its own
  // group. Nothing is filtered by `castShadow`. So the walls are captured too —
  // edge-on strips from above — and every millimetre of plane sticking out past a
  // wall is a surface for that wall's blurred strip to paint on, outside the room.
  const spanX = Math.ceil(b.width * 2) / 2;
  const spanZ = Math.ceil(b.depth * 2) / 2;
  return (
    <ContactShadows
      position={[b.cx, 0.004, b.cz]}
      scale={[spanX, spanZ]}
      // 512 on 'Fast' — a quarter of the texels to fill and blur.
      resolution={hi ? 1024 : 512}
      // A CONTACT shadow, so the depth band is a contact distance — not the whole
      // room. At `far={height}` the pass reached the ceiling, which meant a
      // wall-mounted TV at 1.3m and the full height of every wall registered as
      // occluders and blurred out across the floor. The real cast shadows come
      // from the key light's shadow map (see KeyLight); this pass only has to
      // darken where things MEET the floor.
      far={0.6}
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
function DropConnector({ apiRef }: { apiRef: React.MutableRefObject<SceneApi | null> }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    apiRef.current = { camera, gl, scene };
  }, [apiRef, camera, gl, scene]);
  return null;
}

// On-demand scene snapshot — the Export menu's 3D-view item bumps useSnapshot's
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
        if (blob) downloadBlob(blob, snapshotFileName(useSnapshot.getState().name));
      }, 'image/png');
    } catch {
      /* canvas not ready / context lost — skip this snapshot */
    } finally {
      hidden.forEach((h) => (h.obj.visible = true));
    }
  });
  return null;
}

'use client';

// Renders all parts from useScene. Each becomes a Draggable wrapping a shape-dispatched geometry.
// Replaces the prior hand-coded Sofa/TV/Closet/Chair/etc imports.

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ContactShadows, Environment, Lightformer, AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, Raycaster, Vector2, Vector3, Plane, type Camera, type WebGLRenderer } from 'three';
import { v4 as uuid } from 'uuid';
import { useStudio } from '@/lib/store';
import { useScene } from '@/lib/scene-store';
import { placeNewPart, DND_MIME, type Category, type Shape } from '@/lib/scene-spec';
import { roomStore } from '@/lib/storage';
import { RoomShell } from './RoomShell';
import { WallHandles } from './WallHandles';
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
  const mode = useStudio((s) => s.renderMode);
  const hidden = useStudio((s) => s.hidden);
  const lighting = useStudio((s) => s.lighting);
  const quality = useStudio((s) => s.quality);
  const dressed = useStudio((s) => s.dressed);
  const hi = quality === 'high';
  const L = LIGHTING[lighting];
  const parts = useScene((s) => s.parts).filter((p) => !hidden[p.id]);
  const room = useScene((s) => s.room);
  // Drop the upper DPR bound when FPS regresses (large scenes / weak GPUs);
  // AdaptiveDpr cuts further while interacting. Keeps AO affordable.
  const [dprMax, setDprMax] = useState(2);

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
      // Drop where the pointer hit the floor, kept inside the walls.
      const halfW = r.width / 2 - item.dimMM[0] / 2000;
      const halfD = r.depth / 2 - item.dimMM[1] / 2000;
      x = Math.max(-halfW, Math.min(halfW, _hit.x));
      z = Math.max(-halfD, Math.min(halfD, _hit.z));
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
      // Continuous render so the composer repaints every frame.
      frameloop="always"
      onPointerMissed={() => useStudio.getState().setSelected(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Opaque paper background — THE fix for the moving-object "shadow trail":
          with a transparent canvas the EffectComposer (N8AO) blended each frame
          over the last, so contact shadows + gizmos smeared. An explicit scene
          background makes the render pass CLEAR the colour buffer every frame.
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
          materials. Baked once (frames={1}); no CDN/HDR file fetched, so it
          works for the BYO-key, browser-only architecture. */}
      <Environment key={lighting} resolution={256} frames={1}>
        <Lightformer intensity={0.7} position={[0, 5, 0]} scale={[8, 8, 1]} rotation={[Math.PI / 2, 0, 0]} color={L.env[0]} />
        <Lightformer intensity={0.35} position={[5, 2, 3]} scale={[4, 6, 1]} color={L.env[1]} />
        <Lightformer intensity={0.3} position={[-5, 2, -3]} scale={[4, 6, 1]} color={L.env[2]} />
      </Environment>

      <Suspense fallback={null}>
        <RoomShell />
        <WallHandles />
        {parts.map((part) => (
          <Draggable key={part.id} partId={part.id}>
            <PartGeometry part={part} locked={part.locked} mode={mode} />
          </Draggable>
        ))}
        {dressed && parts.map((part) => <Dressing key={`dress-${part.id}`} part={part} />)}
        <ContactShadows
          position={[0, 0.004, 0]}
          scale={Math.max(room.width, room.depth) * 1.3}
          resolution={1024}
          far={room.height}
          blur={2.4}
          opacity={0.45}
          color="#3a342b"
        />
      </Suspense>

      {/* Ambient occlusion — the biggest "CG → real" jump for interiors:
          darkens corners + where objects meet the floor. N8AO is the
          performance-oriented SSAO variant; half-res + SMAA keeps it light, and
          it only runs on requested frames under frameloop="demand". */}
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <N8AO aoRadius={0.5} intensity={1.1} distanceFalloff={1} halfRes />
        <SMAA />
      </EffectComposer>

      {/* Perf guards: PerformanceMonitor lowers the DPR ceiling on FPS decline;
          AdaptiveDpr drops resolution while the camera is moving. */}
      <PerformanceMonitor onDecline={() => setDprMax(1)} onIncline={() => setDprMax(2)} />
      <AdaptiveDpr pixelated />

      <CameraRig />
      <SceneCapture />
      <DropConnector apiRef={dropApi} />
    </Canvas>
    </div>
  );
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

// Persists a debounced screenshot of the live scene to IDB whenever the scene
// settles. The render flow uses it as the base image when the user never
// captured real photos — "reimagine this 3D blockout as a real room".
function SceneCapture() {
  const { gl, scene, camera } = useThree();
  const { roomId } = useParams<{ roomId: string }>();
  const parts = useScene((s) => s.parts);
  const room = useScene((s) => s.room);
  // Transform overrides matter: the snapshot is the render's base image, so it
  // MUST reflect the user's moves/rotations/scales. Watching only parts/room
  // (the old behaviour) meant a rotated wardrobe or a moved item never made it
  // into the snapshot, so the render reverted to the detected layout.
  const positions = useStudio((s) => s.positions);
  const rotations = useStudio((s) => s.rotations);
  const dims = useStudio((s) => s.dims);

  // "Dirty" episode tracking. Any arrangement OR camera change pushes the settle
  // deadline; ~600ms after the last change we take exactly one snapshot. This is
  // what makes the render use the EXACT view + arrangement the user is looking at
  // (camera moves don't trigger React renders, so we poll the camera in useFrame).
  const dirtyAt = useRef(Date.now());
  const savedFor = useRef(0);
  const lastCamKey = useRef('');

  useEffect(() => {
    dirtyAt.current = Date.now();
  }, [parts, room, positions, rotations, dims]);

  useFrame(() => {
    if (!roomId) return;
    const p = camera.position;
    const r = (camera as { rotation?: { x: number; y: number; z: number } }).rotation;
    const camKey = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}|${r ? `${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}` : ''}`;
    if (camKey !== lastCamKey.current) {
      lastCamKey.current = camKey;
      dirtyAt.current = Date.now();
    }
    // Settled, and not yet saved for this dirty episode → snapshot once.
    if (Date.now() - dirtyAt.current < 600) return;
    if (savedFor.current === dirtyAt.current) return;
    savedFor.current = dirtyAt.current;
    // Hide editor-only helpers (selection highlight + transform gizmo) so they
    // don't bake into the snapshot the AI renders from. Restore after.
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
      snap.toBlob(
        (blob) => {
          if (blob) roomStore.saveSceneSnap(roomId, blob).catch(() => {});
        },
        'image/jpeg',
        0.92,
      );
    } catch {
      /* canvas not ready / context lost — skip this snapshot */
    } finally {
      // drawImage already captured the buffer synchronously, so restore now.
      hidden.forEach((h) => (h.obj.visible = true));
    }
  });
  return null;
}

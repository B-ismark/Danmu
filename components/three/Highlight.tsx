'use client';

// What a piece looks like while it is under the pointer, selected, carried, or
// refused: a translucent base under it, the size of its footprint and a little
// more (see `lib/selection-base.ts` for the why and the measurements).
//
//   • hovered  → a faint frosted base, sage rim
//   • selected → a clearer frosted base, terracotta rim — the same while carried
//   • invalid  → light red: the spot it is being carried to will not take it
//
// Depth-tested, unlike the outlined box it replaced, which drew through walls so a
// selection was never lost behind one. From the default dollhouse view the near
// walls are cut away, and the Inspector says what is selected wherever it is; a
// frame drawn through the plaster read as a construction line over the room.
//
// Drawn inside the part's outer group, so it follows the live position and
// rotation, and outside the `Wobble` group, so it stays put while the piece leans.
// The outer group wears a resize as a SCALE for most pieces; the base is authored
// at the real size and undoes that scale, or a piece stretched to twice its height
// would stand on a slab twice as thick.

import { useEffect, useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { ExtrudeGeometry, Shape } from 'three';
import { SCENE } from '@/lib/scene-palette';
import { selectionBase } from '@/lib/selection-base';
import type { Anchor } from '@/lib/physics';

function roundedRect(w: number, l: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -l / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + l - r);
  s.quadraticCurveTo(x + w, y + l, x + w - r, y + l);
  s.lineTo(x + r, y + l);
  s.quadraticCurveTo(x, y + l, x, y + l - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const noRaycast = () => null;

export function Highlight({
  dimMM,
  sizeMM,
  anchor,
  state,
}: {
  /** What the piece's group draws at scale 1. */
  dimMM: [number, number, number];
  /** Its real size — the resize included. */
  sizeMM: [number, number, number];
  anchor: Anchor;
  /** 'invalid' wins over 'selected' wins over 'hovered' — caller decides. */
  state: 'selected' | 'hovered' | 'invalid';
}) {
  const base = selectionBase(anchor, sizeMM);
  const [a, b] = base.size;

  const geometry = useMemo(
    () =>
      new ExtrudeGeometry(roundedRect(a, b, base.radius), {
        depth: base.thickness,
        bevelEnabled: false,
        curveSegments: 6,
      }),
    [a, b, base.radius, base.thickness],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // From lib/scene-palette. The slab itself is frosted paper, and only its rim
  // carries the brand hue — sage for a hover, terracotta for a selection, the same
  // as the plan and the inspector. A refusal is the one state that tints the
  // slab, because --danger sits a step from --accent on the wheel: a terracotta
  // slab turning red would be a change of shade nobody reads as "no". Frosted to
  // red is. Light, not solid: it is a tint on the floor, not a stop sign.
  const fillColor = state === 'invalid' ? SCENE.invalid : SCENE.glass;
  const rimColor = state === 'invalid' ? SCENE.invalid : state === 'selected' ? SCENE.accent : SCENE.accentHover;
  const fill = state === 'invalid' ? 0.3 : state === 'selected' ? 0.55 : 0.3;
  const rim = state === 'invalid' ? 0.85 : state === 'selected' ? 0.7 : 0.45;

  // Extruded along +Z from the shape's XY plane. A floor or ceiling base is laid
  // flat (thickness up +Y); a wall base stands as it is, off the plaster toward +Z.
  const flat = base.plane !== 'wall';
  const position: [number, number, number] =
    base.plane === 'floor' ? [0, base.at, 0] : base.plane === 'ceiling' ? [0, base.at - base.thickness, 0] : [0, 0, base.at];
  const unscale: [number, number, number] = [
    dimMM[0] / sizeMM[0] || 1,
    dimMM[2] / sizeMM[2] || 1,
    dimMM[1] / sizeMM[1] || 1,
  ];

  return (
    // userData.helper lets SceneCapture hide this while it grabs the PNG, so an
    // editor-only cue never bakes into the exported image.
    <group userData={{ helper: true }} scale={unscale}>
      <mesh
        geometry={geometry}
        position={position}
        rotation={flat ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
        // Not a press target: a margin round a piece must not catch a press meant
        // for the one beside it, or start a drag of this one from empty floor.
        raycast={noRaycast}
        renderOrder={2}
      >
        <meshBasicMaterial transparent opacity={fill} color={fillColor} depthWrite={false} />
        <Edges threshold={20} raycast={noRaycast}>
          <lineBasicMaterial color={rimColor} transparent opacity={rim} depthWrite={false} />
        </Edges>
      </mesh>
    </group>
  );
}

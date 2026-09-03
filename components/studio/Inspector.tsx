'use client';

import { useEffect, useRef, useState } from 'react';
import { useStudio, useSettings, type DimUnit } from '@/lib/store';
import { useHasOverrides, useRoomPart, useRoomScene } from '@/lib/room-scene';
import { useScene } from '@/lib/scene-store';
import { boundsToUnit, fromMM, toMM, stepFor, precisionFor, formatDim, UNIT_OPTIONS } from '@/lib/units';
import { clampDims, dimRangeFor } from '@/lib/dimension-ranges';
import { Icon } from '@/components/ui/Icon';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Select } from '@/components/ui/Select';
import { NumberField } from '@/components/ui/NumberField';
import { EditableText, IconButton, Pill } from '@/components/ui/primitives';
import { SwapModelModal } from './RegenerateModal';
import { RailSection } from './RailSection';
import { SCENE, defaultBodyColor } from '@/lib/scene-palette';
import { isWallMountedPart, supportsDecor, autoSurfaceDecor, isLightFixture, lightFor, DECOR_KINDS, type LibraryItem, type ScenePart, type DecorItem, type DecorKind, type PartLight } from '@/lib/scene-spec';
import { anchorFor, findSupportDetailed, groundY, heightForNewCeiling, MOUNT_PAD, restingOn, snapToWall as snapToWallPhys, wallStandoff } from '@/lib/physics';
import { useRoomReport } from './RoomTools';
import { wallSegments } from '@/lib/footprint';
import { moveWallCarrying } from '@/lib/wall-actions';

// The right rail is a DECORATING panel, not a properties palette — and it now
// practises the disclosure the left rail has always had. Every decorating
// decision folds to ONE summary line: Colour (swatch · name · finish), On the
// surface ("Suggested · 3"), Exact size (the millimetres). The fold is
// RailSection, the left rail's own component, and its meta slot carries the
// derived state — so the row tells you where you stand without spending a
// screen of options on it. Where it sits, the model swap stays permanently out
// because it is a verb, not an option. Delete is a verb too and is not in this
// panel at all any more: it is the rail's pinned footer (`RailFooter`), beside
// Add, which is what stopped it scrolling away inside this scroll box. The old panel opened a
// sofa onto 24 swatches, 5 finish chips and 5 prop chips at once — every
// option, no decision. Nothing was removed, only re-ranked and folded.
export function Inspector() {
  const id = useStudio((s) => s.selectedPartId);
  const selectedWall = useStudio((s) => s.selectedWall);
  const part = useRoomPart(id);
  const baseDim = useScene((s) => s.parts.find((p) => p.id === id)?.dimMM);
  // The rotation a swap will LAND on: swapModel calls resetTransforms, so the
  // effective (overridden) rot is about to be discarded and must not be the one
  // the new model's footprint is measured with.
  const baseRot = useScene((s) => s.parts.find((p) => p.id === id)?.rot) ?? 0;
  const hasOverrides = useHasOverrides(id);
  const setDim = useStudio((s) => s.setDim);
  const setPosition = useStudio((s) => s.setPosition);
  const setRotation = useStudio((s) => s.setRotation);
  const setParent = useStudio((s) => s.setParent);
  const clearParent = useStudio((s) => s.clearParent);
  const resetTransforms = useStudio((s) => s.resetTransforms);
  const updatePart = useScene((s) => s.updatePart);
  // Resolved once for the whole panel: surface snapping and the dimension fields
  // both need the world as it stands, not as it was authored.
  const effParts = useRoomScene();
  const room = useScene((s) => s.room);
  // Above the early returns below, because it is a HOOK — the same memoised report the
  // health chip reads. What it is FOR is § 37, and the reasoning lives beside the
  // derivation further down rather than here.
  const { report } = useRoomReport();

  const [swapOpen, setSwapOpen] = useState(false);

  if (selectedWall !== null) return <WallInspector index={selectedWall} />;

  if (!part || !id)
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
        Click a piece of furniture to recolour, restyle or move it — or click a wall to paint it.
      </div>
    );

  const currentDim = part.dimMM;
  const defaultDim = baseDim ?? part.dimMM;

  function currentXYZ(): [number, number, number] {
    // `part` is already resolved by `useRoomPart`, so this is the effective position
    // without a second fallback written out.
    return [part!.pos[0], part!.pos[1], part!.pos[2]];
  }

  /** Every part in its CURRENT effective transform, so surface snapping works
   *  against the world the user is looking at rather than the original scene. */
  function partSnapshot() {
    // Already resolved by `useRoomScene`; this only projects the handful of fields
    // the snapping maths reads.
    return effParts.map((p) => ({
      id: p.id,
      pos: p.pos,
      rot: p.rot,
      dimMM: p.dimMM,
      category: p.category,
      // `shape`, not `wallMounted`. The support probe decides what a piece's geometry
      // is anchored to, and that is `anchorFor(category, shape)` — keyed by shape
      // first for a fan, a door, a curtain and a television. Handing it the stored
      // flag instead was handing it a copy of the answer, which `lib/scene-file.ts`
      // could get wrong; `SupportCandidate` no longer has a field to put it in.
      shape: p.shape,
      circle: p.circle,
    }));
  }

  function groundToFloor() {
    const [x, , z] = currentXYZ();
    setPosition(id!, [x, 0, z]);
    clearParent(id!);
  }

  // Hybrid swap — replace this part's model with a library one, keeping its
  // position + colour. Re-grounds Y for the new dims / mount type and clears
  // stale transform overrides (old scale would distort the new base dims).
  // `dimOverride` carries sizes the user named in the picker's search box —
  // `sizeFromQuery` has already clamped them, and the item handed over carries the
  // result, so the argument and `item.dimMM` are the same number by the time they
  // arrive. It stays a separate parameter because re-grounding must be the only
  // place that decides Y, and a caller with a size in hand should be able to say so
  // rather than mutate the item on the way in.
  function swapModel(item: LibraryItem, dimOverride?: [number, number, number]) {
    const dimMM = dimOverride ?? ([...item.dimMM] as [number, number, number]);
    const [x, y, z] = currentXYZ();
    const wallMounted = isWallMountedPart(item.category, item.shape);
    let ny = y;
    let support: { id: string; y: number } | null = null;
    if (wallMounted) {
      // `heightForNewCeiling` with the ceiling held still, NOT a hand-written
      // clamp. This was a fifth copy of the one in `physics.ts` — character for
      // character its return expression — while the constant's own docblock named
      // four and listed the other one in this file. It also broke the exemption
      // stated three lines below that count: a door is `wall-floor`, so
      // `isWallMountedPart` is true and it came through here, `groundY` returned
      // its canonical h/2, and the pad then stood it 20 mm off its own threshold —
      // with `apertures.ts` cutting the hole from the same raised centre, which is
      // the doorway-with-a-step the anchor exists to prevent. The shared function
      // returns `y` untouched for `floor` and `wall-floor` and clamps everything
      // else, so routing through it fixes the door and makes the count true.
      ny = heightForNewCeiling(
        item.category,
        item.shape,
        dimMM,
        groundY(item.category, item.shape, dimMM, room.height),
        room.height,
        room.height,
      );
    } else {
      support = findSupportDetailed(partSnapshot(), id!, x, z, dimMM, baseRot);
      ny = support !== null && support.y > 0.3 ? support.y : 0;
    }
    resetTransforms(id!); // drop stale rotate/scale overrides (and any rigid-parenting link)
    // Update the name too — leaving it stale is how a swapped-in door kept its
    // old "tall mirror" identity, so hover/tree showed a wrong, conflicting label.
    updatePart(id!, { name: item.label, category: item.category, shape: item.shape, dimMM, wallMounted });
    setPosition(id!, [x, ny, z]);
    // Re-establish what `resetTransforms` just cleared — the swap moved the
    // part, but didn't stop it resting on whatever it landed on.
    if (!wallMounted && support && support.y > 0.3) setParent(id!, support.id);
    else clearParent(id!);
    setSwapOpen(false);
  }

  function snapToNearestWall() {
    const [x, y, z] = currentXYZ();
    const snapped = snapToWallPhys([x, y, z], part!.dimMM, room.footprint, wallStandoff(part!.shape));
    setPosition(id!, [snapped.x, y, snapped.z]);
    if (snapped.rot !== undefined) setRotation(id!, snapped.rot);
    clearParent(id!);
  }

  /** What this piece would come to rest ON — the highest surface under its centre,
   *  or null for bare floor.
   *
   *  Pulled out of `snapToSurface` because it answers a second question: whether a
   *  separate **Floor** button means anything at all. With nothing underneath,
   *  `snapToSurface` and `groundToFloor` are the same three lines — y = 0, clear the
   *  parent — so two buttons were doing one thing, which is what the user saw as the
   *  row being redundant. It is the SAME call with the SAME arguments the action
   *  makes, deliberately: a button shown by one predicate and driven by another is
   *  how a control comes to appear when it does nothing. */
  function supportBelow() {
    const [x, , z] = currentXYZ();
    return findSupportDetailed(partSnapshot(), id!, x, z, part!.dimMM, part!.rot);
  }

  function snapToSurface() {
    const [x, , z] = currentXYZ();
    const support = supportBelow();
    setPosition(id!, [x, support?.y ?? 0, z]);
    if (support) setParent(id!, support.id);
    else clearParent(id!);
  }

  const isGeneric = part.shape === 'box';

  // ─── Where this piece stands ─────────────────────────────────────────────
  //
  // § 37. A selected piece saying where it is standing is a real gap, and the first
  // attempt at it was held out of a PR for one reason: it ANSWERED the question itself.
  // It ran `collidesAt` and `partInsideRoom` beside the room report, which asks the
  // same two questions with different bars, and it was wrong on both.
  //
  // `collidesAt` deliberately has no `sharesFloor` exemption while the report's rule 2
  // charges a tucked pair against `TUCKED_CLASH_SHARE` — that divergence is written
  // down in `lib/clearance.ts` in as many words, with twenty seeded pairs behind it.
  // So a dining chair pushed under its table got a red *"Blocked — move it away from
  // the overlapping piece"* while Room check said the room was fine. The advice was to
  // break the app's own seeded arrangement.
  //
  // So it reads the report instead. Not "computes the same thing carefully": READS it,
  // via the same memoised `useRoomReport` the health chip uses. The banner agrees with
  // Room check by construction and inherits every exemption automatically, including
  // the ones nobody has written yet. CLAUDE.md rule 3 names this exact scar — two
  // consumers carrying their own copies of a placement rule is how Suggest came to park
  // a bed across a doorway and have Room check report it.
  const mine = report.issues.filter((i) => i.partIds.includes(id!) && i.severity !== 'info');
  // Worst first. `severity` is the report's own ordering and re-ranking it here would
  // be the same mistake one level down.
  const worst = mine.find((i) => i.severity === 'error') ?? mine[0] ?? null;

  // …and the half the report cannot answer. `lib/clearance.ts` skips anything above
  // the floor, so a rider has no finding of its own however far it is floating — which
  // is why § 12's floating rider has never had a gate. `restingOn` is that answer, and
  // it is NOT `findSupportDetailed`: see its docblock for why "what is under here" and
  // "is this resting" are different questions, and why asking the first one produced a
  // green banner reading "On Table — Supported by Table" about a lamp in mid-air.
  const rest = part.wallMounted
    ? null
    : restingOn(partSnapshot(), id!, currentXYZ(), part.rot, part.dimMM, part.category, part.shape, part.circle);
  const floating = !part.wallMounted && rest === null;

  const restingName =
    rest?.on === 'part' ? (effParts.find((p) => p.id === rest.id)?.name ?? 'another piece') : null;

  // Where the piece is ANCHORED, in the app's own three-way wording. Not "wall-mounted":
  // `part.wallMounted` is `anchorFor(...) !== 'floor'`, so it is true for a ceiling fan
  // and a pendant lamp, and calling those fixed to a wall is simply false.
  // `lib/scene-file.ts` already solved this exact sentence for its `dropped` messages,
  // with a comment saying the file "two lines up knows better" — so this reads the same
  // three-way answer rather than inventing a fourth.
  const anchor = anchorFor(part.category, part.shape);
  const anchorSentence =
    anchor === 'ceiling' ? 'Hanging from the ceiling.' : 'Fixed to a wall.';
  const anchorLabel = anchor === 'ceiling' ? 'Hanging' : 'Wall-mounted';

  // Three severities, not a boolean. `warn` is "A bit tight" in amber in the room
  // report (`SEVERITY` in `RoomTools`), and painting it `--danger` here would make one
  // finding two colours on two surfaces — the same two-sources-of-truth defect this
  // banner exists to end, one layer down in the presentation.
  const placementTone: 'danger' | 'warn' | 'ok' = worst
    ? worst.severity === 'error'
      ? 'danger'
      : 'warn'
    // Floating is a WARN and not a danger, deliberately: `clearance.ts` skips anything
    // above the floor, so a floating rider produces no finding and the health chip
    // reads "Room checks out". A red banner beside a green chip is the contradiction
    // this whole item is about, so the one state the report cannot see is reported in
    // the quieter tone.
    : floating
      ? 'warn'
      : 'ok';

  // …and `floating` is not SUPPRESSED by an unrelated warn. A lamp in mid-air that also
  // happens to sit in a tight walkway used to read "Tight walkway" and nothing else —
  // the one state this feature was built for, erased by a finding about the floor.
  const placementLabel = worst
    ? worst.title
    : floating
      ? 'Floating'
      : part.wallMounted
        ? anchorLabel
        : restingName
          ? `On ${restingName}`
          : 'On floor';
  const restingSentence = part.wallMounted
    ? anchorSentence
    : floating
      ? 'Nothing is holding it up. Drop it to the surface below, or move it onto something.'
      : restingName
        ? `Resting on ${restingName}.`
        : 'Standing on the floor.';
  // Both halves when both have something to say. A finding is about the floor plan and
  // the resting state is about the vertical; they are different facts and the report
  // cannot see the second, so a piece that is BOTH in a tight walkway and floating says
  // so rather than picking one.
  const placementDetail = worst
    ? floating
      ? `${worst.detail} It is also not resting on anything.`
      : worst.detail
    : restingSentence;
  const placementOk = placementTone === 'ok';

  // `rail-scroll` carries nothing but `container-type` — it is what makes THIS box
  // the one `@container rail` measures, rather than the rail outside the scrollbar.
  // Both Inspector panes are scroll boxes and both take it; see globals.css for why
  // the outer rail is the wrong box. If the `overflow` ever moves, the class moves
  // with it, because it is the scrollbar that makes the two boxes differ.
  return (
    <div className="rail-scroll" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%', minWidth: 0 }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <EditableText
            value={part.name}
            label="Furniture name"
            onCommit={(next) => updatePart(id!, { name: next })}
            style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}
            inputStyle={{ fontSize: 16, fontWeight: 500, height: 32 }}
          />
          {/* Not "Locked": the piece drags, resizes and recolours like any other.
              What the flag means is where it came from — see ScenePart.locked. */}
          {part.locked && <Pill tone="locked" style={{ flexShrink: 0 }}>From photo</Pill>}
        </div>

        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, paddingLeft: 4, textTransform: 'capitalize' }}>
          {/* shape ids are hyphenated internally ("chair-armchair") — say it in words */}
          {part.category} · {part.shape.replace(/-/g, ' ')}
        </div>
      </div>

      {/* ── Where this piece stands ────────────────────────────────────────── */}
      {/*
          `role="status"` WITHOUT `aria-live`. The first version had both, and the
          combination re-announces on every selection change and every position write —
          so a drag committed a stream of announcements into a polite queue that then
          read them all out. `role="status"` already carries an implicit live region;
          what it does not carry is a promise to interrupt, which is right for a label
          that describes whatever happens to be selected.

          `--danger-tint` / `--danger-text` and `--paper-0` / `--success-text` rather
          than the fill tokens: `--danger` and `--success` are FILLS and do not clear
          4.5:1 as type. The `-text` variants are the ones that do.
      */}
      <div
        role="status"
        // Named, so a test can find it by IDENTITY rather than by the text it is about
        // to assert. The first version of `tests/placement-banner.test.tsx` located it
        // with a regex of expected words over every `role="status"` on the page — of
        // which there are five once the real layout is mounted — so it selected the
        // element by the answer and, on a wall selection where this banner does not
        // render at all, matched the keyboard-shortcut announcer instead.
        aria-label="Placement"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          margin: '10px 16px 2px',
          padding: '9px 10px',
          border: `1px solid ${
            placementTone === 'danger' ? 'var(--danger)' : placementTone === 'warn' ? 'var(--warn)' : 'var(--edge)'
          }`,
          borderRadius: 'var(--r-2)',
          background:
            placementTone === 'danger'
              ? 'var(--danger-tint)'
              : placementTone === 'warn'
                ? 'var(--paper-3)'
                : 'var(--paper-0)',
          color:
            placementTone === 'danger'
              ? 'var(--danger-text)'
              : placementTone === 'warn'
                ? 'var(--warn-text)'
                : 'var(--success-text)',
          fontSize: 12,
          lineHeight: 1.35,
          // The tell is the ICON and the words; the colour is the third signal, not the
          // only one. And `minWidth: 0` on the text so a long piece name ellipsises
          // rather than pushing the rail out — the rail is `overflow: hidden`, so a
          // spill here is silent.
        }}
      >
        {/* `check` / `info`, which is the pair the room health chip itself uses for
            the same two states (`RoomTools`). Matching it rather than reaching for a
            warning triangle keeps one visual vocabulary for "this room is fine" and
            "this room has something to say", and avoids adding an `IconName` for a
            single call site. */}
        <Icon name={placementOk ? 'check' : 'info'} size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{placementLabel}</strong>
          <span style={{ color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{placementDetail}</span>
        </span>
      </div>

      {/* ── The decorating decisions, folded to a line each ────────────────── */}
      <PaintPicker
        label="Colour"
        value={part.color}
        // Shape AND category: the swatch has to be the exact colour the renderer
        // falls back to, and within one category the shapes do not match (a
        // dining chair is walnut, an office chair is charcoal).
        fallback={defaultBodyColor(part.category, part.shape)}
        fallbackNote="Default for this piece"
        onChange={(c) => updatePart(id!, { color: c })}
        onReset={() => updatePart(id!, { color: undefined })}
        // Finish rides inside the Colour disclosure — the second half of the same
        // "how does this material read" decision — and its choice joins the
        // collapsed row's summary so it stays visible without its own section.
        finishLabel={part.finish && part.finish !== 'auto' ? FINISH_LABEL[part.finish] : undefined}
        extra={<FinishChips value={part.finish} onChange={(f) => updatePart(id!, { finish: f })} />}
      />

      {isLightFixture(part.shape) && (
        <LightControls part={part} onChange={(light) => updatePart(id!, { light })} />
      )}

      {supportsDecor(part.category, part.shape) && (
        <DecorCollection part={part} onChange={(decor) => updatePart(id!, { decor })} />
      )}

      {/* Placement — surfaced as visible buttons (was buried in a ⋯ menu).

          No label. It read "Where it sits", and the user's verdict after looking at
          the real thing was that the section is redundant and takes too much
          horizontal space. The heading was the redundant half: every button in the row
          says where the piece will sit, in a word, and each one's `title` says it
          again in a sentence. The horizontal half is answered below. */}
      <div className="section section--flush">
        {/* Two buttons for a piece that stands on the floor, THREE only when there is
            something under it to stand on instead, and none for a piece fixed to the
            building.

            The third button was unconditional, and for most pieces it was the second
            button again: with nothing underneath, `snapToSurface` is `groundToFloor`
            line for line — y = 0, clear the parent. They differ in exactly one case,
            which is real but rare: something IS below and you want the piece on the
            floor rather than on it, which no drag can express, since dragging it clear
            moves it in x/z. So Floor appears exactly when it has that to offer, and
            `supportBelow()` is the same call the action makes.

            Not icons-only — the other way out the user offered. Three icon+word
            buttons at 33% is what does not fit; two at 50% does, and stripping the
            words to keep a button that should not be there would fix the symptom,
            keep the cause, and take on an accessible-name obligation for nothing.

            A wall-mounted part gets none of them: it has nowhere else to be put —
            "Wall" moves it along the wall it is already on, which reads as an action
            and is barely one — and for the ceiling family it is worse than useless,
            since `snapToWallPhys` would slide a ceiling fan sideways onto a wall.
            What those parts get instead is the one number that does mean something
            about where they sit, below.

            `rail-triple` stays on the wrapper either way: it is the hook the elastic
            rail's container query reflows, and the three-button case still needs it. */}
        {!part.wallMounted && (() => {
          const standingOn = supportBelow();
          // The piece it would land on, by name. `findSupportDetailed` returns only
          // { id, y }, so the name comes from the resolved world the probe was run
          // against — the same list, so the two cannot disagree about which piece
          // that id is.
          const ontoName = standingOn
            ? (effParts.find((q) => q.id === standingOn.id)?.name ?? 'the surface below')
            : null;
          const cols = standingOn ? 3 : 2;
          return (
            <div className="rail-triple" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
              <button onClick={snapToNearestWall} className="ds-btn" title="Move to the nearest wall and face the room" style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
                <Icon name="snap-wall" size={13} /> Wall
              </button>
              {standingOn ? (
                <button onClick={snapToSurface} className="ds-btn" title={`Drop onto ${ontoName}`} style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
                  <Icon name="snap-surface" size={13} /> Surface
                </button>
              ) : null}
              {/* `groundToFloor` in both cases, and it is the honest one: when there is
                  nothing below, "put this on the floor" is the whole of what the other
                  button did too, so labelling it Surface described a surface that is
                  not there. */}
              <button onClick={groundToFloor} className="ds-btn" title="Put this piece on the floor" style={{ height: 32, fontSize: 11, gap: 6, justifyContent: 'center' }}>
                <Icon name="snap-floor" size={13} /> Floor
              </button>
            </div>
          );
        })()}
        {part.wallMounted && (
          <MountHeightRow
            key={`${id}-${currentXYZ()[1]}`}
            bottomMM={(currentXYZ()[1] - part.dimMM[2] / 2000) * 1000}
            // …minus the pad the commit below keeps, or the field advertises a
            // maximum it will not accept: typing it silently committed 20 mm less.
            maxBottomMM={(room.height - part.dimMM[2] / 1000 - MOUNT_PAD) * 1000}
            onCommit={(bottomMM) => {
              const [x, , z] = currentXYZ();
              const h = part!.dimMM[2] / 1000;
              const y = Math.max(h / 2 + MOUNT_PAD, Math.min(room.height - h / 2 - MOUNT_PAD, bottomMM / 1000 + h / 2));
              setPosition(id!, [x, y, z]);
            }}
          />
        )}
      </div>

      {/* One entry point to the model library. Generic-box parts (low-confidence
          detections) read poorly, so for those the same button leads with why. */}
      <div className="section section--flush" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={() => setSwapOpen(true)}
          className={isGeneric ? 'ds-btn' : 'ds-btn ds-btn--primary'}
          title="Pick a different model from the library"
          style={{
            width: '100%',
            height: 34,
            fontSize: 12,
            gap: 6,
            justifyContent: 'center',
            ...(isGeneric
              ? { background: 'var(--accent-tint)', borderColor: 'var(--accent-text)', color: 'var(--accent-text)' }
              : null),
          }}
        >
          <Icon name="swap" size={13} />
          {isGeneric ? 'Generic shape — pick a real model' : 'Change the model'}
        </button>
        {hasOverrides && (
          <button
            onClick={() => resetTransforms(id!)}
            className="ds-btn"
            title="Undo the moves, turns and resizes you made to this piece"
            style={{ width: '100%', height: 30, gap: 6, justifyContent: 'center', fontSize: 11 }}
          >
            <Icon name="refresh" size={12} /> Back to where it started
          </button>
        )}
      </div>

      {/* Precise millimetres last, folded away — and the plain-language size tier
          stays on screen either way, because that clamp is the app's promise that
          nothing can end up a fantasy size. */}
      <DimensionEditor partId={id} category={part.category} shape={part.shape} value={currentDim} defaultDim={defaultDim} onChange={(d) => setDim(id, d)} />

      {swapOpen && (
        <SwapModelModal part={part} onClose={() => setSwapOpen(false)} onSwap={swapModel} />
      )}
    </div>
  );
}

// Surface finish — the material *sheen* (roughness/metalness), distinct from
// colour. Applied to the part's meshes by Draggable's FinishApplier. 'auto'
// keeps each shape's hand-tuned default.
const SURFACE_FINISHES: Array<{ id: NonNullable<ScenePart['finish']>; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'matte', label: 'Matte' },
  { id: 'satin', label: 'Satin' },
  { id: 'polished', label: 'Polished' },
  { id: 'metal', label: 'Metal' },
];

const FINISH_LABEL = Object.fromEntries(SURFACE_FINISHES.map((f) => [f.id, f.label])) as Record<
  NonNullable<ScenePart['finish']>,
  string
>;

// The five sheens as chips — but never a section of their own again. Finish is
// the second half of the Colour decision (how the same paint reads under
// light), so the chips live inside the Colour disclosure under their own
// mini-label, and the chosen one is named in the Colour row's summary.
function FinishChips({
  value,
  onChange,
}: {
  value?: ScenePart['finish'];
  onChange: (f: ScenePart['finish']) => void;
}) {
  const active = value ?? 'auto';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {SURFACE_FINISHES.map((f) => {
        const on = active === f.id;
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            aria-pressed={on}
            className={`ds-chip ${on ? 'ds-chip--accent' : ''}`}
            style={{ cursor: 'pointer', height: 28, fontWeight: 600, background: on ? 'var(--accent-tint)' : 'var(--paper)' }}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

// What a fixture emits, in the units printed on the box it came in. Shown only
// for lamps (isLightFixture), because everything else emits nothing.
//
// Real units are the point: 800 lm really is twice 400 lm in the scene, and 2700 K
// really is a warm bulb. The alternative — an abstract 0-to-1 "brightness" — would
// have made this another slider to fiddle with rather than a decision about a
// lamp you could go and buy.
const WARMTHS: Array<{ k: number; label: string }> = [
  { k: 2200, label: 'Candle' },
  { k: 2700, label: 'Warm' },
  { k: 4000, label: 'Neutral' },
  { k: 6500, label: 'Daylight' },
];

function LightControls({
  part,
  onChange,
}: {
  part: ScenePart;
  onChange: (light: PartLight) => void;
}) {
  const spec = lightFor(part);
  if (!spec) return null;
  const set = (patch: Partial<PartLight>) => onChange({ ...spec, ...patch });
  return (
    <Section label="Light">
      {/* Wraps, and the field shrinks — defensively, not because this row was
          measured overflowing. Flat it is 66 + 8 + 104 + 8 + 'lm' ≈ 201px of
          FIXED content, against ~228px of usable width at the narrowest rail that
          ships (`--rail-right-min` 276px, less its border, the section's 16px
          either side and a vertical scrollbar). 27px of margin, and no margin at
          all if the label's font or the unit ever grows.

          `--rail-right-tight` (248px) is NOT the number to check against, but not
          for the reason this comment used to give. It said the token "is applied to
          nothing"; `DockedShell` applies it for the whole `compact` step, through a
          template string that a grep for the token name cannot see. The reason is
          narrower: 276px is the narrowest a rail gets in the layout this row was
          sized for, and a laptop at 248px is a band whose contents nobody has
          measured this row against.

          This comment said 248 in its first version and concluded the row
          overflowed by a pixel, which was wrong in a way that would have sent the
          next reader hunting the wrong row. The panel's stray horizontal scrollbar
          is real and its cause is NOT identified here — it needs
          `scrollWidth > clientWidth` read off the live box, which no test in this
          repo can do. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <label htmlFor={`lm-${part.id}`} style={{ fontSize: 12, color: 'var(--ink-2)', minWidth: 66, flex: '0 1 auto' }}>
          Brightness
        </label>
        <NumberField
          value={String(spec.lumens)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) set({ lumens: n });
          }}
          step={50}
          min={0}
          max={5000}
          height={30}
          ariaLabel="Brightness in lumens"
          style={{ width: 104, maxWidth: '100%', minWidth: 0 }}
        />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>lm</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {WARMTHS.map((w) => {
          const on = spec.kelvin === w.k;
          return (
            <button
              key={w.k}
              onClick={() => set({ kelvin: w.k })}
              aria-pressed={on}
              className={`ds-chip ${on ? 'ds-chip--accent' : ''}`}
              style={{ cursor: 'pointer', height: 28, fontWeight: 600, background: on ? 'var(--accent-tint)' : 'var(--paper)' }}
            >
              {w.label}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
        A typical bulb is 400–800 lm. Switch the room to Evening to see what this
        one actually does.
      </p>
    </Section>
  );
}

// Editable decor collection on a part's surface. Starts from the suggested
// arrangement; the user can add props, remove them, clear, or reset to auto.
const DECOR_LABEL: Record<DecorKind, string> = {
  books: 'Books', vase: 'Vase', plant: 'Plant', bowl: 'Bowl', candle: 'Candle',
};
function DecorCollection({ part, onChange }: { part: ScenePart; onChange: (decor: DecorItem[] | undefined) => void }) {
  const isAuto = part.decor === undefined;
  const items = part.decor ?? autoSurfaceDecor(part.category, part.shape, part.dimMM, part.id);
  const w = part.dimMM[0] / 1000;
  const d = part.dimMM[1] / 1000;

  function add(kind: DecorKind) {
    const next: DecorItem = {
      id: `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      kind,
      x: (Math.random() - 0.5) * w * 0.66,
      z: (Math.random() - 0.5) * d * 0.55,
    };
    onChange([...items, next]); // materialises the suggested set, then appends
  }

  // The collapsed row's summary — derived, never typed (RailSection's contract
  // for its meta). "Suggested" has to stay visible while the props are still
  // the auto set: someone who never opens this should still learn that the
  // arrangement is editable rather than fixed.
  const summary = isAuto
    ? items.length > 0
      ? `Suggested · ${items.length}`
      : 'None'
    : items.length > 0
      ? `${items.length}`
      : 'Bare';
  const [open, setOpen] = useState(false);

  return (
    <RailSection title="On the surface" meta={summary} open={open} onToggle={() => setOpen((v) => !v)}>
      {isAuto && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Showing suggested props. Add or remove to make it your own.
        </div>
      )}
      {items.length === 0 && !isAuto && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Bare surface. Add something below, or go back to the suggestion.
        </div>
      )}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {items.map((it) => (
            <div key={it.id} className="list-row" style={{ cursor: 'default', padding: '5px 8px', background: 'var(--paper-2)' }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{DECOR_LABEL[it.kind]}</span>
              <IconButton
                icon="x"
                label={`Remove ${DECOR_LABEL[it.kind].toLowerCase()}`}
                onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                size={24}
                iconSize={12}
              />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {DECOR_KINDS.map((k) => (
          <button key={k} onClick={() => add(k)} className="ds-chip" style={{ cursor: 'pointer', height: 28, fontWeight: 600 }}>
            <Icon name="plus" size={11} /> {DECOR_LABEL[k]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => onChange([])} className="ds-btn" style={{ flex: 1, height: 28, fontSize: 11, justifyContent: 'center' }}>
          Clear
        </button>
        {!isAuto && (
          <button onClick={() => onChange(undefined)} className="ds-btn" style={{ flex: 1, height: 28, fontSize: 11, justifyContent: 'center' }}>
            <Icon name="refresh" size={10} /> Suggested
          </button>
        )}
      </div>
    </RailSection>
  );
}

// Compass label for a wall from its inward normal (wallSegments yaw encodes it).
// Falls back to "Wall n" for the extra edges of L / T / U footprints.
function wallName(yaw: number, index: number, edgeCount: number): string {
  if (edgeCount !== 4) return `Wall ${index + 1}`;
  const inX = Math.sin(yaw);
  const inZ = Math.cos(yaw);
  if (Math.abs(inZ) >= Math.abs(inX)) return inZ > 0 ? 'North wall' : 'South wall';
  return inX > 0 ? 'West wall' : 'East wall';
}

// Wall editor — shown when a wall is selected instead of a part. Paint one wall
// or all walls, reset, and nudge the wall in/out (drag in the 3D / plan views is
// the primary move affordance; these buttons are the precise fallback).
function WallInspector({ index }: { index: number }) {
  const room = useScene((s) => s.room);
  const setWallColor = useScene((s) => s.setWallColor);
  const setAllWallColors = useScene((s) => s.setAllWallColors);
  const resetWallColor = useScene((s) => s.resetWallColor);

  const segs = wallSegments(room.footprint);
  const seg = segs[index];
  const name = seg ? wallName(seg.yaw, index, room.footprint.length) : `Wall ${index + 1}`;
  const painted = room.wallColors?.[index] !== undefined;
  const current = room.wallColors?.[index] ?? SCENE.wall;

  return (
    <div className="rail-scroll" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%', minWidth: 0 }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
          {seg ? (
            <>
              <span className="mono">{seg.len.toFixed(2)} m</span> wide ·{' '}
              <span className="mono">{room.height.toFixed(2)} m</span> tall
            </>
          ) : null}
        </div>
      </div>

      <PaintPicker
        label="Wall colour"
        value={room.wallColors?.[index]}
        fallback={SCENE.wall}
        fallbackNote="Default shell colour"
        onChange={(hex) => setWallColor(index, hex)}
        onReset={() => resetWallColor(index)}
        footer={
          <button
            onClick={() => setAllWallColors(current)}
            className="ds-btn"
            title={painted ? 'Paint every wall this colour' : 'Paint every wall the default colour'}
            style={{ width: '100%', height: 32, fontSize: 12, justifyContent: 'center', gap: 6, marginTop: 10 }}
          >
            <Icon name="layers" size={13} /> Use this colour on every wall
          </button>
        }
      />

      {/* Move */}
      <Section label="Move wall">
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.4 }}>
          Drag the handle on the wall in the 3D or plan view — or nudge it here.
          Only this wall moves, and anything mounted on it or standing against it
          comes along.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button onClick={() => moveWallCarrying(index, 0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={12} /> Out 10 cm
          </button>
          <button onClick={() => moveWallCarrying(index, -0.1)} className="ds-btn" style={{ height: 32, fontSize: 11, justifyContent: 'center', gap: 6 }}>
            <Icon name="minus" size={12} /> In 10 cm
          </button>
        </div>
      </Section>

    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="section section--flush">
      <span className="section-title" style={{ marginBottom: 8, display: 'block' }}>{label}</span>
      {children}
    </div>
  );
}

function DimensionEditor({
  partId,
  category,
  shape,
  value,
  onChange,
  defaultDim,
}: {
  partId: string;
  category: ScenePart['category'];
  shape: ScenePart['shape'];
  value: [number, number, number];
  onChange: (d: [number, number, number]) => void;
  defaultDim: [number, number, number];
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const setDimUnit = useSettings((s) => s.setDimUnit);
  const prec = precisionFor(dimUnit);
  const step = stepFor(dimUnit);
  const range = dimRangeFor(category, shape);
  /** The bounds for one axis, in the field's own unit. ONE call, read by the
   *  stepper and by the sentence under it — they were two derivations, the arrows
   *  on `boundsToUnit` and the sentence on `formatDim`, so the sentence printed
   *  numbers the arrows could not reach: in feet a dining chair advertised
   *  1.25-1.97 wide while the stepper stopped at 1.3 and 1.9, in ~270 combinations
   *  across the catalog, with no tell that the arrow had stopped early.
   *  `RoomDimsEditor` has read one call for both since the metre/centimetre bug;
   *  this is the copy that was not converted. */
  const bound = (i: 0 | 1 | 2) => boundsToUnit(range.min[i], range.max[i], dimUnit);
  // Open by default. It was collapsed on the reasoning that typing millimetres is
  // the rare path — true of typing, and beside the point for READING: the three
  // numbers are what tells you whether the piece you just dropped is the size you
  // meant, and rule 2 of CLAUDE.md makes them the derived answer the app owes the
  // user rather than a detail to go looking for. The collapsed summary already
  // printed the same numbers, so the fold was hiding a text field and the tier
  // sentence, not the measurement — which makes "collapsed" cost a click and save
  // one line. The disclosure stays, because a rail with several sections open at
  // once still needs a way to get its height back.
  //
  // Not the same call as the room shell's, deliberately: a room's dimensions are
  // set once during onboarding, while a part's change every time you scale one.
  const [open, setOpen] = useState(true);

  // Destructured so the resync effect can depend on the three numbers rather
  // than the tuple identity — the parent rebuilds `value` every render.
  const [valW, valD, valH] = value;

  const [local, setLocal] = useState<[string, string, string]>(() => [
    fromMM(valW, dimUnit).toFixed(prec),
    fromMM(valD, dimUnit).toFixed(prec),
    fromMM(valH, dimUnit).toFixed(prec),
  ]);

  useEffect(() => {
    setLocal([
      fromMM(valW, dimUnit).toFixed(prec),
      fromMM(valD, dimUnit).toFixed(prec),
      fromMM(valH, dimUnit).toFixed(prec),
    ]);
  }, [partId, valW, valD, valH, dimUnit, prec]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function commitDebounced(idx: 0 | 1 | 2, raw: string) {
    const next = [...local] as [string, string, string];
    next[idx] = raw;
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const mm = next.map((s) => toMM(parseFloat(s), dimUnit));
      if (mm.some((n) => Number.isNaN(n) || n <= 0)) return;
      // Clamp into the shape's trustable real-world range — same gate the scale
      // gizmo and every other size path go through.
      onChange(clampDims(category, shape, [mm[0], mm[1], mm[2]]));
    }, 120);
  }

  const labels: ['Width', 'Depth', 'Height'] = ['Width', 'Depth', 'Height'];
  // The tier, in plain language: this is the promise that a size can't go silly.
  const tier =
    range.flex === 'fixed' ? 'Standard product size' : range.flex === 'standard' ? 'Typical size range' : 'Made to measure';

  return (
    <div className="section" style={{ background: 'var(--paper)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', color: 'var(--ink-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <Icon name="chevron-right" size={14} />
        </span>
        <span className="section-title" style={{ color: 'var(--ink)' }}>Exact size</span>
        {!open && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em', marginLeft: 'auto' }}>
            {local.join(' × ')} {dimUnit}
          </span>
        )}
      </button>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, paddingLeft: 22 }}>{tier}</div>

      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
            {labels.map((axis, i) => (
              <label key={axis} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>{axis}</span>
                {/* .field owns the border + focus ring; mono is here only because
                    these are measurements. The stepper is ours — the native one
                    is suppressed app-wide (see globals.css). */}
                {/* Bounded by the piece's OWN range, in the field's own unit — the
                    same numbers `clampDims` enforces on commit and the same ones the
                    sentence below prints, so the arrows stop where the clamp would
                    have stopped them instead of walking out and snapping back.
                    `0.001` was a floor in no unit at all: a millimetre to someone
                    working in metres, a micrometre to someone in millimetres, and
                    there was no ceiling whatsoever. `boundsToUnit` rounds inward, so a
                    rounded bound can only ever be stricter than the clamp, never
                    looser — see `RoomDimsEditor`, where the same mismatch was
                    destructive rather than merely slack. The PAIR is what asks,
                    because rounding both ends of a narrow range in a coarse unit
                    collapses it (a mirror's 15-60 mm depth is 0.1 ft at both ends)
                    or inverts it (a door's 35-60 mm becomes min 0.2, max 0.1). */}
                <NumberField
                  min={bound(i as 0 | 1 | 2).min}
                  max={bound(i as 0 | 1 | 2).max}
                  step={step}
                  value={local[i]}
                  onChange={(v) => commitDebounced(i as 0 | 1 | 2, v)}
                  height={34}
                />
              </label>
            ))}
          </div>

          {/* The values every edit is clamped into. */}
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.6 }}>
            Anything you type lands inside{' '}
            <span className="mono">
              {bound(0).min}–{bound(0).max} wide ·{' '}
              {bound(1).min}–{bound(1).max} deep ·{' '}
              {bound(2).min}–{bound(2).max} tall
            </span>{' '}
            ({dimUnit}).
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {/* One display unit for the whole app — Settings owns it, and this is
                the same preference, labelled, where the numbers actually are. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-2)', fontWeight: 600 }}>
              Units
              <Select
                value={dimUnit}
                onChange={(u) => setDimUnit(u as DimUnit)}
                options={UNIT_OPTIONS.map((u) => ({ value: u.id, label: u.label, short: u.id }))}
                ariaLabel="Display units"
                title="Applies everywhere in Danmu"
                width={64}
                height={26}
                fontSize={11}
              />
            </label>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => onChange(defaultDim)}
              className="ds-btn ds-btn--ghost"
              title="Back to the size it came with"
              style={{ height: 26, padding: '0 8px', fontSize: 11, fontWeight: 600, color: 'var(--accent-text)', gap: 4 }}
            >
              <Icon name="refresh" size={11} /> Original size
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Curated palette — named, and ORDERED in three runs of eight: neutrals, then
// woods & metals, then colours.
//
// Three runs, not three labelled groups. The labels cost a caption and a gap each
// and told nobody anything a swatch does not — neutrals look neutral — while the
// run length is 8 and the grid is 8 or 6 wide, so each run is exactly one row and
// the grouping draws itself. At 6 the merged block still tiles (24 = 6 × 4); it was
// the SEPARATED version that went ragged there, three groups of 6 + 2.
//
// The names are what a screen reader announces and what the tooltip shows: "#E8E5DB"
// told nobody anything. 8 columns keeps every target ≥ 32px in a 320px rail.
type Swatch = { hex: string; name: string };
const SWATCHES: Swatch[] = [
  // Neutrals
  { hex: '#E8E5DB', name: 'Chalk' },
  { hex: '#EDE6D6', name: 'Cream' },
  { hex: '#D6C7AE', name: 'Linen' },
  { hex: '#DCE4E2', name: 'Mist' },
  { hex: '#D8C7A8', name: 'Oat' },
  { hex: '#3A3733', name: 'Charcoal' },
  { hex: '#3A3A3A', name: 'Graphite' },
  { hex: '#131311', name: 'Ink' },
  // Woods & metals
  { hex: '#C9A98E', name: 'Pale oak' },
  { hex: '#C9A87C', name: 'Warm oak' },
  { hex: '#9A6A48', name: 'Teak' },
  { hex: '#6F4A2F', name: 'Walnut' },
  { hex: '#5D3820', name: 'Espresso' },
  { hex: '#A86E5A', name: 'Clay' },
  { hex: '#B08D4F', name: 'Brass' },
  { hex: '#D8C36A', name: 'Ochre' },
  // Colours
  { hex: '#8FA98C', name: 'Sage' },
  { hex: '#5D8A5D', name: 'Fern' },
  { hex: '#A9C4C0', name: 'Eucalyptus' },
  { hex: '#6E94C8', name: 'Cornflower' },
  { hex: '#4F6D8C', name: 'Denim' },
  { hex: '#3F5670', name: 'Navy' },
  { hex: '#C57B53', name: 'Terracotta' },
  { hex: '#C44A3A', name: 'Paprika' },
];

const SWATCH_NAME = new Map(SWATCHES.map((s) => [s.hex.toLowerCase(), s.name] as const));

// One paint control, used for furniture AND for walls — the two used to be
// separate 24-swatch grids that could drift apart.
//
// The palette is a decision to make, not a state to watch, so it lives behind
// the rail's standard disclosure. Collapsed, the row is one glanceable summary
// — swatch, colour name, finish — and the 24 swatches, the finish chips and the
// custom mixer are one click away instead of permanently on screen. The
// summary is RailSection's `meta`, derived here so no call site types it.
function PaintPicker({
  label,
  value,
  fallback,
  fallbackNote,
  onChange,
  onReset,
  footer,
  finishLabel,
  extra,
}: {
  label: string;
  /** the user's chosen colour, or undefined while the default applies */
  value?: string;
  /** colour actually on screen when `value` is unset */
  fallback: string;
  fallbackNote: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  footer?: React.ReactNode;
  /** a non-auto finish to name in the summary (parts; walls have no sheen) */
  finishLabel?: string;
  /** body content after the swatch groups — the finish chips for parts */
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mixing, setMixing] = useState(false);
  const current = value ?? fallback;
  const named = value ? SWATCH_NAME.get(value.toLowerCase()) : undefined;

  return (
    <RailSection
      title={label}
      open={open}
      onToggle={() => {
        // Collapsing unmounts the body, which takes the mixer's popover with it;
        // drop `mixing` too, or re-opening the row resurrects a popover the user
        // dismissed by folding rather than by closing it.
        if (open) setMixing(false);
        setOpen((v) => !v);
      }}
      meta={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* The dot is half the point of the summary: the colour itself, no words. */}
          <span
            aria-hidden="true"
            style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 'var(--r-1)', border: '1px solid var(--edge)', background: current }}
          />
          <span style={{ color: value ? 'var(--ink)' : 'var(--ink-3)' }}>
            {value ? (
              named ?? <span className="mono" style={{ letterSpacing: '0.04em' }}>{value.toUpperCase()}</span>
            ) : (
              fallbackNote
            )}
            {finishLabel && <span style={{ color: 'var(--ink-3)' }}> · {finishLabel}</span>}
          </span>
        </span>
      }
    >
      {/* ONE grid, not three captioned ones. Eight columns, and the elastic rail's
          container query is what drops it to six — an `auto-fit` here would also
          have changed the count on a WIDE rail (nine or ten per row), which is a
          redesign of a shipping panel rather than a reflow of a cramped one.

          Either count divides 24, so the three runs of the palette still land as
          whole rows and the grouping reads without three labels and three gaps
          paying for it. `role="group"` + the section's own title is what a screen
          reader gets instead; each swatch already announces its name. */}
      <div
        role="group"
        aria-label={`${label} swatches`}
        className="rail-swatches"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, paddingTop: 2 }}
      >
        {SWATCHES.map((s) => {
          const on = value?.toLowerCase() === s.hex.toLowerCase();
          return (
            <button
              key={s.hex}
              onClick={() => onChange(s.hex)}
              title={s.name}
              aria-label={s.name}
              aria-pressed={on}
              className={`swatch${on ? ' is-selected' : ''}`}
              style={{ background: s.hex }}
            />
          );
        })}
      </div>

      {extra && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6 }}>Finish</div>
          {extra}
        </div>
      )}

      {/* The two rare paths — a bespoke colour, and the way back — share the last
          row of the open panel. The mixer used to hide behind the swatch itself,
          which read as "this swatch does something" with no hint of what. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, position: 'relative' }}>
        <button
          onClick={() => setMixing((o) => !o)}
          aria-expanded={mixing}
          title="Mix a custom colour"
          className="ds-btn"
          style={{ flex: 1, height: 28, fontSize: 11, justifyContent: 'center', gap: 6, minWidth: 0 }}
        >
          <Icon name="edit" size={11} /> Mix a custom colour
        </button>
        {value && (
          <button
            onClick={onReset}
            className="ds-btn"
            title="Back to the default colour"
            style={{ height: 28, padding: '0 10px', fontSize: 11, fontWeight: 600, color: 'var(--accent-text)', gap: 4, flexShrink: 0 }}
          >
            <Icon name="refresh" size={11} /> Default
          </button>
        )}
        {/* Brand-styled mixer (replaces the unthemeable native <input type=color>). */}
        {mixing && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-popover)' }} onClick={() => setMixing(false)} />
            <div className="popover" style={{ position: 'absolute', top: 36, left: 0, right: 0, zIndex: 'var(--z-popover)', padding: 12 }}>
              <ColorPicker value={current} onChange={onChange} />
            </div>
          </>
        )}
      </div>

      {footer && <div style={{ marginTop: 10 }}>{footer}</div>}
    </RailSection>
  );
}

// Numeric mount-height editor for wall/ceiling-mounted parts — bottom edge
// height off the floor, in the user's display unit. Pairs with the gizmo's
// Y axis (drag preserves whatever height is set here).
function MountHeightRow({
  bottomMM,
  maxBottomMM,
  onCommit,
}: {
  bottomMM: number;
  maxBottomMM: number;
  onCommit: (bottomMM: number) => void;
}) {
  const dimUnit = useSettings((s) => s.dimUnit);
  const [draft, setDraft] = useState(() => formatDim(Math.max(0, bottomMM), dimUnit));
  useEffect(() => {
    setDraft(formatDim(Math.max(0, bottomMM), dimUnit));
  }, [bottomMM, dimUnit]);

  // A piece TALLER than the room has no legal mount height at all, and the caller
  // hands that over as a negative `maxBottomMM` (`room.height - dimMM[2]/1000`).
  // The commit line used to read
  //     Math.max(0, Math.min(maxBottomMM, toMM(v, dimUnit)))
  // — min against a negative max, then max against 0 — so every number typed came
  // back 0 and the field snapped to 0 with nothing said. That is the crossed-
  // interval failure `boundsToUnit` was written for, one control along: two bounds
  // that have inverted, the wrong one applied last, and every entry landing on the
  // same end. Lower a room to the 1.8 m floor with the default 2.2 m curtain in it
  // and this field is simply dead for that piece — which was the second half of
  // "the curtain doesn't reduce when the room height is reduced, and it doesn't
  // state anything as the reason". `lib/clearance.ts` §7 says WHY in the room
  // report; this says it where the number is being typed.
  const fits = maxBottomMM > 0;
  // NOT `boundsToUnit`, and the first version of this used it. That function
  // exists to bound a STEPPER: it rounds each end toward the interior so the
  // arrows cannot reach a number the commit would refuse. This control has no
  // stepper. What it needs is an exact comparison and a formatted display, and
  // using the rounded pair for both is what put a raw float on screen — the
  // collapse guard falls back to unrounded `fromMM` when rounding has inverted
  // the interval, so a 1790 mm piece under an 1800 mm ceiling rendered
  // "0–0.03280839895013123 ft under this ceiling."  Found by danmu-62 in review,
  // and it is the same class as the defect this whole row was written to fix: a
  // bound crossing into a control in the wrong shape. The window is under
  // 15.24 mm of headroom and it is in FEET, which is where all fourteen of the
  // earlier bound defects lived.
  //
  // So compare in MILLIMETRES, where the arithmetic is exact and nothing rounds,
  // and display through `formatDim` — which is what the size range two hundred
  // lines above this already does.
  const typedMM = toMM(parseFloat(draft), dimUnit);
  // DERIVED, not stored. A `useState` flag here would be cleared by the resync
  // effect above the moment the commit moved the piece — the message would
  // announce the clamp and erase itself in the same tick — and would then outlive
  // its subject on a unit change, which is the pair of faults `RoomDimsEditor`
  // already carries a comment about. Reading the draft answers both for free, and
  // says it while the number is still being typed rather than after the snap.
  const outOfRange = fits && Number.isFinite(typedMM) && (typedMM < 0 || typedMM > maxBottomMM);
  // A range narrower than one step of the display unit is not a range. Quoting it
  // as one is true and useless — "0–0.03 ft" for a centimetre of headroom — so say
  // the thing the number was standing in for.
  const noRoom = fits && fromMM(maxBottomMM, dimUnit) < stepFor(dimUnit);

  function commit() {
    const v = parseFloat(draft);
    if (!Number.isFinite(v)) return setDraft(formatDim(Math.max(0, bottomMM), dimUnit));
    if (!fits) return;
    onCommit(Math.max(0, Math.min(maxBottomMM, toMM(v, dimUnit))));
  }

  return (
    <div style={{ marginTop: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* `minWidth: 0` because this is the flex item that should ellipsise —
            rule 4 names it, and a `flex: 1` box with no min-width sizes to its
            content rather than to the space there is. Its min-content here is
            only "Height" at 11px, so it was never this row's overflow source,
            but it is the property the rule is about and this is the branch that
            lands. Asked for by danmu-62, who reverted their own copy of the line
            so the two of us are not both editing it. */}
        <span style={{ fontSize: 11, color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>Height off the floor</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          className="field"
          disabled={!fits}
          aria-invalid={!fits || outOfRange}
          style={{ width: 72, height: 28, fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}
        />
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{dimUnit}</span>
      </label>
      {(!fits || outOfRange || noRoom) && (
        // `noRoom` is not a fault — the piece fits and simply has nowhere to go —
        // so it reads as information rather than as an error.
        <div style={{ fontSize: 10.5, lineHeight: 1.4, marginTop: 4, color: !fits || outOfRange ? 'var(--danger-text)' : 'var(--ink-3)' }}>
          {!fits
            ? 'Taller than the room — there is no height it can hang at. Room check says by how much.'
            : outOfRange
              ? `0–${formatDim(maxBottomMM, dimUnit)} ${dimUnit} under this ceiling.`
              : 'It only just fits — there is no room to move it under this ceiling.'}
        </div>
      )}
    </div>
  );
}

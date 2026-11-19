'use client';

// One row of the scan review's "Your pieces" list. It shares a colour with its box on the
// photo (`--piece`), and the screen's one hovered piece (`highlighted`) is drawn the same
// way on both sides — see `.piece-row` / `.piece-box` in globals.css.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CAPTURE_SLOTS } from '@/lib/capture';
import type { CaptureSlot } from '@/lib/storage';
import type { Detection } from '@/lib/detection';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EditableText, IconButton } from '@/components/ui/primitives';
import { Select } from '@/components/ui/Select';
import { PART_LIBRARY, sceneShapeFor } from '@/lib/scene-spec';
import { sourceLabel, sourceOf } from '@/lib/detect-confidence';
import { cleanLabelOf } from '@/lib/detection-record';
import type { LabelCandidate } from '@/lib/label-repair';
import { pieceColor } from '@/lib/piece-colors';

/** One shared empty list, so a row with no offer is handed the same reference every
 *  render rather than a fresh `[]`. */
export const EMPTY_OFFER: LabelCandidate[] = [];

// The by-hand path needs a name for the thing being drawn — the geometry engine
// takes the category for its depth default and anchor, and the label is what the
// user sees in the studio. Wording is a decorator's, not the model's enum.
export const MANUAL_CATEGORIES: { value: Detection['category']; label: string }[] = [
  { value: 'sofa', label: 'Sofa' },
  { value: 'chair', label: 'Chair' },
  { value: 'table', label: 'Table' },
  { value: 'desk', label: 'Desk' },
  { value: 'bed', label: 'Bed' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'shelf', label: 'Shelf' },
  { value: 'nightstand', label: 'Bedside table' },
  { value: 'ottoman', label: 'Footstool' },
  { value: 'tv', label: 'TV' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'lamp', label: 'Lamp' },
  { value: 'plant', label: 'Plant' },
  { value: 'rug', label: 'Rug' },
  { value: 'mirror', label: 'Mirror' },
  { value: 'painting', label: 'Picture' },
  { value: 'curtain', label: 'Curtain' },
  { value: 'fridge', label: 'Fridge' },
  { value: 'fan', label: 'Fan' },
  { value: 'ac', label: 'Air conditioner' },
  { value: 'door', label: 'Door' },
  { value: 'other', label: 'Something else' },
];

// Wall names come from the capture step, so the two screens can never disagree
// about what the user photographed. The n/e/s/w ids stay; only labels are human.
export function slotLabel(slot: CaptureSlot): string {
  return CAPTURE_SLOTS.find((c) => c.id === slot)?.label ?? slot.toUpperCase();
}

/** "Wall 2", "Wall 2 and Wall 3", "Wall 2, Wall 3 and Wall 4". */
function wallList(slots: readonly CaptureSlot[]): string {
  const names = slots.map(slotLabel);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A piece's name mid-sentence: "the bed", but "the TV". */
function inSentence(label: string): string {
  return /^.[A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export function categoryLabel(cat?: string): string {
  return MANUAL_CATEGORIES.find((c) => c.value === cat)?.label ?? 'Furniture';
}

/** What a repair is called on its chip and on the row once accepted: its kind's own
 *  name when it was measured as one ("Double bed"), else its category's. */
export function candidateLabel(cand: LabelCandidate): string {
  return cand.name ?? categoryLabel(cand.category);
}

/** A line under a row's name saying why the row is as it is. One markup for every
 *  such line, so two of them under one name cannot drift apart. Wraps rather than
 *  clips: a sentence holding a piece name is as long as the name makes it. */
function RowNote({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="t-hint" style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginTop: 3, lineHeight: 1.45 }}>
      <Icon name={icon} size={11} style={{ flex: '0 0 auto', marginTop: 2 }} />
      <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  );
}

export function DetectionRow({
  d,
  confirmed,
  repeatOf,
  doubted,
  photoDoubted = false,
  highlighted,
  scrollWhenHovered,
  index,
  onThisPhoto,
  onToggle,
  onRename,
  suggestModels,
  onRepair,
  onDismissOffer,
  offer,
  onDelete,
  onLink,
  onShow,
  sameAs,
  alsoSeenOn,
  linkOptions,
  onLinkTo,
  onUnlink,
  onConfirmRepeat,
}: {
  d: Detection;
  /** Whether this row's PIECE is in the room. For a linked row that is the tick of the
   *  row it is linked to (`pieceRow`), not its own, which is always off. */
  confirmed: boolean;
  /** The row this one is probably a second sighting of — see
   *  lib/repeat-sightings.ts. Null for a piece in its own right. */
  repeatOf: Detection | null;
  /** The size the photo gives this piece is outside its model's range
   *  (`judgeLabels` said suspect), which is why it started unticked. The note says
   *  SIZE, not "does not look like": in a field test of 88 such rows about a third
   *  were wrong words (sockets called picture frames) and two thirds right ones read
   *  at the wrong size, from photos taken away from the room's centre — so the note
   *  names what was measured and leaves the person to judge which it is. */
  doubted: boolean;
  /** Most pieces in this row's PHOTO read the wrong size (`photosInDoubt`), so the
   *  camera is the likelier culprit and the note blames the photo, not the word. */
  photoDoubted?: boolean;
  /** This row is the screen's one hovered piece (from the row or from its box). */
  highlighted: boolean;
  /** The hover started on the photo, so the row is brought into view; one the pointer
   *  is already on is not scrolled out from under it. */
  scrollWhenHovered: boolean;
  /** Position in the review's list, which is what picks the piece's colour. */
  index: number;
  onThisPhoto: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
  /** Models the name being typed matches, recomputed per keystroke (`suggestFromLabel`). */
  suggestModels: (draft: string) => LabelCandidate[];
  /** `keep` is true when the person chose the model from what they typed, in the list
   *  or the offer under the name: they named the piece, so it is one they want. */
  onRepair: (cand: LabelCandidate, keep?: boolean) => void;
  /** Models the piece’s current NAME suggests, best first — see suggestFromLabel.
   *  Empty for every row but the one just renamed. */
  offer: LabelCandidate[];
  onDismissOffer: () => void;
  onDelete: () => void;
  onLink: (on: boolean) => void;
  onShow: () => void;
  /** The row the PERSON said this one repeats (`lib/sighting-links.ts`). Unlike
   *  `repeatOf`, which is the app's guess, this is settled: the row is not built. */
  sameAs: Detection | null;
  /** The walls of the rows linked to this one, so the kept piece says it was seen
   *  more than once. Empty for most rows. */
  alsoSeenOn: readonly CaptureSlot[];
  /** Rows this one could be linked to, best first (`linkCandidates`), already named.
   *  Empty hides the control. */
  linkOptions: readonly { index: number; label: string }[];
  onLinkTo: (index: number) => void;
  onUnlink: () => void;
  /** "Same" on the guessed repeat: link this row to `repeatOf`. */
  onConfirmRepeat: () => void;
}) {
  const label = cleanLabelOf(d);
  const rowRef = useRef<HTMLDivElement>(null);
  // `nearest` and no focus move: a row already on screen stays put, and one off screen
  // is brought just far enough to be seen.
  useEffect(() => {
    if (highlighted && scrollWhenHovered) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, scrollWhenHovered]);
  /** The suggestions the name field is showing, so a pick resolves to the same
   *  candidate the person saw rather than one recomputed from a later draft. */
  const shown = useRef<LabelCandidate[]>([]);
  /** The "same as" picker is open in place of the row's note. */
  const [linking, setLinking] = useState(false);
  // The MODEL this row becomes, by the studio's own rule (`sceneShapeFor`), named as
  // the Library names it. It said the category, so a row renamed "Shoe rack" still
  // read "Shelf" while the studio was in fact going to build the shoe rack, and a
  // rename looked like it changed nothing but the word.
  // A linked row is never built, so the model it names is the one its piece is built
  // as: the row it is linked to. Naming its own would show a model the room never gets.
  const piece = sameAs ?? d;
  const modelName =
    PART_LIBRARY.find((r) => r.shape === sceneShapeFor(piece.category, cleanLabelOf(piece), piece.shape))?.label ??
    categoryLabel(piece.category);
  const keepTitle = sameAs
    ? confirmed
      ? `Kept: built once, as the ${inSentence(cleanLabelOf(sameAs))} on ${slotLabel(sameAs.slot)}. Press to leave it out`
      : `Left out, with the ${inSentence(cleanLabelOf(sameAs))} on ${slotLabel(sameAs.slot)}. Press to put it back`
    : confirmed
      ? 'Kept: this piece goes into your room at a typical size'
      : 'Not kept: it stays on this list and out of your room';
  return (
    // Hover AND focus drive the same highlight, so a keyboard user gets the
    // row↔photo link too. onFocus/onBlur bubble from the child buttons.
    <div
      ref={rowRef}
      className="piece-row"
      data-piece-row={index}
      data-hovered={highlighted}
      data-kept={confirmed}
      onMouseEnter={() => onLink(true)}
      onMouseLeave={() => onLink(false)}
      onFocus={() => onLink(true)}
      onBlur={() => onLink(false)}
      style={{
        '--piece': pieceColor(index),
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
      } as CSSProperties}
    >
      {/* The row's colour, quietly: a round dot in the piece's own colour, the same one its
          box and tag wear on the photo. Decoration, so hidden from assistive tech. */}
      <span className="piece-row__dot" aria-hidden="true" />
      {/* Was the whole row as a `div onClick`: unreachable by keyboard and with
          no state announced. Now a real toggle with aria-pressed. */}
      {/* Reads as a checkbox, because that is what it is: an empty box when left out,
          a ticked fill when kept. It drew a "+" when left out, which reads as "add
          another", and the list already has a button for that. */}
      <IconButton
        icon="check"
        label={`Keep ${label}`}
        title={keepTitle}
        active={confirmed}
        onClick={onToggle}
        variant="outline"
        size={28}
        iconSize={13}
        style={
          confirmed
            ? { background: 'var(--locked-tint)', color: 'var(--locked)', borderColor: 'var(--locked)' }
            : { color: 'transparent' }
        }
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <EditableText
          value={label}
          onCommit={onRename}
          // As the name is typed, the models it matches: picking one changes the MODEL,
          // not only the word, which is what a person renaming a "bed" to "Fridge"
          // meant. Typing a name and leaving the list alone is still a plain rename,
          // with the chips below to change the model afterwards.
          suggest={(draft) => {
            shown.current = suggestModels(draft).slice(0, 4);
            // Keyed on the MODEL: two models of one category (shelf, shoe rack) are
            // two options, and a category key collapsed them into one.
            return shown.current.map((c) => ({
              key: c.detection.shape ?? c.category,
              label: `${candidateLabel(c)} model`,
            }));
          }}
          onPick={(key) => {
            const cand = shown.current.find((c) => (c.detection.shape ?? c.category) === key);
            if (cand) onRepair(cand, true);
          }}
          label="Piece name"
          className="sentence-case"
          style={{ fontSize: 'var(--fs-small)', fontWeight: 600, color: 'var(--ink)', display: 'block' }}
          inputStyle={{ height: 28, fontSize: 'var(--field-fs)' }}
        />
        {/* Confidence percentages and slot codes were telemetry. What helps is
            which photo it came from and what Danmu thinks it is. */}
        <div className="t-hint">
          {/* Which wall, and "You" when the person drew the box: that is the only
              difference between rows that is theirs to act on. */}
          {[slotLabel(d.slot), sourceLabel(sourceOf(d))].filter(Boolean).join(' · ')}
        </div>
        {/* ONE line under the name at a time, the most pressing first. A row used to
            stack a link state, a question, a dropdown, a doubt and an offer, and the
            list read as a wall of small print. The order: what the person just did
            (a settled link, a model offer after a rename), then what the app asks
            (a guessed repeat), then why it started unticked, then what it knows. */}
        {linking && !sameAs && linkOptions.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, maxWidth: 260 }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              <Select
                value=""
                onChange={(v) => {
                  setLinking(false);
                  onLinkTo(Number(v));
                }}
                options={linkOptions.map((o) => ({ value: String(o.index), label: o.label }))}
                placeholder="Same as…"
                ariaLabel={`${label} is the same piece as…`}
                title="Pick the piece this is another view of, and it is built once"
                height={26}
                fontSize="var(--fs-caption)"
              />
            </div>
            <IconButton icon="x" label="Cancel" onClick={() => setLinking(false)} size={22} iconSize={11} />
          </div>
        ) : sameAs ? (
          // Settled by the person: another view of a piece already on the list, so it
          // is not built. Its tick is that piece's tick, and the line says so.
          <div className="t-hint" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3, lineHeight: 1.45 }}>
            <Icon name="link" size={11} style={{ flex: '0 0 auto' }} />
            <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
              Same {inSentence(cleanLabelOf(sameAs))} as on {slotLabel(sameAs.slot)}
              {confirmed ? ' · kept' : ' · left out'}
            </span>
            <button
              onClick={onUnlink}
              className="ds-chip"
              title="Make this its own piece again, kept"
              style={{ height: 22, fontSize: 'var(--fs-caption)', padding: '0 8px', flex: '0 0 auto', gap: 4 }}
            >
              <Icon name="unlink" size={11} />
              Unlink
            </button>
          </div>
        ) : offer.length > 0 ? (
          // A model offered because of the WORD the person typed. Accepting swaps the
          // model, built at that model's typical size.
          <div className="t-hint" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 5, lineHeight: 1.45 }}>
            <span style={{ flex: '1 1 auto', minWidth: 0 }}>
              Still the {categoryLabel(d.category).toLowerCase()} model
            </span>
            {offer.slice(0, 2).map((cand) => (
              <button
                // Keyed on the MODEL: a word can reach two models of one category.
                key={cand.detection.shape ?? cand.category}
                onClick={() => onRepair(cand, true)}
                className="ds-chip"
                title={`Use the ${candidateLabel(cand)} model at a typical size`}
                style={{ height: 22, fontSize: 'var(--fs-caption)', padding: '0 8px', flex: '0 0 auto' }}
              >
                Use {candidateLabel(cand)}
              </button>
            ))}
            <IconButton icon="x" label="Keep this model" onClick={onDismissOffer} size={22} iconSize={11} />
          </div>
        ) : repeatOf && !confirmed ? (
          // The app's guess that this is a repeat, ASKED rather than acted on. It
          // starts unticked; Same links it, Different keeps it as its own piece.
          <div className="t-hint" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3, lineHeight: 1.45 }}>
            <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
              Same {inSentence(cleanLabelOf(repeatOf))} as on {slotLabel(repeatOf.slot)}?
            </span>
            <span style={{ display: 'inline-flex', gap: 4, flex: '0 0 auto' }}>
              <button onClick={onConfirmRepeat} className="ds-chip" style={{ height: 22, fontSize: 'var(--fs-caption)', padding: '0 8px' }}>
                Same
              </button>
              <button onClick={onToggle} className="ds-chip" style={{ height: 22, fontSize: 'var(--fs-caption)', padding: '0 8px' }}>
                Different
              </button>
            </span>
          </div>
        ) : doubted && !confirmed ? (
          // Why this row started unticked. It names what was measured, the SIZE, and
          // leaves the person to judge: in the field two thirds of doubted rows were
          // correctly named pieces read at the wrong size.
          <RowNote icon="info">
            {photoDoubted ? 'Sizes in this photo look off. Tick to keep.' : `Size doesn’t fit a ${inSentence(modelName)}. Tick to keep.`}
          </RowNote>
        ) : alsoSeenOn.length > 0 ? (
          <RowNote icon="link">
            Also seen on {wallList(alsoSeenOn)}{confirmed ? '. Built once' : ''}
          </RowNote>
        ) : null}
      </div>
      {/* Trailing actions are icons, so the name keeps the width. "Show" was a word
          button and "Seen this already?" a full-width dropdown in the row's body. */}
      {!sameAs && linkOptions.length > 0 && !linking && (
        <IconButton
          icon="link"
          label={`${label} is already on the list`}
          title="Already on the list from another wall? Link it, and it is built once"
          onClick={() => setLinking(true)}
          size={26}
          iconSize={12}
        />
      )}
      {!onThisPhoto && (
        <IconButton
          icon="eye"
          label={`Show ${label} on the ${slotLabel(d.slot).toLowerCase()} photo`}
          title="Show on its photo"
          onClick={onShow}
          size={26}
          iconSize={12}
        />
      )}
      <IconButton
        icon="x"
        label={`Remove ${label}`}
        variant="outline"
        tone="danger"
        onClick={onDelete}
        size={26}
        iconSize={11}
        style={{ borderRadius: 'var(--r-1)' }}
      />
    </div>
  );
}

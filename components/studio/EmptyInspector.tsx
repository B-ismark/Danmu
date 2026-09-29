'use client';

// The right rail with nothing selected.
//
// It said "Nothing selected" in grey and left the rest of a 700px column blank.
// For a while the View section filled the space below it, but those controls were
// set once and never touched again. They have moved to the top bar (ViewMenu), and
// what is left is the state everyone lands in first.
//
// An empty state has three jobs (NN/g, "Designing Empty States in Complex
// Applications"): say what the space is for, show how to fill it, and offer a way
// forward. So this panel says what appears here once a piece is picked, and how to
// pick one. It shows the room at a glance, because with nothing selected the room
// is the thing in front of you. And it offers the two whole-room edits people reach
// for before they pick anything: restyle it, or resize it. Both land in the LEFT
// rail, on the right section (`lib/rail-intent.ts`). This panel gains no second
// copy of either control.
//
// Add is not offered here. It is the pinned footer directly below, and a second
// Add one row above the first is the double-button this rail's footer was
// collapsed to get rid of.

import { useScene } from '@/lib/scene-store';
import { useSettings, useStudio } from '@/lib/store';
import { useRailIntent, type LeftSection } from '@/lib/rail-intent';
import { useMediaQuery } from '@/lib/use-media-query';
import { useStudioLayout } from './NarrowViewportBanner';
import { formatArea, formatDim } from '@/lib/units';
import { Icon, type IconName } from '@/components/ui/Icon';
import { roomFacts } from '@/lib/room-facts';

export function EmptyInspector() {
  const room = useScene((s) => s.room);
  const count = useScene((s) => s.parts.length);
  const unit = useSettings((s) => s.dimUnit);
  const touch = useMediaQuery('(pointer: coarse)');
  const leftOpen = useStudio((s) => s.railLeftOpen);
  const toggleRail = useStudio((s) => s.toggleRail);
  const { layout } = useStudioLayout();
  const askLeft = useRailIntent((s) => s.askLeft);
  const facts = roomFacts(room, count);
  const pick = touch ? 'Tap' : 'Click';

  const goTo = (section: LeftSection) => {
    askLeft(section);
    // On a laptop the left rail may be shut, so it opens. On a tablet or phone there
    // is no rail to open, and the shell switches to its Room panel on the same
    // request. It must not toggle there anyway: `railLeftOpen` is persisted, so a
    // press on a tablet would quietly shut the laptop's rail for next time.
    if (layout !== 'stacked' && !leftOpen) toggleRail('left');
  };

  return (
    <div className="empty-inspector">
      <div className="empty-inspector__hero">
        <span className="empty-inspector__mark" aria-hidden="true">
          <Icon name="pointer" size={22} />
        </span>
        <h2 className="empty-inspector__title">Pick a piece to style it</h2>
        <p className="t-small empty-inspector__say">
          {pick} anything in the room, or its row in the Catalog. Its colour, finish and size open here.
        </p>
        <p className="t-hint empty-inspector__say">
          {pick} a wall to paint it or move it{touch ? '.' : '. Shift-click to pick several pieces at once.'}
        </p>
      </div>

      <section className="empty-inspector__card" aria-label="This room">
        <span className="ds-label">This room</span>
        <dl className="empty-inspector__facts">
          <Fact term="Pieces" value={String(facts.pieces)} />
          <Fact
            term="Size"
            value={`${facts.rough ? '≈' : ''}${formatDim(facts.widthMM, unit)} × ${formatDim(facts.depthMM, unit)} ${unit}`}
          />
          <Fact term="Floor area" value={`${facts.rough ? '≈' : ''}${formatArea(facts.areaM2, unit)}`} />
        </dl>
      </section>

      <div className="empty-inspector__paths">
        <span className="ds-label">Or change the whole room</span>
        <PathRow icon="palette" label="Restyle it" hint="One-tap palettes and the light" onClick={() => goTo('style')} />
        <PathRow icon="ruler" label="Resize it" hint="Its walls and ceiling height" onClick={() => goTo('room')} />
      </div>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="empty-inspector__fact">
      <dt className="t-hint">{term}</dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}

function PathRow({ icon, label, hint, onClick }: { icon: IconName; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-row empty-inspector__path" onClick={onClick}>
      <span className="empty-inspector__path-icon" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <span className="menu-row__text">
        <span className="empty-inspector__path-label">{label}</span>
        <span className="t-hint">{hint}</span>
      </span>
      <span className="empty-inspector__path-go" aria-hidden="true">
        <Icon name="chevron-right" size={13} />
      </span>
    </button>
  );
}

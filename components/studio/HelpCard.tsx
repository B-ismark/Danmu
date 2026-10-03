'use client';

// The parts a help dialog is built from — the dialog, its sections, its lines, its
// key table and its keycaps. Both studio tabs' help is assembled out of these, so the
// two describe the same app in the same chrome; only the content differs, and it lives
// in `StudioHelp.tsx` for both rather than in either page.
//
// It is a `Modal`, not a popover under the "?": a card 320px wide holding 950px of
// content was a scroll box nobody could scan. A left-hand list of sections jumps the
// reading pane to one; every section is still in the pane, in order, so nothing is
// hidden behind a tab and a phone (where the list is dropped) just reads top to bottom.
//
// The chip that OPENS it is not here. It used to be — a `HelpToggle` that bundled chip
// and card together for the canvas's bottom-left corner — and `StudioHelp` replaced it
// by moving help into the top bar. Help is one surface, and a second control that opens
// it from a different corner is not a spare, it is a fork.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/Modal';

/** One topic of the dialog. `nav` is the short name in the list on the left and is
 *  deliberately not the heading: the same words twice on one screen read as a stutter,
 *  and a test that looks a heading up by its text must find ONE element. */
export type HelpSectionSpec = {
  id: string;
  nav: string;
  icon: IconName;
  title: string;
  note?: string;
  body: ReactNode;
};

export function HelpDialog({ title, sections, onClose }: { title: string; sections: HelpSectionSpec[]; onClose: () => void }) {
  const titleId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(sections[0]?.id ?? '');

  // Which section the reading pane is on, so the list says where you are. The last
  // section whose top has passed the pane's top edge — and the final one once the pane
  // cannot scroll further, or a short last section could never be the current one.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      let cur = sections[0]?.id ?? '';
      if (atEnd && el.scrollTop > 0) cur = sections[sections.length - 1].id;
      else {
        for (const s of sections) {
          const node = el.querySelector<HTMLElement>(`[data-help-sec="${s.id}"]`);
          if (node && node.offsetTop <= el.scrollTop + 24) cur = s.id;
        }
      }
      setActive(cur);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [sections]);

  const jump = (id: string) => {
    const el = bodyRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-help-sec="${id}"]`);
    if (!el || !node) return;
    setActive(id);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo?.({ top: node.offsetTop, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <Modal onClose={onClose} labelledBy={titleId} width={880} bodyPadding="0" sheet>
      <div className="help-dlg">
        <div className="help-dlg__head">
          <Icon name="help" size={18} />
          <h2 id={titleId} className="help-dlg__title">
            {title}
          </h2>
          <IconButton icon="x" label="Close help" onClick={onClose} size={32} iconSize={16} />
        </div>
        <nav className="help-dlg__nav" aria-label="Help topics">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="help-dlg__navbtn"
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => jump(s.id)}
            >
              <Icon name={s.icon} size={16} />
              <span>{s.nav}</span>
            </button>
          ))}
        </nav>
        {/* A scroll box needs to be focusable or a keyboard-only user cannot scroll
            it: Firefox focuses an overflow container on its own, Chrome and Edge do
            not, so without this the pane is unreachable below its fold in the two
            browsers most people use. */}
        <div ref={bodyRef} className="help-dlg__body" tabIndex={0} role="region" aria-label="Help sections">
          {sections.map((s) => (
            <section key={s.id} data-help-sec={s.id} className="help-sec">
              <h3 className="help-sec__title">
                <span className="help-sec__icon" aria-hidden>
                  <Icon name={s.icon} size={16} />
                </span>
                {s.title}
              </h3>
              <div className="help-sec__lines">{s.body}</div>
              {s.note && <div className="t-hint help-sec__note">{s.note}</div>}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function HelpLine({ children }: { children: ReactNode }) {
  return <p className="help-line">{children}</p>;
}

/** A two-column table of keys: the caps on the left, what they do on the right. */
export function HelpKeys({ children }: { children: ReactNode }) {
  return <div className="help-keys">{children}</div>;
}

export function HelpKey({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="help-keys__row">
      <div className="help-keys__caps">{keys}</div>
      <div className="help-keys__what">{children}</div>
    </div>
  );
}

// Keycaps in the sans face, not mono: a keycap is a real convention, but this
// product's monospace is reserved for numerals and measurements.
export function Kb({ children }: { children: ReactNode }) {
  return <kbd className="help-kb">{children}</kbd>;
}

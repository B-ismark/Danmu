'use client';

// The shell for every page that is READ and NAVIGATED, as opposed to operated:
// the workspace, settings, and the layout picker. It owns the top bar, the two
// ways back, and how wide the content is allowed to get.
//
// The two ways back are deliberately different and deliberately not adjacent:
// the breadcrumb is a FIXED destination and lives in the bar with the mark,
// while `back` is HISTORY and lives at the top of the content column. See the
// note on the `back` prop for why that is not where it started.
//
// Three routes had built that bar three times. They agreed on the class
// (`.chrome-bar`) and on nothing else — the mark was a plain graphic on the
// workspace and a labelled link on settings, so the logo was clickable on one
// page and dead on the next; the page's own name was spelled out in a
// `ds-label` beside content that already said it; and each route picked its own
// content width. All three are decided here now.
//
// TWO routes deliberately do NOT use this:
//   · /onboarding/welcome — a hero. A breadcrumb on the first screen would be a
//     path from nowhere, and the page has no chrome bar to unify.
//   · /onboarding/{capture,detect} — a viewfinder and a review queue. A document
//     shell has nothing to offer a live camera feed.
// Forcing either into this would be the same mistake as leaving three bars.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { DanmuMark } from './primitives';

/** One hop in the path. No `href` marks the page you are on. */
export type Crumb = { label: string; href?: string };

export function DocShell({
  trail,
  actions,
  back,
  measure = 'page',
  variant = 'plain',
  children,
}: {
  /** The path, root first. The last entry is the current page and is not a link. */
  trail: Crumb[];
  /** Right end of the bar. Keep it to one committing action where possible. */
  actions?: ReactNode;
  /**
   * For a step in a flow that should go back the way it came. Supplied by the
   * route rather than built here, because `router.back()` is history — a
   * different destination from the breadcrumb's fixed one, and only the route
   * knows which of the two it means.
   *
   * **Rendered at the top of the CONTENT column, not in the chrome bar.** It was
   * in the bar, left of the mark, and it read as missing: on a `hero` page the
   * content is centred in the viewport, so the bar's left edge was ~115px above
   * the heading and a whole content-column's width to its left. The first
   * question anyone asked of that screen was "why is there no back button".
   * A control belongs beside the thing it acts on, and what Back undoes is the
   * choice being made in the column — not anything in the bar. The bar keeps the
   * breadcrumb, which is a different promise: a fixed destination rather than
   * a step backwards.
   */
  back?: ReactNode;
  /** `page` for card grids, `prose` for a page that is mostly reading and forms. */
  measure?: 'page' | 'prose';
  /** `hero` adds the onboarding wash and centres the content in the viewport. */
  variant?: 'plain' | 'hero';
  children: ReactNode;
}) {
  const maxWidth = measure === 'prose' ? 'var(--measure-page-prose)' : 'var(--measure-page)';

  const body = (
    <>
      {back && <div style={{ marginBottom: 10 }}>{back}</div>}
      {children}
    </>
  );

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background:
          variant === 'hero'
            ? 'radial-gradient(1100px 560px at 12% -12%, var(--accent-tint), transparent 60%),' +
              'radial-gradient(900px 520px at 108% 116%, var(--accent-2-tint), transparent 55%),' +
              'var(--paper)'
            : 'var(--paper)',
      }}
    >
      <div className="chrome-bar">
        {/* Always a link, always to the same place. This was the inconsistency:
            the workspace rendered a bare <DanmuMark/>, so the one affordance
            every other page trained you to click did nothing there. */}
        <Link href="/workspace" aria-label="Danmu — back to your rooms" style={{ display: 'flex' }}>
          <DanmuMark size={12} />
        </Link>
        <div aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--hairline)' }} />
        <Breadcrumb trail={trail} />
        <div className="chrome-bar__spacer" />
        {actions}
      </div>

      <div
        className="page-pad"
        style={
          variant === 'hero'
            ? { flex: 1, display: 'grid', placeItems: 'center', width: '100%' }
            : { flex: 1, width: '100%', maxWidth, marginInline: 'auto' }
        }
      >
        {/* Both branches render the same body, so the back slot cannot end up
            inside the measured column on one variant and outside it on the
            other — which is the whole point of putting it here. On `hero` the
            measured column is the inner div; on `plain` it is the box above. */}
        {variant === 'hero' ? (
          <div style={{ width: '100%', maxWidth }}>{body}</div>
        ) : (
          body
        )}
      </div>
    </div>
  );
}

// A path, not a field label. `ds-label` used to spell out "Workspace" /
// "Settings" / "Project" next to content that already named itself; a trail says
// the same thing AND says where you came from, in the same width.
function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ minWidth: 0 }}>
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {i > 0 && (
                <span aria-hidden="true" style={{ color: 'var(--ink-4)', fontSize: 12 }}>
                  /
                </span>
              )}
              {c.href && !last ? (
                <Link
                  href={c.href}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--ink-3)',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                </Link>
              ) : (
                <span
                  // The current page is the accessible landmark of the trail, so
                  // it is marked as such rather than just being the unlinked one.
                  aria-current={last ? 'page' : undefined}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: 'var(--ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

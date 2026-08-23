'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/lib/store';
import { Icon, type IconName } from '@/components/ui/Icon';
import { DanmuMark, IconButton } from '@/components/ui/primitives';

export default function WelcomePage() {
  const router = useRouter();
  const apiKey = useSettings((s) => s.apiKey);
  const setApiKey = useSettings((s) => s.setApiKey);
  const [show, setShow] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  // Format-only check — synchronous, no network. Live validation lives in
  // Settings; here we only reassure that the key *looks* like a Gemini key
  // (they start "AIza" and run ~39 chars). Detection proves it later.
  const trimmed = apiKey.trim();
  const looksValid = /^AIza[A-Za-z0-9_-]{30,}$/.test(trimmed);
  const keyState: 'empty' | 'check' | 'valid' =
    trimmed.length === 0 ? 'empty' : looksValid ? 'valid' : 'check';

  return (
    <div
      // .page-pad so the horizontal padding drops to 16px on a phone; dvh so
      // mobile browser chrome can't push the primary action below the fold.
      className="page-pad"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        fontFamily: 'var(--font-sans)',
        color: 'var(--ink)',
        background:
          'radial-gradient(1100px 560px at 12% -12%, var(--accent-tint), transparent 60%),' +
          'radial-gradient(900px 520px at 108% 116%, var(--accent-2-tint), transparent 55%),' +
          'var(--paper)',
      }}
    >
      {/* In flow, not absolutely pinned: .page-pad drops to 24px of top padding
          on a phone, which the old `top: 26` mark sat directly on top of. Same
          max-width as the grid below so the mark aligns with the headline rather
          than floating off in the left margin. */}
      <div style={{ width: '100%', maxWidth: 'var(--measure-page)', margin: '0 auto' }}>
        <DanmuMark size={15} />
      </div>

      {/* Four cells in .auto-grid, not two tall columns. The old
          `minmax(340px, 1fr)` forced a 340px track inside a 312px content box —
          the page scrolled sideways on a phone and the terracotta CTA sat below
          the entire feature list. .auto-grid caps the track at 100%, and pairing
          the cells means the single-column order *is* the reading order:
          pitch → start card → detail → preview. No `order` tricks, so the DOM
          stays correct for screen readers. */}
      <div
        className="auto-grid"
        // alignContent centres the rows in whatever height is left over, so the
        // composition still sits mid-viewport on a desktop without needing the
        // grid-in-grid centring that pinned the mark out of flow.
        style={{ flex: 1, alignContent: 'center', width: '100%', maxWidth: 'var(--measure-page)', margin: '0 auto', gap: '36px 44px', alignItems: 'start' }}
      >
        {/* PITCH */}
        <div>
          <span className="ds-kicker">Interior · Decoration studio</span>
          <h1
            style={{
              fontSize: 'clamp(34px, 5vw, 54px)',
              lineHeight: 1.05,
              letterSpacing: '-0.035em',
              fontWeight: 500,
              margin: '14px 0 16px',
            }}
          >
            Decorate any room.
            <br />
            In real 3D.
            <br />
            No account needed.
          </h1>
          {/* The privacy promise is qualified here rather than stated absolutely:
              the optional detect step really does POST wall photos to Gemini, so
              an unhedged "nothing leaves your device" would be untrue for anyone
              who switches it on. */}
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0, maxWidth: 'var(--measure-hero)' }}>
            Pick a room shape, drop in furniture, then move, recolour, restyle and relight every
            piece — live, in your browser. Nothing leaves your device, unless you switch on the
            optional AI step that spots furniture in a photo of a real room.
          </p>
        </div>

        {/* START */}
        <div
          style={{
            border: '1px solid var(--hairline-strong)',
            background: 'var(--paper)',
            padding: 28,
            position: 'relative',
            boxShadow: 'var(--shadow-lift)',
            borderRadius: 'var(--r-card)',
          }}
        >
          <div style={{ position: 'absolute', top: -10, left: 18, background: 'var(--paper)', padding: '0 8px' }}>
            <span className="ds-label" style={{ color: 'var(--accent-text)' }}>Start here</span>
          </div>

          <h2 style={{ fontSize: 20, margin: '6px 0 6px' }}>Build your first room</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, margin: '0 0 22px' }}>
            Free, instant, and right in the browser. No sign-up, no upload, no key needed to start.
          </p>

          <button
            onClick={() => router.push('/onboarding/layout-pick')}
            className="ds-btn ds-btn--accent"
            style={{ height: 52, justifyContent: 'center', fontSize: 15, width: '100%' }}
          >
            Start decorating
            <Icon name="arrow-right" size={15} color="var(--on-accent)" />
          </button>

          {/* Optional AI key — collapsed by default. AI is a bonus, not a gate. */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--hairline)', paddingTop: 14 }}>
            <button
              onClick={() => setKeyOpen((o) => !o)}
              aria-expanded={keyOpen}
              // aria-controls, not just aria-expanded: the trigger has to name
              // the region it opens or "expanded" refers to nothing.
              aria-controls="welcome-key-panel"
              className="ds-btn ds-btn--ghost"
              // minHeight rather than the class's fixed height: this is the
              // longest label in the card and it has to be allowed to wrap in a
              // narrow single-column card instead of spilling out of a 44px box.
              style={{ height: 'auto', minHeight: 44, fontSize: 13, lineHeight: 1.35, padding: '8px 6px', color: 'var(--ink-2)', width: '100%', justifyContent: 'space-between', textAlign: 'left' }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name="sparkles" size={13} color={keyState === 'valid' ? 'var(--accent-2)' : 'var(--ink-3)'} />
                {keyState === 'valid' ? 'AI furniture detection · key added' : 'Add an AI key for furniture detection (optional)'}
              </span>
              <Icon name={keyOpen ? 'chevron-up' : 'chevron-down'} size={14} />
            </button>

            {keyOpen && (
              <div id="welcome-key-panel" style={{ marginTop: 12 }}>
                <div style={{ position: 'relative' }}>
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="AIza••••••••••••••••••••"
                    type={show ? 'text' : 'password'}
                    aria-label="Google Gemini API key (optional)"
                    // The verdict below is colour + wording; aria-invalid is what
                    // actually reaches assistive tech, and the hint it points at
                    // names the expected format instead of just saying "check it".
                    aria-invalid={keyState === 'check'}
                    aria-describedby="welcome-key-hint"
                    className="ds-input"
                    style={{ paddingRight: 44, height: 44 }}
                  />
                  <IconButton
                    icon={show ? 'eye-off' : 'eye'}
                    label={show ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShow((s) => !s)}
                    size={40}
                    iconSize={16}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 10,
                    fontSize: 12,
                  }}
                >
                  {/* Accurate: the key is kept in this browser and only ever
                      travels to Google, never to a Danmu server. */}
                  <span style={{ color: 'var(--ink-2)' }}>Kept in this browser · only sent to Google</span>
                  <span
                    // The verdict used to change silently while you typed.
                    role="status"
                    aria-live="polite"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontWeight: 700,
                      // The *-text tokens, not the fill tokens: this is 12px type.
                      color:
                        keyState === 'valid' ? 'var(--success-text)'
                        : keyState === 'check' ? 'var(--warn-text)'
                        : 'var(--ink-3)',
                    }}
                  >
                    {keyState === 'valid' ? 'Looks good'
                      : keyState === 'check' ? 'Check the format'
                      : 'Optional'}
                  </span>
                </div>

                <p id="welcome-key-hint" style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, margin: '10px 0 0' }}>
                  Gemini keys start with “AIza”. Add one now or later in Settings — either way you
                  can start decorating.
                </p>

                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="ds-btn ds-btn--ghost"
                  style={{ height: 44, justifyContent: 'center', fontSize: 13, color: 'var(--ink-2)', marginTop: 6 }}
                >
                  How to get a free key
                  {/* target=_blank has to be visible, not a surprise. */}
                  <Icon name="external" size={13} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            )}
          </div>
        </div>

        {/* DETAIL */}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxWidth: 'var(--measure-hero)' }}>
          <Feature
            icon="sofa"
            tint="var(--accent-tint)"
            color="var(--accent)"
            title="Arrange in real 3D"
            desc="Move, rotate and place 30+ pieces at true room scale."
          />
          <Feature
            icon="leaf"
            tint="var(--accent-2-tint)"
            color="var(--accent-2)"
            title="Restyle & relight"
            desc="Recolour any piece and switch whole palettes in a tap."
          />
          {/* The differentiator, in place of a second privacy promise that only
              repeated the headline: sizing is deterministic, and that is the one
              claim no photo-to-render toy can make. */}
          <Feature
            icon="ruler"
            tint="var(--paper-3)"
            color="var(--ink-2)"
            title="Real dimensions, not guesses"
            desc="Every size is computed on your device — clearance and fit come from geometry, never AI."
          />
        </ul>

        {/* PREVIEW */}
        <RoomVignette />
      </div>
    </div>
  );
}

function Feature({
  icon,
  tint,
  color,
  title,
  desc,
}: {
  icon: IconName;
  tint: string;
  color: string;
  title: string;
  desc: string;
}) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0' }}>
      <div
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 'var(--r-2)',
          background: tint,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
        }}
      >
        <Icon name={icon} size={17} color={color} />
      </div>
      <div>
        {/* A real heading — these were <div>s, so the page's whole outline was a
            lone h1. `.sans` keeps Nunito: the display serif is for page and
            section titles, not a 14px list label. */}
        <h2
          className="sans"
          style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0, color: 'var(--ink)', lineHeight: 1.3 }}
        >
          {title}
        </h2>
        <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45, marginTop: 2 }}>{desc}</div>
      </div>
    </li>
  );
}

/* Zero-asset preview of the thing you're about to build: an isometric room shell
   — two back walls plus the cut-away front wall — with one piece that slides a
   step along the floor's iso axis and re-upholsters between clay and sage. The
   previous version was a flat orthographic elevation, which showed neither that
   the room is a volume nor that pieces move and re-colour: the front door made
   no case that this is a 3D studio. Still no image, no 3D boot, no extra bytes.
   Motion is CSS keyframes in globals.css (see .vignette-piece) so the app's
   prefers-reduced-motion rule stops it — nothing here is driven from JS. */
function RoomVignette() {
  return (
    <div
      style={{
        borderRadius: 'var(--r-card)',
        overflow: 'hidden',
        border: '1px solid var(--hairline)',
        boxShadow: 'var(--shadow-soft)',
        background: 'var(--paper-0)',
      }}
    >
      <svg
        viewBox="0 0 320 240"
        width="100%"
        height="100%"
        role="img"
        aria-label="Isometric preview of a furnished room, where a sofa slides across the floor and changes colour."
        style={{ display: 'block' }}
      >
        {/* Room shell on a 2:1 isometric floor diamond. The left wall is one
            paper step deeper than the right so the corner reads as volume
            instead of a folded card. */}
        <path d="M32 160 L160 96 L160 20 L32 84 Z" fill="var(--paper-2)" stroke="var(--hairline)" strokeWidth="1.5" />
        <path d="M160 96 L288 160 L288 84 L160 20 Z" fill="var(--paper)" stroke="var(--hairline)" strokeWidth="1.5" />
        <path d="M32 160 L160 96 L288 160 L160 224 Z" fill="var(--paper-3)" stroke="var(--hairline)" strokeWidth="1.5" />

        {/* framed art, on the plane of the left wall */}
        <path d="M76 98 L108 82 L108 52 L76 68 Z" fill="var(--paper)" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <circle cx="92" cy="75" r="6" fill="var(--accent)" opacity="0.5" />

        {/* window with sage daylight, on the plane of the right wall */}
        <path d="M216 98 L268 124 L268 84 L216 58 Z" fill="var(--accent-2-tint)" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path d="M242 111 L242 71" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path d="M216 78 L268 104" stroke="var(--hairline-strong)" strokeWidth="1.5" />

        {/* rug */}
        <path d="M160 130 L242 171 L160 212 L78 171 Z" fill="var(--accent-2-tint)" />

        {/* floor lamp */}
        <ellipse cx="60" cy="158" rx="10" ry="4" fill="var(--ink-4)" />
        <path d="M60 158 L60 100" stroke="var(--ink-3)" strokeWidth="2.5" />
        <path d="M49 100 L71 100 L66 82 L54 82 Z" fill="var(--accent)" opacity="0.9" />
        <ellipse cx="60" cy="100" rx="11" ry="4" fill="var(--accent)" />

        {/* potted plant */}
        <path d="M222 152 L242 152 L239 168 L225 168 Z" fill="var(--accent)" opacity="0.55" />
        <ellipse cx="232" cy="152" rx="10" ry="3.5" fill="var(--accent)" opacity="0.75" />
        <path d="M232 150 C230 132 222 128 216 124 C226 126 232 134 232 150 Z" fill="var(--accent-2)" />
        <path d="M232 150 C234 130 242 126 250 122 C240 124 232 132 232 150 Z" fill="var(--accent-2)" opacity="0.85" />
        <path d="M232 150 C232 136 232 126 232 118 C236 126 236 138 234 150 Z" fill="var(--accent-2)" opacity="0.7" />

        {/* The piece that carries the demo. `currentColor` on every upholstery
            face means one animated `color` re-tints the whole sofa while each
            face keeps its own shading opacity — and the inline `color` is the
            base state reduced-motion falls back to. */}
        <g className="vignette-piece" style={{ color: 'var(--accent)' }}>
          <path d="M81 147 L153 111 L187 128 L115 164 Z" fill="var(--hairline)" />
          {/* seat block: two visible side faces, then the top */}
          <path d="M76 129 L110 146 L110 159 L76 142 Z" fill="currentColor" opacity="0.6" />
          <path d="M110 146 L182 110 L182 123 L110 159 Z" fill="currentColor" opacity="0.78" />
          <path d="M76 129 L148 93 L182 110 L110 146 Z" fill="currentColor" />
          {/* backrest against the left wall, plus its top edge */}
          <path d="M76 129 L148 93 L148 69 L76 105 Z" fill="currentColor" opacity="0.86" />
          <path d="M76 105 L148 69 L154 72 L82 108 Z" fill="currentColor" opacity="0.96" />
          {/* far arm */}
          <path d="M148 93 L182 110 L182 100 L148 83 Z" fill="currentColor" opacity="0.84" />
          {/* cushions */}
          <path d="M123 112 L147 124 L119 138 L95 126 Z" fill="var(--paper)" opacity="0.78" />
          <path d="M155 95 L179 107 L151 121 L127 109 Z" fill="var(--paper)" opacity="0.78" />
          {/* near arm last — it is the closest surface to the viewer */}
          <path d="M76 129 L110 146 L110 136 L76 119 Z" fill="currentColor" opacity="0.7" />
          <path d="M76 119 L110 136 L122 130 L88 113 Z" fill="currentColor" opacity="0.95" />
        </g>

        {/* Cut-away front wall, drawn last so it sits in front of the room. */}
        <path d="M160 224 L288 160 L288 144 L160 208 Z" fill="var(--paper-3)" stroke="var(--hairline)" strokeWidth="1.5" />
        <path d="M160 208 L288 144 L283 142 L155 206 Z" fill="var(--paper-2)" stroke="var(--hairline)" strokeWidth="1" />
      </svg>
    </div>
  );
}

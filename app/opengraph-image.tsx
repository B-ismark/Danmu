import { ImageResponse } from 'next/og';
import { MARK_COLORS, markDataUri } from '@/lib/brand-mark';

// What a shared Danmu link unfurls as.
//
// Danmu spreads by word of mouth and a room leaves the browser as a file someone
// hands over, so a pasted link IS the marketing surface. It used to unfurl as
// text alone, on the stated reasoning that the repo had no raster asset and that
// inventing a screenshot would be worse than nothing. The first half stopped
// being true the moment a mark could be rasterised at build time; the second half
// is still true and still respected — this is a brand card, not a fake screenshot.
// It shows the mark, the name, what the app is, and the two claims that actually
// distinguish it. Nothing on it is a promise about what your room will look like.
//
// Three things worth knowing before editing it:
//
// · **No fonts are loaded.** `ImageResponse` takes a `fonts` array and this passes
//   none, so it renders with the renderer's own default face. Fraunces and Nunito
//   arrive through `next/font/google`, which caches them inside `.next` under
//   content-hashed names — there is no stable path to hand a rasteriser, and
//   fetching them from fonts.gstatic.com would put a network call in the build of
//   an app whose whole point is that it does not need one. So the card leans on
//   scale, colour and the mark for its identity rather than on a typeface. If a
//   font is ever vendored into the repo as a file, this is the place it pays off.
//
// · **The mark arrives as a data URI, not as inline `<svg>`.** Satori draws an
//   `<img>` of an SVG through resvg, a complete SVG renderer, where its own
//   support for inline SVG children covers a subset of it. `lib/brand-mark.ts`
//   builds the document, so this shares its path data with the favicon, the iOS
//   icon and the mark in the app's own top bar.
//
// · **It is generated once, at build time.** This route is static, so `next build`
//   rasterises it and what ships is a PNG. Nothing runs per request, which is what
//   keeps "no backend" true.

export const alt = 'Danmu — decorate a scaled 3D room in your browser';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The three claims, in the order they answer a stranger's questions: what is it,
 *  is it real, what does it cost me. */
const CLAIMS = ['Real dimensions', 'Works offline', 'No account'];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // --paper-0, the page wash the app itself paints. A share card in a
          // different cream from the site it opens reads as someone else's link.
          background: '#EFE9DD',
          padding: '76px 88px',
        }}
      >
        {/* Lockup: the mark at a size where its furniture block is legible, and
            the wordmark beside it. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders
              a plain <img>; next/image is a browser-runtime component and has no
              meaning inside an ImageResponse. */}
          <img src={markDataUri({ size: 132 })} width={132} height={132} alt="" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 86, fontWeight: 700, color: '#2A2520', letterSpacing: '-0.03em' }}>Danmu</div>
            <div style={{ fontSize: 30, fontWeight: 600, color: MARK_COLORS.accent, letterSpacing: '-0.01em' }}>
              interior decoration, in your browser
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {/* The sentence someone should be able to read and know whether they
              want this. `--ink` at a size that survives a phone-sized preview. */}
          <div style={{ fontSize: 46, fontWeight: 600, color: '#2A2520', lineHeight: 1.24, maxWidth: 900 }}>
            Pick a footprint, get a scaled 3D room, and redecorate it.
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            {CLAIMS.map((claim) => (
              <div
                key={claim}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  // --paper and --edge. A chip, the same shape the app uses.
                  background: MARK_COLORS.tile,
                  border: '2px solid rgba(42, 37, 32, 0.5)',
                  borderRadius: 999,
                  padding: '14px 26px',
                  fontSize: 27,
                  fontWeight: 700,
                  color: '#5A5147',
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    // --accent-2, the sage the app uses for a settled state.
                    background: MARK_COLORS.piece,
                  }}
                />
                {claim}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

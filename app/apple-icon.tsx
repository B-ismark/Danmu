import { ImageResponse } from 'next/og';
import { markDataUri } from '@/lib/brand-mark';

// The home-screen icon, for the one platform that will not take the SVG.
//
// `app/icon.svg` covers browser tabs and the web manifest, and Chrome will install
// from it. iOS will not: Safari reads `<link rel="apple-touch-icon">` and wants a
// raster PNG, and given none it screenshots the page — so "Add to Home Screen" on
// the tablet this app is meant to be carried into a room on produced a thumbnail
// of whatever was on screen at the time. Next emits the link tag for this file
// automatically.
//
// 180×180 is the largest size iOS asks for and the only one worth shipping; it
// downscales from there. No tile radius of our own: iOS masks the icon to the
// platform's shape and a rounded rectangle inside that mask shows as a visible
// inset, which is why the mark is drawn `tile: false` on a flat --paper square.
//
// Rasterised at build time like the share card, so nothing runs per request.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // --paper, matching the tile app/icon.svg draws for itself.
          background: '#FBF8F2',
        }}
      >
        {/* The mark at 74% of the square: iOS crops a few pixels at the corners of
            its mask, and a glyph run to the edge loses its outline stroke there. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders a
            plain <img>; next/image has no meaning inside an ImageResponse. */}
        <img src={markDataUri({ size: 134, tile: false })} width={134} height={134} alt="" />
      </div>
    ),
    size,
  );
}

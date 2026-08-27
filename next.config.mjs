/** @type {import('next').NextConfig} */

// ─── Security headers ───────────────────────────────────────────────────────
//
// There used to be none at all. That matters more here than it would for a
// brochure site, because this origin holds a usable Google API key (localStorage)
// and every room the user owns (IndexedDB), AND it deliberately executes
// JavaScript fetched from a third-party CDN at runtime (lib/local-detect.ts). A
// script-src allowlist is the one control that bounds that.
//
// Every host below is listed with the reason it is here. If a feature stops
// needing a host, delete it from the list.

const dev = process.env.NODE_ENV !== 'production';

/** ONNX Runtime. Served from public/ort/ when `pnpm vendor:ort` has been run;
 *  the CDN stays as the fallback for a fresh clone, so it has to stay allowed.
 *  (See scripts/vendor-ort.mjs and the resolver in lib/local-detect.ts.) */
const ORT_CDN = 'https://cdn.jsdelivr.net';
/** Optional Gemini detection — the only user-data egress in the app. */
const GEMINI = 'https://generativelanguage.googleapis.com';
/** Detector weights, when public/models/ has not been populated locally. The
 *  /resolve/ URLs 302 to an LFS CDN host, so that has to be allowed too. */
const WEIGHTS = ['https://huggingface.co', 'https://*.hf.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co'];

const csp = [
  `default-src 'self'`,
  // 'unsafe-inline' is required by Next's inline bootstrap; nonce-ing it needs
  // middleware on every route, which this app (9 of 11 routes prerendered) has
  // no other reason to run. 'wasm-unsafe-eval' is for the ONNX Runtime's wasm
  // backend. 'unsafe-eval' is dev-only — the Next dev overlay and React refresh
  // need it, production does not.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${dev ? `'unsafe-eval' ` : ''}${ORT_CDN}`,
  // The app styles almost everything with inline style objects.
  `style-src 'self' 'unsafe-inline'`,
  // Photo previews and the plan/snapshot exports are blob: and data: URLs.
  `img-src 'self' blob: data:`,
  `font-src 'self' data:`,
  // Stated rather than left to the default-src fallback, because the manifest is
  // now load-bearing (installability, and the offline splash) and a directive the
  // app depends on should be visible in the policy. `worker-src 'self'` below
  // already covers registering /sw.js — it was there for ORT's blob: workers.
  `manifest-src 'self'`,
  // next/font self-hosts the Google fonts at build time, so no font CDN here.
  `connect-src 'self' blob: data: ${GEMINI} ${ORT_CDN} ${WEIGHTS.join(' ')}`,
  // ORT's threaded backend spawns workers from blob URLs.
  `worker-src 'self' blob:`,
  `media-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  // Production only. localhost is exempt from upgrading, but `next dev` bound to
  // a LAN address is not — and shooting the capture screen from a real phone
  // over http://192.168.x.x is the one thing this app genuinely needs a second
  // device for. Upgrading those subresource requests to https would break it.
  ...(dev ? [] : [`upgrade-insecure-requests`]),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Redundant with frame-ancestors for modern browsers, kept for older ones.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // The app asks for exactly ONE powerful feature and refuses the rest. Note
  // that `=(self)` is NOT the same as denying it — it is what lets the feature
  // work on this origin while still blocking it in anything this page embeds.
  //   · camera — the capture screen. That is the whole list.
  // It does not send anything anywhere; it writes to local storage only.
  //
  // Four entries were `(self)` here until the sun mood was collapsed to fixed
  // presets, and all four are back to denied:
  //   · geolocation, for a "Use my location" button that filled in the room's
  //     latitude and longitude;
  //   · accelerometer / gyroscope / magnetometer, for a "Compass" button that
  //     read the room's bearing off the phone's own magnetometer (Chrome gates
  //     the DeviceOrientation events on all three, so one reading needed the set).
  //
  // A feature and its header entry move together in BOTH directions, and this is
  // the direction that gets forgotten: `()` overrides the user's own permission
  // grant, so leaving these at `(self)` would not have broken anything or failed
  // a test — it would just have left the app permanently asking for two sensors
  // and a location it can no longer use. `tests/toolchain.test.ts` has no opinion
  // on a policy that is merely too generous, which is why this comment is the
  // guard.
  {
    key: 'Permissions-Policy',
    value: [
      'camera=(self)',
      'microphone=()',
      'geolocation=()',
      'accelerometer=()',
      'gyroscope=()',
      'magnetometer=()',
      'payment=()',
      'usb=()',
      'midi=()',
      'display-capture=()',
      'idle-detection=()',
      'serial=()',
      'bluetooth=()',
    ].join(', '),
  },
  // Ignored on http:// and on localhost, so it is safe to send unconditionally.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Deliberately NOT Cross-Origin-Embedder-Policy: require-corp — it would block
  // the CDN script and the weights, which do not send CORP headers.
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  reactStrictMode: true,
  // No `images` config: the app renders no remote images. The two raw <img>
  // tags point at local blob/data URLs from photo capture, which next/image
  // cannot optimise anyway. The old unsplash remotePattern was a leftover from
  // the deleted render pipeline. This is also why the Image Optimizer advisories
  // against Next do not reach this app, and why `sharp` — which Next depends on
  // for exactly that feature — is never called here.
  // `next lint` only walks app/pages/components/lib/src by default; `tests` is
  // real TypeScript we ship rules for, so lint it too.
  eslint: { dirs: ['app', 'components', 'lib', 'tests'] },
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'three'],
    // No `esmExternals: 'loose'`. It was needed on Next 14 for the three /
    // three-stdlib ESM graph; Next 15 resolves it without the escape hatch, and
    // warns that setting it can itself disrupt resolution. Verified by building
    // both ways. If a three-adjacent import starts failing to resolve, this is
    // the first thing to try again — but measure before adding it back.
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The service worker script itself must never be served from a long-lived
      // cache. A worker that can pin its own replacement is a worker you cannot
      // ship a fix to — the browser would keep handing back the old bytes, and
      // the old bytes are what decide whether the new ones are ever fetched.
      // Browsers already bypass the HTTP cache for the worker script after 24h,
      // but 24h of a broken cache strategy is 24h too many, and static hosts are
      // free to serve public/ with whatever max-age they like.
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;

// Where this copy of the app is served from.
//
// Needed for exactly one reason: Open Graph and Twitter card tags must carry
// ABSOLUTE urls. A relative `/opengraph-image` is not something Slack, iMessage
// or a search crawler will resolve — they fetch the page's HTML and nothing else,
// so a relative path there is a preview that silently never appears. Next builds
// those absolute urls from `metadata.metadataBase`, and with no base set it warns
// at build time and falls back to `http://localhost:3000`, which ships tags
// pointing at the reader's own machine.
//
// So it has to be resolved, and it cannot be hard-coded: this repo has no
// deployed domain anywhere in it, and inventing one would produce previews that
// break for whoever actually deploys it — worse than the localhost fallback,
// because it would look configured.
//
// Hence: the explicit override first, then the variables the three static hosts
// this app can run on set by themselves. Someone deploying gets working previews
// with no configuration, and someone on a fourth host sets one variable.
//
// This is build-time configuration and not a backend. Nothing is fetched from it,
// nothing is sent to it, and the value only ever ends up inside a `<meta>` tag.

/** Local dev. Also the honest answer when nothing else is known — a wrong
 *  absolute domain is a worse lie than an obviously-local one. */
export const DEV_SITE_URL = 'http://localhost:3000';

/** In order. The first that yields a usable origin wins.
 *
 *  · `NEXT_PUBLIC_SITE_URL` — the explicit override, for a custom domain or a
 *    host not listed below. Set this and nothing else matters.
 *  · Vercel's production url, then its per-deployment url. Both arrive without a
 *    scheme, which is why `normalise` adds one.
 *  · Netlify sets `URL` for the site and `DEPLOY_PRIME_URL` for a branch deploy.
 *  · Cloudflare Pages sets `CF_PAGES_URL`.
 *
 *  Deliberately not `VERCEL_BRANCH_URL` or a PR url: a preview deployment's share
 *  card pointing at the preview is correct, and its own per-deployment url is
 *  already the entry above. */
const SOURCES = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'URL',
  'DEPLOY_PRIME_URL',
  'CF_PAGES_URL',
] as const;

/** A bare host (`danmu.example.com`) becomes `https://danmu.example.com`; a value
 *  that already has a scheme is left alone so a local override can stay `http`.
 *  Returns null for anything `new URL` cannot parse, so one malformed variable
 *  falls through to the next source instead of throwing during a build. */
function normalise(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    // `.origin`, so a variable someone set to a full page url still yields a base
    // — and so a trailing slash cannot produce `//opengraph-image`.
    const { origin } = new URL(withScheme);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Pure, and takes the environment rather than reading it, so the precedence
 *  order above is testable without mutating `process.env`. */
export function resolveSiteUrl(env: Record<string, string | undefined>): string {
  for (const key of SOURCES) {
    const origin = normalise(env[key]);
    if (origin) return origin;
  }
  return DEV_SITE_URL;
}

/** What `app/layout.tsx` uses. `process.env` is read once, at module scope, which
 *  is also the only place it can be: `NEXT_PUBLIC_SITE_URL` is inlined at build
 *  time and the rest are only ever present on the build machine. */
export const SITE_URL = resolveSiteUrl(process.env as Record<string, string | undefined>);

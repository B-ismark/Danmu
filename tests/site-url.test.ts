import { describe, expect, it } from 'vitest';
import { DEV_SITE_URL, resolveSiteUrl } from '@/lib/site-url';

// The whole value of this module is its PRECEDENCE and its refusal to throw. A
// wrong answer here is not a crash — it is a `<meta property="og:image">`
// pointing at localhost, or at the wrong deployment, on every page. Nothing in the
// app misbehaves and no error is logged; the link simply never unfurls, and the
// only way to find out is to paste it somewhere and look.

describe('resolveSiteUrl precedence', () => {
  it('prefers the explicit override over every host variable', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_SITE_URL: 'https://danmu.example',
        VERCEL_PROJECT_PRODUCTION_URL: 'prod.vercel.app',
        URL: 'https://netlify.example',
      }),
    ).toBe('https://danmu.example');
  });

  it('prefers a production url to a per-deployment one', () => {
    // Both are set on every Vercel production build. Taking VERCEL_URL would
    // point the share card at a deployment-specific host that outlives nothing.
    expect(
      resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'danmu.example', VERCEL_URL: 'danmu-a1b2c3.vercel.app' }),
    ).toBe('https://danmu.example');
  });

  it('prefers a Netlify site url to a branch deploy url', () => {
    expect(resolveSiteUrl({ URL: 'https://danmu.netlify.app', DEPLOY_PRIME_URL: 'https://x--danmu.netlify.app' })).toBe(
      'https://danmu.netlify.app',
    );
  });

  it('falls back to a branch deploy when there is no site url', () => {
    expect(resolveSiteUrl({ DEPLOY_PRIME_URL: 'https://x--danmu.netlify.app' })).toBe('https://x--danmu.netlify.app');
  });

  it('reads Cloudflare Pages', () => {
    expect(resolveSiteUrl({ CF_PAGES_URL: 'https://danmu.pages.dev' })).toBe('https://danmu.pages.dev');
  });

  it('is local when nothing is set', () => {
    expect(resolveSiteUrl({})).toBe(DEV_SITE_URL);
  });
});

describe('resolveSiteUrl normalisation', () => {
  it('adds https to a bare host, which is how Vercel supplies it', () => {
    expect(resolveSiteUrl({ VERCEL_URL: 'danmu-a1b2c3.vercel.app' })).toBe('https://danmu-a1b2c3.vercel.app');
  });

  it('leaves an existing scheme alone, so a local override can stay http', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://192.168.1.20:3000' })).toBe('http://192.168.1.20:3000');
  });

  it('reduces a full page url to its origin', () => {
    // Someone will paste a whole url in. A base with a path produces
    // `…/some/page/opengraph-image`, and a trailing slash produces a double one.
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://danmu.example/workspace?x=1' })).toBe(
      'https://danmu.example',
    );
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://danmu.example/' })).toBe('https://danmu.example');
  });

  it('ignores whitespace and empty values rather than treating them as set', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: '   ', VERCEL_URL: 'danmu.example' })).toBe('https://danmu.example');
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: '' })).toBe(DEV_SITE_URL);
  });

  it('falls through a malformed value instead of throwing during a build', () => {
    // `new URL` throws, and this runs at module scope in the root layout — an
    // exception here fails the whole build over one bad variable.
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'ht tp://%%%', URL: 'danmu.example' })).toBe(
      'https://danmu.example',
    );
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://' })).toBe(DEV_SITE_URL);
  });

  it('never returns a value new URL cannot parse', () => {
    // What `app/layout.tsx` does with the result, so it is what must not throw.
    for (const env of [{}, { VERCEL_URL: 'a.example' }, { NEXT_PUBLIC_SITE_URL: 'garbage' }]) {
      expect(() => new URL(resolveSiteUrl(env))).not.toThrow();
    }
  });
});

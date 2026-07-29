/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No `images` config: the app renders no remote images. The two raw <img>
  // tags point at local blob/data URLs from photo capture, which next/image
  // cannot optimise anyway. The old unsplash remotePattern was a leftover from
  // the deleted render pipeline.
  // `next lint` only walks app/pages/components/lib/src by default; `tests` is
  // real TypeScript we ship rules for, so lint it too.
  eslint: { dirs: ['app', 'components', 'lib', 'tests'] },
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'three'],
    esmExternals: 'loose',
  },
};

export default nextConfig;

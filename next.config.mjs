/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  // @react-pdf/renderer ships ESM only — Next 14 needs to transpile it.
  transpilePackages: ['@react-pdf/renderer'],
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'three'],
    esmExternals: 'loose',
  },
};

export default nextConfig;

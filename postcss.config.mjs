// Tailwind 4 is its own PostCSS plugin, and vendor-prefixes on its own (Lightning CSS),
// which is why autoprefixer is gone.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

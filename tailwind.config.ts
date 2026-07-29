import type { Config } from 'tailwindcss';

// Tailwind is here for Preflight and nothing else.
//
// It used to mirror ~25 CSS custom properties into the theme so that "a utility
// can never introduce a second, contradicting design vocabulary". The intent was
// right and the cost was real: no utility classes are used anywhere in the app.
// Every `className` resolves to a hand-written class in app/globals.css —
// .ds-btn, .ds-card, .rail, .field, .list-row, .chrome-bar, .split, .auto-grid,
// .row-grid, .popover, .toolbar, .icon-btn, .ds-chip, .sr-only, .mono. So the
// bridge was a second copy of the token table, kept in sync by hand, guarding
// against something nobody does.
//
// app/globals.css is the single source of truth for tokens. If a utility class is
// ever genuinely wanted, add the one token it needs here at that point — and read
// the contrast notes in globals.css first, because the fill/text distinction
// (--accent vs --accent-text) does not survive being flattened into a `colors`
// map.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {},
  plugins: [],
};
export default config;

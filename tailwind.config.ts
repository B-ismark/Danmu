import type { Config } from 'tailwindcss';

// Tokens stay in globals.css — that file is the source of truth. Tailwind is
// kept for Preflight and the handful of utility classes in the plan view; this
// config only bridges the real tokens across so a utility can never introduce a
// second, contradicting design vocabulary. Every value here must match
// globals.css exactly; if you change a token, change it there first.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'paper-0': 'var(--paper-0)',
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        'paper-3': 'var(--paper-3)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        'accent-text': 'var(--accent-text)',
        'accent-2': 'var(--accent-2)',
        locked: 'var(--locked)',
        danger: 'var(--danger)',
        'danger-text': 'var(--danger-text)',
        warn: 'var(--warn)',
        success: 'var(--success)',
        'on-accent': 'var(--on-accent)',
        hairline: 'var(--hairline)',
        edge: 'var(--edge)',
      },
      fontFamily: {
        sans: ['var(--font-nunito)', 'ui-rounded', 'sans-serif'],
        display: ['var(--font-fraunces)', 'Georgia', 'serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        '1': 'var(--r-1)',
        '2': 'var(--r-2)',
        '3': 'var(--r-3)',
        card: 'var(--r-card)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
      },
      zIndex: {
        'canvas-ui': 'var(--z-canvas-ui)',
        'canvas-hint': 'var(--z-canvas-hint)',
        panel: 'var(--z-panel)',
        popover: 'var(--z-popover)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
    },
  },
  plugins: [],
};
export default config;

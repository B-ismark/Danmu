import type { Config } from 'tailwindcss';

// Tokens stay in globals.css. Tailwind references them via CSS variables.
// Keep this file small — tokens.css is the source of truth.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        'paper-3': 'var(--paper-3)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        accent: 'var(--accent)',
        locked: 'var(--locked)',
        danger: 'var(--danger)',
        success: 'var(--success)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)'],
        mono: ['var(--font-geist-mono)'],
      },
      borderRadius: {
        '1': '2px',
        '2': '4px',
        '3': '8px',
      },
    },
  },
  plugins: [],
};
export default config;

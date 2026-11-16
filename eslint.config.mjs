// ESLint config, flat format.
//
// `next lint` is removed in Next 16, so linting runs through the ESLint CLI directly
// (`pnpm lint` → `eslint .`). Two things had to move for that:
//
//   · The rules. `eslint-config-next` is still what supplies them, and since Next 16
//     it ships them as flat configs, imported below. Up to Next 15 it shipped eslintrc
//     format and `FlatCompat` (`@eslint/eslintrc`) bridged it; under 16 that bridge
//     fails outright (a circular-structure error while validating the `react`
//     plugin), so it and its devDependency are gone.
//   · The ignore list, out of `.eslintignore` — deprecated in ESLint 9 and silently
//     ignored under flat config, which is the failure mode worth avoiding: it does
//     not error, it just starts linting `public/` and the build output.
//
// `next lint` linted only `app` / `components` / `lib` / `pages` / `src` by default.
// `eslint .` covers `tests/`, `scripts/` and the root config files too, which is a
// deliberate widening — 171 files, and they were already clean.
//
// `next build` no longer lints at all as of Next 16, so `pnpm lint` (a CI step of its
// own) is the only lint gate. Three things about this file are load-bearing:
//
//   · **ESLint must be >= 9.** Flat config is the only format here, and
//     `eslint-config-next` 16's flat exports need it. (It used to matter for a second
//     reason — `next build`'s own lint pass silently linted nothing on 8.57 — which
//     went with that pass.)
//   · **`next/typescript` is extended, not just `next/core-web-vitals`.** Without it
//     `@typescript-eslint/no-unused-vars` is never enabled, `eslint:recommended` is
//     not in the chain either, and `tsconfig.json` sets no `noUnusedLocals` — so
//     `pnpm lint --max-warnings 0` and `pnpm typecheck` were both structurally
//     incapable of seeing a dead import. Adding it found thirteen across nine files on
//     the first run, one of them a stale `collidesAt` that had outlived its call site.
//     A gate reporting zero because it cannot see the defect is the failure mode this
//     repo keeps finding.
//   · **This file must not be self-ignored.** It lints itself (that is why the default
//     export is named), and a `*.config.mjs` ignore entry — what `.eslintignore` used
//     to carry — would quietly take it, and every root config file, out of the gate.
//
// And one decision, made with the Next 16 upgrade: `eslint-config-next` 16 brings
// `eslint-plugin-react-hooks` 7, whose recommended set adds the React Compiler's rules
// (`refs`, `set-state-in-effect`, `immutability`, `purity`). They are switched off
// below. This app does not use the React Compiler, and on first run those four
// reported 72 findings in 29 files that were overwhelmingly the patterns the app is
// built on rather than defects: `Draggable` and `CameraRig` mutating their own refs
// and Three objects inside pointer handlers, `Date.now()` / `Math.random()` inside
// click handlers read as "during render", a ref mirrored from a prop. Rewriting the
// drag path to satisfy a compiler nothing runs is how drag behaviour breaks quietly.
// The classic hook rules — `rules-of-hooks`, `exhaustive-deps` — stay on, and
// `tests/toolchain.test.ts` pins that. Of the four, `set-state-in-effect` (20
// findings) is the one with real if small wins in it (a render that immediately
// renders again); it is a candidate for a later, separate cleanup, not this upgrade.

import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Named rather than exported anonymously so `import/no-anonymous-default-export`
// stays satisfied — this file lints itself now, see the note above.
const config = [
  {
    // Was `.eslintignore`. `public/` holds vendored ONNX Runtime and model files that
    // are third-party bytes, not source; `weights/` is the local detector export.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      // …except `sw.js`, which is the one piece of first-party source in there. It
      // has to sit at the origin root to claim a '/' scope, so it cannot live in
      // app/ or lib/ — but "cannot be bundled" is no reason to be the only
      // unlinted file we ship.
      'public/!(sw.js)',
      'public/*/**',
      'weights/**',
      'next-env.d.ts',
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    // The React Compiler's rules — off on purpose; the reason is in the header.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // Raised from `warn` to `error` — `--max-warnings 0` already fails on a warning,
    // so this only makes the output say what it means. The ignore patterns are the
    // conventional ones: a leading underscore is how this codebase writes "read and
    // deliberately discarded", and `ignoreRestSiblings` is what allows the
    // `const { fromDetection: _drop, ...part }` idiom that strips a field on the way
    // into a scene file.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Next's generated-image routes. `next/og` renders their JSX with satori, in
    // Node, at build time — there is no browser, no layout, and no `next/image`
    // runtime to reach for, so `no-img-element`'s advice ("use `<Image />`") is not
    // applicable rather than merely inconvenient. A plain `<img>` is what satori
    // rasterises.
    //
    // Off HERE rather than with a per-line `eslint-disable`, because that directive
    // was not portable: the rule fired on Windows and not on Linux, so the same
    // `eslint .` saw the comment as suppressing something locally and as an unused
    // directive in CI — and an unused directive is itself a warning, which at
    // `--max-warnings 0` is a red build. Two platforms, two answers, no line that
    // satisfies both. A config entry has one answer and states its reason once.
    files: ['app/opengraph-image.tsx', 'app/apple-icon.tsx', 'app/**/opengraph-image.tsx', 'app/**/icon.tsx'],
    rules: { '@next/next/no-img-element': 'off' },
  },
  {
    // A service worker's globals are neither the browser's nor Node's: no
    // `window`, and `self` is a ServiceWorkerGlobalScope. Without this, every
    // `caches` / `clients` reference reads as an undefined global.
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
];

export default config;

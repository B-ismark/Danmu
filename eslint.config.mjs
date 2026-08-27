// ESLint config, flat format.
//
// `next lint` is removed in Next 16, so linting runs through the ESLint CLI directly
// (`pnpm lint` → `eslint .`). Two things had to move for that:
//
//   · The rules. `eslint-config-next` is still what supplies them, but it ships in
//     eslintrc format, so `FlatCompat` bridges it. That is the officially supported
//     path and the one Next's own codemod produces; `@eslint/eslintrc` is a direct
//     devDependency rather than a borrowed transitive of ESLint's, because importing
//     a package you have not declared is how a working lint setup breaks on someone
//     else's install.
//   · The ignore list, out of `.eslintignore` — deprecated in ESLint 9 and silently
//     ignored under flat config, which is the failure mode worth avoiding: it does
//     not error, it just starts linting `public/` and the build output.
//
// `next lint` linted only `app` / `components` / `lib` / `pages` / `src` by default.
// `eslint .` covers `tests/`, `scripts/` and the root config files too, which is a
// deliberate widening — 171 files, and they were already clean.
//
// Two things about this file are load-bearing and easy to undo by accident:
//
//   · **ESLint must be >= 9.** `next build` runs its own lint pass, and it only strips
//     the eslintrc-era options (`useEslintrc`, `extensions`, …) when the installed
//     ESLint is 9+. On 8.57 it sees this flat config, loads `FlatESLint`, then hands it
//     eslintrc options — and the build prints `Invalid Options` and lints nothing while
//     still exiting 0. A silently skipped lint pass that looks like a passing build.
//   · **`next/typescript` is extended, not just `next/core-web-vitals`.** Without it
//     `@typescript-eslint/no-unused-vars` is never enabled, `eslint:recommended` is
//     not in the chain either, and `tsconfig.json` sets no `noUnusedLocals` — so
//     `pnpm lint --max-warnings 0`, `pnpm typecheck` and `next build`'s own lint pass
//     were all structurally incapable of seeing a dead import. Adding it found
//     thirteen across nine files on the first run, one of them a stale `collidesAt`
//     that had outlived its call site. A gate reporting zero because it cannot see
//     the defect is the failure mode this repo keeps finding.
//   · **This file must not be self-ignored.** That same build pass detects the Next
//     plugin by calling `calculateConfigForFile('eslint.config.mjs')` and looking for
//     `@next/next` in the result. A `*.config.mjs` ignore entry (which is what
//     `.eslintignore` used to carry) makes that resolve to an ignored, plugin-less
//     config, so the build warns the plugin is missing even though every Next rule is
//     in fact firing.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

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
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
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

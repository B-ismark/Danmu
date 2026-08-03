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
// `eslint .` covers `tests/` and `scripts/` too, which is a deliberate widening — 168
// files before, and they were already clean.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    // Was `.eslintignore`. `public/` holds vendored ONNX Runtime and model files that
    // are third-party bytes, not source; `weights/` is the local detector export.
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'public/**',
      'weights/**',
      // Build configuration rather than application source, and excluded before this
      // migration too — kept so the change is a move, not a widening.
      '*.config.mjs',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
];

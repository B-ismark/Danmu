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
      'public/**',
      'weights/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
];

export default config;

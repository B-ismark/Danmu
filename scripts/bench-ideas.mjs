// `pnpm bench:ideas`: runs `tests/ideas-bench.test.ts` with IDEAS_BENCH set. A script
// rather than `IDEAS_BENCH=1 vitest …` in package.json because that prefix is POSIX
// shell, and pnpm runs scripts through cmd on Windows, where it is a syntax error.
import { spawnSync } from 'node:child_process';

const r = spawnSync('pnpm', ['exec', 'vitest', 'run', 'tests/ideas-bench.test.ts', '--disableConsoleIntercept'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, IDEAS_BENCH: '1' },
});
process.exit(r.status ?? 1);

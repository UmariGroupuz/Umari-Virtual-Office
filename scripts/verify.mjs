#!/usr/bin/env node
// Full local verification: format:check → lint → typecheck → test → build (API_CONTRACTS §12.2).
// Stops at the first failing step, prints a pass/fail summary and exits non-zero on failure.
// Portable: runs the same from PowerShell, cmd and Git Bash (npm is a .cmd shim on Windows → shell: true).
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STEPS = ['format:check', 'lint', 'typecheck', 'test', 'build'];

/** @type {{ step: string; status: 'pass' | 'fail' | 'skipped'; seconds: number }[]} */
const results = [];
let failed = false;

for (const step of STEPS) {
  if (failed) {
    results.push({ step, status: 'skipped', seconds: 0 });
    continue;
  }
  console.log(`\n=== verify: npm run ${step} ===\n`);
  const started = Date.now();
  // One command string (constant step names only): passing an args array together with shell: true
  // triggers Node's DEP0190 warning.
  const run = spawnSync(`npm run ${step}`, { cwd: repoRoot, stdio: 'inherit', shell: true });
  const seconds = (Date.now() - started) / 1000;
  if (run.error) {
    console.error(`verify: could not start "npm run ${step}": ${run.error.message}`);
  }
  const ok = !run.error && run.status === 0;
  results.push({ step, status: ok ? 'pass' : 'fail', seconds });
  if (!ok) failed = true;
}

console.log('\n=== verify summary ===');
for (const { step, status, seconds } of results) {
  const label = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP';
  const time = status === 'skipped' ? '' : ` (${seconds.toFixed(1)}s)`;
  console.log(`  ${label}  ${step}${time}`);
}
console.log(failed ? '\nverify: FAILED' : '\nverify: all steps passed');
process.exit(failed ? 1 : 0);

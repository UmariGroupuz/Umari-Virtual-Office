// Integration test for the dev launcher's reaper (scripts/dev.mjs --reaper, CR-20). Uses only processes spawned
// by this test (no ports, no dev stack): a stand-in "launcher" and stand-in "children".
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatIdentity, readCreationTimes } from './processIdentity.mjs';

const DEV_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev.mjs');
const sleeper = () =>
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
const exitOf = (child) =>
  child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((resolve) => child.once('exit', resolve));
const running = (child) => child.exitCode === null && child.signalCode === null;
const waitUntil = async (predicate, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return predicate();
};

test('reaper kills only children whose PID + creation time still match once the launcher is gone', async () => {
  const launcher = sleeper();
  const verified = sleeper(); // correct identity → must be killed
  const reused = sleeper(); // wrong creation time = "PID reused by another process" → must NOT be killed
  const unknown = sleeper(); // unknown identity (0) → must NOT be killed
  const own = [launcher, verified, reused, unknown];
  try {
    const created = readCreationTimes([verified.pid, reused.pid]);
    assert.ok(created.get(verified.pid) > 0 && created.get(reused.pid) > 0);
    const reaper = spawn(
      process.execPath,
      [
        DEV_SCRIPT,
        '--reaper',
        String(launcher.pid),
        formatIdentity(verified.pid, created.get(verified.pid)),
        formatIdentity(reused.pid, created.get(reused.pid) - 5000),
        formatIdentity(unknown.pid, 0),
      ],
      { stdio: 'ignore' },
    );
    own.push(reaper);

    await new Promise((r) => setTimeout(r, 800)); // reaper is polling, launcher alive → nothing happens
    assert.ok(
      running(verified) && running(reused) && running(unknown),
      'no kill while launcher lives',
    );

    launcher.kill(); // our own, un-exited child
    await exitOf(launcher);

    assert.ok(await waitUntil(() => !running(verified), 15_000), 'verified child killed');
    await exitOf(reaper);
    assert.ok(running(reused), 'mismatched identity (PID reuse) must not be killed');
    assert.ok(running(unknown), 'unknown identity must not be killed');
  } finally {
    for (const child of own) if (running(child)) child.kill(); // only our own, un-exited children
    await Promise.all(own.map(exitOf));
  }
});

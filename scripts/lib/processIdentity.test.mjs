// Unit tests for process identity (CR-20). Run: npm run test:scripts (also part of `npm test` / `npm run verify`).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  formatIdentity,
  isSameProcess,
  parseIdentity,
  readCreationTimes,
} from './processIdentity.mjs';

/** Fake process table: pid → creation time. */
const fakeTable = (entries) => (pids) =>
  new Map(pids.filter((pid) => entries.has(pid)).map((pid) => [pid, entries.get(pid)]));

describe('isSameProcess (fake process table)', () => {
  const table = new Map([
    [1234, 1_700_000_000_000],
    [5678, 1_700_000_500_000],
  ]);
  const read = fakeTable(table);

  it('same PID and same creation time → same process', () => {
    assert.equal(isSameProcess(1234, 1_700_000_000_000, read), true);
  });
  it('PID reused by a newer process (creation time differs) → not the same', () => {
    assert.equal(isSameProcess(5678, 1_700_000_000_000, read), false);
  });
  it('PID no longer exists → not the same', () => {
    assert.equal(isSameProcess(9999, 1_700_000_000_000, read), false);
  });
  it('unknown recorded identity (0 / NaN) → never the same (do not kill)', () => {
    assert.equal(isSameProcess(1234, 0, read), false);
    assert.equal(isSameProcess(1234, Number.NaN, read), false);
  });
  it('invalid PIDs → not the same, and the table is not even queried', () => {
    let queried = false;
    const spy = (pids) => {
      queried = true;
      return read(pids);
    };
    for (const pid of [0, -1, 1.5, Number.NaN]) assert.equal(isSameProcess(pid, 1, spy), false);
    assert.equal(queried, false);
  });
});

describe('identity argv format', () => {
  it('round-trips pid:created', () => {
    assert.deepEqual(parseIdentity(formatIdentity(42, 1_700_000_000_123)), {
      pid: 42,
      created: 1_700_000_000_123,
    });
  });
  it('unknown creation time is encoded as 0 (never killable)', () => {
    assert.equal(formatIdentity(42, undefined), '42:0');
    assert.equal(formatIdentity(42, Number.NaN), '42:0');
  });
  it('malformed input parses to an unkillable identity', () => {
    for (const bad of ['', '42', 'abc:1', '1:2:3', '-1:5']) {
      assert.deepEqual(parseIdentity(bad), { pid: 0, created: 0 });
    }
  });
});

describe('readCreationTimes (real OS query)', () => {
  it('returns a stable creation time for the current process', () => {
    const first = readCreationTimes([process.pid]).get(process.pid);
    const second = readCreationTimes([process.pid]).get(process.pid);
    assert.ok(Number.isFinite(first) && first > 0, `got ${first}`);
    assert.equal(second, first);
    assert.equal(isSameProcess(process.pid, first), true);
    assert.equal(isSameProcess(process.pid, first - 1000), false);
  });

  it('a child that has exited is no longer "the same process"', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    const created = readCreationTimes([child.pid]).get(child.pid);
    assert.ok(Number.isFinite(created) && created > 0);
    assert.equal(isSameProcess(child.pid, created), true);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill(); // our own child, still un-exited (Node holds its handle)
    await exited;
    assert.equal(isSameProcess(child.pid, created), false);
  });

  it('ignores invalid PIDs and returns an empty map', () => {
    assert.equal(readCreationTimes([0, -5, Number.NaN]).size, 0);
  });
});

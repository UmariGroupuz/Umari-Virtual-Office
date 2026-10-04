// Unit/integration tests for the content-based dev source watcher (QA-6). Temp directories only.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { detectChanges, isWatchedSource, snapshotSources, watchSources } from './sourceWatcher.mjs';

const dirs = [];
const tempRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'vo-watch-test-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'sub', 'b.ts'), 'export const b = 2;\n');
  writeFileSync(join(dir, 'sub', 'b.test.ts'), 'test file\n');
  writeFileSync(join(dir, 'notes.md'), 'not a source\n');
  return dir;
};
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('isWatchedSource', () => {
  it('watches TS/JS/JSON sources and ignores tests and other files', () => {
    for (const f of ['x.ts', 'x.tsx', 'x.mjs', 'x.js', 'x.json'])
      assert.equal(isWatchedSource(f), true, f);
    for (const f of ['x.test.ts', 'x.test.tsx', 'x.test.mjs', 'x.md', 'x.db', 'x.db-wal']) {
      assert.equal(isWatchedSource(f), false, f);
    }
  });
});

describe('snapshot + detectChanges', () => {
  it('reports only real content changes, additions and removals', () => {
    const dir = tempRoot();
    const a = join(dir, 'a.ts');
    const b = join(dir, 'sub', 'b.ts');
    const snapshot = snapshotSources([dir]);
    assert.deepEqual([...snapshot.keys()].sort(), [a, b].sort());

    // Pure read and atime-only update (what NTFS last-access updates look like): no change.
    readFileSync(a);
    const st = statSync(a);
    utimesSync(a, new Date(Date.now() - 2 * 3600_000), st.mtime);
    assert.deepEqual(detectChanges(snapshot, [a, b]), []);

    // mtime-only touch without content change: no change (content hash, not timestamps).
    utimesSync(a, new Date(), new Date(Date.now() + 5000));
    assert.deepEqual(detectChanges(snapshot, [a]), []);

    // Real edit → reported once; restoring the original content → reported again.
    writeFileSync(a, 'export const a = 42;\n');
    assert.deepEqual(detectChanges(snapshot, [a]), [a]);
    assert.deepEqual(detectChanges(snapshot, [a]), []);
    writeFileSync(a, 'export const a = 1;\n');
    assert.deepEqual(detectChanges(snapshot, [a]), [a]);

    // Added and removed files → reported; test files and non-sources → ignored.
    const c = join(dir, 'c.ts');
    writeFileSync(c, 'export {};\n');
    writeFileSync(join(dir, 'sub', 'b.test.ts'), 'changed test\n');
    writeFileSync(join(dir, 'notes.md'), 'changed notes\n');
    assert.deepEqual(
      detectChanges(snapshot, [c, join(dir, 'sub', 'b.test.ts'), join(dir, 'notes.md')]),
      [c],
    );
    unlinkSync(b);
    assert.deepEqual(detectChanges(snapshot, [b]), [b]);
  });
});

describe('watchSources (real fs.watch)', () => {
  it('ignores reads and metadata-only updates, fires on a real edit', async () => {
    const dir = tempRoot();
    const a = join(dir, 'a.ts');
    const b = join(dir, 'sub', 'b.ts');
    const calls = [];
    const watcher = watchSources({
      roots: [dir],
      onChange: (files) => calls.push(files),
      debounceMs: 100,
    });
    try {
      await sleep(300);
      readFileSync(a);
      utimesSync(b, new Date(Date.now() - 2 * 3600_000), statSync(b).mtime); // atime-only notification
      utimesSync(a, new Date(), new Date(Date.now() + 10_000)); // mtime-only touch
      await sleep(700);
      assert.deepEqual(calls, [], 'no restart for reads / metadata-only changes');

      writeFileSync(b, 'export const b = 3;\n');
      for (let i = 0; i < 40 && calls.length === 0; i++) await sleep(100);
      assert.equal(calls.length, 1, 'exactly one change batch for one edit');
      assert.deepEqual(calls[0], [b]);
    } finally {
      watcher.close();
    }
  });
});

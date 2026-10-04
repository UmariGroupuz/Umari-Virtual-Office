// Content-based source watcher for the dev server (QA-6). `node --watch` (and `--watch-path`) restarts on every
// fs.watch event of a loaded file without checking it, and on Windows libuv also reports LAST-ACCESS updates:
// with NTFS last-access updates enabled, merely READING a source file (tsc, eslint, a second server, smoke)
// restarted the dev server. This watcher re-hashes the file on each event and reports a change only when the
// CONTENT changed (or a file was added/removed). Reads, atime and other metadata-only updates never trigger.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Default filter: TS/JS/JSON sources, excluding tests (they are never loaded by the server). */
export function isWatchedSource(file) {
  return /\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/i.test(file) && !/\.test\.[cm]?[jt]sx?$/i.test(file);
}

/** SHA-1 of the file content, or null when it does not exist / is not a readable file. */
export function hashFile(file) {
  try {
    if (!statSync(file).isFile()) return null;
    return createHash('sha1').update(readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** Map absolutePath → content hash for every watched source under the roots. */
export function snapshotSources(roots, filter = isWatchedSource) {
  const snapshot = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (filter(full)) {
        const hash = hashFile(full);
        if (hash !== null) snapshot.set(full, hash);
      }
    }
  };
  for (const root of roots) walk(resolve(root));
  return snapshot;
}

/**
 * Re-checks `files` against `snapshot` (updating it) and returns the paths whose content changed, appeared or
 * disappeared. Unchanged content → not reported.
 */
export function detectChanges(snapshot, files, filter = isWatchedSource) {
  const changed = [];
  for (const file of new Set(files)) {
    if (!filter(file)) continue;
    const before = snapshot.get(file) ?? null;
    const after = hashFile(file);
    if (before === after) continue;
    if (after === null) snapshot.delete(file);
    else snapshot.set(file, after);
    changed.push(file);
  }
  return changed;
}

/**
 * Watches `roots` recursively; calls `onChange(changedFiles)` (debounced) only for real content changes.
 * Returns `{ close }`. When fs.watch cannot name the file, the whole root is re-scanned.
 */
export function watchSources({ roots, onChange, debounceMs = 150, filter = isWatchedSource }) {
  const absRoots = roots.map((r) => resolve(r));
  const snapshot = snapshotSources(absRoots, filter);
  const pending = new Set();
  let rescan = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    const files = [...pending];
    pending.clear();
    for (const root of rescan) {
      const fresh = snapshotSources([root], filter);
      for (const file of fresh.keys()) files.push(file);
      for (const file of snapshot.keys()) if (file.startsWith(root)) files.push(file);
    }
    rescan = new Set();
    const changed = detectChanges(snapshot, files, filter);
    if (changed.length > 0) onChange(changed);
  };
  const watchers = absRoots.map((root) => {
    const watcher = watch(root, { recursive: true }, (_type, name) => {
      if (name) pending.add(join(root, String(name)));
      else rescan.add(root);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
    watcher.on('error', () => {
      /* a vanished directory etc. — keep running; the next event or restart re-syncs */
    });
    return watcher;
  });
  return {
    snapshotSize: () => snapshot.size,
    relative: (file) => relative(process.cwd(), file),
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

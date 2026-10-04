// Process identity = PID + creation time (CR-20). A bare PID is not an identity: Windows (and POSIX) reuse PIDs,
// so any code that kills a process it does not hold a live handle to must first prove it is still the same
// process. Used by scripts/dev.mjs (reaper). Rule: when identity cannot be proven, do not kill.
import { spawnSync } from 'node:child_process';

/**
 * Creation time (ms since epoch) of each given PID that exists now. PIDs that do not exist are absent from the
 * map. Windows: Win32_Process.CreationDate; POSIX: `ps -o lstart=` (second resolution).
 * @param {number[]} pids
 * @param {{ platform?: string, run?: typeof spawnSync }} [options]
 * @returns {Map<number, number>}
 */
export function readCreationTimes(pids, { platform = process.platform, run = spawnSync } = {}) {
  const valid = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  const times = new Map();
  if (valid.length === 0) return times;
  if (platform === 'win32') {
    const filter = valid.map((pid) => `ProcessId=${pid}`).join(' OR ');
    const script = [
      `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object {`,
      "  '{0} {1}' -f $_.ProcessId, [long](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds)",
      '}',
    ].join('\n');
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    for (const line of String(result.stdout ?? '').split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) times.set(Number(m[1]), Number(m[2]));
    }
    return times;
  }
  const result = run('ps', ['-o', 'pid=,lstart=', '-p', valid.join(',')], { encoding: 'utf8' });
  for (const line of String(result.stdout ?? '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    const created = m ? Date.parse(m[2]) : NaN;
    if (m && Number.isFinite(created)) times.set(Number(m[1]), created);
  }
  return times;
}

/**
 * True only when `pid` exists now AND was created at `recordedCreated` (the identity recorded while the process
 * was provably ours). Unknown/zero recorded time, a missing process or any mismatch → false (do not kill).
 * @param {number} pid
 * @param {number} recordedCreated
 * @param {(pids: number[]) => Map<number, number>} [read]
 */
export function isSameProcess(pid, recordedCreated, read = readCreationTimes) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!Number.isFinite(recordedCreated) || recordedCreated <= 0) return false;
  const current = read([pid]).get(pid);
  return current !== undefined && current === recordedCreated;
}

/** `pid:created` (reaper argv format). */
export function formatIdentity(pid, created) {
  return `${pid}:${Number.isFinite(created) && created > 0 ? created : 0}`;
}

/** Parses `pid:created`; malformed input → { pid: 0, created: 0 } (never killable). */
export function parseIdentity(text) {
  const m = /^(\d+):(\d+)$/.exec(String(text));
  return m ? { pid: Number(m[1]), created: Number(m[2]) } : { pid: 0, created: 0 };
}

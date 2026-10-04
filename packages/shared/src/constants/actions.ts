// Action vocabulary (REQ-132, ORIGINAL_REQUEST §19). `action` is free text; this list is informational.

export const KNOWN_ACTIONS = [
  'read_file',
  'write_file',
  'edit_file',
  'search',
  'run_command',
  'git_status',
  'git_diff',
  'git_commit',
  'test',
  'build',
  'browser',
  'wait',
  'error',
] as const;
export type KnownAction = (typeof KNOWN_ACTIONS)[number];

/** Developer Simulator datalist suggestions, in UX §9.3 order. */
export const SIMULATOR_ACTION_SUGGESTIONS = ['run_tests', ...KNOWN_ACTIONS] as const;

// Office rooms (API_CONTRACTS §1.2, §6.3).

export const ROOM_IDS = [
  'management',
  'development',
  'design',
  'infrastructure',
  'quality',
  'ai-lab',
  'documentation',
  'audit',
] as const;
export type RoomId = (typeof ROOM_IDS)[number];

/** In display order; `label` equals the agents' `department`. */
export const ROOMS: readonly { id: RoomId; label: string }[] = Object.freeze([
  { id: 'management', label: 'Management' },
  { id: 'development', label: 'Development' },
  { id: 'design', label: 'Design' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'quality', label: 'Quality' },
  { id: 'ai-lab', label: 'AI Lab' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'audit', label: 'Audit' },
]);

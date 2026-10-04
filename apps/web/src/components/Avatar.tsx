// Avatar (UX §12): monogram of the agent code on the department color; offline → grayscale.
import type { RoomId } from '@vo/shared';
import { cn } from '../lib/cn';
import { DEPARTMENT_VISUALS } from '../lib/statusMeta';

const SIZES = {
  18: 'size-[18px] text-[8px]',
  28: 'size-7 text-[10px]',
  40: 'size-10 text-sm',
} as const;

export function Avatar({
  code,
  roomId,
  size,
  offline = false,
}: {
  code: string;
  roomId: RoomId;
  size: 18 | 28 | 40;
  offline?: boolean;
}) {
  const dept = DEPARTMENT_VISUALS[roomId];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-tight text-text-primary select-none',
        SIZES[size],
        dept.bg,
        dept.ring,
        offline && 'opacity-70 grayscale',
      )}
    >
      {code}
    </span>
  );
}

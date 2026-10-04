// Live-change highlight (UX §4, §6, §7.1): returns a counter that increases whenever `value` changes
// after the first render. Use it as a React `key` with a CSS animation class while it is > 0.
import { useState } from 'react';

export function useChangeFlash(value: unknown): number {
  const [previous, setPrevious] = useState(value);
  const [count, setCount] = useState(0);
  if (!Object.is(previous, value)) {
    // "Storing information from previous renders" pattern (react.dev): adjust state during render.
    setPrevious(value);
    setCount((c) => c + 1);
  }
  return count;
}

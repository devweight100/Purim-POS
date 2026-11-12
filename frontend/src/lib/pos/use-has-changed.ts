'use client';

import { useState } from 'react';

/**
 * true during the render in which `value` differs from the previous render (and on the first render).
 * Lets a dialog reset its form while rendering when it opens, instead of in an effect after paint:
 *
 *   if (useHasChanged(open) && open) { setAmount(''); ... }
 *
 * (React's "storing information from previous renders" pattern; the setters run during render and React
 * re-renders before painting.)
 */
export function useHasChanged<T>(value: T): boolean {
  const [prev, setPrev] = useState<{ value: T } | null>(null);
  if (prev === null || !Object.is(prev.value, value)) {
    setPrev({ value });
    return true;
  }
  return false;
}

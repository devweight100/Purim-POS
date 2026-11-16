import { useSyncExternalStore } from 'react';

const noop = () => () => undefined;

/** true after the first client render (cart in localStorage is only known in the browser). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

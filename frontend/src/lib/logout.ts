import { useAuthStore } from '@/lib/store/auth-store';
import { useShiftStore, CURRENT_SHIFT_CACHE_KEY } from '@/lib/store/shift-store';

/**
 * Sign the current employee out of this device.
 * The shift is NOT closed (closing a shift is a separate step with cash counting); only this
 * device's cached copy of the employee's shift is forgotten, so the next person who logs in sees
 * their own shift from the server. The cart and held bills stay on the device.
 */
export function performLogout() {
  try {
    localStorage.removeItem(CURRENT_SHIFT_CACHE_KEY);
  } catch {
    /* storage unavailable: nothing to forget */
  }
  useShiftStore.setState({ currentShift: null, cashTransactions: [] });
  useAuthStore.getState().logout();
}

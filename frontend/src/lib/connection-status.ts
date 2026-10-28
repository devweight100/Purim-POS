import { create } from 'zustand';

export const useConnectionStatus = create<{
  unavailable: boolean;
  pending: number;
  failed: number;
  syncing: boolean;
  error: string | null;
}>(() => ({ unavailable: false, pending: 0, failed: 0, syncing: false, error: null }));

export function reportConnection(unavailable: boolean) {
  useConnectionStatus.setState({ unavailable });
}

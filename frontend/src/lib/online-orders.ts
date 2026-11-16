'use client';

import { create } from 'zustand';
import { apiFetch } from './api';

/** Back office: counts behind the "ออเดอร์ออนไลน์" badge (new orders + LINE link requests + orders to take payment for). */
export interface OnlineCounts {
  new: number;
  linkRequests: number;
  payable: number;
  statuses: Record<string, number>;
}

interface State {
  counts: OnlineCounts | null;
  refresh: () => Promise<OnlineCounts | null>;
}

export const useOnlineCounts = create<State>()((set) => ({
  counts: null,
  refresh: async () => {
    try {
      const counts = await apiFetch<OnlineCounts>('/online-shop/counts');
      set({ counts });
      return counts;
    } catch {
      return null;
    }
  },
}));

/** Short two-tone chime (WebAudio; no sound file). Silently does nothing where audio is blocked. */
export function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* ignore */
  }
}

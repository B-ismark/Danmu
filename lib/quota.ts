'use client';

// Local quota tracker for the one remaining Gemini call — multi-image room
// detection (optional; the local ONNX detector and manual boxes need no key).
// Resets at Pacific midnight. Free tier: gemini-2.5-flash ≈ 20 RPD.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ModelKey = 'flash';

const LIMITS: Record<ModelKey, number> = {
  flash: 20,
};

type QuotaState = {
  /** ISO date string for the day these counts apply to (Pacific). */
  day: string;
  counts: Record<ModelKey, number>;
  bump: (key: ModelKey) => void;
  reset: () => void;
};

function pacificDay(): string {
  // Pacific midnight reset — approximate using UTC-8.
  const d = new Date(Date.now() - 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export const useQuota = create<QuotaState>()(
  persist(
    (set, get) => ({
      day: pacificDay(),
      counts: { flash: 0 },
      bump: (key) => {
        const today = pacificDay();
        if (get().day !== today) {
          set({ day: today, counts: { flash: 0 } });
        }
        set((s) => ({ counts: { ...s.counts, [key]: (s.counts[key] ?? 0) + 1 } }));
      },
      reset: () => set({ day: pacificDay(), counts: { flash: 0 } }),
    }),
    { name: 'danmu-quota', storage: createJSONStorage(() => localStorage) },
  ),
);

export function quotaLimit(key: ModelKey): number {
  return LIMITS[key];
}

export function quotaSummary(): { used: number; limit: number; per: Record<ModelKey, { used: number; limit: number }> } {
  const counts = useQuota.getState().counts;
  const per = { flash: { used: counts.flash ?? 0, limit: LIMITS.flash } };
  return { used: per.flash.used, limit: LIMITS.flash, per };
}

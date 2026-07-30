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

// en-CA gives ISO-shaped YYYY-MM-DD, and the timeZone option does the DST
// arithmetic for us. Subtracting a fixed 8 hours was wrong for the ~8 months a
// year Pacific runs on daylight time (UTC-7), so the counter rolled over an hour
// off the reset the UI promises and a run in that window landed on the wrong day.
const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pacificDay(): string {
  return PACIFIC_DAY.format(new Date());
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


'use client';

// Local quota tracker. Increments on every Gemini call. Resets at Pacific midnight.
// Free-tier limits (per Google docs, June 2026):
//   gemini-2.5-flash:        20 RPD
//   gemini-2.5-flash-lite:   1500 RPD (varies — sometimes 20)
//   gemini-2.5-flash-image:  ~500 RPD (~10 RPM) — preview retired 2026-01-15

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ModelKey = 'flash' | 'flash-lite' | 'flash-image';

const LIMITS: Record<ModelKey, number> = {
  flash: 20,
  'flash-lite': 1500,
  'flash-image': 500,
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
      counts: { flash: 0, 'flash-lite': 0, 'flash-image': 0 },
      bump: (key) => {
        const today = pacificDay();
        if (get().day !== today) {
          set({ day: today, counts: { flash: 0, 'flash-lite': 0, 'flash-image': 0 } });
        }
        set((s) => ({ counts: { ...s.counts, [key]: (s.counts[key] ?? 0) + 1 } }));
      },
      reset: () => set({ day: pacificDay(), counts: { flash: 0, 'flash-lite': 0, 'flash-image': 0 } }),
    }),
    { name: 'danmu-quota', storage: createJSONStorage(() => localStorage) },
  ),
);

export function quotaLimit(key: ModelKey): number {
  return LIMITS[key];
}

export function quotaSummary(): { used: number; limit: number; per: Record<ModelKey, { used: number; limit: number }> } {
  const counts = useQuota.getState().counts;
  const per = {
    flash: { used: counts.flash, limit: LIMITS.flash },
    'flash-lite': { used: counts['flash-lite'], limit: LIMITS['flash-lite'] },
    'flash-image': { used: counts['flash-image'], limit: LIMITS['flash-image'] },
  };
  const used = counts.flash + counts['flash-lite'] + counts['flash-image'];
  const limit = LIMITS.flash + LIMITS['flash-lite'] + LIMITS['flash-image'];
  return { used, limit, per };
}

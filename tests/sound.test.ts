import { describe, it, expect } from 'vitest';
import { voice, playSound, type SoundName } from '@/lib/sound';
import { useSettings } from '@/lib/store';

// The studio's sounds (lib/sound.ts). There is no browser here, so what is pinned
// is the palette's own promises — the things that make a UI sound one you stop
// noticing rather than one you mute.

const ALL: SoundName[] = ['pick', 'drop', 'snap', 'blocked', 'tick', 'select', 'chime'];

describe('the sound palette', () => {
  it('keeps every sound short and quiet', () => {
    for (const n of ALL) {
      const v = voice(n, { size: 1, brightness: 1 });
      const parts = [...v.tones.map((t) => ({ end: ('at' in t ? t.at ?? 0 : 0) + t.dur, peak: t.peak })), ...v.knocks.map((k) => ({ end: k.at + k.dur, peak: k.peak }))];
      expect(parts.length, n).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.end, `${n} lasts ${p.end}s`).toBeLessThanOrEqual(0.35);
        expect(p.peak, `${n} peaks at ${p.peak}`).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('sets a bigger piece down lower than a small one', () => {
    const small = voice('drop', { size: 0.05 }).tones[0].to;
    const big = voice('drop', { size: 1 }).tones[0].to;
    expect(big).toBeLessThan(small);
  });

  it('ticks brighter the higher the sun', () => {
    expect(voice('tick', { brightness: 1 }).tones[0].from).toBeGreaterThan(voice('tick', { brightness: 0 }).tones[0].from);
  });

  it('is silent, and safe, with no Web Audio and with sound switched off', () => {
    // Node has no AudioContext: every call must be a no-op, never a throw.
    useSettings.getState().setSound(true);
    for (const n of ALL) expect(() => playSound(n)).not.toThrow();
    useSettings.getState().setSound(false);
    expect(() => playSound('drop')).not.toThrow();
  });
});

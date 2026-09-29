import { describe, it, expect } from 'vitest';
import { voice, playSound, glide, glideStop, glideVoice, GLIDE_MAX, SOUND_NAMES } from '@/lib/sound';
import { useSettings } from '@/lib/store';

// The studio's sounds (lib/sound.ts). There is no browser here, so what is pinned
// is the palette's own promises — the things that make a UI sound one you stop
// noticing rather than one you mute.

const ALL = SOUND_NAMES;

describe('the sound palette', () => {
  it('keeps every sound short and quiet', () => {
    for (const n of ALL) {
      const v = voice(n, { size: 1, brightness: 1 });
      const parts = [...v.tones.map((t) => ({ end: (t.at ?? 0) + t.dur, peak: t.peak })), ...v.knocks.map((k) => ({ end: k.at + k.dur, peak: k.peak }))];
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

  it('names every sound once', () => {
    expect(new Set(ALL).size).toBe(ALL.length);
    expect(ALL.length).toBe(20);
  });

  it('pairs the sounds that are one another reversed', () => {
    const first = (n: 'undo' | 'redo') => voice(n).tones.map((t) => t.from);
    expect(first('undo')[0]).toBeGreaterThan(first('undo')[1]);
    expect(first('redo')[0]).toBeLessThan(first('redo')[1]);
    const on = voice('toggle', { brightness: 1 }).tones.map((t) => t.from);
    const off = voice('toggle', { brightness: 0 }).tones.map((t) => t.from);
    expect(on[1]).toBeGreaterThan(on[0]);
    expect(off[1]).toBeLessThan(off[0]);
    expect(voice('dawn').tones.at(-1)!.from).toBeGreaterThan(voice('dawn').tones[0].from);
    expect(voice('dusk').tones.at(-1)!.from).toBeLessThan(voice('dusk').tones[0].from);
  });
});

describe('the glide', () => {
  it('is silent at rest and never louder than its ceiling', () => {
    expect(glideVoice(0).gain).toBe(0);
    for (const s of [0.1, 1, 5, 1e9, Infinity, NaN, -3]) {
      const g = glideVoice(s, { size: 1 }).gain;
      expect(g, String(s)).toBeGreaterThanOrEqual(0);
      expect(g, String(s)).toBeLessThanOrEqual(GLIDE_MAX);
    }
  });

  it('gets louder with speed, lower with size, and brighter with the sky', () => {
    expect(glideVoice(1).gain).toBeGreaterThan(glideVoice(0.2).gain);
    expect(glideVoice(1, { size: 1 }).cutoff).toBeLessThan(glideVoice(1, { size: 0 }).cutoff);
    expect(glideVoice(1, { brightness: 1 }).cutoff).toBeGreaterThan(glideVoice(1, { brightness: 0 }).cutoff);
  });

  it('is safe with no Web Audio', () => {
    useSettings.getState().setSound(true);
    expect(() => glide(1)).not.toThrow();
    expect(() => glideStop()).not.toThrow();
  });
});

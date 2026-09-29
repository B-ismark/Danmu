'use client';

// The studio's sounds: small, soft, and made on the spot.
//
// Every sound here is SYNTHESISED with the Web Audio API — an oscillator or a
// burst of filtered noise through a short envelope — rather than played from a
// file. Three reasons, in order:
//
//   1. **Local-first.** A sample is an asset to fetch, cache and allow-list; a
//      synthesised tick is forty lines of arithmetic and never leaves the tab.
//   2. **They can respond.** A drop is lower for a bigger piece, the sun's tick is
//      brighter the higher the sun, and a sample would need a copy per pitch.
//   3. **They stay small.** A sound design for a tool you sit in for an hour has to
//      be one you stop noticing. Nothing here is longer than a quarter-second or
//      louder than a light tap, and nothing loops.
//
// The palette is wood and felt: a pick-up is a soft rising "pop", a set-down a
// muted knock whose pitch follows the piece's size, a snap is a small bright tick,
// a refusal a low double bump — the sound of pushing against something. The sun
// scrub ticks once per hour it passes, like a dial with detents.
//
// **Sound is a preference and it is honoured before anything is built**:
// `useSettings().sound` gates every call, and no `AudioContext` exists until the
// first sound is actually wanted — which is always inside a press, so the
// browser's autoplay rule is met by construction rather than worked around.
// `prefers-reduced-motion` does not mute it (motion and sound are different
// senses), but the setting is one press away in Settings and in the View panel.

import { useSettings } from './store';

export type SoundName = 'pick' | 'drop' | 'snap' | 'blocked' | 'tick' | 'select' | 'chime';

export type SoundOptions = {
  /** 0–1: how big the thing is. Lowers a drop's pitch and lengthens it. */
  size?: number;
  /** 0–1: how bright. The sun's tick rises with its elevation. */
  brightness?: number;
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
/** Per-sound last-played time, so a sound triggered every frame plays at most
 *  once per `MIN_GAP_S` and a fast scrub does not buzz. */
const last: Partial<Record<SoundName, number>> = {};
const MIN_GAP_S: Record<SoundName, number> = {
  pick: 0.08,
  drop: 0.08,
  snap: 0.09,
  blocked: 0.5,
  tick: 0.045,
  select: 0.06,
  chime: 0.15,
};

/** The overall level. Deliberately low: these sit under whatever else is playing
 *  on the machine, and a UI that is louder than a notification is a UI people mute. */
const MASTER_GAIN = 0.32;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  // A quarter-second of white noise, made once: the body of every knock.
  noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.25), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

/** A pitched blip: `from` Hz gliding to `to` Hz over `dur` s, with a fast attack
 *  and an exponential tail — the shape of anything struck rather than bowed. */
function tone(a: AudioContext, out: AudioNode, t0: number, type: OscillatorType, from: number, to: number, dur: number, peak: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A band of noise: the felt-and-wood thud under a drop. */
function knock(a: AudioContext, out: AudioNode, t0: number, freq: number, dur: number, peak: number) {
  if (!noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const clamp01 = (x: number | undefined, d: number) => Math.min(1, Math.max(0, x ?? d));

/** What each sound IS. Exported so `tests/sound.test.ts` can hold the palette to
 *  its own promises (short, quiet, a bigger piece lands lower) without a browser. */
export function voice(name: SoundName, opts: SoundOptions = {}) {
  const size = clamp01(opts.size, 0.4);
  const bright = clamp01(opts.brightness, 0.5);
  switch (name) {
    case 'pick':
      return { tones: [{ type: 'sine' as const, from: 420, to: 720, dur: 0.07, peak: 0.22 }], knocks: [] };
    case 'drop': {
      // Bigger pieces land lower and a touch longer: a sofa is not a vase.
      const f = 210 - 120 * size;
      return {
        tones: [{ type: 'sine' as const, from: f * 1.6, to: f, dur: 0.1 + 0.06 * size, peak: 0.3 }],
        knocks: [{ at: 0, freq: 900 - 500 * size, dur: 0.06 + 0.04 * size, peak: 0.16 }],
      };
    }
    case 'snap':
      return { tones: [{ type: 'triangle' as const, from: 1900, to: 1500, dur: 0.035, peak: 0.12 }], knocks: [] };
    case 'blocked':
      return {
        tones: [
          { type: 'sine' as const, from: 150, to: 120, dur: 0.07, peak: 0.26, at: 0 },
          { type: 'sine' as const, from: 150, to: 110, dur: 0.09, peak: 0.2, at: 0.09 },
        ],
        knocks: [],
      };
    case 'tick':
      return {
        tones: [{ type: 'sine' as const, from: 900 + 700 * bright, to: 800 + 600 * bright, dur: 0.03, peak: 0.07 }],
        knocks: [],
      };
    case 'select':
      return { tones: [{ type: 'sine' as const, from: 1100, to: 950, dur: 0.035, peak: 0.08 }], knocks: [] };
    case 'chime':
      // A major third, like a small marimba: the named times of day.
      return {
        tones: [
          { type: 'sine' as const, from: 660, to: 655, dur: 0.22, peak: 0.13, at: 0 },
          { type: 'sine' as const, from: 830, to: 825, dur: 0.24, peak: 0.11, at: 0.07 },
        ],
        knocks: [],
      };
  }
}

/** Play one of the studio's sounds, if sound is on. Safe to call anywhere — on the
 *  server, in a test, in a browser with no Web Audio — and from every frame. */
export function playSound(name: SoundName, opts?: SoundOptions): void {
  if (!useSettings.getState().sound) return;
  const a = audio();
  if (!a || !master) return;
  // A context created outside a gesture starts suspended; every call here is
  // inside one, so resuming is the browser's own rule being met, not dodged.
  if (a.state === 'suspended') void a.resume();
  const now = a.currentTime;
  if (now - (last[name] ?? -1) < MIN_GAP_S[name]) return;
  last[name] = now;
  const v = voice(name, opts);
  for (const t of v.tones) {
    tone(a, master, now + ('at' in t ? (t.at ?? 0) : 0), t.type, t.from, t.to, t.dur, t.peak);
  }
  for (const k of v.knocks) knock(a, master, now + k.at, k.freq, k.dur, k.peak);
}

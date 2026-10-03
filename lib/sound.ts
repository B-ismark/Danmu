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
// a refusal a low double bump — the sound of pushing against something. The clock
// ticks once per hour it passes, like a dial with detents, and greets sunrise and
// sunset with three quiet notes. Under anything carried runs the glide (below).
//
// **Who plays what.** A gesture plays its own pick-up and set-down, because only
// the gesture knows whether the set-down was refused. Everything else — a piece
// added, deleted, recoloured, turned, resized, hidden, the clock, the weather — is
// heard from the stores by `components/studio/SoundCues.tsx`, which asks
// `lib/sound-cues.ts` which ONE sound a change deserves. So a change sounds the same
// whichever of its four or five ways in was used.
//
// **Sound is a preference and it is honoured before anything is built**:
// `useSettings().sound` gates every call, and no `AudioContext` exists until the
// first sound is actually wanted — which is always inside a press, so the
// browser's autoplay rule is met by construction rather than worked around.
// `prefers-reduced-motion` does not mute it (motion and sound are different
// senses), but the setting is one press away in the View panel (Sounds).

import { useSettings } from './store';

export type SoundName =
  | 'pick'
  | 'drop'
  | 'snap'
  | 'blocked'
  | 'tick'
  | 'select'
  | 'chime'
  | 'place'
  | 'remove'
  | 'brush'
  | 'turn'
  | 'stretch'
  | 'nudge'
  | 'shuffle'
  | 'toggle'
  | 'undo'
  | 'redo'
  | 'cloud'
  | 'dawn'
  | 'dusk';

/** Every sound, in one list, so the tests sweep the palette rather than a sample. */
export const SOUND_NAMES: readonly SoundName[] = [
  'pick', 'drop', 'snap', 'blocked', 'tick', 'select', 'chime', 'place', 'remove', 'brush',
  'turn', 'stretch', 'nudge', 'shuffle', 'toggle', 'undo', 'redo', 'cloud', 'dawn', 'dusk',
];

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
  place: 0.1,
  remove: 0.1,
  brush: 0.12,
  turn: 0.05,
  stretch: 0.05,
  nudge: 0.06,
  shuffle: 0.3,
  toggle: 0.08,
  undo: 0.08,
  redo: 0.08,
  cloud: 0.4,
  dawn: 0.6,
  dusk: 0.6,
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
  // Switched off is silent NOW, glide included, and the device let go of.
  useSettings.subscribe((st, prev) => {
    if (prev.sound && !st.sound) sleep();
  });
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  // A quarter-second of white noise, made once: the body of every knock.
  // Two seconds rather than a quarter: the glide LOOPS this buffer, and a short
  // loop of noise is audible as a flutter at its own repeat rate.
  noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

// ── Going idle ─────────────────────────────────────────────────────────────────
//
// A running AudioContext holds the audio device open — on a laptop that is the
// output kept awake, on Bluetooth headphones a link that never sleeps — and the
// glide's looping noise source ran at zero gain forever once built. So two seconds
// after the last sound the glide is torn down and the context suspended, and the
// next sound wakes it. Resumed on anything but `'running'`: iOS has an
// `'interrupted'` state too (a call, Siri), in which `currentTime` stops, and a
// frozen clock would make `MIN_GAP_S` refuse every sound after it.
const IDLE_MS = 2000;
let idle: ReturnType<typeof setTimeout> | null = null;

function sleep(): void {
  if (idle) clearTimeout(idle);
  idle = null;
  dropGlide();
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

function wake(a: AudioContext): void {
  // Rejected outside a gesture on Safari; the next sound, inside one, retries.
  if (a.state !== 'running') a.resume().catch(() => {});
  if (idle) clearTimeout(idle);
  idle = setTimeout(sleep, IDLE_MS);
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
function knock(a: AudioContext, out: AudioNode, t0: number, freq: number, dur: number, peak: number, attack = 0.004) {
  if (!noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const clamp01 = (x: number | undefined, d: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? (x as number) : d));

type Tone = { type: OscillatorType; from: number; to: number; dur: number; peak: number; at?: number };
type Knock = { at: number; freq: number; dur: number; peak: number; attack?: number };
export type Voice = { tones: Tone[]; knocks: Knock[] };

/** What each sound IS. Exported so `tests/sound.test.ts` can hold the palette to
 *  its own promises (short, quiet, a bigger piece lands lower) without a browser. */
export function voice(name: SoundName, opts: SoundOptions = {}): Voice {
  const size = clamp01(opts.size, 0.4);
  const bright = clamp01(opts.brightness, 0.5);
  switch (name) {
    case 'pick':
      return { tones: [{ type: 'sine', from: 420, to: 720, dur: 0.07, peak: 0.22 }], knocks: [] };
    case 'drop': {
      // Bigger pieces land lower and a touch longer: a sofa is not a vase.
      const f = 210 - 120 * size;
      return {
        tones: [{ type: 'sine', from: f * 1.6, to: f, dur: 0.1 + 0.06 * size, peak: 0.3 }],
        knocks: [{ at: 0, freq: 900 - 500 * size, dur: 0.06 + 0.04 * size, peak: 0.16 }],
      };
    }
    case 'snap':
      return { tones: [{ type: 'triangle', from: 1900, to: 1500, dur: 0.035, peak: 0.12 }], knocks: [] };
    case 'blocked':
      return {
        tones: [
          { type: 'sine', from: 150, to: 120, dur: 0.07, peak: 0.26, at: 0 },
          { type: 'sine', from: 150, to: 110, dur: 0.09, peak: 0.2, at: 0.09 },
        ],
        knocks: [],
      };
    case 'tick':
      return {
        tones: [{ type: 'sine', from: 900 + 700 * bright, to: 800 + 600 * bright, dur: 0.03, peak: 0.07 }],
        knocks: [],
      };
    case 'select':
      return { tones: [{ type: 'sine', from: 1100, to: 950, dur: 0.035, peak: 0.08 }], knocks: [] };
    case 'chime':
      // A major third, like a small marimba: the named times of day.
      return {
        tones: [
          { type: 'sine', from: 660, to: 655, dur: 0.22, peak: 0.13, at: 0 },
          { type: 'sine', from: 830, to: 825, dur: 0.24, peak: 0.11, at: 0.07 },
        ],
        knocks: [],
      };
    case 'place': {
      // A new piece arriving: a pop that lands, the pick-up and the set-down in one.
      const f = 560 - 220 * size;
      return {
        tones: [{ type: 'sine', from: f, to: f * 1.5, dur: 0.06, peak: 0.18 }],
        knocks: [{ at: 0.05, freq: 1000 - 450 * size, dur: 0.07, peak: 0.12 }],
      };
    }
    case 'remove':
      // The pop in reverse, with a breath of air: it is gone, not broken.
      return {
        tones: [{ type: 'sine', from: 760, to: 300, dur: 0.12, peak: 0.15 }],
        knocks: [{ at: 0, freq: 2600, dur: 0.1, peak: 0.05, attack: 0.02 }],
      };
    case 'brush':
      // A soft swish — two strokes of a wide brush — for a colour.
      return {
        tones: [],
        knocks: [
          { at: 0, freq: 3200, dur: 0.14, peak: 0.07, attack: 0.04 },
          { at: 0.07, freq: 2300, dur: 0.16, peak: 0.05, attack: 0.05 },
        ],
      };
    case 'turn':
      // A ratchet detent: two small clicks close together.
      return {
        tones: [
          { type: 'triangle', from: 1400, to: 1250, dur: 0.018, peak: 0.07, at: 0 },
          { type: 'triangle', from: 1150, to: 1050, dur: 0.018, peak: 0.05, at: 0.025 },
        ],
        knocks: [],
      };
    case 'stretch':
      // Growing rises, shrinking falls. `brightness` 1 is bigger, 0 smaller.
      return {
        tones: [
          bright >= 0.5
            ? { type: 'sine', from: 480, to: 700, dur: 0.06, peak: 0.08 }
            : { type: 'sine', from: 700, to: 480, dur: 0.06, peak: 0.08 },
        ],
        knocks: [],
      };
    case 'nudge':
      // One arrow-key step: the smallest knock there is.
      return { tones: [], knocks: [{ at: 0, freq: 800 - 300 * size, dur: 0.035, peak: 0.1 }] };
    case 'shuffle':
      // Several pieces rearranged at once — Suggest, a tidy, a theme — as a quick
      // run of knocks rather than a pile-up of drops.
      return {
        tones: [],
        knocks: [
          { at: 0, freq: 700, dur: 0.05, peak: 0.12 },
          { at: 0.07, freq: 950, dur: 0.05, peak: 0.1 },
          { at: 0.14, freq: 600, dur: 0.06, peak: 0.12 },
        ],
      };
    case 'toggle':
      // On steps up a fifth, off steps down one.
      return bright >= 0.5
        ? {
            tones: [
              { type: 'sine', from: 880, to: 880, dur: 0.04, peak: 0.07, at: 0 },
              { type: 'sine', from: 1320, to: 1320, dur: 0.05, peak: 0.07, at: 0.045 },
            ],
            knocks: [],
          }
        : {
            tones: [
              { type: 'sine', from: 1320, to: 1320, dur: 0.04, peak: 0.07, at: 0 },
              { type: 'sine', from: 880, to: 880, dur: 0.05, peak: 0.07, at: 0.045 },
            ],
            knocks: [],
          };
    case 'undo':
      // A little step backwards: two notes falling.
      return {
        tones: [
          { type: 'sine', from: 940, to: 900, dur: 0.05, peak: 0.08, at: 0 },
          { type: 'sine', from: 700, to: 670, dur: 0.06, peak: 0.08, at: 0.05 },
        ],
        knocks: [],
      };
    case 'redo':
      return {
        tones: [
          { type: 'sine', from: 700, to: 720, dur: 0.05, peak: 0.08, at: 0 },
          { type: 'sine', from: 900, to: 940, dur: 0.06, peak: 0.08, at: 0.05 },
        ],
        knocks: [],
      };
    case 'cloud':
      // Overcast rolling in: a slow, low swell of air with no note in it.
      return { tones: [], knocks: [{ at: 0, freq: 420, dur: 0.34, peak: 0.12, attack: 0.14 }] };
    case 'dawn':
      // The sun clearing the horizon — the moon in the day strip opening into the sun.
      // A four-note phrase climbing a major arpeggio (G C E G), each note leaning up
      // into its pitch, so it lifts the way the light does. Very quiet.
      return {
        tones: [
          { type: 'sine', from: 770, to: 784, dur: 0.16, peak: 0.045, at: 0 },
          { type: 'sine', from: 1030, to: 1047, dur: 0.16, peak: 0.045, at: 0.06 },
          { type: 'sine', from: 1300, to: 1319, dur: 0.16, peak: 0.04, at: 0.12 },
          { type: 'sine', from: 1545, to: 1568, dur: 0.17, peak: 0.04, at: 0.18 },
        ],
        knocks: [],
      };
    case 'dusk':
      // …and going down: the sun closing into the moon. The same shape falling through
      // A minor (E C A E), each note settling down onto its pitch, a little lower and a
      // little softer at the end, like the light going.
      return {
        tones: [
          { type: 'sine', from: 1335, to: 1319, dur: 0.16, peak: 0.045, at: 0 },
          { type: 'sine', from: 1060, to: 1047, dur: 0.16, peak: 0.045, at: 0.06 },
          { type: 'sine', from: 890, to: 880, dur: 0.16, peak: 0.042, at: 0.12 },
          { type: 'sine', from: 667, to: 659, dur: 0.17, peak: 0.04, at: 0.18 },
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
  // A context created outside a gesture starts suspended; resuming is the
  // browser's own rule being met, not dodged — see `wake`.
  wake(a);
  const now = a.currentTime;
  if (now - (last[name] ?? -1) < MIN_GAP_S[name]) return;
  last[name] = now;
  const v = voice(name, opts);
  for (const t of v.tones) {
    tone(a, master, now + (t.at ?? 0), t.type, t.from, t.to, t.dur, t.peak);
  }
  for (const k of v.knocks) knock(a, master, now + k.at, k.freq, k.dur, k.peak, k.attack);
}

// ── The glide ──────────────────────────────────────────────────────────────────
//
// The one sound that is not a blip: a soft rush of air under anything being
// carried — a piece, a wall, the sun. It is looping filtered noise whose level
// follows how fast the thing is moving, so a slow careful move is nearly silent
// and a quick swing is a breath, and it dies by itself a moment after the hand
// stops. Nothing has to remember to switch it off: every `glide()` schedules its
// own fade, and the next one cancels that fade if the movement carries on.

export type GlideOptions = {
  /** 0–1: how big the thing is. Bigger is lower and a touch louder. */
  size?: number;
  /** 0–1: how bright the air is. The sun's glide follows the sky. */
  brightness?: number;
};

/** The loudest a glide gets. Under a tick: this plays for seconds at a time. */
export const GLIDE_MAX = 0.1;
/** How long the air lingers after the last movement, in seconds. */
const GLIDE_TAIL_S = 0.09;

/** What a glide sounds like at a given speed — pure, so it can be held to its
 *  promises without a browser. `speed` is metres a second (or its equivalent). */
export function glideVoice(speed: number, opts: GlideOptions = {}): { gain: number; cutoff: number } {
  const size = clamp01(opts.size, 0.4);
  const bright = clamp01(opts.brightness, 0.5);
  // Walking pace (about 1.2 m/s) is full; nothing moving is nothing.
  const v = Math.min(1, Math.max(0, Number.isFinite(speed) ? speed : 0) / 1.2);
  return {
    gain: GLIDE_MAX * (0.55 + 0.45 * size) * Math.sqrt(v),
    cutoff: (380 + 1700 * bright) * (1 - 0.45 * size) * (0.7 + 0.3 * v),
  };
}

type GlideNodes = { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
let glideNodes: GlideNodes | null = null;

function dropGlide(): void {
  if (!glideNodes) return;
  try {
    glideNodes.src.stop();
  } catch {
    // Already stopped.
  }
  glideNodes.src.disconnect();
  glideNodes.gain.disconnect();
  glideNodes = null;
}

function glideChain(a: AudioContext): GlideNodes | null {
  if (glideNodes) return glideNodes;
  if (!noise || !master) return null;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.6;
  const gain = a.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start();
  glideNodes = { src, gain, filter };
  return glideNodes;
}

/** Sound the glide for one sample of movement. Call it as often as the movement
 *  is measured; it fades out by itself when the calls stop. */
export function glide(speed: number, opts?: GlideOptions): void {
  if (!useSettings.getState().sound) return;
  const { gain, cutoff } = glideVoice(speed, opts);
  // Never build an audio graph to play silence.
  if (gain <= 0 && !glideNodes) return;
  const a = audio();
  if (!a) return;
  wake(a);
  const g = glideChain(a);
  if (!g) return;
  const now = a.currentTime;
  g.gain.gain.cancelScheduledValues(now);
  g.gain.gain.setTargetAtTime(gain, now, 0.03);
  g.gain.gain.setTargetAtTime(0, now + GLIDE_TAIL_S, 0.07);
  g.filter.frequency.setTargetAtTime(cutoff, now, 0.05);
}

/** Stop the glide now — the drop that ends a drag should not have air under it. */
export function glideStop(): void {
  if (!glideNodes || !ctx) return;
  const now = ctx.currentTime;
  glideNodes.gain.gain.cancelScheduledValues(now);
  glideNodes.gain.gain.setTargetAtTime(0, now, 0.03);
}

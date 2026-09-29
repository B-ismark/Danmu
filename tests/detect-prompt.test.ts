import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildDetectPrompt, cloudRows, readCloudReply } from '@/lib/detect-prompt';
import { detectionBox } from '@/lib/local-detect';
import { SLIVER } from '@/lib/photo-geometry';
import { stripComments } from './helpers/source';
import { CATALOG_SHAPES_ORDERED } from '@/lib/scene-spec';

const ROOM = { width: 5.6, depth: 4.2, height: 2.8, layoutId: 'rect' as const };

/** The block that describes where the lens pointed, one line per wall. The only
 *  part of the prompt that must shrink with the photo set — the coordinate system
 *  above it names all four walls on purpose, because x and z are defined against
 *  them whether or not anyone photographed them. */
function cameraBlock(prompt: string): string {
  const from = prompt.indexOf('CAMERA PER SLOT:');
  const to = prompt.indexOf('DEPTH ESTIMATION:');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return prompt.slice(from, to);
}

describe('buildDetectPrompt counts the photos it is actually given', () => {
  it('describes four walls when there are four', () => {
    const p = buildDetectPrompt(ROOM, ['n', 'e', 's', 'w']);
    expect(p).toContain('You will receive 4 photos of a single room, one per wall (NORTH, EAST, SOUTH, WEST)');
    expect(p).toContain('rotating clockwise');
    expect(p).not.toContain('was NOT');
    expect(p).not.toContain('were NOT');
    for (const line of ['- N slot:', '- E slot:', '- S slot:', '- W slot:']) {
      expect(cameraBlock(p)).toContain(line);
    }
  });

  it('says one photo, singular, and describes only that wall', () => {
    // The bug this pins: the opening line read "You will receive 4 photos … one
    // per wall (NORTH, EAST, SOUTH, WEST)" whatever was attached, and the camera
    // notes described all four. One photo is a supported way to use this screen.
    const p = buildDetectPrompt(ROOM, ['e']);
    expect(p).toContain('You will receive 1 photo of a single room, showing the EAST wall.');
    // Singular throughout, not just in the count.
    expect(p.split('\n')[0]).not.toContain('photos');
    expect(p).toContain('the photo attached');
    // Nothing to rotate between.
    expect(p).not.toContain('rotating clockwise');

    const cam = cameraBlock(p);
    expect(cam).toContain('- E slot:');
    for (const absent of ['- N slot:', '- S slot:', '- W slot:']) {
      expect(cam).not.toContain(absent);
    }
  });

  it('names the walls nobody photographed as missing', () => {
    // Left implicit, "one per wall" plus a coordinate system covering all four
    // reads as an instruction to account for all four — which is an invitation to
    // furnish a wall from nothing.
    const p = buildDetectPrompt(ROOM, ['n', 'e']);
    expect(p).toContain('ONLY 2 of the four walls were photographed');
    expect(p).toContain('The SOUTH and WEST walls were NOT');
    expect(p).toContain('do not infer furniture for a wall you were not shown');
  });

  it('agrees with itself about the singular', () => {
    const p = buildDetectPrompt(ROOM, ['n', 'e', 's']);
    expect(p).toContain('ONLY 3 of the four walls were photographed');
    expect(p).toContain('The WEST wall was NOT');
    const one = buildDetectPrompt(ROOM, ['s']);
    expect(one).toContain('ONLY 1 of the four walls was photographed');
    expect(one).toContain('walls were NOT');
  });

  it('keeps the coordinate system whole, whatever was photographed', () => {
    // Deliberately NOT trimmed with the camera block: `position` is reported in
    // room coordinates, and those are defined by all four wall planes. A prompt
    // that dropped the unphotographed walls here would leave the model no frame
    // to put x and z in.
    const p = buildDetectPrompt(ROOM, ['n']);
    expect(p).toContain('N wall lies at z = -2.10');
    expect(p).toContain('S wall at z = 2.10');
    expect(p).toContain('E wall at x = 2.80');
    expect(p).toContain('W wall at x = -2.80');
  });

  it('constrains the slot it will accept back to the ones it sent', () => {
    const p = buildDetectPrompt(ROOM, ['n', 'w']);
    expect(p).toContain('slot: the wall where the BEST view appears — one of "n", "w"');
    expect(p).toContain('Every slot you return MUST be one of "n", "w"');
  });

  it('drops the two-photo continuity rule when there is only one photo', () => {
    const many = buildDetectPrompt(ROOM, ['n', 's']);
    expect(many).toContain('pick the wall with the largest bbox');
    const one = buildDetectPrompt(ROOM, ['n']);
    expect(one).not.toContain('largest bbox');
    // Still exactly one entry per object — a single photo can double-box a sofa.
    expect(one).toContain('Each PHYSICAL object → exactly ONE entry. Never duplicate.');
  });

  it('lists slots in shooting order however they arrive', () => {
    const p = buildDetectPrompt(ROOM, ['w', 'n', 's']);
    expect(p).toContain('one per wall (NORTH, SOUTH, WEST)');
  });

  it('hands over the real footprint for a non-rectangular room', () => {
    const l = buildDetectPrompt({ ...ROOM, layoutId: 'l' }, ['n']);
    expect(l).toContain('this is a L-shaped room, NOT a full rectangle');
    expect(l).toContain('Do not place anything in the missing corner/notch');
    // …and not for the presets that have no polygon to hand over.
    expect(buildDetectPrompt(ROOM, ['n'])).not.toContain('ROOM SHAPE:');
    expect(buildDetectPrompt({ ...ROOM, layoutId: 'custom' }, ['n'])).not.toContain('ROOM SHAPE:');
  });

  it('offers the catalog the renderer actually has', () => {
    // The shape list is generated, not typed out. A prompt naming a shape the
    // catalog lost would come back as a detection nothing can render.
    const p = buildDetectPrompt(ROOM, ['n']);
    expect(p).toContain(CATALOG_SHAPES_ORDERED.join(', '));
  });
});

describe('the prompt reads as prose, because the model has to follow it', () => {
  it('never points at "the list above" when the nearest list is the missing walls', () => {
    // Found by reading a generated prompt rather than by an assertion. The clause
    // used to end "…and never return a slot that is not in the list above", sitting
    // directly after the sentence naming the walls that were NOT photographed — so
    // the nearest antecedent was the wrong one, and it could be read as an
    // instruction to return only the missing walls. It names the codes now.
    for (const slots of [['n'], ['n', 'e'], ['n', 'e', 's']] as const) {
      const p = buildDetectPrompt(ROOM, slots);
      expect(p).not.toContain('the list above');
      expect(p).toContain(`never return any slot other than ${slots.map((s) => `"${s}"`).join(', ')}`);
    }
  });

  it('joins a list of missing walls with "and", not a bare comma run', () => {
    expect(buildDetectPrompt(ROOM, ['n'])).toContain('The EAST, SOUTH and WEST walls were NOT');
    expect(buildDetectPrompt(ROOM, ['n', 'e'])).toContain('The SOUTH and WEST walls were NOT');
    expect(buildDetectPrompt(ROOM, ['n', 'e', 's'])).toContain('The WEST wall was NOT');
  });

  it('does not say "one per wall" about a single photograph', () => {
    const one = buildDetectPrompt(ROOM, ['e']);
    expect(one).not.toContain('one per wall');
    expect(one).toContain('showing the EAST wall');
    expect(one).toContain('The shot frames that wall straight-on');
    // …and still does when there is more than one.
    expect(buildDetectPrompt(ROOM, ['e', 's'])).toContain('one per wall (EAST, SOUTH)');
    expect(buildDetectPrompt(ROOM, ['e', 's'])).toContain('Each shot frames one wall straight-on');
  });
});

describe('cloudRows reads the reply as the geometry can use it', () => {
  const row = (box: unknown, extra: Record<string, unknown> = {}) => ({ label: 'Sofa', category: 'sofa', conf: 0.8, slot: 'n', box, ...extra });

  it('stamps every row it keeps as the cloud’s', () => {
    const [d] = cloudRows([row([0.1, 0.2, 0.3, 0.4])]);
    expect(d.source).toBe('cloud');
    expect(d.box).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(d.label).toBe('Sofa');
  });

  it('cuts a box that runs past the photo to the photo (§ 49.15)', () => {
    // The prompt asks for fractions of the image; a box past the top describes rows
    // nobody saw, and a cut box's top row is the frame's edge, which the ceiling solve
    // stands on. Measured in tests/photo-geometry.test.ts.
    const [d] = cloudRows([row([0.4, -0.05, 0.2, 0.35])]);
    expect(d.box[1]).toBe(0);
    expect(d.box[1] + d.box[3]).toBeCloseTo(0.3, 12);
    const [e] = cloudRows([row([0.9, 0.7, 0.3, 0.5])]);
    expect(e.box[0] + e.box[2]).toBeCloseTo(1, 12);
    expect(e.box[1] + e.box[3]).toBeCloseTo(1, 12);
  });

  it('drops a row with no box in the photo, as a row with no box always was', () => {
    const kept = cloudRows([
      row([0.1, 0.2, 0.3, 0.4]),
      row(undefined),
      row([0.1, 0.2, 0.3]),
      row([1.2, 0.2, 0.3, 0.4]),
      row([0.1, 0.2, Number.NaN, 0.4]),
      row(['0.1', '0.2', '0.3', '0.4']),
      row([0.1, 0.2, 0.3, 0.4], { slot: undefined }),
      null,
      7,
    ]);
    expect(kept).toHaveLength(1);
  });

  it('drops a sliver by the rule the on-device rows are dropped by', () => {
    // 0.2 wide, only 0.005 of it inside the right edge: mostly the model's guess.
    expect(cloudRows([row([0.995, 0.2, 0.2, 0.4])])).toEqual([]);
    expect(cloudRows([row([0.4, 0.2, SLIVER, 0.4])])).toEqual([]);
    expect(cloudRows([row([0.4, 0.2, 0.3, SLIVER])])).toEqual([]);
    expect(cloudRows([row([0.4, 0.2, 0.011, 0.011])])).toHaveLength(1);
    // One rule, not two that agree today: the same boxes, in the two forms the two
    // detectors hand over, are kept or dropped alike and cut alike. For a commit the
    // cloud rows kept every sliver the on-device rows dropped.
    const ends = [-0.3, -0.01, -0.005, 0, 0.004, 0.2, 0.5, 0.985, 0.995, 1, 1.2];
    const sides = [0.005, 0.01, 0.0101, 0.02, 0.3, 1.1];
    let kept = 0, dropped = 0;
    for (const x of ends) for (const y of ends) for (const w of sides) for (const h of sides) {
      const cloud = cloudRows([row([x, y, w, h])])[0]?.box ?? null;
      const local = detectionBox({ x: x + w / 2, y: y + h / 2, w, h, conf: 0.8, label: 'Sofa', category: 'sofa' });
      expect(cloud === null).toBe(local === null);
      if (cloud && local) {
        for (let i = 0; i < 4; i++) expect(cloud[i]).toBeCloseTo(local[i], 12);
        kept++;
      } else dropped++;
    }
    expect([kept, dropped]).toEqual([676, 3680]);
  });
});

describe('readCloudReply: a reply with nothing to act on is not an empty room', () => {
  const row = (box: unknown, extra: Record<string, unknown> = {}) => ({ label: 'Sofa', category: 'sofa', conf: 0.8, slot: 'n', box, ...extra });
  const unreadable = (text: string) => {
    const reply = readCloudReply(text);
    return 'unreadable' in reply ? reply.unreadable : null;
  };

  it('reads an empty list as an empty room — the one empty reply that is an answer', () => {
    expect(readCloudReply('[]')).toEqual({ rows: [] });
  });

  it('refuses a body that is not JSON, and JSON that is not a list', () => {
    expect(unreadable('Here are the pieces I found:')).toMatch(/unreadable/);
    expect(unreadable('{"items":[]}')).toMatch(/unexpected shape/);
  });

  it('refuses a list none of whose rows the geometry can use (§ 49.15)', () => {
    // In pixels rather than the fractions asked for: every box starts past the
    // frame, so the cut keeps none of them. Read row by row this was "All clear".
    const pixels = [row([412, 300, 520, 260]), row([90, 610, 180, 140], { label: 'Lamp', category: 'lamp' })];
    expect(unreadable(JSON.stringify(pixels))).toMatch(/no box inside the photos/);
    expect(unreadable(JSON.stringify([row([0.1, 0.2, 0.3, 0.4], { slot: undefined })]))).toMatch(/no box/);
    expect(unreadable(JSON.stringify([null, 7]))).toMatch(/no box/);
  });

  it('keeps the rows it can use when only some are past the frame', () => {
    const reply = readCloudReply(JSON.stringify([row([412, 300, 520, 260]), row([0.1, 0.2, 0.3, 0.4])]));
    expect('rows' in reply && reply.rows.map((d) => d.box)).toEqual([[0.1, 0.2, 0.3, 0.4]]);
  });
});

describe('only the reply to a Gemini call is stamped as the cloud’s', () => {
  // `cloudRows` says so in a comment, and until the review of D8 nothing held it: a
  // second caller, or a second stamp, would put "sent to Gemini" on rows that were not.
  // Comments are stripped and strings kept, since the stamp IS a string.
  const files: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) files.push([relative(process.cwd(), full), stripComments(readFileSync(full, 'utf8'))]);
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(join(process.cwd(), root));
  const count = (re: RegExp) =>
    Object.fromEntries(files.map(([f, src]) => [f, (src.match(re) ?? []).length]).filter(([, n]) => n));

  it('reads the files it sweeps', () => {
    const names = files.map(([f]) => f);
    for (const f of ['lib/detect-prompt.ts', 'lib/detection.ts', 'lib/local-detect.ts', 'app/onboarding/detect/page.tsx']) {
      expect(names).toContain(f);
    }
  });

  it('calls cloudRows only from readCloudReply, and that only from detectAcrossImages', () => {
    // Its definition and the one call in `readCloudReply`; that definition and the
    // one call in `detectAcrossImages`.
    expect(count(/\bcloudRows\s*\(/g)).toEqual({ 'lib/detect-prompt.ts': 2 });
    expect(count(/\breadCloudReply\s*\(/g)).toEqual({ 'lib/detect-prompt.ts': 1, 'lib/detection.ts': 1 });
  });

  it('writes the cloud stamp in one place', () => {
    expect(count(/\bsource\s*:\s*['"`]cloud['"`]/g)).toEqual({ 'lib/detect-prompt.ts': 1 });
  });
});

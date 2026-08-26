import { describe, it, expect } from 'vitest';
import { buildDetectPrompt } from '@/lib/detect-prompt';
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
    expect(p).toContain('You will receive 1 photo of a single room, one per wall (EAST)');
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
    expect(p).toContain('SOUTH, WEST wall');
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

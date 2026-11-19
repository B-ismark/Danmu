import { describe, expect, it } from 'vitest';
import { shouldAutoConfirm, sourceLabel, sourceOf, type DetectSource } from '@/lib/detect-confidence';
import type { LabelVerdict } from '@/lib/label-repair';

const STATUSES: LabelVerdict['status'][] = ['ok', 'unmeasured', 'suspect'];

const det = (conf: number, source?: DetectSource) => ({ conf, source });

describe('shouldAutoConfirm', () => {
  it('never ticks a row the measurement contradicts, at any confidence', () => {
    // A 1.0 self-report beside a size no bed could have is one row saying two
    // different things. Locking it files the finding behind a padlock before anyone
    // has read it.
    expect(shouldAutoConfirm(det(1, 'cloud'), 'suspect')).toBe(false);
    expect(shouldAutoConfirm(det(1, 'local'), 'suspect')).toBe(false);
  });

  it('never ticks a row nothing measured — the bug this replaced', () => {
    // The caller this came out of tested `status !== 'suspect'`, which let every
    // unmeasured row through. `unmeasured` is not agreement; it is the absence of a
    // second opinion, so a high self-report and no measurement is one piece of
    // evidence rather than two.
    expect(shouldAutoConfirm(det(0.99, 'cloud'), 'unmeasured')).toBe(false);
    expect(shouldAutoConfirm(det(0.99, 'local'), 'unmeasured')).toBe(false);
    // Stated as the contrast, so the assertion above cannot pass by nothing ever
    // being confirmed.
    expect(shouldAutoConfirm(det(0.99, 'cloud'), 'ok')).toBe(true);
  });

  it('confirms a hand-drawn box outright, whatever the geometry says', () => {
    // The user drew it. There is nothing here for them to confirm, and the `1` in
    // `conf` on that path is a sentinel rather than a measurement of anything.
    for (const status of STATUSES) {
      expect(shouldAutoConfirm(det(1, 'manual'), status), status).toBe(true);
      // …and it does not even depend on that sentinel.
      expect(shouldAutoConfirm(det(0, 'manual'), status), status).toBe(true);
    }
  });

  it('holds a low-confidence row back on every model-driven source', () => {
    // Cloud: a self-report, so the bar stays high.
    expect(shouldAutoConfirm(det(0.5, 'cloud'), 'ok')).toBe(false);
    expect(shouldAutoConfirm(det(0.84, 'cloud'), 'ok')).toBe(false);
    expect(shouldAutoConfirm(det(0.85, 'cloud'), 'ok')).toBe(true);
    // Local: a real class score, measured against four photographed rooms. At 0.85
    // it ticked nothing; measured-and-agreeing rows between 0.5 and 0.85 were right.
    expect(shouldAutoConfirm(det(0.49, 'local'), 'ok')).toBe(false);
    expect(shouldAutoConfirm(det(0.5, 'local'), 'ok')).toBe(true);
    expect(shouldAutoConfirm(det(0.7, 'local'), 'ok')).toBe(true);
  });

  it('still needs the geometry to agree before a mid-confidence local row is ticked', () => {
    // The lowered bar is only safe because of the corroboration rule: the
    // unmeasured rows that scored well in the field test were pendant lamps.
    expect(shouldAutoConfirm(det(0.7, 'local'), 'unmeasured')).toBe(false);
    expect(shouldAutoConfirm(det(0.7, 'local'), 'suspect')).toBe(false);
  });

  it('reads a source-less detection as the cloud, which is what produced them', () => {
    // Rooms saved before the field existed. The only path that wrote them was the
    // Gemini call, so anything else would be a claim about history that is false.
    expect(sourceOf({ source: undefined })).toBe('cloud');
    expect(shouldAutoConfirm(det(0.9), 'ok')).toBe(true);
    expect(shouldAutoConfirm(det(0.9), 'unmeasured')).toBe(false);
  });

  it('names only a box the person drew', () => {
    // The label sits in a metadata line next to the category and the wall. It exists
    // so a row the user drew and a row a language model guessed at stop looking like
    // the same claim — and deliberately does NOT show `conf`, which is three
    // incomparable scales in one field.
    // Only a box the person drew is named; the engine that found the rest is not.
    expect(sourceLabel('manual')).toBe('You');
    expect(sourceLabel('local')).toBeNull();
    expect(sourceLabel('cloud')).toBeNull();
  });
});

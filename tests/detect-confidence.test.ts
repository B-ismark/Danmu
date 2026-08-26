import { describe, expect, it } from 'vitest';
import { shouldAutoConfirm, sourceLabel, sourceOf, type DetectSource } from '@/lib/detect-confidence';
import type { LabelVerdict } from '@/lib/label-repair';

const SOURCES: DetectSource[] = ['local', 'cloud', 'manual'];
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
    for (const source of SOURCES.filter((s) => s !== 'manual')) {
      expect(shouldAutoConfirm(det(0.5, source), 'ok'), source).toBe(false);
      expect(shouldAutoConfirm(det(0.84, source), 'ok'), source).toBe(false);
      expect(shouldAutoConfirm(det(0.85, source), 'ok'), source).toBe(true);
    }
  });

  it('reads a source-less detection as the cloud, which is what produced them', () => {
    // Rooms saved before the field existed. The only path that wrote them was the
    // Gemini call, so anything else would be a claim about history that is false.
    expect(sourceOf({ source: undefined })).toBe('cloud');
    expect(shouldAutoConfirm(det(0.9), 'ok')).toBe(true);
    expect(shouldAutoConfirm(det(0.9), 'unmeasured')).toBe(false);
  });

  it('gives every source a name for the user, and none of them says a number', () => {
    // The label sits in a metadata line next to the category and the wall. It exists
    // so a row the user drew and a row a language model guessed at stop looking like
    // the same claim — and deliberately does NOT show `conf`, which is three
    // incomparable scales in one field.
    for (const s of SOURCES) {
      expect(sourceLabel(s), s).toMatch(/^[A-Z]/);
      expect(sourceLabel(s), s).not.toMatch(/[0-9]/);
    }
    expect(new Set(SOURCES.map(sourceLabel)).size).toBe(SOURCES.length);
  });
});

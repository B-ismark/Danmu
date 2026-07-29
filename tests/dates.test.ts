import { describe, expect, it } from 'vitest';
import { editedLabel, recencyBucket, savedLabel, startOfToday } from '../lib/dates';

const DAY = 24 * 60 * 60 * 1000;
// A fixed local noon, so the assertions do not depend on when the suite runs.
const NOON = new Date(2026, 6, 29, 12, 0, 0).getTime();
const TODAY = startOfToday(NOON);

describe('startOfToday', () => {
  it('is local midnight, not UTC midnight', () => {
    const d = new Date(TODAY);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(29);
  });
});

describe('recencyBucket', () => {
  it('buckets by how recently the room was touched', () => {
    expect(recencyBucket(NOON, TODAY)).toBe('today');
    expect(recencyBucket(TODAY, TODAY)).toBe('today');
    expect(recencyBucket(TODAY - 1, TODAY)).toBe('week');
    expect(recencyBucket(TODAY - 5 * DAY, TODAY)).toBe('week');
    expect(recencyBucket(TODAY - 10 * DAY, TODAY)).toBe('month');
    expect(recencyBucket(TODAY - 40 * DAY, TODAY)).toBe('older');
  });
});

describe('editedLabel', () => {
  it('shows a time for today', () => {
    expect(editedLabel(NOON, TODAY)).toMatch(/^Edited /);
    expect(editedLabel(NOON, TODAY)).not.toContain('yesterday');
  });

  it('names yesterday, and keeps the time', () => {
    const label = editedLabel(TODAY - 2 * 60 * 60 * 1000, TODAY);
    expect(label).toContain('yesterday');
    expect(label).toMatch(/\d/);
  });

  it('falls back to a date for anything older, still with a time', () => {
    // Two rooms edited on the same day used to be indistinguishable.
    const label = editedLabel(TODAY - 9 * DAY, TODAY);
    expect(label).not.toContain('yesterday');
    expect(label).toMatch(/^Edited .+,/);
  });
});

describe('savedLabel', () => {
  it('is absolute, not relative', () => {
    // Layout variants are things the user chooses BETWEEN, so "yesterday" is the
    // wrong register — they need a date they can line up against each other.
    expect(savedLabel(TODAY - DAY)).not.toContain('yesterday');
    expect(savedLabel(TODAY - DAY)).toMatch(/,/);
  });
});

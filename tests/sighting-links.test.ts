// The person's half of "is this the same piece?" — links made on the review screen,
// and what the room does with them.
//
// Two kinds of test. The rule tests hand the module small lists and check the link
// bookkeeping: one level deep, never pointing at nothing, never a row linked to
// itself. The population block at the bottom is the one that decides behaviour:
// `combinedFloorSpot` averages a floor piece's sightings only where averaging was
// MEASURED to help, and the measurement is this file's, printed on every green run
// and held as literals so a drift shows.

import { describe, expect, it } from 'vitest';
import {
  combinedFloorSpot,
  linkCandidates,
  linkSighting,
  linkedTo,
  sightingsOf,
  unlinkSighting,
  withSeenAt,
  withoutRow,
  handOver,
} from '@/lib/sighting-links';
import { refineDetections, type CalMap } from '@/lib/detect-refine';
import { keptAtFirst } from '@/lib/repeat-sightings';
import { toRecord } from '@/lib/detection-record';
import { buildSceneFromRoom } from '@/lib/scene-spec';
import type { CameraCal, LensSource } from '@/lib/photo-geometry';
import type { Detection } from '@/lib/detection';
import { ROOM, roomData } from './helpers/known-room';
import { boxIn, furnishedRoom, SWEEP_SLOTS } from './helpers/furnished-rooms';

type Row = Partial<Detection> & Pick<Detection, 'uid' | 'category'>;

function row(r: Row): Detection {
  return {
    label: r.category,
    conf: 0.9,
    source: 'local',
    box: [0.3, 0.3, 0.3, 0.3],
    slot: 'n',
    ...r,
  };
}

const bedN = row({ uid: 'bed-n', category: 'bed', slot: 'n' });
const bedE = row({ uid: 'bed-e', category: 'bed', slot: 'e' });
const bedS = row({ uid: 'bed-s', category: 'bed', slot: 's' });
const lampE = row({ uid: 'lamp-e', category: 'lamp', slot: 'e' });

describe('linking', () => {
  it('links a row to the row it repeats, by uid', () => {
    const out = linkSighting([bedN, bedE], 1, 0);
    expect(out[1].sameAs).toBe('bed-n');
    expect(out[0].sameAs).toBeUndefined();
    expect(linkedTo(out, 1)).toBe(0);
    expect(sightingsOf(out, 0)).toEqual([1]);
  });

  it('lands a link to a linked row on the row it is linked to, so links stay one deep', () => {
    const one = linkSighting([bedN, bedE, bedS], 1, 0);
    const two = linkSighting(one, 2, 1);
    expect(two[2].sameAs).toBe('bed-n');
    expect(sightingsOf(two, 0)).toEqual([1, 2]);
  });

  it('carries the rows already linked to a row when that row is linked onward', () => {
    // Wall 3's bed was linked to wall 2's, then wall 2's turns out to be wall 1's.
    const one = linkSighting([bedN, bedE, bedS], 2, 1);
    const two = linkSighting(one, 1, 0);
    expect(two[1].sameAs).toBe('bed-n');
    expect(two[2].sameAs).toBe('bed-n');
    expect(sightingsOf(two, 1)).toEqual([]);
  });

  it('refuses a link to itself, directly or through the row it repeats', () => {
    const list = [bedN, bedE];
    expect(linkSighting(list, 0, 0)).toBe(list);
    const one = linkSighting(list, 1, 0);
    expect(linkSighting(one, 0, 1)).toBe(one);
  });

  it('refuses a link when either row has no uid', () => {
    const list = [row({ uid: undefined, category: 'bed' }), bedE];
    expect(linkSighting(list, 1, 0)).toBe(list);
    expect(linkSighting(list, 0, 1)).toBe(list);
  });

  it('unlinks one row and leaves the others', () => {
    const linked = linkSighting(linkSighting([bedN, bedE, bedS], 1, 0), 2, 0);
    const out = unlinkSighting(linked, 1);
    expect('sameAs' in out[1]).toBe(false);
    expect(out[2].sameAs).toBe('bed-n');
  });

  it('hands a deleted piece to its next sighting instead of leaving links to nothing', () => {
    const linked = linkSighting(linkSighting([bedN, lampE, bedE, bedS], 2, 0), 3, 0);
    const { dets: out, heir } = withoutRow(linked, 0);
    expect(out.map((d) => d.uid)).toEqual(['lamp-e', 'bed-e', 'bed-s']);
    expect(heir).toBe(1);
    expect('sameAs' in out[1]).toBe(false);
    expect(out[2].sameAs).toBe('bed-e');
    expect(withoutRow(linked, 1).heir).toBeNull();
  });

  it('hands an unticked piece on, and leaves the removed row unlinked so it cannot be handed back', () => {
    const linked = linkSighting(linkSighting([bedN, bedE, bedS], 1, 0), 2, 0);
    const first = handOver(linked, 0);
    expect(first.heir).toBe(1);
    expect('sameAs' in first.dets[0]).toBe(false);
    expect('sameAs' in first.dets[1]).toBe(false);
    expect(first.dets[2].sameAs).toBe('bed-e');
    // Removing the heir hands on to the last sighting, never back to the first row.
    const second = handOver(first.dets, 1);
    expect(second.heir).toBe(2);
    expect('sameAs' in second.dets[2]).toBe(false);
    // And the last one has nothing to hand on: the bed can be taken out.
    expect(handOver(second.dets, 2).heir).toBeNull();
  });

  it('reads a link to a row that is gone as no link', () => {
    expect(linkedTo([row({ uid: 'x', category: 'bed', sameAs: 'nobody' })], 0)).toBeNull();
  });
});

describe('linkCandidates', () => {
  it('offers kept pieces of the same kind, other walls first in wall order', () => {
    const bedW = row({ uid: 'bed-w', category: 'bed', slot: 'w' });
    const bedE2 = row({ uid: 'bed-e2', category: 'bed', slot: 'e', box: [0.7, 0.3, 0.2, 0.2] });
    const list = [bedW, bedE2, bedN, lampE, bedE];
    expect(linkCandidates(list, new Set([0, 1, 2, 3]), 4)).toEqual([2, 0, 1]);
  });

  it('leaves out unkept rows, linked rows and the row itself', () => {
    const list = linkSighting([bedN, bedS, bedE, row({ uid: 'bed-w', category: 'bed', slot: 'w' })], 1, 0);
    expect(linkCandidates(list, new Set([0, 1, 2]), 2)).toEqual([0]);
  });

  it('offers every kind when there is none of this one — the detector’s word is the likeliest mistake', () => {
    const cabinet = row({ uid: 'cab', category: 'shelf', slot: 'e' });
    const wardrobe = row({ uid: 'ward', category: 'wardrobe', slot: 'n' });
    expect(linkCandidates([wardrobe, lampE, cabinet], new Set([0, 1]), 2)).toEqual([0, 1]);
  });
});

const lens = (deg: number, src?: LensSource): CameraCal => ({
  k: 2 * Math.tan(((deg / 2) * Math.PI) / 180),
  aspect: 4 / 3,
  ...(src ? { lens: src } : {}),
});
const every = (c: CameraCal): CalMap => ({ n: c, e: c, s: c, w: c });

describe('combinedFloorSpot', () => {
  const at = (uid: string, slot: Detection['slot'], x: number, z: number, box?: Detection['box']) =>
    row({ uid, category: 'table', slot, shape: 'table', position: { x, y: 0, z }, ...(box ? { box } : {}) });

  it('averages every sighting when a lens was assumed', () => {
    const cut: Detection['box'] = [0.3, 0.6, 0.3, 0.4];
    expect(combinedFloorSpot([at('a', 'n', 0, 0), at('b', 'e', 1, 2, cut)], every(lens(66)))).toEqual({ x: 0.5, z: 1 });
  });

  it('drops a sighting the frame cut off when every lens was measured, and needs two left', () => {
    const cut: Detection['box'] = [0.3, 0.6, 0.3, 0.4];
    const m = every(lens(66, 'measured'));
    expect(combinedFloorSpot([at('a', 'n', 0, 0), at('b', 'e', 1, 2, cut)], m)).toBeNull();
    expect(combinedFloorSpot([at('a', 'n', 0, 0), at('b', 'e', 1, 2), at('c', 's', 9, 9, cut)], m)).toEqual({ x: 0.5, z: 1 });
  });

  it('combines nothing for one sighting, a wall piece or a row with no position', () => {
    const c = every(lens(66));
    expect(combinedFloorSpot([at('a', 'n', 0, 0)], c)).toBeNull();
    const tv = (uid: string, slot: Detection['slot']) => row({ uid, category: 'tv', slot, position: { x: 0, y: 1, z: -2 } });
    expect(combinedFloorSpot([tv('a', 'n'), tv('b', 'e')], c)).toBeNull();
    expect(combinedFloorSpot([at('a', 'n', 0, 0), row({ uid: 'b', category: 'table', slot: 'e' })], c)).toBeNull();
  });
});

describe('withSeenAt → the room', () => {
  it('builds one table where its two sightings put it, and keeps each row’s own reading', () => {
    const a = row({ uid: 'a', category: 'table', shape: 'table', slot: 'n', position: { x: -0.4, y: 0, z: 0 } });
    const b = row({ uid: 'b', category: 'table', shape: 'table', slot: 'e', position: { x: 0.4, y: 0, z: 0.6 } });
    const dets = linkSighting([a, b], 1, 0);
    const recs = withSeenAt(
      dets.map((d, i) => toRecord(d, i, i === 0, () => 'x')),
      dets,
      every(lens(66)),
    );
    expect(recs[0].seenAt).toEqual({ x: 0, z: 0.3 });
    expect(recs[0].position).toEqual({ x: -0.4, y: 0, z: 0 });
    expect(recs[1].seenAt).toBeUndefined();
    const parts = buildSceneFromRoom(roomData(recs));
    expect(parts.map((p) => p.id)).toEqual(['a']);
    expect(parts[0].pos[0]).toBeCloseTo(0, 6);
    expect(parts[0].pos[2]).toBeCloseTo(0.3, 6);
  });

  it('clears a stale seenAt once the link is gone', () => {
    const a = row({ uid: 'a', category: 'table', shape: 'table', position: { x: 0, y: 0, z: 0 } });
    const stale = { ...toRecord(a, 0, true, () => 'x'), seenAt: { x: 1, z: 1 } };
    expect(withSeenAt([stale], [a], every(lens(66)))[0].seenAt).toBeUndefined();
  });
});

describe('combinedFloorSpot — 150 furnished rooms', () => {
  type Tallied = Detection & { _t: number };
  /** For every floor piece seen in two or more photos: how far from where it stands
   *  the room puts it, kept row alone vs. kept row combined with its sightings. The
   *  kept row is the one `keptAtFirst` ticks — the row the person would link the
   *  others to. */
  function measure(trueDeg: number, given: CalMap) {
    let n = 0;
    let alone = 0;
    let joined = 0;
    let worse = 0;
    for (let sd = 1; sd <= 150; sd++) {
      const pieces = furnishedRoom(sd * 7919 + 13);
      const dets: Tallied[] = [];
      pieces.forEach((p, i) => {
        for (const s of SWEEP_SLOTS) {
          const box = boxIn(p, s, lens(trueDeg));
          if (box) dets.push({ label: p.label, conf: 0.9, box, category: p.category, slot: s, shape: p.shape, _t: i } as Tallied);
        }
      });
      const refined = refineDetections(dets, given, ROOM) as Tallied[];
      const kept = keptAtFirst(refined, refined.map(() => true), ROOM, given);
      pieces.forEach((p, i) => {
        if (p.kind !== 'floor') return;
        const rows = refined.map((d, j) => ({ d, j })).filter((x) => x.d._t === i && x.d.position);
        if (rows.length < 2) return;
        const first = rows.find((x) => kept.has(x.j)) ?? rows[0];
        const ordered = [first.d, ...rows.filter((x) => x !== first).map((x) => x.d)];
        const spot = combinedFloorSpot(ordered, given) ?? first.d.position!;
        const e1 = Math.hypot(first.d.position!.x - p.x, first.d.position!.z - p.z);
        const e2 = Math.hypot(spot.x - p.x, spot.z - p.z);
        n++;
        alone += e1;
        joined += e2;
        if (e2 > e1 + 0.05) worse++;
      });
    }
    return { n, alone: +(alone / n).toFixed(3), joined: +(joined / n).toFixed(3), worse };
  }

  it('helps a lot on an assumed lens, and costs nothing on a measured one', () => {
    const table = {
      '106° read as 66°': measure(106, every(lens(66))),
      '120° read as 66°': measure(120, every(lens(66))),
      '106° measured': measure(106, every(lens(106, 'measured'))),
      '120° measured': measure(120, every(lens(120, 'measured'))),
    };
    console.log('sighting-links: mean metres off, kept row alone → combined');
    for (const [k, v] of Object.entries(table)) console.log(`  ${k.padEnd(18)} n=${v.n}  ${v.alone} → ${v.joined}  (worse by >5 cm: ${v.worse})`);
    // An assumed lens is most phones (CLAUDE.md rule 2: four real photos, no focal
    // length), and there the combined spot is about 40% nearer the truth. On a
    // measured lens the uncut sightings rarely number two, so the kept row stands
    // where it was measured — the mean of EVERY sighting there was 0.382 at 106°,
    // worse than the 0.318 kept row, which is why the cut ones are dropped.
    expect(table).toEqual({
      '106° read as 66°': { n: 182, alone: 1.224, joined: 0.76, worse: 18 },
      '120° read as 66°': { n: 330, alone: 1.435, joined: 0.791, worse: 9 },
      '106° measured': { n: 106, alone: 0.318, joined: 0.318, worse: 0 },
      '120° measured': { n: 157, alone: 0.327, joined: 0.327, worse: 0 },
    });
  }, 120_000);
});

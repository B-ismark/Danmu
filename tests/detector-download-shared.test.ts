// One furniture-finder download, shared by the screens that want it: the photos screen
// starts it, the scan screen joins it. Each assertion here is one a defect reached.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectorDownloadInFlight, downloadDetector, onDetectorDownload } from '@/lib/local-detect';

/** A `fetch` that holds every request until `release()` and then fails it, so the
 *  download stays in flight for as long as the test needs and ends with `false`. */
function heldFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fn = vi.fn(async () => {
    await gate;
    throw new Error('offline');
  });
  vi.stubGlobal('fetch', fn);
  return { fn, release };
}

afterEach(() => {
  onDetectorDownload(null);
  vi.unstubAllGlobals();
});

describe('the shared finder download', () => {
  it('a second call joins the first rather than fetching twice', async () => {
    const { fn, release } = heldFetch();
    const a = downloadDetector('full');
    const b = downloadDetector('full');
    expect(b).toBe(a);
    expect(detectorDownloadInFlight()).toBe(a);
    release();
    expect(await a).toBe(false);
    expect(fn).toHaveBeenCalled();
    expect(detectorDownloadInFlight()).toBeNull();
  });

  it('a listener joining mid-download keeps the first caller’s total', async () => {
    const { release } = heldFetch();
    const first = vi.fn();
    // Listener first, then the download: the order FinderPrep needs. The other order
    // lands in the in-flight branch and the total is never set.
    onDetectorDownload(first, 65_000_000);
    const run = downloadDetector('full');
    const joined = vi.fn();
    onDetectorDownload(joined, 1_000);
    expect(joined).toHaveBeenCalledWith({ loaded: 0, total: 65_000_000 });
    release();
    await run;
  });

  it('starting the download before the listener loses the total', async () => {
    const { release } = heldFetch();
    const run = downloadDetector('full');
    const late = vi.fn();
    onDetectorDownload(late, 65_000_000);
    // Documented, not wanted: this is why callers set the listener first.
    expect(late).toHaveBeenCalledWith({ loaded: 0, total: 0 });
    release();
    await run;
  });
});

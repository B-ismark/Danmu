/** Whether the browser says this connection is metered: mobile data, or Data Saver on.
 *  Only Chromium reports either, so `false` means "not known to be", never "known not
 *  to be" — copy that uses it says "seem". Shared by the photos screen, which offers the
 *  furniture finder's download, and the scan screen, which asks if it is still owed. */
export function onMeteredConnection(): boolean {
  try {
    const c = (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection;
    return !!c && (c.type === 'cellular' || c.saveData === true);
  } catch {
    return false;
  }
}

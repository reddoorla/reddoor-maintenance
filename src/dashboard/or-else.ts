/** A defensive read: its own failure, thrown or rejected, becomes `fallback`, so it
 *  can sit in a `Promise.all` beside the page's other reads without taking them down
 *  with it. The page loaders (`page-data.ts`, `site-alarm.ts`) wrap every read that
 *  degrades to "absent" in one. */
export async function orElse<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

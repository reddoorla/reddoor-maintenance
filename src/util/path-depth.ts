/** Path segment count: "/" is depth 0, "/services" is depth 1,
 *  "/blog/2019/05/a-post" is depth 3. A malformed URL sorts last rather than
 *  throwing. Its own module, not `url.ts`, because `url.ts` is in the
 *  `./audit` types entry's bundle and this has no business there. */
export function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

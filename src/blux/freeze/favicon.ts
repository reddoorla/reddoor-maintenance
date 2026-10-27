import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

// The export <head> links the site icon (rel="icon" / "apple-touch-icon")
// from the Blux CDN, whose PNG variants are synthesized on the fly — so the
// icon must be captured at freeze time, while the CDN is alive (post-migrate
// it would need a Prismic round-trip plus an imgix `fm=png` dance). The
// emitted `favicon.png` is copied verbatim to the site repo's `static/`.

/** The best icon href in the export head: largest by `sizes` attribute, with a
 *  `<n>x<n>` / `icon-<n>` filename hint as fallback. Null when none is linked. */
export function pickIconUrl(html: string): string | null {
  const tags = [...html.matchAll(/<link\b[^>]*\brel="[^"]*icon[^"]*"[^>]*>/gi)];
  let best: { url: string; size: number } | null = null;
  for (const [tag] of tags) {
    const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes="(\d+)x\d+"/.exec(tag)?.[1];
    const hint = /(\d{2,4})x\1|icon-?(\d{2,4})/.exec(href);
    const size = sizes ? parseInt(sizes, 10) : hint ? parseInt(hint[1] ?? hint[2] ?? "0", 10) : 0;
    if (!best || size > best.size) best = { url: href, size };
  }
  return best?.url ?? null;
}

/**
 * Fetch (or read, for a file-local href) the export's icon and write it as
 * `<outDir>/favicon.png`. Returns the written path, or null when the export
 * links no icon. Network/read failures throw — the caller decides whether a
 * freeze without a favicon is acceptable (the CLI warns and continues).
 */
export async function emitFavicon(
  exportHtml: string,
  exportDir: string,
  outDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const href = pickIconUrl(exportHtml);
  if (!href) return null;

  let bytes: Buffer;
  if (/^(https?:)?\/\//.test(href)) {
    const url = href.startsWith("//") ? `https:${href}` : href;
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`favicon fetch ${res.status} for ${url}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else {
    // Containment: the emitted favicon.png is destined for a PUBLIC static/
    // dir, so a local href must never resolve outside the export (a hostile
    // export's `href="/../../…"` would otherwise publish an arbitrary file).
    const file = resolve(exportDir, href.replace(/^\//, ""));
    const rel = relative(resolve(exportDir), file);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`favicon href escapes the export dir: ${href}`);
    }
    bytes = await readFile(file);
  }

  const path = join(outDir, "favicon.png");
  await writeFile(path, bytes);
  return path;
}

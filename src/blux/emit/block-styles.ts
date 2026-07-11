import { cleanCssValue } from "../normalize.js";

/** Per-band block styles (background-color, min-height, text-align, …) sourced
 * from site.json's top-level page blocks, cleaned exactly as normalize.ts does.
 * Keyed by the block's render-order index, which equals the grid `Band.index`
 * (the `page-block-N` number) for a contiguously-rendered page.
 *
 * site.json's page blocks live at `content.pages[0].items` (see
 * `parseBluxSite` in parse.ts, which reads `j.content.pages`, and `BluxPage`,
 * whose blocks field is `items`) — not `pages[0].blocks` as a naive reading
 * of the export's top level might suggest. */
export function blockStylesByIndex(siteJson: unknown): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  const blocks = (
    siteJson as { content?: { pages?: { items?: unknown[] }[] } }
  )?.content?.pages?.[0]?.items;
  if (!Array.isArray(blocks)) return out;
  blocks.forEach((b, i) => {
    const styles = (b as { styles?: Record<string, unknown> })?.styles ?? {};
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(styles)) {
      const c = cleanCssValue(v);
      if (c) cleaned[k] = c;
    }
    if (Object.keys(cleaned).length) out.set(i, cleaned);
  });
  return out;
}

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
export function blockStylesByIndex(
  siteJson: unknown,
  pageIndex = 0,
): Map<number, Record<string, string>> {
  const out = new Map<number, Record<string, string>>();
  const blocks = (siteJson as { content?: { pages?: { items?: unknown[] }[] } })?.content?.pages?.[
    pageIndex
  ]?.items;
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

/** A block class's `.blocksNcontainer` defaults: the content padding (with its
 * `__media_mobile_padding` responsive override) and max-width that apply when a
 * block's own styles omit them. */
export type BlockDefaults = {
  padding?: string;
  mobilePadding?: string;
  maxWidth?: string;
};

const CONTAINER_RE = /^\.(blocks\d+)container$/;

/** Per-block-class container defaults keyed by the bare class ("blocks0",
 * "blocks2", …), sourced from site.json's `styles.blocks` — a position-stable
 * array of `{ _label, ".blocksN": …, ".blocksNcontainer": … }` slots. Only the
 * `.blocksNcontainer` entries matter here; the head `<style>` is never parsed
 * (styles.blocks is its structured source). Values are cleaned exactly as
 * `blockStylesByIndex` cleans them, so the export's malformed tombstones
 * (`padding: "px"`, empty strings) drop instead of leaking. */
export function blockClassDefaults(siteJson: unknown): Map<string, BlockDefaults> {
  const out = new Map<string, BlockDefaults>();
  const blocks = (siteJson as { styles?: { blocks?: unknown[] } })?.styles?.blocks;
  if (!Array.isArray(blocks)) return out;
  for (const slot of blocks) {
    if (slot === null || typeof slot !== "object") continue;
    for (const [selector, css] of Object.entries(slot as Record<string, unknown>)) {
      const blockClass = CONTAINER_RE.exec(selector)?.[1];
      if (!blockClass || css === null || typeof css !== "object") continue;
      const rec = css as Record<string, unknown>;
      const padding = cleanCssValue(rec["padding"]);
      const mobilePadding = cleanCssValue(rec["__media_mobile_padding"]);
      const maxWidth = cleanCssValue(rec["max-width"]);
      const defaults: BlockDefaults = {
        ...(padding ? { padding } : {}),
        ...(mobilePadding ? { mobilePadding } : {}),
        ...(maxWidth ? { maxWidth } : {}),
      };
      if (Object.keys(defaults).length) out.set(blockClass, defaults);
    }
  }
  return out;
}

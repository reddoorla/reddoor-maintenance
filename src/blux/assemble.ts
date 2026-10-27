import { parseBluxSite } from "./parse.js";
import { normalizePages, normalizeTheme } from "./normalize.js";
import { modelCollections } from "./collections.js";
import { collectAssetUrls } from "./assets.js";
import type { AssetRef, Diagnostic, SiteIR } from "./ir.js";

export function assembleIR(input: { siteJson: unknown; htmls: string[] }): SiteIR {
  const raw = parseBluxSite(input.siteJson);
  const { pages, diagnostics: pageDiags } = normalizePages(raw);
  const theme = normalizeTheme(raw);
  const collections = modelCollections(raw);
  const urlMap = collectAssetUrls(input.htmls);

  const diagnostics: Diagnostic[] = [...pageDiags];
  const assets: AssetRef[] = Object.entries(raw.media).map(([id, m]) => {
    const sourceUrl = urlMap.get(id) ?? null;
    if (!sourceUrl) {
      diagnostics.push({
        kind: "unresolved-asset",
        where: id,
        message: `no CDN url for ${m.name ?? id}`,
      });
    }
    return {
      id,
      sourceUrl,
      name: String(m.name ?? ""),
      mime: String(m.type ?? ""),
      alt: String(m.name ?? ""),
    };
  });

  // The favicon is declared only in settings (settings.favicon.media) and its
  // uuid is routinely ABSENT from the media dict — so resolve it straight from
  // the scraped urlMap (the <link rel="icon"> tags are part of the HTML scrape)
  // rather than through the assets list above. It lives on meta, not in
  // `assets`, because migration-plan assets get uploaded to Prismic media —
  // the wrong destination for a favicon (convert downloads it beside the plan).
  const faviconId = raw.settings.favicon?.media;
  const favicon = faviconId
    ? { assetId: faviconId, sourceUrl: urlMap.get(faviconId) ?? null }
    : undefined;
  if (favicon && !favicon.sourceUrl) {
    diagnostics.push({
      kind: "unresolved-asset",
      where: favicon.assetId,
      message: `no CDN url for favicon ${favicon.assetId}`,
    });
  }

  return {
    meta: { ...raw.meta, ...(favicon ? { favicon } : {}) },
    theme,
    pages,
    collections,
    assets,
    diagnostics,
  };
}

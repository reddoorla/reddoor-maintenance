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

  return {
    meta: raw.meta,
    theme,
    pages,
    collections,
    assets,
    diagnostics,
  };
}

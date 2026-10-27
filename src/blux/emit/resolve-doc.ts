import { htmlAsRichText } from "@prismicio/migrate";

/** Resolve a PlanDocument's plain-JSON markers into Migration API values:
 *  `__richtext_html` → rich text nodes, `__asset_id` → `{ id }` using the
 *  uuid → Prismic-asset-id map (missing assets are dropped and reported).
 *  Pure, so the network shell in run-migration.ts stays untested-thin. */
export function resolveDocData(
  data: Record<string, unknown>,
  assetIdByUuid: Map<string, string>,
): { data: Record<string, unknown>; missingAssets: string[] } {
  const missing: string[] = [];
  const resolve = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if ("__richtext_html" in v) {
        return htmlAsRichText((v as { __richtext_html: string }).__richtext_html).result;
      }
      if ("__asset_id" in v) {
        const uuid = (v as { __asset_id: string }).__asset_id;
        const id = assetIdByUuid.get(uuid);
        if (!id) {
          missing.push(uuid);
          return undefined;
        }
        return { id };
      }
      if (Array.isArray(v)) return v.map(resolve);
      return Object.fromEntries(
        Object.entries(v)
          .map(([k, val]) => [k, resolve(val)] as const)
          .filter(([, val]) => val !== undefined),
      );
    }
    return v;
  };
  return { data: resolve(data) as Record<string, unknown>, missingAssets: missing };
}

import { htmlAsRichText } from "@prismicio/migrate";
import type { MigrationPlan } from "../emit/plan.js";

export type FixtureDoc = { type: string; uid: string; data: Record<string, unknown> };
export type RenderFixture = {
  documents: FixtureDoc[];
  collections: Record<string, FixtureDoc[]>;
  missingAssets: string[];
};

/** Resolve plan markers OFFLINE for the starter fidelity-gate route (Task 8):
 * `{__richtext_html}` → rich text NODE ARRAYS (via the same `htmlAsRichText`
 * call the frozen migrate path uses in emit/resolve-doc.ts), `{__asset_id}` →
 * a Prismic-HYDRATED image field `{url, alt, dimensions}` pointing at the plan
 * asset's CDN url. Unlike resolve-doc.ts (which emits Migration API shapes —
 * richtext nodes plus `{id}` asset refs for the network), this produces the
 * shapes the production SliceZone consumes when rendering, so the gate can run
 * documents through it with no Prismic round-trip.
 *
 * Dimensions are a fixed placeholder — `PlanAsset` carries no intrinsic size
 * and the offline gate forbids the network fetch that would find it, so layout
 * fidelity for image slices that key off the INTRINSIC ratio (unconstrained
 * `height:auto`, `aspect-ratio` bound to natural dims) is approximate;
 * container-pinned images (`object-fit:cover`, `aspect-[x/y]`) are unaffected.
 * If ratio-sensitive fidelity ever regresses, capture real dims into
 * `PlanAsset` at scrape/IR time. Missing assets resolve to `null`
 * (isFilled-safe) and are reported. Entity (non-`page`) documents are grouped
 * by type for the SliceZone `context.collections`. Keep the marker NAMES
 * (`__richtext_html`, `__asset_id`) in sync with resolve-doc.ts — the `typeof`
 * guards below are intentionally stricter than resolve-doc's `"key" in v` (they
 * won't misfire on a non-string field of the same name); keep them on a sync. */
export function resolveFixture(plan: MigrationPlan): RenderFixture {
  const assetById = new Map(plan.assets.map((a) => [a.id, a] as const));
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.__richtext_html === "string") return htmlAsRichText(o.__richtext_html).result;
      if (typeof o.__asset_id === "string") {
        const a = assetById.get(o.__asset_id);
        if (!a) {
          missing.add(o.__asset_id);
          return null;
        }
        return { url: a.url, alt: a.alt, dimensions: { width: 1600, height: 1200 } };
      }
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  // `data` is invariantly a field map (PlanDocument.data), never a bare marker,
  // so walk() returns an object here — the cast is sound.
  const resolved: FixtureDoc[] = plan.documents.map((d) => ({
    ...d,
    data: walk(d.data) as Record<string, unknown>,
  }));
  const documents = resolved.filter((d) => d.type === "page");
  const collections: Record<string, FixtureDoc[]> = {};
  for (const d of resolved) {
    if (d.type === "page") continue;
    (collections[d.type] ??= []).push(d);
  }
  return { documents, collections, missingAssets: [...missing] };
}

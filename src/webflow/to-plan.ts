/** Webflow capture → blux MigrationPlan adapter, so the Webflow import rides
 *  the SAME live push runner as the Blux pipeline (src/blux/emit/run-migration).
 *  Two shape gaps to bridge:
 *   - Media: to-docs emits `{ __asset: <filename>, alt? }` placeholders; the
 *     runner's resolveDocData resolves `{ __asset_id: <key> }` against a map
 *     keyed by PlanAsset.id. We rewrite each placeholder to `assetRef(filename)`
 *     and set PlanAsset.id = the SAME filename, so the two ends meet on the
 *     assetFilename key run-migration already dedupes the media library by.
 *   - Custom types: the site (beachfront) repo's types are pushed by Slice
 *     Machine from the site repo, not by this migrate — so customTypes is []
 *     (runMigration never reads it anyway; pushCustomTypes is a separate call).
 *  stylesManifest/diagnostics are design-pass/plan-time only and unread by the
 *  runner, so they're empty here too. */
import { assetRef } from "../blux/emit/plan.js";
import type { MigrationPlan, PlanAsset, PlanDocument } from "../blux/emit/plan.js";
import type { AssetRef } from "./crawl.js";
import type { AssetPlaceholder, WfDoc } from "./to-docs.js";

export type WebflowPlanInput = { docs: WfDoc[]; assets: AssetRef[] };

/** An `{ __asset, alt? }` media placeholder (to-docs' AssetPlaceholder).
 *  `__asset` is emitted only by to-docs' asset(), never by content — scraped
 *  text lives inside RtBlock `text` strings, so a key-shaped match here can't
 *  be a false positive from site copy. */
function isAssetPlaceholder(v: object): v is AssetPlaceholder {
  return "__asset" in v && typeof (v as { __asset: unknown }).__asset === "string";
}

/** Recursively rewrite Webflow `{ __asset, alt? }` placeholders into the blux
 *  `{ __asset_id }` marker resolveDocData resolves, keyed by filename. Records
 *  each placeholder's alt into `altByFilename` (first alt wins) so the asset
 *  upload carries it. Per-doc alt is architecturally unavailable through this
 *  runner: resolveDocData turns the marker into a bare `{ id }` (no alt slot),
 *  so an asset referenced by several docs with differing alts carries exactly
 *  ONE library-level alt — first-wins picks it deterministically (doc order). */
function rewriteAssets(value: unknown, altByFilename: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => rewriteAssets(v, altByFilename));
  if (value && typeof value === "object") {
    if (isAssetPlaceholder(value)) {
      const { __asset, alt } = value;
      if (alt && !altByFilename.has(__asset)) altByFilename.set(__asset, alt);
      return assetRef(__asset);
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, rewriteAssets(v, altByFilename)] as const),
    );
  }
  return value;
}

/** Build the MigrationPlan runMigration consumes from a Webflow capture's docs
 *  + asset manifest. Pure — no network, no env. */
export function webflowToPlan(input: WebflowPlanInput): MigrationPlan {
  const altByFilename = new Map<string, string>();
  const documents: PlanDocument[] = input.docs.map((doc) => ({
    type: doc.type,
    uid: doc.uid,
    data: rewriteAssets(doc.data, altByFilename) as Record<string, unknown>,
  }));
  const assets: PlanAsset[] = input.assets.map((a) => ({
    id: a.filename,
    url: a.url,
    alt: altByFilename.get(a.filename) ?? "",
  }));
  return { customTypes: [], documents, assets, stylesManifest: [], diagnostics: [] };
}

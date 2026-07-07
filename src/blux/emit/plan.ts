import type { Diagnostic, SectionIR } from "../ir.js";

export type RichTextMarker = { __richtext_html: string };
export type AssetMarker = { __asset_id: string };
export const richText = (html: string): RichTextMarker => ({ __richtext_html: html });
export const assetRef = (id: string): AssetMarker => ({ __asset_id: id });

export type PlanSlice = {
  slice_type: string;
  variation: string;
  primary: Record<string, unknown>;
  items: Record<string, unknown>[];
};
export type PlanDocument = { type: string; uid: string; data: Record<string, unknown> };
export type PlanCustomType = { id: string; label: string; repeatable: true; json: unknown };
export type PlanAsset = { id: string; url: string; alt: string };
/** Presentation hints for one emitted slice; `index` is its position in the
 * document's slice zone (after empty-slice filtering). `items` aligns with a
 * kept section_grid's items. */
export type SliceStyleEntry = {
  index: number;
  sliceType: string;
  presentation?: NonNullable<SectionIR["presentation"]>;
  items?: (NonNullable<SectionIR["presentation"]> | null)[];
};

export type MigrationPlan = {
  customTypes: PlanCustomType[];
  documents: PlanDocument[];
  assets: PlanAsset[];
  /** Per-page presentation hints (block styles + text roles) — design-pass
   * reference only, never pushed to Prismic. */
  stylesManifest: { pageUid: string; slices: SliceStyleEntry[] }[];
  /** Plan-time findings (skipped empty pages, dropped non-image assets, …). */
  diagnostics: Diagnostic[];
};

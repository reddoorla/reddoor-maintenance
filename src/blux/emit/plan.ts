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
export type MigrationPlan = {
  customTypes: PlanCustomType[];
  documents: PlanDocument[];
  assets: PlanAsset[];
};

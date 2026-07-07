export type AssetId = string;

export type Diagnostic = {
  kind:
    | "low-confidence-block"
    | "unresolved-asset"
    | "unwired-collection"
    | "malformed-feed-field"
    | "empty-page"
    | "empty-slice"
    | "non-image-in-image-field";
  where: string; // page uid / feed apiId / asset uuid
  message: string;
};

export type SectionIR = {
  sliceType: "hero" | "media_text" | "rich_text" | "grid" | "slider" | "collection_list";
  variation: string;
  confidence: number;
  fields: {
    heading?: string; // raw HTML
    body?: string; // raw HTML
    media?: AssetId;
    backgroundMedia?: AssetId;
    ratio?: string;
    columns?: number;
    anim?: string;
  };
  collectionRef?: { apiId: string; mode: "all" | "items"; itemUids?: string[]; wired: boolean };
  children?: SectionIR[];
};

export type PageIR = { uid: string; title: string; description: string; sections: SectionIR[] };

export type FieldDef = {
  key: string;
  type: "text" | "richtext" | "image" | "group" | "date" | "boolean" | "number" | "link";
};
export type RecordIR = { uid: string; values: Record<string, unknown>; mediaRefs: AssetId[] };
export type CollectionIR = {
  apiId: string;
  label: string;
  publishRoute: string | null;
  fields: FieldDef[];
  records: RecordIR[];
};

export type ThemeIR = {
  colors: { role: string; value: string }[];
  fonts: { heading: string; body: string };
  textStyles: { role: string; size: string; weight: number; lineHeight: number }[];
};

export type AssetRef = {
  id: AssetId;
  sourceUrl: string | null;
  name: string;
  mime: string;
  alt: string;
};

export type SiteIR = {
  meta: { name: string; domain: string; bluxSiteId: string };
  theme: ThemeIR;
  pages: PageIR[];
  collections: CollectionIR[];
  assets: AssetRef[];
  diagnostics: Diagnostic[];
};

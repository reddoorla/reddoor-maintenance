export type AssetId = string;

export type Diagnostic = {
  kind:
    | "low-confidence-block"
    | "unresolved-asset"
    | "unwired-collection"
    | "malformed-feed-field"
    | "empty-page"
    | "empty-slice"
    | "duplicate-page-uid"
    | "missing-page-html"
    | "empty-feed-grid"
    | "non-image-in-image-field"
    | "dropped-widget";
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
  /** Presentation hints from the export — the text roles a block references
   * (_title/_body class → styles.text), any per-element inline overrides on
   * those elements (e.g. a hero title's white `color`), and the block's own
   * layout styles. Never migrated into Prismic; surfaced via the plan's styles
   * manifest so the site's design pass works from data. */
  presentation?: {
    headingRole?: string;
    bodyRole?: string;
    headingStyle?: Record<string, string>;
    bodyStyle?: Record<string, string>;
    block?: Record<string, string>;
  };
  children?: SectionIR[];
};

export type PageIR = {
  uid: string;
  title: string;
  description: string;
  /** The page's export-dir / route slug ("" for the homepage — the export
   * renders it at the root index.html; every other page renders at
   * `<path>/index.html`). Derived from the source `url` when present, else
   * the title slug. */
  path: string;
  sections: SectionIR[];
};

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

/** One named Blux text style ("Grid Titles", "Page Title Serif", …). Values
 * are cleaned CSS strings from the export; mobile* carry the role's
 * `__media_mobile_*` responsive overrides when present. */
export type TextStyleIR = {
  role: string; // "text5" — referenced by blocks via _title/_body class
  label: string;
  fontFamily: string;
  size: string;
  weight: number | string;
  lineHeight: string;
  transform?: string;
  letterSpacing?: string;
  /** The style's own block margin (e.g. "10px 0") — Blux's vertical rhythm
   * between stacked text blocks lives HERE, not in container gaps. Absent when
   * the style declares none or an explicit "0" (the render's default). */
  margin?: string;
  mobileSize?: string;
  mobileLineHeight?: string;
};

/** A web font the export declares (family + the weights it loads), parsed from
 * `settings.fonts.google`. Tells the design pass exactly which @fontsource
 * weights to install instead of measuring them off the rendered site. */
export type FontLoad = { family: string; weights: string[] };

/** A Blux button skin (styles.buttons[N]) — converted trees carry the raw
 * anchors verbatim (`class="ib middle buttonsN"`), so the declared skin must
 * ship as CSS or the button renders as a bare link. `css` preserves the
 * export's own declaration order: the skins rely on it (a `border` shorthand
 * followed by `border-top/right/left: 0` overrides nets a bottom-only rule). */
export type ButtonStyleIR = {
  role: string; // "buttons2"
  label: string;
  css: Record<string, string>;
  hover?: Record<string, string>;
  active?: Record<string, string>;
};

export type ThemeIR = {
  colors: { role: string; value: string }[];
  fonts: { heading: string; body: string };
  fontLoad: FontLoad[];
  textStyles: TextStyleIR[];
  buttonStyles: ButtonStyleIR[];
};

export type AssetRef = {
  id: AssetId;
  sourceUrl: string | null;
  name: string;
  mime: string;
  alt: string;
};

export type SiteIR = {
  meta: {
    name: string;
    domain: string;
    bluxSiteId: string;
    /** The site favicon (settings.favicon in the export). Kept on meta rather
     * than in `assets` because it must never ride the migration plan into
     * Prismic media — convert downloads it beside the plan instead. sourceUrl
     * is the canonical CDN url scraped from the <link rel="icon"> tags, or
     * null when the scrape missed it (an unresolved-asset diagnostic names it). */
    favicon?: { assetId: AssetId; sourceUrl: string | null };
  };
  theme: ThemeIR;
  pages: PageIR[];
  collections: CollectionIR[];
  assets: AssetRef[];
  diagnostics: Diagnostic[];
};

// Products feed → a clean, materialized product catalog. Blux renders a detail
// page per feed record at /products/<slug> from a Handlebars template; the
// static export ships only the template, so this rebuilds the catalog
// deterministically at convert time: canonical categories (the raw feed data is
// dirty — whitespace/case variants + typos), the faithful url-or-derive slug,
// and resolved main + gallery images. Pure; the convert injects `resolveImage`.

export type ProductImage = { assetId: string; url: string };

export type Product = {
  /** The detail-page slug: /products/<slug>. */
  slug: string;
  title: string;
  /** Canonical category (drives the back-link + faceting). */
  category: string;
  /** Canonical sub-category, or "" when the record has none. */
  subCategory: string;
  /** Rendered verbatim — the export's dimension strings are inconsistent
   * (`94"W x 38"D` vs `94" W x 38" D`) and that's what the live page shows. */
  dimensions: string;
  tags: string[];
  /** Hidden from listing grids, but Blux still serves its detail page (200), so
   * the page is generated regardless. */
  disabled: boolean;
  /** The main image, when the record has one (39/552 have none). */
  image?: ProductImage;
  /** Additional images shown as detail-page thumbnails (160/552 have ≥1). */
  gallery: ProductImage[];
};

export type ProductRecord = {
  title?: unknown;
  category?: unknown;
  sub_category?: unknown;
  dimensions?: unknown;
  tags?: unknown;
  disabled?: unknown;
  /** Present on only a handful of records; when set it is the authoritative
   * slug (and can override what the title would derive). */
  url?: unknown;
  media?: unknown;
  items?: unknown;
};

// The five product categories the site publishes. Upholstered/Case/Exterior are
// populated by the feed; Metal/Finishes are listing pages with no feed records.
const CANONICAL_CATEGORIES = ["Upholstered", "Case", "Exterior", "Metal", "Finishes"];

// Misspellings in the raw data that don't fold by case/whitespace alone.
const CATEGORY_ALIASES: Record<string, string> = {
  upholstrered: "Upholstered",
  upholsered: "Upholstered",
};

// Sub-category variants that need explicit folding (order/wording/typos).
const SUBCATEGORY_ALIASES: Record<string, string> = {
  banuette: "Banquette",
  "benches & ottomans": "Ottomans & Benches",
  miscellaneous: "Misc.",
};

function cleanWs(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Canonicalize a raw product category. Folds whitespace/case variants and
 * known typos onto the canonical set; an unrecognized category is kept
 * (title-cased) rather than dropped, so no product is silently lost. */
export function normalizeCategory(raw: unknown): string {
  const cleaned = cleanWs(raw);
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (CATEGORY_ALIASES[lower]) return CATEGORY_ALIASES[lower];
  const canon = CANONICAL_CATEGORIES.find((c) => c.toLowerCase() === lower);
  return canon ?? titleCase(lower);
}

/** Canonicalize a raw sub-category (own facet; folds typos/word-order). "" when
 * the record has none. */
export function normalizeSubCategory(raw: unknown): string {
  const cleaned = cleanWs(raw);
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (SUBCATEGORY_ALIASES[lower]) return SUBCATEGORY_ALIASES[lower];
  return titleCase(lower);
}

/** The detail-page slug for a record: the stored `url` wins (a few records
 * carry an editorial slug the title wouldn't derive — "Howdy Set" → howdyset),
 * else derive from the title (lowercase, non-alphanumeric runs → single "-",
 * trimmed). */
export function productSlug(record: ProductRecord): string {
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (url) return url.replace(/^\/+products\/+/i, "").replace(/^\/+|\/+$/g, "");
  return String(record.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mediaUuid(media: unknown): string | undefined {
  if (media && typeof media === "object") {
    const m = (media as { media?: unknown }).media;
    if (typeof m === "string" && m) return m;
  }
  return undefined;
}

function imageFor(
  uuid: string | undefined,
  resolveImage: (uuid: string) => string | null,
): ProductImage | undefined {
  if (!uuid) return undefined;
  const url = resolveImage(uuid);
  return url ? { assetId: uuid, url } : undefined;
}

/** Build the product catalog from the feed records. `resolveImage` turns an
 * asset uuid into a CDN url (null when unresolvable). Slug-collision safe: two
 * records that map to the same slug (a handful of duplicate/legacy names) keep
 * ONE page — an enabled record wins over a disabled one, else the first seen.
 * Records with no usable slug are dropped. */
export function materializeProducts(
  records: ProductRecord[],
  resolveImage: (uuid: string) => string | null,
): Product[] {
  const bySlug = new Map<string, Product>();
  for (const r of records) {
    const slug = productSlug(r);
    if (!slug) continue;

    const gallery: ProductImage[] = [];
    if (Array.isArray(r.items)) {
      for (const it of r.items as ProductRecord[]) {
        const img = imageFor(mediaUuid(it?.media), resolveImage);
        if (img) gallery.push(img);
      }
    }

    const image = imageFor(mediaUuid(r.media), resolveImage);
    const product: Product = {
      slug,
      title: cleanWs(r.title),
      category: normalizeCategory(r.category),
      subCategory: normalizeSubCategory(r.sub_category),
      dimensions: String(r.dimensions ?? ""),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      disabled: r.disabled === true,
      gallery,
      // `exactOptionalPropertyTypes`: omit the key rather than set undefined.
      ...(image ? { image } : {}),
    };

    const existing = bySlug.get(slug);
    if (!existing || (existing.disabled && !product.disabled)) bySlug.set(slug, product);
  }
  return [...bySlug.values()];
}

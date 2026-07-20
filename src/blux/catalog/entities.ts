// Feed records → real Prismic entity documents (spec §8). Each kept feed maps
// onto its frozen entity type (feeds.ts), its records onto the Plan-2 shared
// base fields, and any non-base keys ride verbatim as per-site extension
// fields — with one extension custom type per USED entity type (the shared
// base Main + the observed extension fields).
import type { Media } from "../grid/types.js";
import type { Diagnostic } from "../ir.js";
import {
  assetRef,
  richText,
  type PlanCustomType,
  type PlanDocument,
} from "../emit/plan.js";
import { demoteHeadingsHtml } from "../emit/coerce-html.js";
import { productSlug, type ProductRecord } from "../products.js";
import { feedEntityType, isSkippedFeed } from "./feeds.js";

export type EntityEmit = {
  documents: PlanDocument[];
  customTypes: PlanCustomType[];
  media: Media[]; // every record media (kind:"image"), for plan-asset upload
  diagnostics: Diagnostic[];
};

/** The Plan-2 shared-base entity Main (frozen — mirrors the starter's
 * customtypes/{product,person,event,news_article,project,collection_item}
 * base JSON exactly). Extension fields are appended per site. */
const BASE_MAIN: Record<string, unknown> = {
  uid: { type: "UID", config: { label: "uid" } },
  title: {
    type: "StructuredText",
    config: { label: "title", single: "heading1" },
  },
  body: {
    type: "StructuredText",
    config: {
      label: "body",
      multi: "paragraph,strong,em,hyperlink,list-item",
    },
  },
  media: {
    type: "Image",
    config: { label: "media", constraint: {}, thumbnails: [] },
  },
  gallery: {
    type: "Group",
    config: {
      label: "gallery",
      fields: {
        image: {
          type: "Image",
          config: { label: "image", constraint: {}, thumbnails: [] },
        },
        caption: { type: "Text", config: { label: "caption" } },
      },
    },
  },
  tags: { type: "Text", config: { label: "tags (comma-separated)" } },
  date: { type: "Date", config: { label: "date" } },
  link: { type: "Link", config: { label: "link", allowTargetBlank: true } },
};

/** Record keys the base mapping consumes explicitly. `disabled` is NOT here:
 * it is an extension field (it lands verbatim in data and in the extension
 * type) that ALSO drives the enabled-beats-disabled uid dedup. */
const BASE_KEYS = new Set([
  "title",
  "body",
  "media",
  "items",
  "tags",
  "date",
  "url",
  "link_url",
]);

/** Underscore-prefixed keys are per-element style config (collections.ts
 * convention) — never content. */
const isStyleKey = (key: string) => key.startsWith("_");

type ExtKind = "text" | "boolean" | "number" | "group";

const EXT_FIELD_CONFIG: Record<
  ExtKind,
  (label: string) => Record<string, unknown>
> = {
  text: (label) => ({ type: "Text", config: { label } }),
  boolean: (label) => ({ type: "Boolean", config: { label } }),
  number: (label) => ({ type: "Number", config: { label } }),
  group: (label) => ({
    type: "Group",
    config: {
      label,
      fields: { value: { type: "Text", config: { label: "value" } } },
    },
  }),
};

const kindOf = (value: unknown): ExtKind => {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "group";
  return "text";
};

/** "news_article" → "News Article". */
const typeLabel = (type: string): string =>
  type
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

const mediaUuidOf = (v: unknown): string | undefined => {
  if (v && typeof v === "object") {
    const m = (v as { media?: unknown }).media;
    if (typeof m === "string" && m) return m;
  }
  return undefined;
};

/** Extension entries of a record: every non-style, non-base key. */
function extEntries(record: Record<string, unknown>): [string, unknown][] {
  return Object.entries(record).filter(
    ([key, value]) =>
      !isStyleKey(key) && !BASE_KEYS.has(key) && value !== undefined,
  );
}

/** Base-field mapping for one record → the document data + the media it
 * references. Extension keys ride verbatim. */
function recordToDoc(
  record: Record<string, unknown>,
  type: string,
  uid: string,
): { doc: PlanDocument; media: Media[] } {
  const data: Record<string, unknown> = {};
  const media: Media[] = [];

  if (typeof record.title === "string" && record.title.trim())
    data.title = richText(`<h1>${record.title}</h1>`);
  // The base type's body allows no heading blocks — demote, like recordData.
  if (typeof record.body === "string" && record.body.trim())
    data.body = richText(demoteHeadingsHtml(record.body));

  const mainUuid = mediaUuidOf(record.media);
  if (mainUuid) {
    data.media = assetRef(mainUuid);
    media.push({ kind: "image", assetId: mainUuid });
  }

  if (Array.isArray(record.items)) {
    const gallery: { image: unknown; caption: string }[] = [];
    for (const it of record.items) {
      const item = it && typeof it === "object" ? (it as Record<string, unknown>) : undefined;
      const uuid = item ? mediaUuidOf(item.media) : undefined;
      if (!uuid) continue;
      media.push({ kind: "image", assetId: uuid });
      const caption =
        typeof item?.caption === "string"
          ? item.caption
          : typeof item?.title === "string"
            ? item.title
            : "";
      gallery.push({ image: assetRef(uuid), caption });
    }
    if (gallery.length) data.gallery = gallery;
  }

  if (Array.isArray(record.tags))
    data.tags = record.tags
      .filter((t): t is string => typeof t === "string")
      .join(",");
  else if (typeof record.tags === "string" && record.tags) data.tags = record.tags;

  if (record.date != null && record.date !== "") data.date = record.date;

  const linkUrl =
    typeof record.url === "string" && record.url.trim()
      ? record.url.trim()
      : typeof record.link_url === "string" && record.link_url.trim()
        ? record.link_url.trim()
        : undefined;
  if (linkUrl) data.link = { link_type: "Web", url: linkUrl };

  for (const [key, value] of extEntries(record)) data[key] = value;

  return { doc: { type, uid, data }, media };
}

/** Feed records → typed entity documents + per-type extension custom types +
 * the media they reference + skip diagnostics. Uid dedup is per entity type:
 * an enabled record beats a disabled one, else first-seen wins (productSlug
 * semantics — the record `url` slug first, else the title slug). */
export function buildEntityEmit(
  feeds: Record<
    string,
    { name?: string; items?: unknown[]; fields?: unknown } | undefined
  >,
): EntityEmit {
  const diagnostics: Diagnostic[] = [];
  const media: Media[] = [];
  const typeOrder: string[] = [];
  const docsByType = new Map<
    string,
    Map<string, { doc: PlanDocument; disabled: boolean }>
  >();
  const extByType = new Map<string, Map<string, ExtKind>>();

  for (const [feedId, feed] of Object.entries(feeds)) {
    if (!feed) continue;
    const name = String(feed.name ?? "");
    if (isSkippedFeed(name)) {
      diagnostics.push({
        kind: "skipped-feed",
        where: feedId,
        message: `feed "${name}" is marked DO NOT USE — not migrated`,
      });
      continue;
    }
    const type = feedEntityType(name);
    if (!docsByType.has(type)) {
      typeOrder.push(type);
      docsByType.set(type, new Map());
      extByType.set(type, new Map());
    }
    const byUid = docsByType.get(type)!;
    const extKinds = extByType.get(type)!;

    (Array.isArray(feed.items) ? feed.items : []).forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const uid = productSlug(record as ProductRecord) || `item-${i}`;
      const { doc, media: recMedia } = recordToDoc(record, type, uid);
      media.push(...recMedia);
      // Extension fields type from the observed value shapes (deriveFields
      // convention: a later, more specific observation upgrades "text").
      for (const [key, value] of extEntries(record)) {
        if (!extKinds.has(key) || extKinds.get(key) === "text")
          extKinds.set(key, kindOf(value));
      }
      const disabled = record.disabled === true;
      const existing = byUid.get(uid);
      if (!existing || (existing.disabled && !disabled))
        byUid.set(uid, { doc, disabled });
    });
  }

  const documents: PlanDocument[] = [];
  const customTypes: PlanCustomType[] = [];
  for (const type of typeOrder) {
    for (const { doc } of docsByType.get(type)!.values()) documents.push(doc);
    const Main: Record<string, unknown> = { ...BASE_MAIN };
    for (const [key, kind] of extByType.get(type)!)
      Main[key] = EXT_FIELD_CONFIG[kind](key);
    const label = typeLabel(type);
    customTypes.push({
      id: type,
      label,
      repeatable: true,
      json: {
        id: type,
        label,
        format: "custom",
        repeatable: true,
        status: true,
        json: { Main },
      },
    });
  }

  return { documents, customTypes, media, diagnostics };
}

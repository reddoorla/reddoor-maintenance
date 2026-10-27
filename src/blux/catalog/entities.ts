// Feed records → real Prismic entity documents (spec §8). Each kept feed maps
// onto its frozen entity type (feeds.ts), its records onto the Plan-2 shared
// base fields, and any non-base keys ride verbatim as per-site extension
// fields — with one extension custom type per USED entity type (the shared
// base Main + the observed extension fields).
import type { Media } from "../grid/types.js";
import type { Diagnostic } from "../ir.js";
import { assetRef, richText, type PlanCustomType, type PlanDocument } from "../emit/plan.js";
import { demoteHeadingsHtml } from "../emit/coerce-html.js";
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

/** Record keys the base mapping consumes explicitly, PLUS the base field names
 * a record key must never shadow (`uid`/`gallery`/`link` — an extension
 * assignment would clobber the mapped base field in `data`). `disabled` is NOT
 * here: it is an extension field (it lands verbatim in data and in the
 * extension type) that ALSO drives the enabled-beats-disabled uid dedup.
 * `url` is deliberately absent: the raw url rides as an extension field (the
 * Phase-7 detail-page slug) even though the base mapping also reads it for the
 * uid and the external-only link field. */
const BASE_KEYS = new Set([
  "title",
  "body",
  "media",
  "items",
  "tags",
  "date",
  "link_url",
  "uid",
  "gallery",
  "link",
]);

/** Underscore-prefixed keys are per-element style config (collections.ts
 * convention) — never content. */
const isStyleKey = (key: string) => key.startsWith("_");

type ExtKind = "text" | "richtext" | "boolean" | "number" | "group";

const EXT_FIELD_CONFIG: Record<ExtKind, (label: string) => Record<string, unknown>> = {
  text: (label) => ({ type: "Text", config: { label } }),
  // deriveFields convention: mirrors the base body field's model config.
  richtext: (label) => ({
    type: "StructuredText",
    config: { label, multi: "paragraph,strong,em,hyperlink,list-item" },
  }),
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

const kindOf = (key: string, value: unknown): ExtKind => {
  // deriveFields convention: `description` (like `body`) is richtext.
  if (key === "description" && typeof value === "string") return "richtext";
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
    ([key, value]) => !isStyleKey(key) && !BASE_KEYS.has(key) && value !== undefined,
  );
}

/** Legacy-parity spelling normalization (round-2 item 4 — grid feed-grid.ts
 * isDisabled honors BOTH `disabled` and `disable`): fold `disable` into the
 * one normalized `disabled` key, so either spelling === true drives the
 * enabled-beats-disabled uid dedup AND emits `data.disabled = true` (the
 * starter filters on `doc.data.disabled !== true`); a separate `disable`
 * extension field never emits. */
function normalizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  if (record.disable === undefined) return record;
  const { disable, ...rest } = record;
  return {
    ...rest,
    disabled: record.disabled === true || disable === true ? true : (record.disabled ?? disable),
  };
}

/** A valid Prismic UID fragment: alphanumerics/dash/underscore only. */
const BARE_SLUG_RE = /^[a-z0-9_-]+$/i;

/** External http(s) url — the ONLY shape the base link field accepts (spec
 * §8). Case-insensitive: real-world data capitalizes schemes ("HTTPS://…"). */
const EXTERNAL_RE = /^https?:\/\//i;

/** The record's uid. Its `url` — but ONLY when it is a bare slug after the
 * productSlug-style `/products/` prefix strip + slash trim: real fleet urls
 * are often absolute (`https://mailchi.mp/...`, strategyAdvantage ×46) or
 * route paths (`/news/<slug>` tosa ×49, `/projects/<slug>` williamsonHomes
 * ×5), which would make INVALID Prismic UIDs. Anything non-bare falls back to
 * the slugified title. */
function recordUid(record: Record<string, unknown>): string {
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const fromUrl = url.replace(/^\/+products\/+/i, "").replace(/^\/+|\/+$/g, "");
  // BARE_SLUG_RE is case-insensitive, so an uppercase slug passes — lowercase
  // it (round-2 item 9): a mixed-case uid is INVALID in Prismic.
  if (fromUrl && BARE_SLUG_RE.test(fromUrl)) return fromUrl.toLowerCase();
  return String(record.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type DateOrientation = "year-month-day" | "year-day-month";

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** Drop a trailing time suffix (`T10:30:00Z`, ` 10:30`) so a datetime-shaped
 * string keeps its date instead of being dropped as unparseable (round-2
 * item 8 — zero fleet occurrences today, cheap resilience). */
const stripTime = (s: string): string => s.replace(/(?:T|\s+)\d{1,2}:\d{2}\S*$/, "").trim();

export type NormalizedDate = {
  date?: string;
  issue?: "ambiguous" | "unparseable";
};

/** Normalize a raw feed date into a valid Prismic `YYYY-MM-DD`. Composition's
 * Products dates are unpadded `YYYY-n-n` with MIXED orientation (207 records
 * year-DAY-month, 191 year-month-day, 135 ambiguous) — verbatim passthrough
 * would land invalid values in a Date field. Already-valid ISO passes; an
 * unambiguous `YYYY-n-n` self-resolves (whichever side > 12 is the day); a
 * both-≤12 value resolves by `feedVote` (the feed's majority orientation), or
 * defaults to year-month-day with an `ambiguous` issue when the feed offers no
 * evidence. Anything else (or an out-of-range resolution) is `unparseable` —
 * the caller omits the date. */
export function normalizeDate(raw: unknown, feedVote: DateOrientation | null): NormalizedDate {
  if (typeof raw !== "string") return { issue: "unparseable" };
  const trimmed = stripTime(raw.trim());
  const m = DATE_RE.exec(trimmed);
  if (!m) return { issue: "unparseable" };
  const year = m[1]!;
  const mid = Number(m[2]!);
  const last = Number(m[3]!);
  // Range check PLUS calendar validity (round-2 item 8): "2017-02-30" is
  // range-valid but no real date — a UTC round-trip catches month-length and
  // leap-year violations, so impossible dates go unparseable instead of
  // landing verbatim in a Prismic Date field.
  const build = (month: number, day: number): string | undefined => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const d = new Date(Date.UTC(Number(year), month - 1, day));
    if (
      d.getUTCFullYear() !== Number(year) ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    )
      return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && build(mid, last) === trimmed) return { date: trimmed }; // already-valid ISO
  if (mid > 12 && last > 12) return { issue: "unparseable" };
  if (mid > 12 || last > 12) {
    // Exactly one side can be the day — the orientation is self-evident.
    const date = mid > 12 ? build(last, mid) : build(mid, last);
    return date ? { date } : { issue: "unparseable" };
  }
  // Both ≤ 12: orientation-ambiguous — the feed's majority decides;
  // tie/no-evidence reads year-month-day and flags it.
  const date = feedVote === "year-day-month" ? build(last, mid) : build(mid, last);
  if (date === undefined) return { issue: "unparseable" };
  return feedVote ? { date } : { date, issue: "ambiguous" };
}

/** The feed's majority date orientation, voted by its unambiguous records
 * (exactly one side > 12). Null when tied or the feed offers no evidence. */
function feedDateOrientation(items: unknown[]): DateOrientation | null {
  let ymd = 0;
  let ydm = 0;
  for (const it of items) {
    const raw = it && typeof it === "object" ? (it as { date?: unknown }).date : undefined;
    if (typeof raw !== "string") continue;
    const m = DATE_RE.exec(stripTime(raw.trim()));
    if (!m) continue;
    const mid = Number(m[2]!);
    const last = Number(m[3]!);
    // The would-be day must be a POSSIBLE day (≤ 31) for the record to cast a
    // vote (round-2 item 8): garbage like "2017-45-3" is not ydm evidence and
    // must never silently resolve another record's ambiguous date.
    if (mid > 12 && mid <= 31 && last >= 1 && last <= 12) ydm++;
    else if (last > 12 && last <= 31 && mid >= 1 && mid <= 12) ymd++;
  }
  if (ydm > ymd) return "year-day-month";
  if (ymd > ydm) return "year-month-day";
  return null;
}

const titleOf = (record: Record<string, unknown>): string =>
  typeof record.title === "string" && record.title.trim() ? record.title.trim() : "(untitled)";

type RecordCtx = {
  feedId: string;
  dateVote: DateOrientation | null;
  diagnostics: Diagnostic[];
  /** The entity type's extension kinds, RESOLVED across all records of every
   * feed of the type before any document emits (round-2 item 7) — value
   * emission must know the final kind so a scalar under a group-kind key
   * wraps as a row instead of landing raw in a Group-modeled field. */
  extKinds: ReadonlyMap<string, ExtKind>;
};

/** Base-field mapping for one record → the document data + the media it
 * references. Extension keys ride verbatim (except `description` → richtext
 * and arrays → their Group{value} model shape). */
function recordToDoc(
  record: Record<string, unknown>,
  type: string,
  uid: string,
  ctx: RecordCtx,
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
    data.tags = record.tags.filter((t): t is string => typeof t === "string").join(",");
  else if (typeof record.tags === "string" && record.tags) data.tags = record.tags;

  if (record.date != null && record.date !== "") {
    const norm = normalizeDate(record.date, ctx.dateVote);
    if (norm.date !== undefined) data.date = norm.date;
    if (norm.issue === "ambiguous")
      ctx.diagnostics.push({
        kind: "ambiguous-date",
        where: ctx.feedId,
        message: `record "${titleOf(record)}" date "${String(record.date)}" is orientation-ambiguous with no feed evidence — read as year-month-day "${norm.date}"`,
      });
    else if (norm.issue === "unparseable")
      ctx.diagnostics.push({
        kind: "malformed-feed-field",
        where: ctx.feedId,
        message: `record "${titleOf(record)}" date "${String(record.date)}" does not normalize to YYYY-MM-DD — omitted`,
      });
  }

  // Spec §8: the link field is EXTERNAL-only — bare slugs ('steel-chair') and
  // route paths ('/news/x') are detail-page slugs, not links. The raw `url`
  // still rides as an extension field below (Phase 7 detail pages). Round-2
  // item 6: pick the FIRST candidate that IS external (scheme match
  // case-insensitive) — a bare-slug `url` must not eat an external `link_url`.
  const urlVal = typeof record.url === "string" ? record.url.trim() : "";
  const linkUrlVal = typeof record.link_url === "string" ? record.link_url.trim() : "";
  const external = [urlVal, linkUrlVal].find((v) => v && EXTERNAL_RE.test(v));
  if (external) data.link = { link_type: "Web", url: external };
  // A non-external link_url is dropped either way (link_url is a BASE_KEYS
  // key — it never rides as an extension field) — never silently.
  if (linkUrlVal && !EXTERNAL_RE.test(linkUrlVal))
    ctx.diagnostics.push({
      kind: "malformed-feed-field",
      where: ctx.feedId,
      message: `record "${titleOf(record)}" link_url "${linkUrlVal}" is not an external http(s) url — dropped (the base link field is external-only)`,
    });

  for (const [key, value] of extEntries(record)) {
    if (ctx.extKinds.get(key) === "group")
      // The key models Group{value:Text} (an array was observed SOMEWHERE in
      // the type's records — round-2 item 7): scalars wrap as a single row so
      // every record's data matches the model, whatever this record holds.
      data[key] = (Array.isArray(value) ? value : [value]).map((x) => ({
        value: String(x),
      }));
    else if (key === "description" && typeof value === "string")
      // deriveFields convention: description (like body) is richtext; the
      // extension model is StructuredText, so raw HTML must not ride as Text.
      data[key] = richText(demoteHeadingsHtml(value));
    else if (Array.isArray(value))
      // Match the Group{value:Text} extension model the array kind derives.
      data[key] = value.map((x) => ({ value: String(x) }));
    else data[key] = value;
  }

  return { doc: { type, uid, data }, media };
}

/** Feed records → typed entity documents + per-type extension custom types +
 * the media they reference + skip diagnostics. Uid dedup is per entity type:
 * an enabled record beats a disabled one, else first-seen wins (recordUid
 * semantics — the record's bare-slug `url` first, else the title slug); every
 * dropped loser is named by a uid-collision diagnostic. */
export function buildEntityEmit(
  feeds: Record<string, { name?: string; items?: unknown[]; fields?: unknown } | undefined>,
): EntityEmit {
  const diagnostics: Diagnostic[] = [];
  const media: Media[] = [];
  const typeOrder: string[] = [];
  const docsByType = new Map<
    string,
    Map<string, { doc: PlanDocument; disabled: boolean; title: string }>
  >();
  const extByType = new Map<string, Map<string, ExtKind>>();

  // Pass 1 — resolve every extension key's kind across ALL records of every
  // feed of the type BEFORE any document emits (round-2 item 7): emission must
  // know the final kind, or a string-then-array key would land a raw string
  // in a Group-modeled field (and boolean/number-then-array the reverse).
  // DO-NOT-USE feeds skip here, once.
  const kept: { feedId: string; type: string; items: unknown[] }[] = [];
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
    const extKinds = extByType.get(type)!;
    const items = Array.isArray(feed.items) ? feed.items : [];
    kept.push({ feedId, type, items });
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = normalizeRecord(item as Record<string, unknown>);
      // Extension fields type from the observed value shapes (deriveFields
      // convention: a later, more specific observation upgrades "text");
      // group — an array observed in ANY record — beats every scalar kind.
      for (const [key, value] of extEntries(record)) {
        const next = kindOf(key, value);
        const prev = extKinds.get(key);
        if (!prev || prev === "text" || next === "group") extKinds.set(key, next);
      }
    }
  }

  // Pass 2 — emit documents with the resolved kinds.
  for (const { feedId, type, items } of kept) {
    const byUid = docsByType.get(type)!;
    const extKinds = extByType.get(type)!;
    // The feed's majority date orientation, voted once by its unambiguous
    // records, resolves the both-≤12 dates (see normalizeDate).
    const dateVote = feedDateOrientation(items);
    items.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      const record = normalizeRecord(item as Record<string, unknown>);
      const uid = recordUid(record) || `item-${i}`;
      const { doc, media: recMedia } = recordToDoc(record, type, uid, {
        feedId,
        dateVote,
        diagnostics,
        extKinds,
      });
      media.push(...recMedia);
      const disabled = record.disabled === true;
      const existing = byUid.get(uid);
      const dropped =
        !existing || (existing.disabled && !disabled)
          ? existing // the incoming record wins — the stored one is dropped
          : { title: titleOf(record) }; // the stored record wins — this one is dropped
      if (dropped)
        diagnostics.push({
          kind: "uid-collision",
          where: feedId,
          message: `record "${dropped.title}" collides on uid "${uid}" — dropped (enabled beats disabled, else first-seen wins)`,
        });
      if (!existing || (existing.disabled && !disabled))
        byUid.set(uid, { doc, disabled, title: titleOf(record) });
    });
  }

  const documents: PlanDocument[] = [];
  const customTypes: PlanCustomType[] = [];
  for (const type of typeOrder) {
    for (const { doc } of docsByType.get(type)!.values()) documents.push(doc);
    const Main: Record<string, unknown> = { ...BASE_MAIN };
    for (const [key, kind] of extByType.get(type)!) Main[key] = EXT_FIELD_CONFIG[kind](key);
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

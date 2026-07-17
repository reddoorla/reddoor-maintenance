// Feed-grid materialization. Blux feed grids (gallery/portfolio) render their
// tiles CLIENT-SIDE from feed records — the static export ships only a
// display:none {{…}} template (dropped by the parser). This module rebuilds
// the visible tiles DETERMINISTICALLY from the feed data at convert time, so
// the faithful render shows the real content instead of an empty band.
//
// A feed band's site.json item carries `sources` (a feed id, or `__media` for
// the media library) and `sourceConfig` (a tag filter, a sort, per-tile style
// config). We resolve the matching records, expand each into a tile
// (image + optional title/body), and return a Grid node tree — so the band
// classifies and renders as any other Grid, with no new render surface.
import type { Cell, Media, Node } from "./types.js";
import { CDN_HOSTS } from "../assets.js";

/** A media-library entry (`site.json.media[uuid]`) or a feed record. Both are
 * loose bags; we read only the fields the tile needs. */
export type FeedRecord = Record<string, unknown>;

/** A resolved tile: an image (already a Media) and/or display text. `title`
 * and `body` are RENDER-READY HTML — feed records store them as HTML (entities
 * pre-encoded, `<br>` markup), and `__media` plain text (name/description) is
 * escaped at resolve time — so the render places them verbatim, never
 * re-escaping (which would double-encode `&amp;` or show a literal `<br>`). */
export type FeedTile = { media?: Media; title?: string; body?: string };

/** Everything the materializer needs from the export, injected so the module
 * stays pure/offline and testable. */
export type FeedResolvers = {
  /** Feed records by feed id (site.json feeds → their JSON arrays). */
  feeds: Map<string, FeedRecord[]>;
  /** The media library: uuid → its `{ name, type, tags }` entry. */
  media: Map<string, FeedRecord>;
  /** Build a Media (with a resolved url base) for an asset uuid, given its mime
   * type and/or filename (either can supply the extension) — the render
   * resolver turns Media→url the same way it does for parsed media, so feed
   * images flow through one url path. */
  mediaFor: (uuid: string, type: string | undefined, name?: string) => Media | null;
};

/** A term matches a tag when they're equal OR differ only by a trailing `s`
 * (singular/plural) — Blux's server-side feed resolver stems this way, so a
 * `projects` filter also selects `project`-tagged media (7 real gallery tiles
 * that an exact match drops). Conservative: only a single trailing `s`, so it
 * never over-selects unrelated tags. */
const termMatchesTag = (term: string, tag: string): boolean =>
  term === tag ||
  (term.endsWith("s") && term.slice(0, -1) === tag) ||
  (tag.endsWith("s") && tag.slice(0, -1) === term);

/** Parse a Blux tag filter expression into a predicate over a tag set. The
 * DSL: `&&` joins AND terms, `||` joins OR groups; a record matches when ANY
 * OR group has ALL its terms present (singular/plural-insensitive, see
 * `termMatchesTag`). Leading/empty terms (`&&metal&&sofa`) are ignored.
 * Case-insensitive. An empty/absent expression matches all. */
export function tagFilter(expr: string | undefined): (tags: string[]) => boolean {
  const groups = (expr ?? "")
    .split("||")
    .map((g) =>
      g
        .split("&&")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter((g) => g.length > 0);
  if (!groups.length) return () => true;
  return (tags) => {
    const set = tags.map((t) => t.toLowerCase());
    return groups.some((g) => g.every((term) => set.some((tag) => termMatchesTag(term, tag))));
  };
}

/** Records sorted by a Blux `sort` key. `title` → by title with
 * `localeCompare` (matching Blux's own client sort, which uses
 * `((a.sort||"")+"").localeCompare(b.sort)` for non-numeric sort values);
 * `fdate`/`date` → by the record's date descending (newest first, Blux's
 * default), the undated last; anything else → source order preserved.
 * Stable. */
function sortRecords(records: FeedRecord[], sort: string | undefined): FeedRecord[] {
  if (sort === "title") {
    return [...records].sort((a, b) =>
      String(a["title"] ?? "").localeCompare(String(b["title"] ?? "")),
    );
  }
  if (sort === "fdate" || sort === "date") {
    return [...records].sort((a, b) =>
      String(b["date"] ?? "").localeCompare(String(a["date"] ?? "")),
    );
  }
  return records;
}

const isDisabled = (r: FeedRecord): boolean => r["disabled"] === true || r["disable"] === true;
const styleDisabled = (cfg: unknown): boolean =>
  !!cfg && typeof cfg === "object" && (cfg as { class?: string })["class"] === "disable";

/** Resolve a feed band's source into ordered tiles. `sources[0]` is either
 * `__media` (the media library, tiles = tag-matched images) or a feed id
 * (tiles = its records, filtered + sorted, expanded via the template config).
 * Returns null when the source is unknown or yields nothing. */
export function resolveFeedTiles(
  bandDef: {
    sources?: unknown;
    sourceConfig?: Record<string, unknown>;
  },
  resolvers: FeedResolvers,
): FeedTile[] | null {
  const sources = Array.isArray(bandDef.sources) ? bandDef.sources.map(String) : [];
  const source = sources[0];
  if (!source) return null;
  const cfg = bandDef.sourceConfig ?? {};
  const filterExpr = (cfg["filters"] as { tag?: string } | undefined)?.tag;
  const match = tagFilter(filterExpr);
  const sort = cfg["sort"] as string | undefined;
  const bodyOff = styleDisabled(cfg["_body"]);
  const titleOff = styleDisabled(cfg["_title"]);

  if (source === "__media") {
    // Media-library grid: every tag-matched image, sorted by the config (the
    // gallery/portfolio grids are `fdate` — newest first). Library entries DO
    // carry display text: `name` is a caption (a real title, not a filename)
    // and `description` the body — Blux binds both into the tile overlay
    // (unless _title/_body is disabled). These are PLAIN text, so escape them.
    const matched: FeedRecord[] = [];
    for (const [uuid, entry] of resolvers.media) {
      const type = String(entry["type"] ?? "");
      if (!type.startsWith("image/")) continue;
      if (!match((entry["tags"] as string[] | undefined) ?? [])) continue;
      matched.push({ ...entry, __uuid: uuid });
    }
    const tiles = sortRecords(matched, sort)
      .map((entry): FeedTile => {
        const media = resolvers.mediaFor(
          String(entry["__uuid"]),
          entry["type"] as string | undefined,
          entry["name"] as string | undefined,
        );
        const tile: FeedTile = {};
        if (media) tile.media = media;
        if (!titleOff && entry["name"]) tile.title = escapeHtml(String(entry["name"]));
        if (!bodyOff && entry["description"]) tile.body = plainToHtml(String(entry["description"]));
        return tile;
      })
      .filter((t) => t.media || t.title || t.body);
    return tiles.length ? tiles : null;
  }

  const records = resolvers.feeds.get(source);
  if (!records) return null;
  const enabled = records.filter((r) => !isDisabled(r));
  const filtered = filterExpr
    ? enabled.filter((r) => match((r["tags"] as string[]) ?? []))
    : enabled;
  const ordered = sortRecords(filtered, sort);
  const tiles = ordered.map((r): FeedTile => {
    const tile: FeedTile = {};
    const m = r["media"] as { media?: string; type?: string } | undefined;
    if (m?.media) {
      const media = resolvers.mediaFor(m.media, m.type);
      if (media) tile.media = media;
    }
    // Feed record title/body are stored as HTML (entities encoded, `<br>`
    // markup) — keep them VERBATIM, never re-escape.
    if (!titleOff && r["title"]) tile.title = String(r["title"]);
    if (!bodyOff && r["body"]) tile.body = String(r["body"]);
    return tile;
  });
  return tiles.length ? tiles : null;
}

/** A materialized feed grid: the band's heading (if any) over a row of tile
 * cells. Each tile is a stack of its image + title + body (whichever it has);
 * a lone image/heading stays bare. `columns` sets each cell's grid token so the
 * render lays them out in a grid (the source `columns`/`data-columns`; default
 * 3). Returns the heading alone when there are no tiles, null when neither. */
export function materializeFeedGrid(opts: {
  heading?: { html: string; level: number; role?: string };
  tiles: FeedTile[] | null;
  columns: number;
  spacing?: number;
}): Node | null {
  const { heading, tiles, columns, spacing } = opts;
  const headingNode: Node | null = heading
    ? {
        kind: "heading",
        level: heading.level,
        html: heading.html,
        ...(heading.role ? { role: heading.role } : {}),
      }
    : null;
  if (!tiles || !tiles.length) return headingNode;

  const cols = Math.max(1, Math.round(columns));
  const cells: Cell[] = tiles.map((t) => {
    const parts: Node[] = [];
    if (t.media) parts.push({ kind: "media", media: t.media });
    // title/body are already render-ready HTML (feed records store HTML;
    // __media plain text was escaped at resolve time) — place them verbatim.
    if (t.title) parts.push({ kind: "heading", level: 6, html: t.title, role: "text6" });
    if (t.body) parts.push({ kind: "body", html: t.body });
    const node: Node = parts.length === 1 ? parts[0]! : { kind: "stack", children: parts };
    return {
      token: {
        cols,
        raw: `grid-${cols}${spacing ? `-s${spacing}` : ""}`,
        ...(spacing ? { spacing } : {}),
      },
      node,
    };
  });
  const row: Node = { kind: "row", cells };
  return headingNode ? { kind: "stack", children: [headingNode, row] } : row;
}

/** HTML-escape a PLAIN-text value (a `__media` name/description) for placement
 * into an html-bearing node. Feed-record title/body are already HTML and skip
 * this. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A plain-text body (`__media` description) as body html: escaped, with the
 * source's hard newlines becoming `<br>` (Blux descriptions are multi-line —
 * "DESIGN: …\nPROCUREMENT: …"), wrapped in a `<p>`. */
function plainToHtml(s: string): string {
  const inner = escapeHtml(s.trim()).replace(/\r?\n/g, "<br>");
  return `<p>${inner}</p>`;
}

/** A file extension for a media asset: the mime map first (image/jpeg → jpg),
 * else the extension off the entry's own filename (`name`) — Blux names carry
 * the real extension, so an unmapped/absent mime (image/jpg, avif, heic, a
 * bare `custom`) still resolves instead of silently dropping the tile. null
 * only when neither yields an image extension. */
function extFor(mime: string | undefined, name: string | undefined): string | null {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  if (mime && byMime[mime]) return byMime[mime];
  const m = /\.([a-z0-9]{2,5})$/i.exec(name ?? "");
  const ext = m?.[1]?.toLowerCase();
  const IMG = new Set(["jpg", "jpeg", "png", "svg", "gif", "webp", "avif", "bmp", "tif", "tiff"]);
  return ext && IMG.has(ext) ? (ext === "jpeg" ? "jpg" : ext) : null;
}

/** Is this a feed-driven band? — its site.json item declares `sources`. */
export function isFeedBand(
  item: unknown,
): item is { sources: unknown[]; sourceConfig?: Record<string, unknown> } {
  return (
    !!item &&
    typeof item === "object" &&
    Array.isArray((item as { sources?: unknown }).sources) &&
    (item as { sources: unknown[] }).sources.length > 0
  );
}

/** The CDN base (`https://<host>/<siteId>/`) an export actually serves assets
 * from — scraped from a rendered `data-base` so the RIGHT host is used (Blux
 * spreads assets across two CDN hosts; a hardcoded host would 404 the other).
 * Falls back to the first known host + siteId when no data-base is present. */
export function feedAssetBase(htmls: string[], siteId: string): string {
  for (const html of htmls) {
    const m = /data-base="(https?:\/\/[^"]+?\/)"/i.exec(html);
    if (m?.[1]) return m[1].replace(/^http:/, "https:");
  }
  return `https://${CDN_HOSTS[0]}/${siteId}/`;
}

/** Build the feed resolvers from a parsed site: feed records (site.json.feeds
 * carries them inline), the media library, and a Media builder that
 * reconstructs the CDN url (`<base><uuid>.<ext>` — the untransformed base the
 * export's own `data-base` uses, which resolves full-res). `base` comes from
 * `feedAssetBase` (the export's real host); `ext` from mime-or-filename. Pure. */
export function buildFeedResolvers(
  feeds: Record<string, { items?: FeedRecord[] } | undefined>,
  mediaLibrary: Record<string, FeedRecord>,
  base: string,
): FeedResolvers {
  const feedMap = new Map<string, FeedRecord[]>();
  for (const [id, f] of Object.entries(feeds)) {
    if (Array.isArray(f?.items)) feedMap.set(id, f.items);
  }
  const mediaMap = new Map<string, FeedRecord>(Object.entries(mediaLibrary));
  return {
    feeds: feedMap,
    media: mediaMap,
    mediaFor: (uuid, type, name) => {
      const ext = extFor(type, name);
      if (!ext) return null;
      return { kind: "image", assetId: uuid, base, ext };
    },
  };
}

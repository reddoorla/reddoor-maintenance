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

/** A resolved tile: an image (already a Media) and/or display text. */
export type FeedTile = { media?: Media; title?: string; body?: string };

/** Everything the materializer needs from the export, injected so the module
 * stays pure/offline and testable. */
export type FeedResolvers = {
  /** Feed records by feed id (site.json feeds → their JSON arrays). */
  feeds: Map<string, FeedRecord[]>;
  /** The media library: uuid → its `{ name, type, tags }` entry. */
  media: Map<string, FeedRecord>;
  /** Build a Media (with a resolved url base) for an asset uuid of a given
   * mime type — the render resolver turns Media→url the same way it does for
   * parsed media, so feed images flow through one url path. */
  mediaFor: (uuid: string, type: string | undefined) => Media | null;
};

/** Parse a Blux tag filter expression into a predicate over a tag set. The
 * DSL: `&&` joins AND terms, `||` joins OR groups; a record matches when ANY
 * OR group has ALL its terms present. Leading/empty terms (`&&metal&&sofa`)
 * are ignored. Case-insensitive. An empty/absent expression matches all. */
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
    const set = new Set(tags.map((t) => t.toLowerCase()));
    return groups.some((g) => g.every((t) => set.has(t)));
  };
}

/** Records sorted by a Blux `sort` key. `title` → alphabetical by title;
 * `fdate`/`date` → by the record's date descending (newest first, Blux's
 * default feed order); anything else → source order preserved. Stable. */
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
    // Media-library grid: every image whose tags match, as an image tile. The
    // library entries carry no display text (name is a filename), so overlay
    // titles are omitted — the tiles are the images.
    const tiles: FeedTile[] = [];
    for (const [uuid, entry] of resolvers.media) {
      const type = String(entry["type"] ?? "");
      if (!type.startsWith("image/")) continue;
      const tags = (entry["tags"] as string[] | undefined) ?? [];
      if (!match(tags)) continue;
      const media = resolvers.mediaFor(uuid, type);
      if (media) tiles.push({ media });
    }
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
    if (t.title)
      parts.push({ kind: "heading", level: 6, html: escapeHtml(t.title), role: "text6" });
    if (t.body)
      parts.push({
        kind: "body",
        html: /<[a-z]/i.test(t.body) ? t.body : `<p>${escapeHtml(t.body)}</p>`,
      });
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

/** Minimal HTML-escape for plain-text feed values placed into html-bearing
 * nodes (heading/body carry html). Feed titles are plain text. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A file extension for a media mime type (image/jpeg → jpg). null for a mime
 * we don't map (the tile then can't build a url and is dropped). */
function extForMime(mime: string | undefined): string | null {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/svg+xml":
      return "svg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
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

/** Build the feed resolvers from a parsed site: feed records (site.json.feeds
 * carries them inline), the media library, and a Media builder that
 * reconstructs the CDN url (`https://<host>/<siteId>/<uuid>.<ext>` — the
 * untransformed base the export's own `data-base` uses, which resolves
 * full-res). Pure. */
export function buildFeedResolvers(
  feeds: Record<string, { items?: FeedRecord[] } | undefined>,
  mediaLibrary: Record<string, FeedRecord>,
  siteId: string,
): FeedResolvers {
  const feedMap = new Map<string, FeedRecord[]>();
  for (const [id, f] of Object.entries(feeds)) {
    if (Array.isArray(f?.items)) feedMap.set(id, f.items);
  }
  const mediaMap = new Map<string, FeedRecord>(Object.entries(mediaLibrary));
  const base = `https://${CDN_HOSTS[0]}/${siteId}/`;
  return {
    feeds: feedMap,
    media: mediaMap,
    mediaFor: (uuid, type) => {
      const ext = extForMime(type);
      if (!ext) return null;
      return { kind: "image", assetId: uuid, base, ext };
    },
  };
}

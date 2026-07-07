/** Style config for a block's title/body. `class: "disable"` (or the bare
 * string "disable") hides that element on the rendered site. */
export type BluxTextStyle = string | { class?: string; [key: string]: unknown };

export type BluxBlock = {
  title?: string;
  _title?: BluxTextStyle;
  body?: string;
  _body?: BluxTextStyle;
  media?: { media?: string };
  backgroundMedia?: { media?: string };
  class?: string;
  ratio?: string;
  loadEffect?: string;
  items?: BluxBlock[];
  styles?: Record<string, unknown>;
};

const hasDisable = (cls: unknown) =>
  typeof cls === "string" && cls.split(/\s+/).includes("disable");

/** Display text of a Blux title/body pair, or undefined when the element is
 * hidden. Blux stores the text itself in `title`/`body`; the underscore twin
 * (`_title`/`_body`) is style config whose `class: "disable"` hides the
 * element, so its text must not be migrated. */
export function visibleText(text: unknown, style: BluxTextStyle | undefined): string | undefined {
  const s = typeof text === "number" && Number.isFinite(text) ? String(text) : text;
  if (typeof s !== "string" || s.trim() === "") return undefined;
  if (hasDisable(style)) return undefined;
  if (typeof style === "object" && style !== null && hasDisable(style.class)) return undefined;
  return s.trim();
}
export type BluxPage = { title?: string; description?: string; items?: BluxBlock[] };
export type BluxFeed = {
  name?: string;
  source?: string;
  publish?: string;
  fields?: { title?: string; field?: string; type?: string }[];
  items?: Record<string, unknown>[];
};
export type BluxMedia = { name?: string; type?: string; size?: unknown; siteID?: string };
export type BluxRaw = {
  meta: { name: string; domain: string; bluxSiteId: string };
  pages: BluxPage[];
  feeds: Record<string, BluxFeed>;
  media: Record<string, BluxMedia>;
  styles: {
    colors?: Record<string, string>;
    text?: Record<string, unknown>;
    buttons?: Record<string, unknown>;
  };
  nav: { title?: string; url?: string }[];
  settings: { fonts?: { heading?: string; body?: string } };
};

function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error("Invalid site.json: expected an object");
  }
  return v as Record<string, unknown>;
}

export function parseBluxSite(input: unknown): BluxRaw {
  const j = asObject(input);
  const content = (j.content ?? {}) as { pages?: BluxPage[] };
  const styles = (j.styles ?? {}) as BluxRaw["styles"];
  const nav = ((j.navigation as { items?: unknown }[] | undefined)?.[0]?.items ?? []) as {
    title?: string;
    url?: string;
  }[];
  return {
    meta: {
      name: String(j.name ?? ""),
      domain: String(j.domain ?? ""),
      bluxSiteId: String(j.id ?? ""),
    },
    pages: Array.isArray(content.pages) ? content.pages : [],
    feeds: (j.feeds ?? {}) as Record<string, BluxFeed>,
    media: (j.media ?? {}) as Record<string, BluxMedia>,
    styles,
    nav,
    settings: (j.settings ?? {}) as BluxRaw["settings"],
  };
}

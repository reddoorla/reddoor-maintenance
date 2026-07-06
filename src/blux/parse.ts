export type BluxBlock = {
  title?: string;
  _title?: string;
  body?: string;
  _body?: string;
  media?: { media?: string };
  backgroundMedia?: { media?: string };
  class?: string;
  ratio?: string;
  loadEffect?: string;
  items?: BluxBlock[];
  styles?: Record<string, unknown>;
};
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

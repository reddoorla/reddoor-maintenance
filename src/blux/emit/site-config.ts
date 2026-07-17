// Site chrome (navigation + footer) → a render-side config. The Blux export's
// `navigation` is a nested tree (top items with optional dropdown children)
// and `footer` a list of social-link + copyright items; both were dropped by
// the page-focused convert. This builds a deterministic `site-config.json` the
// render's Nav/Footer consume (additive: a site with no config renders the
// starter's logo-only bar and placeholder footer, exactly as before).

/** A navigation entry: a label + href, with optional dropdown children. */
export type NavItem = { label: string; href: string; children?: NavItem[] };

/** A footer social link: the network id (facebook, instagram, …) and, when the
 * export carries one, its url. */
export type FooterSocial = { network: string; href?: string };

export type SiteConfig = {
  nav: {
    /** The logo image url (resolved), if the export declares one. */
    logo?: { url: string; maxWidth?: string };
    items: NavItem[];
  };
  footer: {
    socials: FooterSocial[];
    /** The copyright / rights line. */
    text?: string;
  };
};

type RawNavItem = { title?: unknown; link?: unknown; items?: unknown };

/** Parse the nested navigation tree from a Blux `navigation` value. Only items
 * with a title survive; an item with children becomes a dropdown (its own link
 * is often empty — a heading), a leaf keeps its href. Recurses one+ levels. */
function parseNavItems(items: unknown): NavItem[] {
  if (!Array.isArray(items)) return [];
  const out: NavItem[] = [];
  for (const raw of items as RawNavItem[]) {
    const label = typeof raw?.title === "string" ? raw.title.trim() : "";
    if (!label) continue;
    const href = typeof raw?.link === "string" ? raw.link : "";
    const children = parseNavItems(raw?.items);
    out.push({ label, href, ...(children.length ? { children } : {}) });
  }
  return out;
}

/** The known social networks and the http(s) url found for one in a raw footer
 * social item (Blux stores `networks: { facebook: true, … }` — the flags — and
 * sometimes per-network urls elsewhere; we carry the network id and any url). */
function parseSocials(raw: unknown): FooterSocial[] {
  const out: FooterSocial[] = [];
  const items = Array.isArray(raw) ? raw : [];
  for (const it of items as { media?: { type?: unknown; networks?: unknown; urls?: unknown } }[]) {
    const media = it?.media;
    if (!media || media.type !== "social") continue;
    const networks = media.networks;
    if (!networks || typeof networks !== "object") continue;
    const urls = (media.urls ?? {}) as Record<string, unknown>;
    for (const [network, on] of Object.entries(networks as Record<string, unknown>)) {
      if (on !== true) continue;
      const url = typeof urls[network] === "string" ? (urls[network] as string) : undefined;
      out.push({ network, ...(url ? { href: url } : {}) });
    }
  }
  return out;
}

/** The footer's rights/copyright line: the first footer item that carries a
 * `title` (Blux puts the "© … All Rights Reserved" text there). */
function parseFooterText(raw: unknown): string | undefined {
  const items = Array.isArray(raw) ? raw : [];
  for (const it of items as { title?: unknown }[]) {
    if (typeof it?.title === "string" && it.title.trim()) return it.title.trim();
  }
  return undefined;
}

/** Build the render-side site config from the export's navigation + footer.
 * `resolveLogo` turns the nav logo's asset uuid into a url (null when
 * unresolved). Pure. */
export function buildSiteConfig(
  siteJson: unknown,
  resolveLogo: (uuid: string) => string | null,
): SiteConfig {
  const j = siteJson as { navigation?: unknown; footer?: unknown };
  const navRoot = (Array.isArray(j.navigation) ? j.navigation[0] : j.navigation) as
    | { items?: unknown; logo?: { media?: unknown } }
    | undefined;
  const footRoot = (Array.isArray(j.footer) ? j.footer[0] : j.footer) as
    | { items?: unknown }
    | undefined;

  const items = parseNavItems(navRoot?.items);
  // The logo is `logo: { media: { media: <uuid>, "max-width": … } }` — the
  // asset uuid and its render sizing are nested one level inside `logo.media`.
  const logoMedia = navRoot?.logo?.media as { media?: unknown; "max-width"?: unknown } | undefined;
  const logoUuid = typeof logoMedia?.media === "string" ? logoMedia.media : undefined;
  const logoUrl = logoUuid ? resolveLogo(logoUuid) : null;
  const maxWidth =
    typeof logoMedia?.["max-width"] === "string" ? logoMedia["max-width"] : undefined;

  const socials = parseSocials(footRoot?.items);
  const text = parseFooterText(footRoot?.items);

  return {
    nav: {
      ...(logoUrl ? { logo: { url: logoUrl, ...(maxWidth ? { maxWidth } : {}) } } : {}),
      items,
    },
    footer: {
      socials,
      ...(text ? { text } : {}),
    },
  };
}

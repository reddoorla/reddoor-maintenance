// Site chrome for the catalog path (Plan 4d Task 4). Nav rides the frozen
// buildSiteConfig extraction verbatim (labels from `title`, dropdown
// recursion, `navigation[0].logo` when a site declares one), then patches the
// shape Blux sites like the-pointe actually use: the logo is a nav ITEM
// (`hideTitle: true` + `media`), not `navigation[0].logo` — promote it to
// nav.logo and keep it out of the text links. The footer keeps FULL columns
// (the-pointe's leasing-contact columns with tel:/mailto: links, logo rows as
// images) instead of site-config's socials+text reduction — emit/site-config
// is frozen, so the richer footer lives here.

import { buildSiteConfig, type SiteConfig } from "../emit/site-config.js";

/** One rendered footer row: a text line (optionally linked — tel:/mailto:/
 * http(s) hrefs survive verbatim) or an image (a footer logo, optionally
 * linked). */
export type ChromeFooterItem =
  | { text: string; href?: string }
  | { image: { url: string; maxWidth?: string }; href?: string };

export type ChromeConfig = {
  nav: SiteConfig["nav"];
  footer: { columns: { items: ChromeFooterItem[] }[] };
};

type RawItem = {
  title?: unknown;
  link?: unknown;
  hideTitle?: unknown;
  media?: { media?: unknown; "max-width"?: unknown };
  items?: unknown;
};

/** Display text of a raw item's `title`. Blux pads layout spacers with
 * `&nbsp;` entities (`" &nbsp;"` rows between contact blocks), so decode
 * before trimming — a spacer nets "" and is dropped by the caller. */
function displayTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  return title
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function asHref(link: unknown): string | undefined {
  return typeof link === "string" && link.trim() ? link.trim() : undefined;
}

/** The item's media resolved to a drawable image, or undefined when there is
 * no media uuid or the resolver can't produce a url (nothing to draw — never
 * fall back to the row's hidden title text). */
function asImage(
  media: RawItem["media"],
  resolveLogo: (uuid: string) => string | null,
): { url: string; maxWidth?: string } | undefined {
  const uuid = typeof media?.media === "string" ? media.media : undefined;
  const url = uuid ? resolveLogo(uuid) : null;
  if (!url) return undefined;
  const maxWidth = typeof media?.["max-width"] === "string" ? media["max-width"] : undefined;
  return { url, ...(maxWidth ? { maxWidth } : {}) };
}

/** Site chrome for the catalog path: nav via buildSiteConfig (+ hidden-logo
 * promotion), footer with full columns from `footer[0].items[].items[]`.
 * `resolveLogo` turns a media uuid into a url (null when unresolved). Pure. */
export function buildChrome(
  siteJson: unknown,
  resolveLogo: (uuid: string) => string | null,
): ChromeConfig {
  const sc = buildSiteConfig(siteJson, resolveLogo);
  const j = siteJson as { navigation?: unknown; footer?: unknown };
  const navRoot = (Array.isArray(j.navigation) ? j.navigation[0] : j.navigation) as
    | { items?: unknown }
    | undefined;
  const rawNavItems = Array.isArray(navRoot?.items) ? (navRoot.items as RawItem[]) : [];

  // Hidden nav items (`hideTitle: true`) are visual, not links: buildSiteConfig
  // keeps them (it has no hideTitle notion), so drop their labels from the text
  // items and promote the first media-bearing one to the logo slot when the
  // export has no `navigation[0].logo`.
  const hidden = rawNavItems.filter((r) => r?.hideTitle === true);
  const hiddenLabels = new Set(
    hidden.map((r) => (typeof r.title === "string" ? r.title.trim() : "")).filter(Boolean),
  );
  const items = sc.nav.items.filter((i) => !hiddenLabels.has(i.label));
  let logo = sc.nav.logo;
  if (!logo) {
    for (const r of hidden) {
      const image = asImage(r.media, resolveLogo);
      if (image) {
        logo = image;
        break;
      }
    }
  }

  const footRoot = (Array.isArray(j.footer) ? j.footer[0] : j.footer) as
    | { items?: unknown }
    | undefined;
  const rawCols = Array.isArray(footRoot?.items) ? (footRoot.items as RawItem[]) : [];
  const columns = rawCols.flatMap((col) => {
    const subs = Array.isArray(col?.items) ? (col.items as RawItem[]) : [];
    const colItems = subs.flatMap((it): ChromeFooterItem[] => {
      const href = asHref(it?.link);
      if (typeof it?.media?.media === "string") {
        const image = asImage(it.media, resolveLogo);
        return image ? [{ image, ...(href ? { href } : {}) }] : [];
      }
      if (it?.hideTitle === true) return [];
      const text = displayTitle(it?.title);
      if (!text) return [];
      return [href ? { text, href } : { text }];
    });
    return colItems.length ? [{ items: colItems }] : [];
  });

  return { nav: { ...(logo ? { logo } : {}), items }, footer: { columns } };
}

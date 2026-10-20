import type { SubmissionsPageModel } from "../../../../src/dashboard/submissions-page.js";

/** Href for page `page` of the active filter. */
export function pageHref(m: SubmissionsPageModel, page: number): string {
  const p = new URLSearchParams();
  const f = m.filter;
  if (f.site) p.set("site", f.site);
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.reason) p.set("reason", f.reason);
  p.set("page", String(page));
  return `/submissions?${p.toString()}`;
}

/** Href for a facet-chip click: the active filter with `reason` swapped to
 *  `reasonToken` (null = clear) and NO page param — a reason change resets to page 1. */
export function facetHref(m: SubmissionsPageModel, reasonToken: string | null): string {
  const p = new URLSearchParams();
  const f = m.filter;
  if (f.site) p.set("site", f.site);
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (reasonToken) p.set("reason", reasonToken);
  const qs = p.toString();
  return qs === "" ? "/submissions" : `/submissions?${qs}`;
}

export function maxPage(m: SubmissionsPageModel): number {
  return Math.max(1, Math.ceil(m.total / m.pageSize));
}

/** The spam reason tokens across the WHOLE filtered bucket (`m.facetReasons`, not
 *  just this page), most frequent first. A per-token count suffix ("keywords:4")
 *  is stripped so those group as one facet. Each is a chip that filters to rows
 *  carrying that token; the active chip clears it. Shown only on the spam views,
 *  where the tally describes screened rows alone. */
export function spamFacets(
  m: SubmissionsPageModel,
): Array<{ token: string; count: number; active: boolean; href: string }> {
  if (m.filter.status !== "spam_auto" && m.filter.status !== "spam") return [];
  const counts = new Map<string, number>();
  for (const reasonString of m.facetReasons) {
    for (const raw of reasonString.split(",")) {
      const token = raw.trim().replace(/:\d+$/, "");
      if (token === "") continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token, count]) => {
      const active = token === m.filter.reason;
      return { token, count, active, href: facetHref(m, active ? null : token) };
    });
}

/** The bulk mark-read confirm. The count shown is advisory: the write re-counts
 *  at POST time and only ever touches status='new' rows. */
export function markReadConfirmText(n: number): string {
  return `Mark all ${n} filtered new submission${n === 1 ? "" : "s"} as read? Spam and operator-touched rows are never affected.`;
}

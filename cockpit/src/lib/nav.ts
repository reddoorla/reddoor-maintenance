/** The cockpit's one nav bar, in order. `match` decides which entry a path
 *  belongs to: a site page is reached from Sites, so it lights Sites. */
export const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  match: (path: string) => boolean;
}> = [
  // P1-78f: Overview (`/`) joins first when it lands (P1-78g); until then `/`
  // redirects to Triage, so the nav does not offer a page that is not there.
  // P1-78g: drop `|| p === "/"` here, or Triage lights up on the overview.
  { href: "/triage", label: "Triage", match: (p) => p === "/triage" || p === "/" },
  { href: "/fleet", label: "Sites", match: (p) => p === "/fleet" || p.startsWith("/s/") },
  { href: "/submissions", label: "Inbox", match: (p) => p === "/submissions" },
  { href: "/audits", label: "Audits", match: (p) => p === "/audits" },
];

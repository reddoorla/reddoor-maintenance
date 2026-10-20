/** The cockpit's one nav bar, in order. `match` decides which entry a path
 *  belongs to: a site page is reached from Sites, so it lights Sites. */
export const NAV_ITEMS: ReadonlyArray<{
  href: string;
  label: string;
  match: (path: string) => boolean;
}> = [
  { href: "/", label: "Home", match: (p) => p === "/" },
  { href: "/fleet", label: "Sites", match: (p) => p === "/fleet" || p.startsWith("/s/") },
  { href: "/submissions", label: "Inbox", match: (p) => p === "/submissions" },
  { href: "/audits", label: "Audits", match: (p) => p === "/audits" },
];

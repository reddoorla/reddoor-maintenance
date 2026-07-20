/** Frozen feed→entity-type mapping (spec §8). Keyed on the NORMALIZED feed
 * name (lowercase, collapsed whitespace). `collection_item` is the catch-all
 * so nothing is unroutable; "DO NOT USE…" feeds are skipped with a report
 * entry instead of migrated. */
const NAME_TO_TYPE: Record<string, string> = {
  products: "product",
  "equipment grid": "product",
  "center features": "product",
  team: "person",
  reps: "person",
  trainers: "person",
  events: "event",
  "donate life observances": "event",
  news: "news_article",
  "outside the lines": "news_article",
  "all projects list": "project",
  portfolio: "project",
  projects: "project",
};

const normalize = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

export function feedEntityType(feedName: string): string {
  const name = normalize(feedName);
  const exact = NAME_TO_TYPE[name];
  if (exact) return exact;
  // Real fleet feeds prefix "Equipment Grid" with the club name ("The Pointe
  // Equipment Grid" ×4 in fitHealthClub) — suffix-match after the exact
  // lookup misses so those still route to product.
  if (/\bequipment grid$/.test(name)) return "product";
  return "collection_item";
}

export function isSkippedFeed(feedName: string): boolean {
  return normalize(feedName).startsWith("do not use");
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SiteConfig = {
  /** Override URL the lighthouse audit hits. Sites without the default
   * `/dev/a11y-fixtures` dev route set this to their homepage. */
  lighthouseUrl?: string;
  /**
   * Real site routes the a11y audit should axe-scan, IN ADDITION to the two
   * synthetic fixture pages it always covers. Opt-in per site and absent by
   * default: the audit runs with `--fail-on-violations` in the shared CI
   * workflow, and most of the fleet carries pre-existing a11y debt, so scanning
   * real routes everywhere at once would red every repo. A site adopts this once
   * its routes are clean. Omitted (never `[]`) when unset or unusable.
   */
  a11yRoutes?: string[];
  /**
   * Which server the browser gates run against: `"dev"` (the default — `vite
   * dev`) or `"preview"` (a real `vite build`, served by `vite preview`).
   *
   * Both gates measured the dev server, so the production bundle was built in
   * CI and then never opened by a browser — and dev does not merely fail to
   * reproduce some defects, it hides them. Module graph, code splitting,
   * minification and asset hashing are most of what "hydration works" means,
   * and a stylesheet can even be fetched under a different CSP directive in
   * each (#700).
   *
   * Opt-in, because a preview costs a `pnpm build` per run and because the
   * `/dev/*` fixture routes the axe scan targets are not guaranteed to survive
   * one — a site that flipped this without checking would trade a working gate
   * for one reporting every fixture as a missing route. Omitted (never
   * defaulted here) so each caller states its own default.
   *
   * Requires a `preview` script in the site's package.json; the starter has one.
   */
  gateServer?: "dev" | "preview";
  /**
   * Built-in a11y fixture routes this site deliberately does not have (#900).
   *
   * The audit already declines to fail on a fixture its `src/routes` tree has
   * no directory for — a route the site never had is not a missing route. What
   * it cannot tell from the tree alone is whether the fixture was never there
   * or was deleted last Tuesday, and only one of those is fine. So an
   * undeclared absence is a `warn`: visible in the fleet sweep, not a failure.
   * Listing the route here says "this one is on purpose" and returns the site
   * to a clean pass.
   *
   * The declaration never grants tolerance on its own. A fixture listed here
   * that IS in the tree is scanned exactly as before, so a stale entry cannot
   * silence a real route.
   */
  absentFixtures?: string[];
};

/**
 * Read per-site overrides from `package.json#reddoor`. Returns `{}` on any
 * failure (missing file, malformed JSON, missing key, wrong type) so every
 * caller can safely fall back to its built-in default. Never throws.
 */
export async function readSiteConfig(sitePath: string): Promise<SiteConfig> {
  let raw: string;
  try {
    raw = await readFile(join(sitePath, "package.json"), "utf-8");
  } catch {
    return {};
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!pkg || typeof pkg !== "object") return {};
  const cfg = (pkg as { reddoor?: unknown }).reddoor;
  if (!cfg || typeof cfg !== "object") return {};

  const out: SiteConfig = {};
  const url = (cfg as { lighthouseUrl?: unknown }).lighthouseUrl;
  if (typeof url === "string" && url.length > 0) {
    out.lighthouseUrl = url;
  }
  const routes = (cfg as { a11yRoutes?: unknown }).a11yRoutes;
  if (Array.isArray(routes)) {
    // Junk entries are dropped rather than passed through — a `null` in the list
    // would become `page.goto(null)` inside the generated spec and fail the whole
    // audit for a typo. An all-junk list leaves the key omitted, so the caller's
    // "no routes configured" branch is the same shape as "key absent".
    const clean = routes
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (clean.length > 0) out.a11yRoutes = clean;
  }
  // Anything but the two known values reads as absent. This string reaches a
  // shell as part of a `webServer.command`, so a typo must fall back to the
  // default rather than be forwarded — `"prod"` would become `npm run prod`.
  const gate = (cfg as { gateServer?: unknown }).gateServer;
  if (gate === "dev" || gate === "preview") out.gateServer = gate;

  // Same cleaning as a11yRoutes, same reason: an all-junk list leaves the key
  // omitted so the caller's "nothing declared" branch has one shape.
  const absent = (cfg as { absentFixtures?: unknown }).absentFixtures;
  if (Array.isArray(absent)) {
    const clean = absent
      .filter((r): r is string => typeof r === "string")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    if (clean.length > 0) out.absentFixtures = clean;
  }

  return out;
}

/**
 * The starter's unreplaced Prismic repository name. A clone still carrying it
 * has no content model of its own: every Prismic-backed route resolves nothing
 * and `getByUID("page","home")` throws, so the site's own `/` answers **404 by
 * design** until `/new-site` step 6 swaps this for a real repository.
 *
 * Exactly the same string the site side already reads in four places —
 * `src/lib/prismicio.ts` (`isPlaceholderRepo`), `svelte.config.js`, the home
 * route's `entries()` prerender guard, and `tests/smoke/routes.ts`, whose
 * committed smoke manifest flips `/`'s expected status on it. This is that fact
 * arriving in the audit, not a new convention.
 */
export const PLACEHOLDER_PRISMIC_REPO = "your-prismic-repo-name";

/** Slice Machine's filename, and the name the Prismic CLI's migration renames
 *  it to, in the same preference order `src/prismic/models/config.ts` reads
 *  them. Both are checked so a half-migrated repo is read correctly. */
const PRISMIC_CONFIG_FILES = ["slicemachine.config.json", "prismic.config.json"] as const;

/**
 * True when this site is still pointed at the starter placeholder — i.e. when a
 * 404 on one of its own content routes is the designed answer rather than a
 * broken route.
 *
 * DELIBERATELY NARROWER than `PLACEHOLDER_REPOSITORY_NAMES` in
 * `src/prismic/models/config.ts`, and this is the trap worth naming. That list
 * also holds `reddoor-wireframer`, which is there precisely because IT
 * RESOLVES: data-dynamiq names it, the repository really exists with published
 * documents, and the site really renders from it. It earns a place on a list
 * that means "mint no token for this" and must never reach a list that means
 * "a 404 here is expected" — folding the two together would buy a LIVE
 * production site permanent, silent tolerance of a broken homepage. Only the
 * starter sentinel, which 404s at Prismic itself and so can never serve a page,
 * belongs here.
 *
 * Reads the COMMITTED config only, never `VITE_PRISMIC_ENVIRONMENT`. The site
 * side honours that override, but `tests/smoke/routes.ts` throws when it names
 * the sentinel under CI — "it would make this smoke run expect no home page and
 * pass" — and an audit that honoured it would hand that same false green to any
 * real site whose environment happened to carry it.
 *
 * Never throws, and every unclear answer is `false`: a missing, unreadable or
 * malformed Prismic config buys a site no 404 tolerance at all. The failure
 * this returns to is the one that reports too much, not the one that reports
 * nothing (#680).
 */
export async function readsPlaceholderPrismicRepo(sitePath: string): Promise<boolean> {
  let sawPlaceholder = false;
  for (const name of PRISMIC_CONFIG_FILES) {
    let raw: string;
    try {
      raw = await readFile(join(sitePath, name), "utf-8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const repo = (parsed as { repositoryName?: unknown }).repositoryName;
    if (typeof repo !== "string") continue;
    const trimmed = repo.trim();
    if (trimmed === PLACEHOLDER_PRISMIC_REPO) {
      // Not an early return: the CLI migration renames slicemachine.config.json
      // to prismic.config.json, so a half-migrated repo can hold a stale
      // sentinel in the first file and its real repository in the second. A
      // real name anywhere wins.
      sawPlaceholder = true;
      continue;
    }
    if (trimmed.length > 0) return false;
  }
  return sawPlaceholder;
}

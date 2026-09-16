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

  return out;
}

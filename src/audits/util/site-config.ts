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
  return out;
}

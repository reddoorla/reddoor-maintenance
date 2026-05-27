import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SiteConfig = {
  /** Override URL the lighthouse audit hits. Sites without the default
   * `/dev/a11y-fixtures` dev route set this to their homepage. */
  lighthouseUrl?: string;
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
  return out;
}

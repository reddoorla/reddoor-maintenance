import type { Db } from "../../db/client.js";

export type EnsureSiteCommandOptions = {
  name?: string;
  url?: string;
  contact?: string;
  gitRepo?: string;
  cwd?: string;
};

/** Injectable so tests never open a real libSQL handle. */
export type EnsureSiteCommandDeps = {
  openDb?: () => Promise<Db>;
};

/**
 * `ensure-site <slug>` — create/verify a site's fleet row (#646 step 3: in Turso,
 * with a `site_<ULID>` id for a new site). Day-one step of the /new-site bootstrap
 * skill. Fill-blanks-only; safe to re-run; `--name` renames without moving the slug.
 */
export async function runEnsureSiteCommand(
  slug: string | undefined,
  opts: EnsureSiteCommandOptions,
  deps: EnsureSiteCommandDeps = {},
): Promise<{ output: string; code: number }> {
  if (!slug) return { output: "Provide a <slug> (e.g. `ensure-site roalson`).", code: 2 };
  try {
    const open =
      deps.openDb ??
      (async () => {
        const { openDb, readDbConfig } = await import("../../db/client.js");
        return openDb(readDbConfig());
      });
    const db = await open();
    const { makeSiteStore } = await import("../../db/site-create.js");
    const { ensureSite } = await import("../../fleet/ensure-site.js");
    const result = await ensureSite(
      {
        slug,
        ...(opts.name ? { displayName: opts.name } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        ...(opts.contact ? { pointOfContact: opts.contact } : {}),
        ...(opts.gitRepo ? { gitRepo: opts.gitRepo } : {}),
      },
      { store: makeSiteStore(db) },
    );
    // #664: a name change on the exists path is a rename the operator asked for.
    const renamed = result.updatedFields.includes("name") ? ` — name set to "${opts.name}"` : "";
    const blanks = result.updatedFields.filter((f) => f !== "name");
    const filled = blanks.length > 0 ? ` — filled blank field(s): ${blanks.join(", ")}` : "";
    const skipped =
      result.skippedMismatches.length > 0
        ? ` — differs from existing, left untouched (edit on the dashboard site page): ${result.skippedMismatches.join(", ")}`
        : "";
    const nameNote =
      result.status === "created" && !opts.name
        ? ` — name set to "${slug}"; re-run with --name before forms/announce go live`
        : "";
    return {
      output: `[${slug}] ${result.status} (${result.siteId})${renamed}${filled}${skipped}${nameNote}`,
      code: 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}

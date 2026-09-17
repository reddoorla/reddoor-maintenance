import type { Site } from "../types.js";
import { siteSlug, ACTIVE_STATUSES, isPreLaunch, type WebsiteRow } from "../fleet/site-row.js";
import { isHttpUrl } from "../util/url.js";

/**
 * THE fleet-sweep selection rule, over rows from either store (#646 step 4).
 *
 * Every `--fleet` sweep — the four nightly audits, the Prismic drift sweep,
 * `prismic-ci`, `init`, `sync-configs` and the rest — visits exactly the sites this
 * returns. It lived inside `fromAirtableBase` until step 4 moved the roster to
 * Turso; it is shared rather than copied so the Airtable and Turso providers
 * cannot drift, and `tests/inventory/selection-parity.test.ts` proves that the
 * two stores, fed the same rows, hand it identical input.
 *
 * Only LIVE `maintained` sites that have a `url` are included — pre-launch
 * stages ("launching" / "building", via isPreLaunch) are excluded so a
 * not-yet-live site is never audited as production (its deploy/domain/uptime/CMS
 * audits would fail against nothing and red its row) nor swept by other `--fleet`
 * ops; it re-enters the fleet when a Launch report flips its Status to
 * "maintained". The production URL is exposed as `Site.deployedUrl` so the
 * lighthouse audit can run against it with no checkout. `repoUrl` is
 * intentionally NOT set from `url` — a clone source must come from `gitRepo`
 * (`owner/repo`), never the production URL.
 *
 * The id is carried as `meta.siteId` and never interpreted: a `rec…` id and a
 * `site_<ULID>` id (#646 step 3) select identically.
 */
export function selectFleetSites(websites: readonly WebsiteRow[], workdir: string): Site[] {
  return websites
    .filter(
      (w) =>
        w.status !== null &&
        ACTIVE_STATUSES.has(w.status) &&
        !isPreLaunch(w.status) &&
        w.url.length > 0,
    )
    .flatMap((w) => {
      const slug = siteSlug(w.name);
      // An empty slug (a Name with no slug-able characters) can't form a stable
      // path and — fatally — can't be matched back to its row on write-back:
      // every empty-slug site would collapse under the "" key and mis-write or
      // fail. Skip it loudly rather than silently mis-map it.
      if (slug.length === 0) {
        console.warn(
          `[inventory] skipping "${w.name}" (row ${w.id}): Name has no slug-able characters (empty slug)`,
        );
        return [];
      }
      const site: Site = {
        path: `${workdir}/${slug}`,
        name: slug,
        meta: { siteId: w.id, displayName: w.name },
      };
      // Scheme-allowlist the `url` before exposing it as the deployed-audit
      // target (it's handed straight to Chrome/lhci). A `file://`/`gopher://`/
      // internal-host value would be a local-file read or SSRF — skip the
      // deployed audit for that site rather than trust it.
      if (isHttpUrl(w.url)) {
        site.deployedUrl = w.url;
      } else {
        console.warn(
          `[inventory] skipping deployed audit for "${w.name}": url is not http(s): ${JSON.stringify(w.url)}`,
        );
      }
      if (w.gitRepo) site.gitRepo = w.gitRepo;
      // Expose the Netlify site id (operator-set identity column) so the
      // netlify-deploy audit can query the API with no checkout. Absent → that
      // audit skips for this site. Not derived from the URL.
      if (w.netlifyId) site.netlifyId = w.netlifyId;
      return [site];
    });
}

/** The workdir every store-backed provider needs: sites carry a local path, and
 *  no store holds checkout paths. */
export function requireFleetWorkdir(explicit: string | undefined, provider: string): string {
  const workdir = explicit ?? process.env.REDDOOR_FLEET_WORKDIR;
  if (!workdir) {
    throw new Error(
      `${provider} requires \`workdir\` option or REDDOOR_FLEET_WORKDIR env (sites need a local path)`,
    );
  }
  return workdir;
}

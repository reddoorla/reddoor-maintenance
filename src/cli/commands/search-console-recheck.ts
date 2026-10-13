import { siteSlug, type WebsiteRow } from "../../fleet/site-row.js";
import { searchConsoleLookupFields } from "../../fleet/site-fields.js";
import type { FleetRoster } from "../../fleet/roster.js";
import type { HealthMirror } from "../../audits/health-mirror.js";
import type { SearchConsoleOutcome } from "../../fleet/search-console-evidence.js";

/** What one lookup resolved, in the shape `fetchSearch` returns it: null when
 *  the lookup did not run for the site (opted out, not enrolled). */
export type RecheckLookup = {
  lookup: { outcome: SearchConsoleOutcome; property: string | null } | null;
};

/** Injectable wiring for {@link runSearchConsoleRecheckCommand}. Every default
 *  is the real path; tests replace them, so no test reaches Turso or Google. */
export type SearchConsoleRecheckDeps = {
  /** Every roster row (default: Turso via `readFleetRoster`). */
  roster: FleetRoster;
  /** site_health writer (default: `makeHealthMirror`). A null fails the run. */
  makeMirror: () => Promise<HealthMirror | null>;
  /** The draft's own lookup (default: `fetchSearch`). */
  search: (site: WebsiteRow, periodStart: Date, periodEnd: Date) => Promise<RecheckLookup>;
  /** Whether GA/Search Console credentials are present (default: `readGaConfig`). */
  gaConfigured: () => boolean;
  now: () => Date;
};

/** A host no Search Console property can match. If the lookup reads anything
 *  but `no-property` for it, the instrument would clear real watches, so the
 *  run writes nothing. */
export const NO_PROPERTY_CONTROL_URL = "https://no-such-property-zz9q.invalid/";

/** The window the lookup's brand query runs over. Only the outcome is stored;
 *  the window matches a draft's default first period. */
const PERIOD_DAYS = 30;

/** `search-console-recheck --fleet --write-back` (P1-48): a report draft is the
 *  only other writer of the #943 lookup, so a `no-property` outcome stood until
 *  the site's next draft, months for a quarterly site, after its property was
 *  fixed. This re-runs the draft's lookup for every `maintained` site whose
 *  stored outcome is `no-property` and writes the cells a draft writes. A
 *  soft-fail writes nothing: an unknown answer must not retire a known finding,
 *  and a stored soft-fail would drop the site from this sweep's own targets. A
 *  run-level control goes first; if it misreads, nothing is written. */
export async function runSearchConsoleRecheckCommand(
  opts: { fleet?: boolean | undefined; writeBack?: boolean | undefined },
  deps: Partial<SearchConsoleRecheckDeps> = {},
): Promise<{ output: string; code: number }> {
  if (!opts.fleet || !opts.writeBack) {
    return {
      output: "search-console-recheck currently supports only --fleet --write-back",
      code: 2,
    };
  }
  const now = deps.now ?? (() => new Date());
  const websites = await (
    deps.roster ??
    (async () => {
      const { readFleetRoster } = await import("../../fleet/roster.js");
      return readFleetRoster();
    })
  )();
  const targets = websites.filter(
    (w) => w.status === "maintained" && w.searchConsoleOutcome === "no-property",
  );
  const lines: string[] = [];
  if (targets.length === 0) {
    lines.push(
      "SEARCH_CONSOLE_RECHECK_SUMMARY checked=0 resolved=0 no_property=0 soft_fail=0 skipped=0 mirrored=0 mirror_failed=0",
    );
    return { output: lines.join("\n"), code: 0 };
  }

  const gaConfigured =
    deps.gaConfigured ??
    (await (async () => {
      const { readGaConfig } = await import("../../reports/ga/config.js");
      return () => readGaConfig() !== null;
    })());
  if (!gaConfigured()) {
    return {
      output:
        "::error::search-console-recheck: no Search Console credentials (GA_SUBJECT unset) — nothing written",
      code: 1,
    };
  }
  const search =
    deps.search ??
    (async (site: WebsiteRow, start: Date, end: Date) => {
      const { fetchSearch } = await import("../../reports/draft.js");
      return fetchSearch(site, start, end);
    });

  const end = now();
  const start = new Date(end.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const control = await search(
    {
      ...targets[0]!,
      id: "no-property-control",
      name: "no-property control",
      url: NO_PROPERTY_CONTROL_URL,
      searchConsoleProperty: null,
      searchQuery: "no-property control",
      acceptedWatchConditions: [],
    },
    start,
    end,
  );
  if (control.lookup?.outcome !== "no-property") {
    return {
      output: `::error::search-console-recheck: no-property control ${NO_PROPERTY_CONTROL_URL} read ${control.lookup?.outcome ?? "not run"}, expected no-property — nothing written`,
      code: 1,
    };
  }

  const makeMirror =
    deps.makeMirror ??
    (async () => {
      const { makeHealthMirror } = await import("../../audits/health-mirror.js");
      return makeHealthMirror();
    });
  const mirror = await makeMirror();

  const counts = { resolved: 0, "no-property": 0, "soft-fail": 0, skipped: 0 };
  let mirrored = 0;
  let mirrorFailed = 0;
  const checkedAt = end.toISOString();
  for (const w of targets) {
    const { lookup } = await search(w, start, end);
    if (!lookup) {
      counts.skipped++;
      continue;
    }
    counts[lookup.outcome]++;
    if (lookup.outcome === "resolved") {
      lines.push(
        `::notice::search-console-recheck: ${siteSlug(w.name)} ${w.url.trim()} resolved ${lookup.property ?? ""}`.trimEnd(),
      );
    } else {
      lines.push(
        `::warning::search-console-recheck: ${siteSlug(w.name)} ${w.url.trim()} ${lookup.outcome}`,
      );
    }
    if (lookup.outcome === "soft-fail" || !mirror) continue;
    try {
      if (await mirror(w.id, searchConsoleLookupFields({ ...lookup, checkedAt }))) mirrored++;
      else {
        mirrorFailed++;
        console.error(`[health-mirror] ${w.name}: no site_health row matched`);
      }
    } catch (e) {
      mirrorFailed++;
      console.error(`[health-mirror] ${w.name}: ${(e as Error).message}`);
    }
  }
  if (!mirror) lines.push("::error::search-console-recheck: no store configured — nothing written");
  lines.push(
    `SEARCH_CONSOLE_RECHECK_SUMMARY checked=${targets.length} resolved=${counts.resolved} no_property=${counts["no-property"]} soft_fail=${counts["soft-fail"]} skipped=${counts.skipped} mirrored=${mirrored} mirror_failed=${mirrorFailed}`,
  );
  return { output: lines.join("\n"), code: !mirror || mirrorFailed > mirrored ? 1 : 0 };
}

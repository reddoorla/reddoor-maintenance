import { isArchivedStatus, siteSlug, type WebsiteRow } from "../../fleet/site-row.js";
import { rosterUrlFields } from "../../fleet/site-fields.js";
import type { FleetRoster } from "../../fleet/roster.js";
import type { HealthMirror } from "../../audits/health-mirror.js";
import {
  NETLIFY_SITE_NOT_FOUND,
  probeRosterUrl,
  type UrlFetch,
  type UrlProbe,
} from "../../fleet/roster-url-probe.js";

/** Injectable wiring for {@link runRosterUrlsCommand}. Every default is the real
 *  fleet path; tests replace all four, so no test reaches Turso or the network. */
export type RosterUrlsDeps = {
  /** Every roster row (default: Turso via `readFleetRoster`). */
  roster: FleetRoster;
  /** site_health writer (default: `makeHealthMirror`, which throws when libSQL
   *  is unreachable). A null is a run with no store, and fails it. */
  makeMirror: () => Promise<HealthMirror | null>;
  fetch: UrlFetch;
  now: () => Date;
};

type Control = { name: string; url: string; accepts: (p: UrlProbe) => boolean; expected: string };

/** A host Netlify does not serve. If this reads anything but site-not-found,
 *  something between us and Netlify (a captive proxy, a DNS hijack) is answering
 *  for it, and every roster verdict would be a lie in the `pass` direction. */
export const BOGUS_HOST_CONTROL: Control = {
  name: "bogus-host",
  url: "https://no-such-site-zz9q.netlify.app/",
  accepts: (p) => p.resolves === "fail" && p.status === NETLIFY_SITE_NOT_FOUND,
  expected: `fail ${NETLIFY_SITE_NOT_FOUND}`,
};

/** A deployed Reddoor site. If this does not pass, the runner cannot reach the
 *  web, and every roster verdict would be a lie in the `fail` direction. */
export const KNOWN_GOOD_CONTROL: Control = {
  name: "known-good",
  url: "https://the-tower-burbank-rd.netlify.app/",
  accepts: (p) => p.resolves === "pass",
  expected: "pass",
};

const CONCURRENCY = 6;

/** `roster-urls --fleet --write-back` (#912): GET every non-archived roster
 *  `url` — every status, not only `maintained`, since a `building` row pointing
 *  at nothing is exactly the case nobody else checks — and store the verdict in
 *  site_health. Two run-level controls go first; if either misreads, the
 *  instrument is broken and nothing is written. A failing row is a finding
 *  (exit 0); the run fails only when the controls do, there is no store, or
 *  mirror failures outnumber writes. */
export async function runRosterUrlsCommand(
  opts: { fleet?: boolean | undefined; writeBack?: boolean | undefined },
  deps: Partial<RosterUrlsDeps> = {},
): Promise<{ output: string; code: number }> {
  if (!opts.fleet || !opts.writeBack) {
    return { output: "roster-urls currently supports only --fleet --write-back", code: 2 };
  }
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  const controlErrors: string[] = [];
  for (const c of [BOGUS_HOST_CONTROL, KNOWN_GOOD_CONTROL]) {
    const p = await probeRosterUrl(c.url, fetcher);
    if (!c.accepts(p)) {
      controlErrors.push(
        `::error::roster-urls: ${c.name} control ${c.url} read ${p.resolves ?? "null"} ${p.status}, expected ${c.expected} — nothing written`,
      );
    }
  }
  if (controlErrors.length > 0) return { output: controlErrors.join("\n"), code: 1 };

  const websites = await (
    deps.roster ??
    (async () => {
      const { readFleetRoster } = await import("../../fleet/roster.js");
      return readFleetRoster();
    })
  )();
  const targets = websites.filter((w) => !isArchivedStatus(w.status));
  const checkedAt = now().toISOString();
  const probes = await probeAll(targets, fetcher);

  const makeMirror =
    deps.makeMirror ??
    (async () => {
      const { makeHealthMirror } = await import("../../audits/health-mirror.js");
      return makeHealthMirror();
    });
  const mirror = await makeMirror();

  const lines: string[] = [];
  let pass = 0;
  let fail = 0;
  let noUrl = 0;
  let mirrored = 0;
  let mirrorFailed = 0;
  for (const [i, w] of targets.entries()) {
    const p = probes[i]!;
    if (p.resolves === "pass") pass++;
    else if (p.resolves === "fail") {
      fail++;
      lines.push(`::warning::roster-urls: ${siteSlug(w.name)} ${w.url.trim()} ${p.status}`);
    } else noUrl++;
    if (!mirror) continue;
    try {
      if (await mirror(w.id, rosterUrlFields({ ...p, checkedAt }))) mirrored++;
      else {
        mirrorFailed++;
        console.error(`[health-mirror] ${w.name}: no site_health row matched`);
      }
    } catch (e) {
      mirrorFailed++;
      console.error(`[health-mirror] ${w.name}: ${(e as Error).message}`);
    }
  }
  if (!mirror) lines.push("::error::roster-urls: no store configured — nothing written");
  lines.push(
    `ROSTER_URL_SUMMARY checked=${targets.length} pass=${pass} fail=${fail} no_url=${noUrl} mirrored=${mirrored} mirror_failed=${mirrorFailed}`,
  );
  return { output: lines.join("\n"), code: !mirror || mirrorFailed > mirrored ? 1 : 0 };
}

async function probeAll(targets: WebsiteRow[], fetcher: UrlFetch): Promise<UrlProbe[]> {
  const out: UrlProbe[] = new Array<UrlProbe>(targets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (next < targets.length) {
        const i = next++;
        out[i] = await probeRosterUrl(targets[i]!.url, fetcher);
      }
    }),
  );
  return out;
}

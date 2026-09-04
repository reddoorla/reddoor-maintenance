/**
 * Runs the check battery against real websites and prints every verdict.
 *
 * Deliberately NOT the whole audit: no model calls, no Lighthouse, no probes.
 * Just the stages that produce `siteChecks` — crawl, DNS, HTTP, and the checks
 * themselves — because those are the ones that make claims about the site, and
 * the ones worth pointing at reality before anybody reads them.
 *
 * The habit this exists to serve: every measurement change so far has found an
 * instrument bug on its first live run, and every one of them overstated the
 * client's fault. A fail here is a hypothesis about the site AND a hypothesis
 * about the check, and the second is the one to test first.
 *
 *   pnpm tsx scripts/validate-checks.mts https://reddoorla.com [more urls]
 */
import { crawlSite, defaultCrawlDeps } from "../src/prospect/crawl.js";
import { runChecks } from "../src/prospect/checks.js";
import { defaultDnsDeps, lookupDns } from "../src/prospect/dns.js";
import { defaultHttpProbeDeps, probeHttp } from "../src/prospect/http-probes.js";
import { summarizeAccessibility } from "../src/prospect/accessibility.js";
import { runSiteChecks, tally } from "../src/prospect/site-checks.js";
import { USER_AGENT } from "../src/prospect/crawl.js";
import type { ChecksResult } from "../src/prospect/types.js";

const ORDER = ["fail", "unmeasured", "not-applicable", "pass"] as const;
const MARK: Record<string, string> = {
  fail: "FAIL",
  unmeasured: "????",
  "not-applicable": "  - ",
  pass: " ok ",
};

async function one(url: string): Promise<void> {
  console.log(`\n${"=".repeat(72)}\n${url}\n${"=".repeat(72)}`);
  const started = Date.now();

  const crawl = await crawlSite(url, defaultCrawlDeps());
  console.log(
    `crawled ${crawl.pages.length} pages in ${Math.round((Date.now() - started) / 1000)}s`,
  );

  let checks: ChecksResult | null = null;
  try {
    checks = runChecks(crawl);
  } catch (err) {
    console.log(`  checks stage failed: ${err instanceof Error ? err.message : err}`);
  }

  const emails = (checks?.consistency?.emails ?? []).map((e) => e.normalized);
  const dns = await lookupDns(crawl.origin, emails, defaultDnsDeps());
  const http = await probeHttp(crawl, defaultHttpProbeDeps(USER_AGENT));
  console.log(`${http.requests} probe requests`);

  const a11y = summarizeAccessibility(crawl.pages);
  if (a11y.measured) {
    console.log(
      `axe: ${a11y.rulesPassed} rules passed, ${a11y.violationsTotal} with findings, ${a11y.rulesIncomplete} undecided`,
    );
    for (const v of a11y.violations.slice(0, 6)) {
      console.log(`     [${v.impact ?? "?"}] ${v.id} — ${v.nodes} on ${v.pages.length} page(s)`);
    }
  } else {
    console.log("axe: did not run");
  }

  const probe = crawl.pages.find((p) => p.formProbe)?.formProbe;
  if (probe) console.log(`form probe on ${probe.url}, ${probe.blocked} request(s) stopped`);

  const results = runSiteChecks(crawl, checks, null, dns, http);
  const t = tally(results);
  console.log(`\n${results.length} checks — ${t.passed}/${t.total} of those with a verdict\n`);

  for (const status of ORDER) {
    const group = results.filter((c) => c.status === status);
    if (group.length === 0) continue;
    console.log(`--- ${status} (${group.length})`);
    for (const c of group) {
      console.log(`  ${MARK[status]} ${c.key.padEnd(26)} ${c.evidence ?? ""}`);
    }
    console.log("");
  }
}

async function main() {
  for (const url of process.argv.slice(2)) {
    try {
      await one(url);
    } catch (err) {
      console.log(`\n!! ${url} — ${err instanceof Error ? err.message : err}`);
    }
  }
}
main();

// Produce a real ProspectAuditResult from the live pipeline stages that do not
// need an API key, so the website's new report sections can be checked against
// data an actual run would produce rather than values invented to look good.
import { writeFileSync } from "node:fs";
import { crawlSite, defaultCrawlDeps, USER_AGENT } from "./src/prospect/crawl.js";
import { runChecks, computeScores } from "./src/prospect/checks.js";
import { checkAssets } from "./src/prospect/assets.js";

const url = process.argv[2];
const out = process.argv[3];
const crawl = await crawlSite(url, defaultCrawlDeps({ maxPages: 6, delayMs: 200 }));
const checks = runChecks(crawl);
const probe = async (u: string) => {
  const res = await fetch(u, { method: "HEAD", headers: { "user-agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  return { status: res.status, headers: Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v])) };
};
const assets = await checkAssets(crawl.pages, crawl.origin, { probe, maxLinks: 50, maxImages: 40, delayMs: 80 });

const result = {
  url,
  businessName: "Beachfront Dentistry",
  generatedAt: new Date().toISOString(),
  scores: computeScores({ checks, lighthouse: null, analyze: null, probes: null }),
  crawl: { ok: true, data: crawl },
  checks: { ok: true, data: checks },
  assets: { ok: true, data: assets },
  lighthouse: { ok: false, error: "not run" },
  analyze: { ok: false, error: "not run" },
  probes: { ok: false, error: "not run" },
};
writeFileSync(out, JSON.stringify({ report: result }));
console.log("wrote", out);
console.log("broken links:", assets.brokenLinks.length, "| broken images:", assets.brokenImages.length);
console.log("heaviest:", assets.heaviestImages.at(0)?.bytes);
console.log("phones:", checks.consistency?.phones.length, "| copyright:", checks.consistency?.newestCopyrightYear);
console.log("worstClicks:", checks.journey?.worstClicksToContact, "| deadEnds:", checks.journey?.deadEnds.length);

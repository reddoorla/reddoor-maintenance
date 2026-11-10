/**
 * Generates the producer-shaped report fixtures reddoor-website renders and
 * tests against — one file per stored shape, all of them written by the REAL
 * pipeline rather than by hand.
 *
 * WHY. Every report test in reddoor-website builds its input by hand, so no
 * test has ever seen a payload the producer actually emits. That is what let
 * `agentAccess` be read off the CHECKS stage — it lives on CRAWL — and print
 * "all 0 of the crawlers we checked are allowed in" on every report for a
 * fortnight. A hand-written fixture agrees with whatever the consumer believes;
 * only the producer's own output can disagree with it.
 *
 *   pnpm tsx scripts/gen-report-shapes.mts ../reddoor-website/src/lib/report/fixtures/producer
 *
 * NO NETWORK, NO DATABASE, NO MODEL CALL. Every dependency `runProspectAudit`
 * takes is injected below — crawl, analyze, engines, lighthouse, assets, basics
 * (both `probe` AND `probeAs`), dns, http and accuracy. The HTML is this repo's
 * own `tests/fixtures/prospect/rich.html`. `generatedAt` is frozen after the
 * run so regeneration produces a readable diff instead of a whole-file churn.
 *
 * THE FIVE SHAPES. The live table holds five distinct payload shapes, which the
 * 2026-09-02 morning report enumerates as a bit-string over
 * `assets·basics·goalFit·accuracy·setId·q.id·fix.addresses·consistency`:
 *
 *   00000000  53 reports   11000001  1 report    11111111  1 report
 *   10000001   1 report    11100001  10 reports
 *
 * Only the last is what today's producer emits; the other four are eras of this
 * code that no longer exist and cannot be re-run. They are derived by DELETING
 * exactly the keys that era did not carry — the bit-string is the whole
 * specification, applied in `reduceTo()` below, so an older shape is still the
 * producer's output with named fields removed rather than a guess at what the
 * producer used to write.
 *
 * THE TWO ADVERSE SHAPES (#893). The five vary which KEYS exist, never the
 * VALUES that pick a branch in the consumer: every stage succeeds, robots.txt is
 * fetched and blocks nothing, there is no sitemap, and every category probe
 * answers. So `adverse-*.json` are two more runs of today's producer, over deps
 * chosen so each of those takes its other branch. Every value is one the
 * producer's own code writes when its dependency behaves this way:
 *
 *   both       a sitemap.xml listing 12 URLs, so `sitemap.present` is true with
 *              a real `urlCount` bigger than the 3 pages the crawl reads; and
 *              one of the three category probes times out, so
 *              `categoryProbes.attempted` is 3 and `answered` is 2.
 *   unmeasured robots.txt times out (both tries), so `crawlerAccessMeasured` is
 *              false; and the accuracy stage's model call returns nothing, so
 *              that stage RAN AND FAILED: `{ok: false, error}`.
 *   blocked    robots.txt turns GPTBot away, so `blockedAi` is ["GPTBot"]; the
 *              accuracy stage succeeds, which is what renders the sitemap count.
 *
 * Two files, not one, because one run cannot hold both robots cases honestly:
 * checks.ts fills `blockedAi` only when the fetch succeeded, so "unmeasured"
 * and "blocks a crawler" are exclusive by construction.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runProspectAudit, type PipelineDeps } from "../src/prospect/pipeline.js";
import type { CrawlDeps, FetchResponse } from "../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, "../tests/fixtures/prospect/rich.html"), "utf-8");

const HOME = "https://acme.example/";
const BUSINESS = "Acme Roofing";
/** Frozen. A generated-at of "now" would rewrite every fixture on every run. */
const GENERATED_AT = "2026-09-02T09:00:00.000Z";
const ASKED_AT = "2026-09-02T08:58:00.000Z";

const crawl: CrawlDeps = {
  async fetchUrl(url): Promise<FetchResponse> {
    if (url === HOME || url.endsWith("/services") || url.endsWith("/about"))
      return { status: 200, body: html, headers: { "content-type": "text/html" } };
    if (url.endsWith("/robots.txt"))
      return { status: 200, body: "User-agent: *\nAllow: /\n", headers: {} };
    return { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, html]));
  },
  maxPages: 3,
  delayMs: 0,
};

/** The analyze stage's output, as the model would return it. Every buyer
 *  question carries its `id` and the fix carries `addresses`, because the
 *  CURRENT producer emits both — the shapes that lack them are derived. */
const analyzeOutput = {
  businessName: BUSINESS,
  business: "Acme Roofing repairs and replaces commercial roofs in Boise, Idaho.",
  entityClarity: { score: 70, missing: [] },
  primaryGoal: "enquire" as const,
  categoryQueries: [
    "commercial roofing contractor Boise",
    "flat roof repair Idaho",
    "how much does a commercial roof replacement cost",
  ],
  buyerQuestions: [
    {
      id: "cost",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    {
      id: "who-for",
      answered: "partial" as const,
      quotable: false,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    { id: "proof", answered: "no" as const, quotable: false, page: null, evidence: null },
    { id: "who-does-it", answered: "no" as const, quotable: false, page: null, evidence: null },
    {
      id: "where",
      answered: "yes" as const,
      quotable: true,
      page: HOME,
      evidence: "We repair flat commercial roofs across the Treasure Valley",
    },
    { id: "next-step", answered: "no" as const, quotable: false, page: null, evidence: null },
  ],
  fixes: [
    {
      title: "Say who the work is for, on the page that sells it",
      why: "A buyer cannot tell from the services page whether you take jobs their size.",
      impact: "high" as const,
      effort: "low" as const,
      tier: "content" as const,
      addresses: "who-for",
    },
  ],
  narrative: {
    findability: "Every page is reachable and indexed.",
    readability: "The pages read plainly and say what the work is.",
    answers: "Three of the six questions buyers ask are answered outright.",
  },
};

const deps: PipelineDeps = {
  crawl,
  analyze: { run: async () => analyzeOutput },
  engines: [
    {
      name: "claude",
      ask: async (query: string) => ({
        answer:
          query.toLowerCase().includes("acme") || query.toLowerCase().includes("who is")
            ? "Acme Roofing is a commercial roofer that has served Boise since 1994."
            : "Treasure Valley Roofing and Boise Commercial Roofing are the usual names here.",
        fullAnswer:
          "Acme Roofing has served Boise since 1994 and works across the Treasure Valley.",
        citedDomains: ["yelp.com", "acme.example"],
      }),
    },
  ],
  lighthouse: async () => ({
    performance: 82,
    accessibility: 94,
    bestPractices: 75,
    seo: 100,
    summary: "lighthouse: all categories passing",
    status: "pass" as const,
  }),
  assets: {
    probe: async () => ({ status: 200, headers: { "content-type": "image/webp" } }),
    delayMs: 0,
    sleep: async () => {},
  },
  basics: {
    probe: async (url: string) => ({ status: 200, finalUrl: url, body: "<html></html>" }),
    probeAs: async (url: string) => ({ status: 200, finalUrl: url, body: "<html></html>" }),
    crawlerDelayMs: 0,
    sleep: async () => {},
  },
  dns: {
    resolveTxt: async () => [["v=spf1 include:_spf.example -all"]],
    resolveMx: async () => [{ exchange: "mx.acme.example", priority: 10 }],
    rdap: async () => null,
  },
  http: {
    request: async (url: string) => ({
      status: 200,
      headers: { "content-type": "text/html" },
      finalUrl: url,
      hops: 0,
      body: null,
      error: null,
    }),
    delayMs: 0,
    sleep: async () => {},
  },
  accuracy: {
    run: async () => ({
      assertions: [
        {
          claim: "Acme Roofing has served Boise since 1994",
          engineQuote: "has served Boise since 1994",
          verdict: "contradicted" as const,
          siteQuote: "roofing across Boise since 2004",
          searchTerms: ["1994", "2004"],
        },
        {
          claim: "Acme Roofing works on residential roofs",
          engineQuote: "works on residential roofs",
          verdict: "absent" as const,
          siteQuote: null,
          searchTerms: ["residential"],
        },
      ],
    }),
    ownership: { fetchPage: async () => null },
  },
  probeDelayMs: 0,
  probeSleep: async () => {},
};

/** Twelve URLs, the first three being the pages `crawl` serves, so the crawl
 *  reads exactly what it reads in the five and the sitemap says the site is
 *  four times that. */
const SITEMAP_PATHS = [
  "",
  "services",
  "about",
  "contact",
  "commercial-roofing",
  "flat-roof-repair",
  "roof-replacement",
  "roof-inspections",
  "projects",
  "reviews",
  "service-area",
  "faq",
];
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_PATHS.map((p) => `  <url><loc>${HOME}${p}</loc></url>`).join("\n")}
</urlset>
`;

/** What `AbortSignal.timeout` throws in crawl.ts's default `fetchUrl`. */
const timeout = (): Error =>
  new DOMException("The operation was aborted due to timeout", "TimeoutError");

/** The category probe that dies. Not a 429/529, so probes.ts drops it without
 *  a retry and it still counts as attempted. The message is the SDK's own. */
const DEAD_PROBE = analyzeOutput.categoryQueries[1];

/** accuracy.ts's own throw when the model call comes back empty. */
const ACCURACY_ERROR = "accuracy: the model returned no parsed output";

type Robots = "unmeasured" | "blocked";

function adverseDeps(robots: Robots): PipelineDeps {
  return {
    ...deps,
    crawl: {
      ...crawl,
      async fetchUrl(url): Promise<FetchResponse> {
        if (url.endsWith("/robots.txt")) {
          if (robots === "unmeasured") throw timeout();
          return {
            status: 200,
            body: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n",
            headers: {},
          };
        }
        if (url.endsWith("/sitemap.xml"))
          return { status: 200, body: SITEMAP, headers: { "content-type": "application/xml" } };
        return crawl.fetchUrl(url);
      },
    },
    engines: deps.engines!.map((engine) => ({
      ...engine,
      ask: async (query: string) => {
        if (query === DEAD_PROBE) throw new Error("Request timed out.");
        return engine.ask(query);
      },
    })),
    accuracy:
      robots === "unmeasured"
        ? {
            ...deps.accuracy!,
            // accuracy.ts's own throw when the model call comes back empty.
            run: async () => {
              throw new Error(ACCURACY_ERROR);
            },
          }
        : deps.accuracy!,
  };
}

/** The adverse files, and the ONLY stages each is allowed to fail. Anything
 *  else failing is the same loud error as in the five. */
/** Read a nested path out of a result, or undefined at the first missing step. */
const at = (root: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node && typeof node === "object" ? (node as Json)[key] : undefined),
      root,
    );

/** The branches every adverse file exists to reach. A producer change that
 *  quietly routes one back to its usual branch (a skip instead of a failure,
 *  a robots read that no longer blocks) is reported, not written. */
function branchesMissed(r: Json, robots: Robots): string[] {
  const missed: string[] = [];
  const check = (ok: boolean, what: string): void => {
    if (!ok) missed.push(what);
  };
  check(at(r, "crawl.data.sitemap.present") === true, "sitemap.present is not true");
  const urlCount = at(r, "crawl.data.sitemap.urlCount");
  const pages = (at(r, "crawl.data.pages") as unknown[] | undefined)?.length ?? 0;
  check(
    typeof urlCount === "number" && urlCount > pages,
    `sitemap.urlCount (${String(urlCount)}) is not more than the ${pages} pages crawled`,
  );
  const attempted = at(r, "probes.data.categoryProbes.attempted");
  const answered = at(r, "probes.data.categoryProbes.answered");
  check(
    typeof attempted === "number" && typeof answered === "number" && attempted > answered,
    `categoryProbes attempted ${String(attempted)} is not more than answered ${String(answered)}`,
  );
  if (robots === "unmeasured") {
    check(
      at(r, "checks.data.crawlerAccessMeasured") === false,
      "crawlerAccessMeasured is not false",
    );
    check(
      at(r, "accuracy.error") === ACCURACY_ERROR,
      `accuracy did not fail with the model's error (got ${JSON.stringify(at(r, "accuracy.error"))})`,
    );
  } else {
    check(at(r, "checks.data.crawlerAccessMeasured") === true, "crawlerAccessMeasured is not true");
    const blocked = at(r, "checks.data.crawlerAccess.blockedAi");
    check(Array.isArray(blocked) && blocked.includes("GPTBot"), "blockedAi does not name GPTBot");
  }
  return missed;
}

const ADVERSE: Array<{ name: string; robots: Robots; expectFailed: string[] }> = [
  { name: "adverse-unmeasured", robots: "unmeasured", expectFailed: ["accuracy"] },
  { name: "adverse-blocked", robots: "blocked", expectFailed: [] },
];

type Json = Record<string, unknown>;

/** Delete a nested path like `analyze.data.questionSetId`, tolerating absence. */
function drop(root: Json, path: string): void {
  const parts = path.split(".");
  let node: Json | undefined = root;
  for (const key of parts.slice(0, -1)) {
    const next: unknown = node?.[key];
    node = next && typeof next === "object" ? (next as Json) : undefined;
    if (!node) return;
  }
  delete node[parts.at(-1) as string];
}

function dropFromEach(root: Json, listPath: string, field: string): void {
  const parts = listPath.split(".");
  let node: Json | undefined = root;
  for (const key of parts) {
    const next: unknown = node?.[key];
    node = next && typeof next === "object" ? (next as Json) : undefined;
    if (!node) return;
  }
  if (Array.isArray(node)) for (const row of node as Json[]) delete row[field];
}

/** The bit-string, applied. A `0` bit deletes exactly the key that bit names. */
const BITS: Array<[string, (r: Json) => void]> = [
  ["assets", (r) => drop(r, "assets")],
  ["basics", (r) => drop(r, "basics")],
  ["goalFit", (r) => drop(r, "goalFit")],
  ["accuracy", (r) => drop(r, "accuracy")],
  ["setId", (r) => drop(r, "analyze.data.questionSetId")],
  ["q.id", (r) => dropFromEach(r, "analyze.data.buyerQuestions", "id")],
  ["fix.addresses", (r) => dropFromEach(r, "analyze.data.fixes", "addresses")],
  ["consistency", (r) => drop(r, "checks.data.consistency")],
];

function reduceTo(full: Json, shape: string): Json {
  const copy = JSON.parse(JSON.stringify(full)) as Json;
  BITS.forEach(([, remove], i) => {
    if (shape[i] === "0") remove(copy);
  });
  return copy;
}

const SHAPES = ["11111111", "11100001", "11000001", "10000001", "00000000"];

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: pnpm tsx scripts/gen-report-shapes.mts <out-dir>");
  process.exit(1);
}

/** One offline run of today's producer, with both wall-clock stamps frozen. */
async function run(withDeps: PipelineDeps): Promise<Json> {
  const result = (await runProspectAudit(
    HOME,
    { business: BUSINESS, goal: "enquire" },
    withDeps,
  )) as unknown as Json;
  result.generatedAt = GENERATED_AT;
  // Same reason as `generatedAt`: probes.ts stamps every answer with the wall
  // clock, so without this a regeneration diff is five changed timestamps and a
  // real producer change hides among them. Verified: with both frozen, two runs
  // produce byte-identical files.
  const probeAnswers = (
    result.probes as { data?: { answers?: { askedAt?: string }[] } } | undefined
  )?.data?.answers;
  for (const answer of probeAnswers ?? []) answer.askedAt = ASKED_AT;
  return result;
}

/** Every stage that came back `{ok: false}` other than the ones a file is built
 *  to fail, plus every built-to-fail stage that succeeded instead: either way
 *  the file no longer exercises what it is named for. */
function unexpected(result: Json, expectFailed: string[]): string[] {
  const failedNow = Object.entries(result).filter(
    ([, v]) => v && typeof v === "object" && (v as Json).ok === false,
  );
  return [
    ...failedNow
      .filter(([k]) => !expectFailed.includes(k))
      .map(([k, v]) => `${k}: ${(v as { error?: string }).error}`),
    ...expectFailed
      .filter((k) => !failedNow.some(([f]) => f === k))
      .map((k) => `${k}: built to fail, but it succeeded`),
  ];
}

function report(label: string, problems: string[]): void {
  if (problems.length === 0) return;
  // Loud and on stderr: a stage that failed here is a stage the fixture cannot
  // speak for, and a fixture nobody noticed was half-empty is the whole defect
  // this file exists to close.
  console.error(
    `\n${label}: ${problems.length} problem(s): the run did not come out as built offline:\n`,
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exitCode = 1;
}

const write = (name: string, payload: Json): void => {
  writeFileSync(resolve(outDir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.error(`wrote ${name}.json`);
};

const result = await run(deps);
report("the five shapes", unexpected(result, []));

mkdirSync(outDir, { recursive: true });
for (const shape of SHAPES) write(shape, reduceTo(result, shape));

for (const { name, robots, expectFailed } of ADVERSE) {
  const adverse = await run(adverseDeps(robots));
  report(name, [...unexpected(adverse, expectFailed), ...branchesMissed(adverse, robots)]);
  write(name, adverse);
}

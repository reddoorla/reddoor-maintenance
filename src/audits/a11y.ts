import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { a11yRoutes, smokeRoutes, type A11yRoute } from "../configs/playwright-a11y.js";
import { readSiteConfig, readsPlaceholderPrismicRepo } from "./util/site-config.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { findFreePort } from "../util/free-port.js";

type Impact = "minor" | "moderate" | "serious" | "critical";

type AxeViolation = {
  id: string;
  impact: Impact;
  route: string;
  help?: string;
  helpUrl?: string;
  nodes?: Array<{ html?: string; target?: string[] }>;
};

/** A route the spec navigated to, found non-200, and deliberately did NOT scan
 *  — because that status is this site's designed answer, not a defect. Kept out
 *  of `violations` (so it cannot fail the run) and named in the summary (so it
 *  cannot pass as a scan). */
export type SkippedRoute = {
  route: string;
  path: string;
  status: number | null;
  reason: string;
};

type NormalizedA11y = {
  totalViolations: number;
  byImpact: Partial<Record<Impact, number>>;
  violations: AxeViolation[];
  skipped?: SkippedRoute[];
};

/** One route as the generated spec sees it. `placeholder404Ok` is set only on
 *  the site's own Prismic-backed routes, and only while the site carries the
 *  starter sentinel. `sourceAbsent` is set only on a built-in fixture that this
 *  site's `src/routes` tree has no directory for (#900). */
type SpecRoute = A11yRoute & { placeholder404Ok?: true; sourceAbsent?: true };

/** The only reason this audit currently accepts a non-200 for. It is written
 *  into the artifact by the spec and reproduced verbatim in the summary, so the
 *  line an operator reads says WHY the route was not scanned. */
const PLACEHOLDER_SKIP_REASON = "placeholder Prismic repo";

/** The second reason (#900): a built-in fixture route that this site's own
 *  source tree does not define. Seven fleet sites ship no `animateIn` action,
 *  so `/dev/animate-in` exercises code that is not there; they read as green
 *  only until their pinned package crossed #807. Written into the artifact by
 *  the spec and reproduced verbatim in the summary, exactly as the reason
 *  above, so an operator reading a skip always learns WHY. */
const ABSENT_FIXTURE_SKIP_REASON = "fixture not in this site's source";

export type RouteVerdict = "scan" | "skip" | "missing";

/**
 * What to do with one navigation's response — the whole sentinel-awareness
 * decision, in one pure function.
 *
 * It is exported, unit-tested, AND serialized into the generated spec by
 * `Function.prototype.toString()` rather than written out twice. That is the
 * point: the branch the tests exercise is byte-for-byte the branch that runs
 * inside Playwright, so a passing test is evidence about the shipped guard and
 * not about a copy of it. Keep it closure-free — it is stringified, so any
 * module-scope identifier it referenced would be an undefined variable in the
 * spec.
 *
 * The two 404s this has to keep apart:
 *
 *   - `/` on a site still carrying `your-prismic-repo-name` — the designed
 *     answer, since no Prismic repository exists to serve a home page yet
 *     (#863). `skip`, and say so out loud.
 *   - `/dev/a11y-fixtures` returning 404 on that SAME site — a real defect. The
 *     fixture routes are served by the dev server the axe scan runs against,
 *     where the #717 `/dev` layout guard is inert, so they owe a 200 no matter
 *     what the Prismic config says. `placeholder404Ok` is never set on them,
 *     so this returns `missing` for them on a placeholder site exactly as on
 *     any other. reddoor-starter sits on the sentinel permanently, so the repo
 *     that DEFINES the fixtures is precisely the one a broader rule would stop
 *     checking.
 *
 * The third 404, added by #900:
 *
 *   - `/dev/animate-in` on a site whose `src/routes` tree has no directory for
 *     it. The fixture exercises the starter's `animateIn` action, and seven
 *     fleet sites ship neither. Nothing is broken there and nothing can be
 *     fixed there; the route was never theirs. `sourceAbsent` marks it, and
 *     ONLY the two built-in fixtures are ever eligible — a route opted in
 *     through `package.json#reddoor.a11yRoutes` is a real page, usually
 *     Prismic-backed with no directory of its own, so a source check on those
 *     would mass-skip the exact routes that opt-in exists to keep honest.
 *
 * Only 404 is tolerated, never a 500 or a dead navigation: "there is no content
 * here yet" is a 404. A placeholder site whose dev server throws is still
 * broken, and blanket non-200 tolerance would swallow that. The same holds for
 * an absent fixture: a route with no source that answers 500 means the dev
 * server is broken, which is not the same claim as "this site does not have
 * that route".
 */
export function classifyRouteResponse(input: {
  status: number | null;
  placeholder404Ok: boolean;
  sourceAbsent?: boolean;
}): RouteVerdict {
  if (input.status === 200) return "scan";
  if (input.status === 404 && (input.placeholder404Ok || input.sourceAbsent === true)) {
    return "skip";
  }
  return "missing";
}

/**
 * Which of the built-in fixture routes this site's own source has no directory
 * for (#900).
 *
 * Three rules, and each one exists because getting it wrong produces a false
 * green rather than a false red:
 *
 *   - **Only ENOENT and ENOTDIR mean absent.** `stat` also throws EACCES,
 *     EMFILE, ELOOP and EIO, and every one of those means "I could not tell".
 *     An earlier cut caught them all and called them absent, which under the
 *     fd pressure of a concurrent fleet sweep would have turned a real 404 into
 *     a skip — the same shape as the starvation-degrades-a-check incident this
 *     repo already has on file. Anything that is not a plain "no such entry"
 *     leaves the fixture checkable.
 *   - **`src/routes` itself is the outer guard.** Missing or unreadable, and
 *     this returns an EMPTY set, so no fixture is ever excused.
 *   - **Entry names are matched EXACTLY**, by reading each directory rather
 *     than by `stat`ing a joined path. macOS folds case and Linux does not, so
 *     a `Dev/Animate-In` tree would read as present locally and absent on the
 *     runner — and since SvelteKit URLs are case-sensitive, the local answer is
 *     the wrong one AND the CI answer is the one that gates the merge. Reading
 *     the parent removes the divergence.
 *
 * SvelteKit route groups are resolved too: `(marketing)/dev/animate-in` serves
 * `/dev/animate-in`, so a group directory is transparent here exactly as it is
 * in the URL. Nothing in the fleet uses one under `/dev` today; it is handled
 * because the failure it would otherwise cause is silent.
 *
 * Being wrong in the other direction costs nothing: a route this calls absent
 * but which answers 200 is scanned anyway, because `classifyRouteResponse`
 * tolerates absence only for a 404.
 */
async function absentFixtureRoutes(sitePath: string, fixtures: A11yRoute[]): Promise<Set<string>> {
  const routesDir = join(sitePath, "src", "routes");
  let top: string[];
  try {
    top = await readdir(routesDir);
  } catch {
    return new Set();
  }
  const absent = new Set<string>();
  for (const fixture of fixtures) {
    const segments = fixture.path.split("/").filter((seg) => seg.length > 0);
    if (!(await resolvesInTree(routesDir, top, segments))) absent.add(fixture.path);
  }
  return absent;
}

/** One directory listing, or null when the directory cannot be listed. A null is
 *  "I could not tell" and every caller treats it as "do not conclude absent". */
async function listDir(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A plain "not there" is an answer. Anything else is not.
    return code === "ENOENT" || code === "ENOTDIR" ? [] : null;
  }
}

/** Does `segments` name a real directory under `dir`, matching entry names
 *  exactly and stepping through SvelteKit route groups transparently? */
async function resolvesInTree(
  dir: string,
  entries: string[],
  segments: string[],
): Promise<boolean> {
  if (segments.length === 0) return true;
  const [head, ...rest] = segments;
  if (entries.includes(head as string)) {
    const next = join(dir, head as string);
    const listing = await listDir(next);
    // Unreadable below here: do not conclude absent.
    if (listing === null) return true;
    if (await resolvesInTree(next, listing, rest)) return true;
  }
  for (const entry of entries) {
    if (!(entry.startsWith("(") && entry.endsWith(")"))) continue;
    const next = join(dir, entry);
    const listing = await listDir(next);
    if (listing === null) return true;
    if (await resolvesInTree(next, listing, segments)) return true;
  }
  return false;
}

/**
 * The route the dev webServer's readiness probe polls. It is `/dev/a11y-fixtures`
 * and not `/` because it has to prove the FIXTURES are being served, not merely
 * that vite answered.
 *
 * It is named here because that makes it load-bearing in a way the #900
 * absent-fixture tolerance has to respect: Playwright treats any status at or
 * above 404 as "not ready", so a site missing THIS fixture never reaches the
 * spec at all. It burns the full webServer budget and dies with a timeout that
 * names neither the route nor the reason. The tolerance below therefore cannot
 * apply to it, and `a11yAudit` fails fast and says so rather than letting the
 * run discover it 120 seconds later.
 */
const DEV_PROBE_ROUTE = "/dev/a11y-fixtures";

const RESULTS_REL = ".reddoor-a11y/results.json";

async function readJsonMaybe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Budget for a webServer that only has to boot vite. */
const DEV_SERVER_TIMEOUT_MS = 120_000;
/** Budget for a webServer that runs a production build and then serves it. */
const PREVIEW_SERVER_TIMEOUT_MS = 5 * 60_000;
/** Playwright spawn budget: cold tree, chrome download, dev boot, axe. */
const PLAYWRIGHT_TIMEOUT_MS = 5 * 60_000;
/** The same, plus a production build. A build SIGKILLed mid-flight reports as
 *  an audit failure with nothing to point at. */
const PLAYWRIGHT_PREVIEW_TIMEOUT_MS = 10 * 60_000;

// One `webServer` entry. Every field is a fix with a scar:
//   --strictPort: refuse to bump to a different port if ours is taken, so the
//     audit fails loudly instead of probing a zombie.
//   reuseExistingServer:false: never reuse — we control the lifecycle.
//   cwd: playwright's default webServer.cwd is the config file's directory. Our
//     config lives under the site but off its root, so without this override
//     "npm run vite:dev" reads the wrong package.json and ENOENTs before vite
//     ever starts. Caltex 2026-05-28 (0.10.5).
function webServerBlock(opts: {
  command: string;
  url: string;
  sitePath: string;
  timeoutMs: number;
}): string {
  return `{
      command: ${JSON.stringify(opts.command)},
      url: ${JSON.stringify(opts.url)},
      cwd: ${JSON.stringify(opts.sitePath)},
      reuseExistingServer: false,
      timeout: ${opts.timeoutMs},
    }`;
}

/**
 * The audit-controlled playwright config. We synthesize it (rather than rely on
 * the site's playwright.config.ts) so we can pin the dev server port + force
 * `--strictPort` — same fix as the lighthouse audit, same reason (zombie vite
 * processes squatting on 5173 would otherwise eat the audit's request and
 * return stale 404s).
 *
 * `previewPort` (#700) adds a SECOND webServer running the real production
 * build, for the hydration smoke only. The axe scan stays on the dev server —
 * deliberately. Its targets are `/dev/a11y-fixtures` and `/dev/animate-in`, dev
 * fixture routes with no guarantee of surviving a production build; moving them
 * would have the route-status guard (#680) correctly report every fixture as a
 * missing route, and a working gate would become a red one measuring nothing.
 * `baseURL` therefore stays on the dev port, and the smoke routes carry an
 * absolute origin instead.
 */
function buildPlaywrightConfig(port: number, sitePath: string, previewPort?: number): string {
  const dev = webServerBlock({
    command: `npm run vite:dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}${DEV_PROBE_ROUTE}`,
    sitePath,
    timeoutMs: DEV_SERVER_TIMEOUT_MS,
  });
  // The preview server is probed on `/`, never a `/dev/*` fixture — see above.
  const preview =
    previewPort === undefined
      ? undefined
      : webServerBlock({
          command: `npm run build && npm run preview -- --port ${previewPort} --strictPort`,
          url: `http://localhost:${previewPort}/`,
          sitePath,
          timeoutMs: PREVIEW_SERVER_TIMEOUT_MS,
        });
  const webServer =
    preview === undefined
      ? dev
      : `[
    ${dev},
    ${preview},
  ]`;

  return `import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\\.spec\\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:${port}",
    trace: "on-first-retry",
  },
  webServer: ${webServer},
});
`;
}

/**
 * A second free port, guaranteed different from `taken`. `findFreePort`
 * releases its socket before returning, so two calls can legitimately hand back
 * the same ephemeral port — and two webServers cannot share one: under
 * `--strictPort` the second dies with "port already in use" and the failure
 * reads as the site's rather than the allocator's.
 */
async function allocateDistinctPort(taken: number): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await findFreePort();
    if (candidate !== taken) return candidate;
  }
  throw new Error(`a11y: could not allocate a second free port distinct from ${taken}`);
}

// The spec the audit writes runs all configured routes through axe in a single
// test (so worker isolation doesn't fragment the collected violations) and
// writes the structured result to <cwd>/.reddoor-a11y/results.json before
// asserting. That way, the audit can read real axe details even when the
// expect(...).toEqual([]) assertion fails.
function buildSpec(axePages: SpecRoute[], smokeOrigin = ""): string {
  return `import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Injected, not transcribed — see classifyRouteResponse in src/audits/a11y.ts.
const classifyRouteResponse = ${classifyRouteResponse.toString()};
const SKIP_REASON = ${JSON.stringify(PLACEHOLDER_SKIP_REASON)};
const ABSENT_FIXTURE_SKIP_REASON = ${JSON.stringify(ABSENT_FIXTURE_SKIP_REASON)};

const pages = ${JSON.stringify(axePages)};
const smokePages = ${JSON.stringify(smokeRoutes)};
// Absolute origin for the hydration smoke when the site has opted its gates
// onto a production build (#700). The axe loop runs against the dev server via
// baseURL; these routes run against the built bundle on a second port, and the
// origin has to be explicit or they would silently fall back to baseURL — i.e.
// to dev — and measure exactly what this exists to stop measuring. Empty string
// = one server for both, the default.
const SMOKE_ORIGIN = ${JSON.stringify(smokeOrigin)};
const OUTPUT = process.env.REDDOOR_A11Y_OUTPUT;

// Playwright's default per-test timeout is 30s. We loop through every
// configured route in a single test, so the budget needs to scale.
test.setTimeout(5 * 60_000);

test("a11y + hydration across configured routes", async ({ page }) => {
  const violations = [];
  // Routes navigated but deliberately not scanned. Separate from violations so
  // they cannot fail the run, and written to the artifact so they cannot vanish
  // from the summary either.
  const skipped = [];

  // Capture uncaught client-side exceptions across every route we visit. A page
  // that builds + SSRs cleanly can still throw on hydrate and blank itself
  // (data-dynamiq: a Svelte 4->5 run() referenced a $state declared after it) --
  // axe never sees that, so we listen for it directly and tag the route in scope.
  let currentRoute = "";
  page.on("pageerror", (err) => {
    violations.push({
      id: "client-error",
      impact: "critical",
      route: currentRoute,
      help: String(err && err.message ? err.message : err),
    });
  });

  for (const { path, name, placeholder404Ok, sourceAbsent } of pages) {
    currentRoute = name;
    const response = await page.goto(path);
    const status = response ? response.status() : null;
    // A route that does not exist is a config problem, not a markup one. The
    // audit used to navigate, get a 404, run axe over whatever the error page
    // was and report the count -- for months that page was a bare fallback with
    // nothing to flag, so a missing fixture read as green. When reddoor-website
    // gave its 404 page a designed watermark the count went to 1 with no route
    // and no rule in the summary, and the "violation" was bisected as markup
    // (#680). Name it as a missing route and do not scan the error page.
    //
    // The one exception (#863): a site still on the starter's Prismic sentinel
    // has no content to serve, so a 404 on ITS OWN routes is the designed
    // answer. Those carry placeholder404Ok; the /dev fixtures never do.
    //
    // The /dev fixtures have their own, narrower tolerance instead (#900):
    // sourceAbsent, set only when this site's src/routes tree has no directory
    // for that fixture. A fixture that IS in the tree and 404s stays a
    // violation, which is the case #680 was written for.
    const verdict = classifyRouteResponse({
      status,
      placeholder404Ok: placeholder404Ok === true,
      sourceAbsent: sourceAbsent === true,
    });
    if (verdict === "skip") {
      // Two reasons reach this branch and an operator has to be able to tell
      // them apart: "no Prismic repo behind it yet" is temporary and ends at
      // /new-site step 6, while "this site does not have that fixture" is
      // permanent. Reporting both as one reason would make the summary say
      // less than the artifact knows, which is #680's original complaint.
      skipped.push({
        route: name,
        path,
        status,
        reason: sourceAbsent === true ? ABSENT_FIXTURE_SKIP_REASON : SKIP_REASON,
      });
      continue;
    }
    if (verdict === "missing") {
      violations.push({
        id: "route-missing",
        impact: "serious",
        route: name,
        help: \`\${path} returned \${status === null ? "no response" : status}\`,
      });
      continue;
    }
    // Snap CSS transitions/animations to their resting state before axe runs.
    // AnimateIn-style fixtures transition opacity 0->1; sampling mid-transition
    // makes axe compute color-contrast against semi-transparent text, yielding a
    // flaky "serious" color-contrast violation (~1/3 of runs on /dev/animate-in).
    // Disabling transitions/animations forces the final, rendered state
    // deterministically -- which is also what users (and prefers-reduced-motion
    // users) actually see, so it's the correct thing to assert.
    await page.addStyleTag({
      content: "*,*::before,*::after{transition:none!important;animation:none!important;}",
    });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])
      .analyze();
    for (const v of results.violations) {
      violations.push({
        id: v.id,
        impact: v.impact ?? "moderate",
        route: name,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({ html: n.html, target: n.target })),
      });
    }
  }

  // Hydration smoke check: load real routes (the homepage) and fail on any
  // uncaught client-side error. No axe here -- real routes carry pre-existing
  // a11y debt we don't gate on; we only assert they don't crash on hydrate.
  // HTTP/SSR errors don't fire 'pageerror', so a data-less CI homepage that
  // renders empty-but-valid won't false-fail -- only a real client crash does.
  for (const { path, name } of smokePages) {
    currentRoute = name;
    await page.goto(SMOKE_ORIGIN + path);
    // Let hydration + first effects run so a TDZ/ReferenceError surfaces.
    await page.waitForTimeout(2000);
  }

  const byImpact = {};
  for (const v of violations) {
    byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
  }
  if (OUTPUT) {
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(
      OUTPUT,
      JSON.stringify(
        { totalViolations: violations.length, byImpact, violations, skipped },
        null,
        2,
      ),
    );
  }
  expect(violations).toEqual([]);
});
`;
}

/** How many `rule on route` entries the summary names before folding the rest
 *  into `+N more`. Six covers every fail the fleet has produced so far in one
 *  line; the artifact JSON keeps the full list. */
const NAMED_VIOLATIONS_MAX = 6;

/**
 * One line naming each violation as `<rule> on <route>`, identical pairs folded
 * into `<rule> ×N on <route>`. A `route-missing` entry appends its help, which
 * is where the path and HTTP status live -- that is the one case where the id
 * and route alone do not say what went wrong. Empty for no violations.
 */
export function describeViolations(violations: AxeViolation[]): string {
  const groups = new Map<string, { id: string; route: string; help?: string; n: number }>();
  for (const v of violations) {
    const key = `${v.id}\u0000${v.route}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { id: v.id, route: v.route, ...(v.help ? { help: v.help } : {}), n: 1 });
  }
  const entries = [...groups.values()];
  const shown = entries.slice(0, NAMED_VIOLATIONS_MAX).map((g) => {
    const count = g.n > 1 ? ` ×${g.n}` : "";
    const detail = g.id === "route-missing" && g.help ? ` (${g.help})` : "";
    return `${g.id}${count} on ${g.route}${detail}`;
  });
  const rest = entries.length - shown.length;
  return shown.join(", ") + (rest > 0 ? `, +${rest} more` : "");
}

/** How many skipped routes the summary names before folding the rest into
 *  `+N more`. Smaller than the violation cap: a skip list is bounded by the
 *  site's own `a11yRoutes`, and the artifact JSON keeps the full list. */
const NAMED_SKIPS_MAX = 4;

/**
 * The skip clause of the summary: how many, which ones, and why. Empty when
 * nothing was skipped, so a site that skipped nothing keeps its old line
 * byte-for-byte.
 *
 * The reason is carried through from the artifact rather than assumed here,
 * because "1 skipped: /" invites the reader to supply their own explanation and
 * the most available one ("probably fine") is the one that re-creates the false
 * green.
 *
 * There are two reasons since #900, and that changes the shape. While every
 * skip shares one reason the compact form is right: names, one em dash, the
 * reason. With MORE than one reason in play the same line stops pairing them,
 * and the two are not interchangeable — a placeholder-repo skip clears itself
 * at `/new-site` step 6, while an absent fixture is permanent. A reader given
 * "/, animate-in demo — placeholder Prismic repo, fixture not in this site's
 * source" will attach the first reason to both. So a mixed run names each
 * route with its own reason, and the compact form survives only where it
 * cannot mislead.
 */
export function describeSkipped(skipped: SkippedRoute[]): string {
  if (skipped.length === 0) return "";
  const shown = skipped.slice(0, NAMED_SKIPS_MAX);
  const rest = skipped.length - shown.length;
  const more = rest > 0 ? `, +${rest} more` : "";
  const reasons = [
    ...new Set(
      skipped
        .map((s) => s.reason)
        .filter((r): r is string => typeof r === "string" && r.length > 0),
    ),
  ];
  if (reasons.length > 1) {
    const paired = shown.map((s) => (s.reason ? `${s.route} (${s.reason})` : s.route)).join(", ");
    return `${skipped.length} skipped: ${paired}${more}`;
  }
  const names = shown.map((s) => s.route).join(", ") + more;
  return `${skipped.length} skipped: ${names}${reasons.length > 0 ? ` — ${reasons.join(", ")}` : ""}`;
}

export async function a11yAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  // specDir lives INSIDE site.path (not /tmp) so the spec's
  // `import AxeBuilder from "@axe-core/playwright"` resolves via Node's
  // walk-up — the site's node_modules is the nearest one. A spec written
  // to /tmp ENOENTs at module resolution before any test runs. Caltex
  // 2026-05-28 (0.10.6 dogfood), third layer of the same class as the
  // webServer.cwd bug.
  const specDir = await mkdtemp(join(site.path, ".reddoor-a11y-spec-"));
  // Everything past mkdtemp is wrapped so the transient specDir is removed on
  // EVERY catchable exit — success, skip-return, or any throw (a failed
  // writeFile/findFreePort used to orphan it). A timeout-SIGKILL of the parent
  // can't be caught here; `.reddoor-a11y-spec-*/` is fleet-gitignored as the
  // backstop for that. (2026-06-10 MEDIUM-D; recurred from 06-05 M3.)
  try {
    // Real routes the site has opted in to (package.json#reddoor.a11yRoutes),
    // appended to the fixtures rather than replacing them: the fixtures exercise
    // design-system components in isolation, which no real page covers. Absent
    // key → the fixtures alone, exactly as before. This exists because scanning
    // only fixtures let a critical `image-alt` violation ship to five production
    // pages with CI green; it is opt-in because the audit runs with
    // --fail-on-violations and most of the fleet has pre-existing debt.
    // The route path doubles as its name — the spec tags each violation with
    // `route: name`, so it has to identify the page.
    const {
      a11yRoutes: siteRoutes,
      gateServer,
      absentFixtures: declaredAbsent,
    } = await readSiteConfig(site.path);
    // #863: while a clone still carries the starter's Prismic sentinel, its own
    // content routes 404 BY DESIGN — there is no repository behind them until
    // `/new-site` step 6. Every new site passes through that state between step
    // 3c (point the gates at real routes) and step 6 (wire Prismic), and the
    // first maintenance PR in that window used to fail on `route-missing on /`,
    // which is not a defect in the site. The alternative the template had to
    // take — `a11yRoutes: []` — trades a false red for a false green, and an
    // empty list is exactly the configuration that let a critical `image-alt`
    // ship to five production pages with CI green. So: keep the route
    // configured, expect its 404, and say in the summary that it was not
    // scanned.
    //
    // Only the site's OWN routes are marked. The `/dev/*` fixtures are served
    // by the dev server the axe scan runs against and owe a 200 regardless of
    // Prismic — and reddoor-starter, which sits on the sentinel permanently, is
    // the very repo those fixtures live in.
    const placeholderRepo = await readsPlaceholderPrismicRepo(site.path);
    // #900. Only the built-in fixtures are checked against the source tree —
    // see absentFixtureRoutes and classifyRouteResponse for why widening this
    // to the site's own routes would be the false green opt-in exists to stop.
    const absentFixtures = await absentFixtureRoutes(site.path, a11yRoutes);
    // The readiness probe cannot be skipped — see DEV_PROBE_ROUTE. Say which
    // route and why, here, instead of surfacing a 120s webServer timeout that
    // names neither.
    if (absentFixtures.has(DEV_PROBE_ROUTE)) {
      return {
        audit: "a11y",
        site: siteLabel(site),
        status: "fail",
        summary:
          `a11y: ${DEV_PROBE_ROUTE} is not in this site's src/routes tree. ` +
          "The dev server's readiness probe polls it, so the run cannot start. " +
          "Restore the fixture route.",
      };
    }
    // An absence the site has written down is intentional and reads as a clean
    // pass. An absence only the filesystem knows about is a `warn`: the tree
    // cannot tell "never had it" from "deleted last Tuesday", and one of those
    // used to be a loud red.
    const declared = new Set(declaredAbsent ?? []);
    const undeclaredAbsent = [...absentFixtures].filter((p) => !declared.has(p));
    const axePages: SpecRoute[] = [
      ...a11yRoutes.map((fixture) => ({
        ...fixture,
        ...(absentFixtures.has(fixture.path) ? { sourceAbsent: true as const } : {}),
      })),
      ...(siteRoutes ?? []).map((path) => ({
        path,
        name: path,
        ...(placeholderRepo ? { placeholder404Ok: true as const } : {}),
      })),
    ];

    const port = await findFreePort();
    // #700: `package.json#reddoor.gateServer: "preview"` opts this site's gates
    // onto the shipped bundle. Only the hydration smoke moves — that is the
    // part `vite dev` hides, since the module graph, code splitting,
    // minification and asset hashing it replaces are most of what "hydration
    // works" means. The axe scan keeps the dev server so the `/dev/*` fixtures
    // still resolve. Absent or unrecognized key → nothing changes.
    const previewPort = gateServer === "preview" ? await allocateDistinctPort(port) : undefined;

    const specPath = join(specDir, "a11y.spec.ts");
    await writeFile(
      specPath,
      buildSpec(axePages, previewPort === undefined ? "" : `http://localhost:${previewPort}`),
      "utf-8",
    );

    const configPath = join(specDir, "playwright.config.ts");
    await writeFile(configPath, buildPlaywrightConfig(port, site.path, previewPort), "utf-8");

    const resultsPath = join(site.path, RESULTS_REL);
    // Clear stale artifacts so a failed spawn never reports old data.
    await rm(join(site.path, ".reddoor-a11y"), { recursive: true, force: true });

    let raw;
    try {
      raw = await spawn(
        "npx",
        ["--yes", "playwright", "test", `--config=${configPath}`, "--reporter=line", specPath],
        {
          cwd: site.path,
          env: { ...process.env, REDDOOR_A11Y_OUTPUT: resultsPath },
          // playwright on a cold tree downloads Chrome, boots the site's dev
          // server, and runs axe over every configured route. The shared 30 s
          // default in runAudits is fine for deps/lint/security but starves
          // playwright (mirrors the lighthouse fix shipped earlier).
          // A preview run pays for a production build before the first
          // navigation, so the budget sized for "boot vite, then axe" would
          // SIGKILL it mid-build and report it as an audit failure.
          timeoutMs:
            previewPort === undefined ? PLAYWRIGHT_TIMEOUT_MS : PLAYWRIGHT_PREVIEW_TIMEOUT_MS,
        },
      );
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
        return {
          audit: "a11y",
          site: label,
          status: "skip",
          summary: "npx/playwright not available",
        };
      }
      throw err;
    }

    const artifact = await readJsonMaybe<NormalizedA11y>(resultsPath);

    if (!artifact) {
      return {
        audit: "a11y",
        site: label,
        status: "fail",
        summary: `a11y: no results written (exit ${raw.code})${
          raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
        }`,
      };
    }

    const hasSerious =
      (artifact.byImpact.serious ?? 0) > 0 || (artifact.byImpact.critical ?? 0) > 0;
    const hasAny = artifact.totalViolations > 0;

    // #900. An UNDECLARED absent fixture cannot leave the audit on `pass`. The
    // skip itself is right — a route the site never had is not a missing route
    // — but inferring it from the tree cannot distinguish "never had it" from
    // "lost it", and losing it used to be a loud red. `warn` keeps the
    // difference visible without failing a site for something it cannot fix,
    // and `package.json#reddoor.absentFixtures` is how a site says "on
    // purpose" and gets its clean pass back.
    const absenceDowngrade = undeclaredAbsent.length > 0;
    const status: AuditResult["status"] = hasSerious
      ? "fail"
      : hasAny || absenceDowngrade
        ? "warn"
        : "pass";

    // Count the list that actually RAN (`axePages`), never the fixture defaults.
    //
    // This said `a11yRoutes.length` — the two fixtures — so every site that
    // opted in via `package.json#reddoor.a11yRoutes` was told, on the one
    // command an operator runs to confirm the opt-in worked, that its routes
    // had not run. The output was byte-identical to before the key existed.
    // vida-legacy-foundation added eight real routes and read "across 2
    // routes"; all ten had been scanned the whole time (#697).
    //
    // The failure mode that invites is the expensive one — conclude the key is
    // broken, revert it, and lose exactly the coverage it exists to provide.
    // Scanning only fixtures is how a critical `image-alt` violation shipped to
    // five production pages on gallerysonder with CI green.
    const siteRouteCount = axePages.length - a11yRoutes.length;
    // Name the split only when there is one: a site with no opt-in keeps its
    // old summary byte-for-byte, and the confirmation appears exactly where it
    // was missing. Saying "10 routes" alone would still leave an operator
    // counting on their fingers to check their eight arrived.
    const splitNote =
      siteRouteCount > 0
        ? `${a11yRoutes.length} fixtures + ${siteRouteCount} from package.json`
        : "";
    // #863: a skipped route MUST NOT be able to read as a scanned one. The
    // count therefore becomes "N of M routes" the moment anything is skipped,
    // and the note names each skipped route and why. A silent skip would
    // re-create the false green #680 removed — the whole reason this route-
    // status guard exists — one layer up, and it would be harder to catch,
    // because this time the run is green on purpose.
    const skippedRoutes = Array.isArray(artifact.skipped) ? artifact.skipped : [];
    const skipNote = describeSkipped(skippedRoutes);
    const countPhrase =
      skippedRoutes.length > 0
        ? `${axePages.length - skippedRoutes.length} of ${axePages.length} routes`
        : `${axePages.length} routes`;
    const notes = [splitNote, skipNote].filter((n) => n.length > 0).join("; ");
    const scanned = notes.length > 0 ? `${countPhrase} (${notes})` : countPhrase;
    // The count was missing entirely from the fail path, so a failing run could
    // not tell you how much it had covered either.
    // Name the rule and the route on the fail path. The count alone sent an
    // operator bisecting markup for a `route-missing` that the artifact JSON
    // had named all along (#680); the summary is the line that reaches CI logs
    // and the cockpit, so it has to carry what the artifact knows.
    // Name the server the smoke ran against. #697's lesson is that an opt-in
    // which does not visibly take effect gets reverted as broken — and this one
    // costs a build per run, so "did it actually do the expensive thing?" is
    // the first question an operator asks.
    const smokeNote =
      previewPort === undefined
        ? `+${smokeRoutes.length} hydration smoke`
        : `+${smokeRoutes.length} hydration smoke on a production preview`;
    const named = describeViolations(artifact.violations ?? []);
    const summary =
      status === "pass"
        ? `a11y: 0 violations across ${scanned} (${smokeNote})`
        : `a11y: ${artifact.totalViolations} violations across ${scanned}${named ? ` — ${named}` : ""}`;

    return {
      audit: "a11y",
      site: label,
      status,
      summary,
      details: artifact,
    };
  } finally {
    await rm(specDir, { recursive: true, force: true });
  }
}

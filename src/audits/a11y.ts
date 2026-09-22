import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import {
  a11yRoutes,
  smokeRoutes,
  DEV_PROBE_ROUTE,
  type A11yRoute,
} from "../configs/playwright-a11y.js";
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

/** Which axe rules produced POSITIVE evidence on one route — i.e. ran and
 *  reported a pass. `violations: []` cannot distinguish "all legible" from
 *  "never looked"; this can (#888). */
export type MeasuredRoute = { route: string; rules: string[] };

type NormalizedA11y = {
  totalViolations: number;
  byImpact: Partial<Record<Impact, number>>;
  violations: AxeViolation[];
  skipped?: SkippedRoute[];
  measured?: MeasuredRoute[];
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

/** One route path in the shape the fixture list uses: a single leading slash,
 *  no trailing one. Applied to operator-typed `absentFixtures` entries so a
 *  near-miss declares what it meant instead of silently declaring nothing. */
function normalizeRoutePath(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const RESULTS_DIR = ".reddoor-a11y";
const RESULTS_REL = `${RESULTS_DIR}/results.json`;

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
  // Which rules produced positive evidence on each route (#888).
  const measured = [];

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
    // #888. When a rule THROWS, axe does not fail it -- it files one node
    // under "incomplete" carrying an "error-occurred" check and skips the rule
    // for the WHOLE page. "violations" stays empty, so an audit gated on
    // violations goes green having measured nothing. That is what hid a 1.73:1
    // label on roalson-interests: axe could not parse "oklch(0.205 0 none)"
    // (Tailwind 4.3 gives 13 palette entries a "none" hue), skipped
    // color-contrast entirely, and the page reported 0 contrast nodes where it
    // should have reported 61.
    //
    // A rule that could not run is a failure of the instrument, not a clean
    // page, so it is reported as a violation carrying axe's own message.
    for (const inc of results.incomplete ?? []) {
      const errored = (inc.nodes ?? []).find((n) =>
        [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].some(
          (c) => c && c.id === "error-occurred",
        ),
      );
      if (!errored) continue;
      const checks = [...(errored.any ?? []), ...(errored.all ?? []), ...(errored.none ?? [])];
      const detail = checks.find((c) => c && c.id === "error-occurred");
      const message =
        detail && detail.data && typeof detail.data.message === "string"
          ? detail.data.message
          : "no message from axe";
      violations.push({
        id: "rule-errored",
        impact: "serious",
        route: name,
        help: 'axe could not run "' + inc.id + '": ' + message,
        helpUrl: inc.helpUrl,
      });
    }
    // #888, the second half. A crashed rule is not the only way a rule can
    // measure nothing, and an empty violations list cannot tell "all legible"
    // from "never looked". The "passes" array carries positive evidence: a
    // rule that ran and found nothing wrong appears there. Record which rules
    // actually ran, so the audit can SAY whether contrast was measured rather
    // than inferring it from an absence.
    measured.push({
      route: name,
      rules: [...new Set((results.passes ?? []).map((r) => r.id))],
    });
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
        { totalViolations: violations.length, byImpact, violations, skipped, measured },
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
    // `route-missing` and `rule-errored` both carry their diagnostic in `help`
    // rather than in a node, and for both of them that sentence IS the finding
    // — "rule-errored on a11y fixtures" tells an operator nothing, while
    // "Unable to parse color oklch(0.205 0 none)" tells them exactly what to
    // change. Every other rule's help is generic advice the helpUrl repeats.
    const carriesItsOwnDiagnostic = g.id === "route-missing" || g.id === "rule-errored";
    const detail = carriesItsOwnDiagnostic && g.help ? ` (${g.help})` : "";
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
    // A reason carried only by a skip PAST the cap must still reach the line.
    // The compact branch computes its reasons over ALL skips, so pairing over
    // `shown` alone silently dropped one — losing information against the very
    // branch this replaced, and the dropped one is as often as not the
    // permanent reason rather than the self-clearing one.
    const shownReasons = new Set(shown.map((s) => s.reason));
    const unshown = reasons.filter((r) => !shownReasons.has(r));
    const trailer = unshown.length > 0 ? ` — also ${unshown.join(", ")}` : "";
    return `${skipped.length} skipped: ${paired}${more}${trailer}`;
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
      // Same invariant as every other exit: a stale results.json must never
      // be read as this run's answer.
      await rm(join(site.path, RESULTS_DIR), { recursive: true, force: true });
      return {
        audit: "a11y",
        site: label,
        status: "fail",
        summary:
          `a11y: ${DEV_PROBE_ROUTE} is not in this site's src/routes tree. ` +
          "The dev server's readiness probe polls it, so the run cannot start. " +
          "Restore the fixture route — `reddoor.absentFixtures` cannot excuse this one.",
      };
    }
    // An absence the site has written down is intentional and reads as a clean
    // pass. An absence only the filesystem knows about is a `warn`: the tree
    // cannot tell "never had it" from "deleted last Tuesday", and one of those
    // used to be a loud red.
    // Normalised before comparing, because the failure of a near-miss is
    // silent: `"dev/animate-in"` or `"/dev/animate-in/"` would leave the site
    // on a permanent warn with no hint that the declaration it wrote was
    // inert. A declaration is operator-typed prose, so it gets the same
    // forgiveness `a11yRoutes` entries already get for whitespace.
    const declared = new Set((declaredAbsent ?? []).map(normalizeRoutePath));
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
    await rm(join(site.path, RESULTS_DIR), { recursive: true, force: true });

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
    const skippedRoutes = Array.isArray(artifact.skipped) ? artifact.skipped : [];
    // Gated on the ARTIFACT, not on the filesystem alone. The two are computed
    // from different sources and can disagree: a route that serves a fixture
    // path without a matching directory (a rest route, dev middleware, a
    // `kit.files.routes` override) is scanned normally and records no skip,
    // and downgrading on the filesystem alone produced a `warn` whose summary
    // said "0 violations across 2 routes" — a warning with nothing in it to
    // act on. A warn now requires that the run actually declined to scan.
    const absentSkips = skippedRoutes.filter((r) => r.reason === ABSENT_FIXTURE_SKIP_REASON);
    // #888. A route that was SCANNED but produced no `color-contrast` entry in
    // `passes` was not measured for contrast. An empty violations list cannot
    // tell "all legible" from "never looked", and the second is what a crashed
    // rule leaves behind. The crash itself is now a violation, so this is the
    // backstop for a rule that measures nothing WITHOUT erroring.
    //
    // It is a `warn`, never a `fail`. A route can legitimately have no text to
    // contrast, and turning that into a red would fail sites for a property
    // they do not have — the mirror of the mistake #900 was about. An artifact
    // with no `measured` array at all (an older spec) says nothing, so it
    // downgrades nothing: "I could not tell" is not "it was not measured".
    const measuredRoutes = Array.isArray(artifact.measured) ? artifact.measured : [];
    const skippedNames = new Set(skippedRoutes.map((r) => r.route));
    const unmeasuredContrast = measuredRoutes
      .filter((m) => !skippedNames.has(m.route))
      .filter((m) => !(m.rules ?? []).includes("color-contrast"))
      .map((m) => m.route);
    const absenceDowngrade =
      undeclaredAbsent.length > 0 && absentSkips.some((r) => undeclaredAbsent.includes(r.path));
    const status: AuditResult["status"] = hasSerious
      ? "fail"
      : hasAny || absenceDowngrade || unmeasuredContrast.length > 0
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
    const skipNote = describeSkipped(skippedRoutes);
    const countPhrase =
      skippedRoutes.length > 0
        ? `${axePages.length - skippedRoutes.length} of ${axePages.length} routes`
        : `${axePages.length} routes`;
    // Named, not just counted. "0 violations" with contrast unmeasured is the
    // exact sentence #888 is about, so the line has to say which routes.
    const unmeasuredNote =
      unmeasuredContrast.length > 0
        ? `color-contrast not measured on ${unmeasuredContrast.slice(0, NAMED_SKIPS_MAX).join(", ")}${
            unmeasuredContrast.length > NAMED_SKIPS_MAX
              ? `, +${unmeasuredContrast.length - NAMED_SKIPS_MAX} more`
              : ""
          }`
        : "";
    const notes = [splitNote, skipNote, unmeasuredNote].filter((n) => n.length > 0).join("; ");
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

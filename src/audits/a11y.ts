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
import { revealBelowFold, type RevealPass } from "./util/reveal-below-fold.js";
import {
  contrastUnmeasuredHelp,
  ruleErroredHelp,
  unparseableColourRemedy,
  unparseableContrastNodes,
} from "./util/contrast-unmeasured.js";
import { readAxeResults } from "./util/axe-results.js";
import {
  describeBlendUnmeasured,
  isExcludableBlendCrash,
  reincludedChildren,
  unsupportedBlendModeAt,
  type BlendUnmeasured,
} from "./util/blend-mode.js";
import {
  collectFrameErrorLogs,
  firstStackUrl,
  frameOnPathIsForeign,
  isForeignUrl,
  recordFrameErrors,
  resolveTargetElement,
  splitCrossOriginFrameNodes,
  splitThirdPartyErrors,
} from "./util/cross-origin.js";

type Impact = "minor" | "moderate" | "serious" | "critical";

type AxeViolation = {
  id: string;
  impact: Impact;
  route: string;
  help?: string;
  helpUrl?: string;
  nodes?: Array<{ html?: string; target?: string[] }>;
  /** On a `client-error`: the first URL in the error's stack, or null when it
   *  names none — so the artifact says where the error came from. */
  source?: string | null;
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

/** One route's reveal pass (#100), as the spec records it in the artifact. */
export type RevealRecord = RevealPass & { route: string };

/** Violation nodes inside cross-origin frames that one scanned route did not
 *  count (#100 review): how many, and under which rules. */
export type FrameNodesDropped = { route: string; count: number; rules: string[] };

/** An uncaught error that a cross-origin frame's own log recorded (#100
 *  review): recorded and named, never failed. `frame` is that frame's URL —
 *  the evidence; `source` is the stack's first URL, for the reader only. */
export type ThirdPartyError = {
  route: string;
  frame?: string;
  source: string | null;
  message: string;
};

/** How many nodes each axe rule actually passed on one route (#888).
 *
 *  A COUNT, not a presence flag. The unit that matters is nodes — the incident
 *  this exists for is "0 contrast nodes where there should have been 61" — and
 *  a boolean is satisfied by one passing node while sixty go unmeasured. */
export type MeasuredRoute = { route: string; ruleNodes: Record<string, number> };

type NormalizedA11y = {
  totalViolations: number;
  byImpact: Partial<Record<Impact, number>>;
  violations: AxeViolation[];
  skipped?: SkippedRoute[];
  /** Absent in an artifact written by a spec from before this field existed. */
  reveals?: RevealRecord[];
  /** Absent in an artifact written by a spec from before this field existed. */
  frameNodesDropped?: FrameNodesDropped[];
  /** Absent in an artifact written by a spec from before this field existed. */
  thirdPartyErrors?: ThirdPartyError[];
  /** Absent in an artifact written by a spec from before this field existed. */
  measured?: MeasuredRoute[];
  /** Absent in an artifact written by a spec from before this field existed. */
  blendUnmeasured?: BlendUnmeasured[];
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

/** Prefixed to the help of a `client-error` that was THROWN WHILE the reveal
 *  pass (#100) was running. It marks a time window, not a cause. The pass runs
 *  IntersectionObserver and scroll callbacks that never ran under the gate
 *  before (on roalson-interests it boots MapLibre), so errors in that window
 *  are the likeliest to be new — but a late hydration error can land in it
 *  too, and an error the pass triggers through async work can land after it.
 *  It still fails: a reader who scrolls hits it too. */
const REVEAL_PASS_ERROR_PREFIX = "while the reveal pass ran: ";

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
// Injected the same way, and run in the page — see src/audits/util/reveal-below-fold.ts.
const revealBelowFold = ${revealBelowFold.toString()};
// Injected the same way — see src/audits/util/cross-origin.ts.
const isForeignUrl = ${isForeignUrl.toString()};
const resolveTargetElement = ${resolveTargetElement.toString()};
const splitCrossOriginFrameNodes = ${splitCrossOriginFrameNodes.toString()};
const recordFrameErrors = ${recordFrameErrors.toString()};
const splitThirdPartyErrors = ${splitThirdPartyErrors.toString()};
const firstStackUrl = ${firstStackUrl.toString()};
const collectFrameErrorLogs = ${collectFrameErrorLogs.toString()};
const frameOnPathIsForeign = ${frameOnPathIsForeign.toString()};
// Injected the same way — see src/audits/util/contrast-unmeasured.ts (#888).
const unparseableContrastNodes = ${unparseableContrastNodes.toString()};
const contrastUnmeasuredHelp = ${contrastUnmeasuredHelp.toString()};
const ruleErroredHelp = ${ruleErroredHelp.toString()};
const unparseableColourRemedy = ${unparseableColourRemedy.toString()};
// Injected the same way — see src/audits/util/axe-results.ts (#916 review).
const readAxeResults = ${readAxeResults.toString()};
// Injected the same way — see src/audits/util/blend-mode.ts.
const isExcludableBlendCrash = ${isExcludableBlendCrash.toString()};
const unsupportedBlendModeAt = ${unsupportedBlendModeAt.toString()};
const reincludedChildren = ${reincludedChildren.toString()};
// How many times one rule is re-run on one route, each time excluding the
// nodes the last run crashed on for a blend mode. One band of text over a
// grain crashes once per text node; a page that still crashes after this many
// keeps the crash, which fails as rule-errored.
const BLEND_RERUN_MAX = 25;
// Every read of a frame is bounded: a lazy iframe that never loaded is listed
// with no document, and waiting on it hung the whole run (#100 review).
const FRAME_READ_TIMEOUT_MS = 2000;
// Every navigation to about:blank is bounded too, and its failure swallowed. A
// renderer kept permanently busy (a cross-origin embed in an endless loop
// shares the page's renderer under Playwright's Chromium) never finishes the
// navigation, and an unbounded one would hang the run to the spawn timeout
// with the crash unnamed. Bounded, the run goes on: the final settle reads
// what is left and results.json is written.
const ABOUT_BLANK_TIMEOUT_MS = 10_000;
const SKIP_REASON = ${JSON.stringify(PLACEHOLDER_SKIP_REASON)};
const ABSENT_FIXTURE_SKIP_REASON = ${JSON.stringify(ABSENT_FIXTURE_SKIP_REASON)};
const REVEAL_PASS_ERROR_PREFIX = ${JSON.stringify(REVEAL_PASS_ERROR_PREFIX)};

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

test("a11y + hydration across configured routes", async ({ page, baseURL }) => {
  const violations = [];
  // Routes navigated but deliberately not scanned. Separate from violations so
  // they cannot fail the run, and written to the artifact so they cannot vanish
  // from the summary either.
  const skipped = [];
  // Which rules produced positive evidence on each route (#888).
  const measured = [];
  // Elements a rule could not measure because axe has no function for their
  // backdrop's blend mode, per route: named and counted, never failed.
  const blendSkipped = [];
  // One entry per scanned route: what the reveal pass did there. Written to
  // the artifact so a pass that stopped short can be named, not assumed.
  const reveals = [];
  // One entry per scanned route: violation nodes inside cross-origin frames
  // that were not counted against the site, and under which rules.
  const frameNodesDropped = [];
  // Uncaught errors that a cross-origin frame's own log recorded -- a
  // third-party embed's script, which the reveal pass may be what loaded.
  // Named in the summary, never failed: the site cannot fix them.
  const thirdPartyErrors = [];
  // This route's uncaught errors, held until the route ends and each frame's
  // own error log can say where they were thrown.
  const pendingErrors = [];
  // Every frame, out-of-process ones included, keeps a log of its own
  // uncaught errors from before its first script runs. That log -- not the
  // stack -- is the evidence of which frame an error was thrown in.
  await page.addInitScript(recordFrameErrors);

  // Capture uncaught client-side exceptions across every route we visit. A page
  // that builds + SSRs cleanly can still throw on hydrate and blank itself
  // (data-dynamiq: a Svelte 4->5 run() referenced a $state declared after it) --
  // axe never sees that, so we listen for it directly and tag the route in scope.
  let currentRoute = "";
  // The origin of the route being visited, from the URL being navigated to
  // (an error thrown on load arrives before goto resolves, so page.url() may
  // still be the previous page).
  let currentOrigin = "";
  const originOf = (url) => new URL(url, baseURL ?? "http://localhost").origin;

  // Settle this route's pending errors. An error moves to thirdPartyErrors
  // only when a cross-origin frame's own log recorded it (see
  // splitThirdPartyErrors); everything else is the site's client-error. Every
  // frame read is bounded (see collectFrameErrorLogs): a frame that does not
  // answer is no evidence for the third party, and a site frame that does not
  // answer moves nothing.
  const settleErrors = async () => {
    if (pendingErrors.length === 0) return;
    const frameLogs = await collectFrameErrorLogs(
      page.frames(),
      page.mainFrame(),
      currentOrigin,
      isForeignUrl,
      FRAME_READ_TIMEOUT_MS,
    );
    const errors = pendingErrors.splice(0, pendingErrors.length);
    const split = splitThirdPartyErrors(errors, frameLogs);
    for (const e of split.site) {
      violations.push({
        id: "client-error",
        impact: "critical",
        route: e.route,
        help: e.help,
        source: e.source,
      });
    }
    for (const e of split.thirdParty) {
      thirdPartyErrors.push({ route: e.route, frame: e.frame, source: e.source, message: e.message });
    }
  };

  // Is there positive evidence that this frame path runs through a
  // cross-origin document? See frameOnPathIsForeign: the URL each frame on the
  // path actually loaded, and anything unresolvable is no.
  const pathIsForeign = (path) =>
    frameOnPathIsForeign(
      page.mainFrame(),
      path,
      currentOrigin,
      isForeignUrl,
      resolveTargetElement,
      FRAME_READ_TIMEOUT_MS,
    );
  // True only while the reveal pass is running on this route (#100). An
  // error caught then is labelled with that time window -- which is all the
  // label claims: not that the pass caused it.
  let inRevealPass = false;
  page.on("pageerror", (err) => {
    const message = String(err && err.message ? err.message : err);
    pendingErrors.push({
      route: currentRoute,
      message,
      help: (inRevealPass ? REVEAL_PASS_ERROR_PREFIX : "") + message,
      source: firstStackUrl(err && err.stack ? String(err.stack) : ""),
    });
  });

  for (const { path, name, placeholder404Ok, sourceAbsent } of pages) {
    currentRoute = name;
    currentOrigin = originOf(path);
    try {
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
      // Disabling transitions forces their final, rendered state
      // deterministically -- which is also what users (and prefers-reduced-motion
      // users) actually see, so it's the correct thing to assert. Disabling a CSS
      // keyframe animation does NOT: it drops the animation and leaves the
      // element at its base style, so a keyframe reveal whose visible state
      // exists only as its forwards fill is audited hidden (see #100).
      await page.addStyleTag({
        content: "*,*::before,*::after{transition:none!important;animation:none!important;}",
      });
      // Scroll the whole page through the viewport and back before axe runs
      // (#100). Without it every scroll-triggered reveal below the fold was
      // audited at the opacity 0 it waits in, and axe does not measure contrast
      // through that -- the text fell out of the result instead of failing it.
      // After the sheet above, so a TRANSITION-driven reveal snaps to its end
      // state as it fires; Web Animations are waited for by the pass itself. A
      // keyframe reveal is cancelled by the sheet and stays hidden, and a reveal
      // that hides again on leaving the viewport is hidden again by the return
      // to the top -- neither is covered.
      let pass;
      inRevealPass = true;
      try {
        pass = await page.evaluate(revealBelowFold);
      } finally {
        inRevealPass = false;
      }
      reveals.push({ route: name, ...pass });
      // preload: false (#52). axe's CSSOM preload re-fetches every cross-origin
      // stylesheet with an XHR, which a site's CSP judges under connect-src, not
      // style-src. A site allowing fonts.googleapis.com for styles only got a
      // real connect-src report posted on every audit, and the failed preload
      // was dropped anyway. Nothing the gate can fail on is lost: in axe-core
      // 4.13 only css-orientation-lock (tagged experimental, so these tags never
      // run it) and no-autoplay-audio (reviewOnFail, so it can only ever be
      // incomplete) read preloaded assets.
      //
      // .options() comes FIRST: it replaces the whole options object, and
      // withTags() writes runOnly into it. Called after, it would drop the tag
      // filter without a word and axe would run every rule it has.
      //
      // reporter: "raw" (#916 review). axe merges each rule's results across
      // frames, and when the rule THREW in any frame its default report keeps
      // only the incomplete group: a color-contrast crash inside a third
      // party's embed erased the site's own contrast violations and passes.
      // The raw report keeps every group and every crash node, in the frame it
      // happened in; readAxeResults (src/audits/util/axe-results.ts) reads it
      // back into the shape below, with the crashes set apart.
      const runAxe = async (rules, excluded) => {
        let builder = new AxeBuilder({ page }).options({ preload: false, reporter: "raw" });
        builder = rules
          ? builder.withRules(rules)
          : builder.withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]);
        // Each excluded node's children are included again, so only the
        // crashed node's own text goes unmeasured -- see reincludedChildren.
        if (excluded.length > 0) {
          builder = builder.include("html");
          for (const selector of excluded) builder = builder.exclude(selector);
          for (const child of await page.evaluate(reincludedChildren, excluded)) {
            builder = builder.include(child);
          }
        }
        return readAxeResults(
          await builder.analyze(),
        );
      };
      const results = await runAxe(null, []);
      // A blend mode axe has no function for (plus-lighter) throws inside the
      // rule and skips it for the whole document -- see
      // src/audits/util/blend-mode.ts. Re-run that rule alone with each node
      // it crashed on excluded, until it stops crashing, so the rest of the
      // page is measured; each excluded node is recorded as not measured. Only
      // a crash in the site's top-level document is re-run around, and
      // anything still crashing after BLEND_RERUN_MAX runs stays a crash and
      // fails below. A crash inside a frame stays a crash too, and the frame
      // split below decides it as it always has.
      const blendRules = [
        ...new Set(results.crashes.filter(isExcludableBlendCrash).map((c) => c.rule)),
      ];
      for (const rule of blendRules) {
        const excluded = [];
        let rerun = { violations: [], passes: [], incomplete: [], crashes: results.crashes.filter((c) => c.rule === rule) };
        for (let round = 0; round < BLEND_RERUN_MAX; round++) {
          const crashing = rerun.crashes.filter(isExcludableBlendCrash);
          if (crashing.length === 0) break;
          for (const c of crashing) excluded.push(c.nodes[0].target[0]);
          rerun = await runAxe([rule], excluded);
        }
        for (const group of ["violations", "passes", "incomplete"]) {
          results[group] = results[group].filter((r) => r.id !== rule).concat(rerun[group]);
        }
        results.crashes = results.crashes.filter((c) => c.rule !== rule).concat(rerun.crashes);
        for (const selector of excluded) {
          let blendMode = null;
          try {
            const handle = await page.evaluateHandle(resolveTargetElement, selector);
            blendMode = await handle.evaluate(unsupportedBlendModeAt);
          } catch {
            blendMode = null;
          }
          blendSkipped.push({ route: name, rule, blendMode, target: [selector] });
        }
      }
      // #888: contrast axe never measured, which an empty violations list
      // cannot tell from legible text. A colour axe cannot parse (Tailwind
      // 4.3's none-hued neutral palette, which Chrome renders fine) reaches it
      // in two shapes, both measured -- see src/audits/util/contrast-unmeasured.ts:
      // per node, as an incomplete "colorParse" entry while the rule runs on
      // (-> contrast-unmeasured, here); or, when the colour sits beneath an
      // opaque background such as a white CTA in a neutral-900 Hero, as a
      // thrown rule that is skipped for that whole document (-> rule-errored,
      // below). The rule's other incomplete reasons (a gradient, an image, an
      // obscured box) belong to the page and are NOT reported.
      //
      // Read after the reveal pass above, like every other result: a node the
      // pass reveals is measured revealed, so a reveal on such a colour lands
      // here instead of dropping out of the rule at opacity 0.
      const unparseable = unparseableContrastNodes(results);
      // Findings derived from axe's incomplete results. They are the site's on
      // the same terms as axe's own violations, so they go through the same
      // cross-origin frame split below: a colour axe cannot parse inside a third
      // party's document is not the site's to fix either.
      const derived = [];
      if (unparseable.length > 0) {
        derived.push({ id: "contrast-unmeasured", impact: "serious", nodes: unparseable });
      }
      // A rule that THREW measured nothing in the document it threw in. This
      // is #888's reported shape: the colour beneath a white CTA made
      // color-contrast throw "Unable to parse color ... Skipping color-contrast
      // rule." Each crash is one node in the frame it happened in, so it goes
      // through the frame split like everything else: a crash inside a third
      // party's frame is counted, never failed, and one in the site's own
      // document -- or one with no node to attribute -- fails, because the
      // site's own results for that rule were never produced there.
      for (const crash of results.crashes) {
        const errored = {
          id: "rule-errored",
          impact: "serious",
          help: ruleErroredHelp(crash.rule, crash.message, unparseableColourRemedy),
          helpUrl: crash.helpUrl,
          nodes: crash.nodes,
        };
        if (errored.nodes.length > 0) derived.push(errored);
        else violations.push({ ...errored, route: name });
      }
      const candidates = [...results.violations, ...derived];
      // Cross-origin frame CONTENTS do not count against the site. The reveal
      // pass brings lazy third-party iframes (a Google Maps footer, a YouTube
      // player) into load range; their documents' violations are not the
      // site's to fix, and whether axe reached them at all depended on
      // injecting into them inside a 1 s window. So a node is dropped here --
      // counted, and named in the summary, never silently -- only on positive
      // evidence: a frame on its path loaded a document from another origin.
      //
      // Default mode, deliberately. Legacy mode (setLegacyMode) skips those
      // frames too, but it also drops frame-focusable-content, which axe can
      // only evaluate INSIDE the frame and which is the site's own defect (an
      // iframe given tabindex=-1 whose document still has something to focus).
      // splitCrossOriginFrameNodes keeps every frame-focusable-content node.
      const foreignPaths = [];
      const checkedPaths = [];
      for (const v of candidates) {
        for (const n of v.nodes) {
          const t = n.target;
          if (!Array.isArray(t) || t.length < 2) continue;
          const key = JSON.stringify(t.slice(0, -1));
          if (checkedPaths.includes(key)) continue;
          checkedPaths.push(key);
          if (await pathIsForeign(t.slice(0, -1))) foreignPaths.push(key);
        }
      }
      const split = splitCrossOriginFrameNodes(candidates, foreignPaths);
      frameNodesDropped.push({ route: name, count: split.dropped, rules: split.rules });
      for (const v of split.kept) {
        violations.push({
          id: v.id,
          impact: v.impact ?? "moderate",
          route: name,
          // contrast-unmeasured's help IS its summary line in CI, so it is
          // written from the nodes that were kept. It carries the count (how
          // blind was the run), the colour axe rejected (what to change) and
          // the remedy -- an alarm without a remedy just gets muted.
          help:
            v.id === "contrast-unmeasured"
              ? contrastUnmeasuredHelp(v.nodes, unparseableColourRemedy)
              : v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({ html: n.html, target: n.target })),
        });
      }
      // Coverage as a NUMBER, not a boolean. The unit that matters is nodes --
      // "0 where it should have been 61" -- and a presence flag is satisfied by
      // one passing node while sixty go unmeasured, which is the very failure
      // above.
      const counts = {};
      for (const r of results.passes ?? []) counts[r.id] = (r.nodes ?? []).length;
      measured.push({ route: name, ruleNodes: counts });
    } finally {
      // Say whose this route's errors were while its frames can still be read,
      // then end on about:blank, so an error that route A's timers or pending
      // work throw late can never be charged to route B.
      await settleErrors();
      await page.goto("about:blank", { timeout: ABOUT_BLANK_TIMEOUT_MS }).catch(() => {});
    }
  }

  // Hydration smoke check: load real routes (the homepage) and fail on any
  // uncaught client-side error. No axe here -- real routes carry pre-existing
  // a11y debt we don't gate on; we only assert they don't crash on hydrate.
  // HTTP/SSR errors don't fire 'pageerror', so a data-less CI homepage that
  // renders empty-but-valid won't false-fail -- only a real client crash does.
  for (const { path, name } of smokePages) {
    currentRoute = name;
    currentOrigin = originOf(SMOKE_ORIGIN + path);
    await page.goto(SMOKE_ORIGIN + path);
    // Let hydration + first effects run so a TDZ/ReferenceError surfaces.
    await page.waitForTimeout(2000);
    await settleErrors();
    await page.goto("about:blank", { timeout: ABOUT_BLANK_TIMEOUT_MS }).catch(() => {});
  }
  // Anything still held -- an error that arrived after its route's settle --
  // is the site's: with no frame left to read, nothing can move it. Nothing
  // held is ever dropped.
  await settleErrors();

  const byImpact = {};
  for (const v of violations) {
    byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
  }
  if (OUTPUT) {
    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(
      OUTPUT,
      JSON.stringify(
        {
          totalViolations: violations.length,
          byImpact,
          violations,
          skipped,
          reveals,
          frameNodesDropped,
          thirdPartyErrors,
          measured,
          blendUnmeasured: blendSkipped,
        },
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
 * is where the path and HTTP status live -- the id and route alone do not say
 * what went wrong there; so do `rule-errored` and `contrast-unmeasured` (#888),
 * whose help is axe's message or the unparsed colour and its remedy. A
 * `client-error` thrown while the reveal pass ran is marked `(while the reveal
 * pass ran)` — a time window, not a cause — and never folded into one thrown
 * outside it (#100). Empty for no violations.
 */
export function describeViolations(violations: AxeViolation[]): string {
  const groups = new Map<
    string,
    { id: string; route: string; help?: string; duringReveal: boolean; n: number }
  >();
  for (const v of violations) {
    // A client error thrown while the reveal pass ran is kept apart from one
    // thrown outside it, so the two never fold into one entry.
    const duringReveal =
      v.id === "client-error" && (v.help ?? "").startsWith(REVEAL_PASS_ERROR_PREFIX);
    // A rule-errored entry is only as useful as the rule it names, and two
    // rules that threw on one route are two findings (#916 review): fold only
    // identical messages, never a second rule under the first rule's text.
    const ownText = v.id === "rule-errored" ? (v.help ?? "") : "";
    const key = `${v.id}\u0000${v.route}\u0000${duringReveal ? "reveal" : ""}\u0000${ownText}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else {
      groups.set(key, {
        id: v.id,
        route: v.route,
        ...(v.help ? { help: v.help } : {}),
        duringReveal,
        n: 1,
      });
    }
  }
  const entries = [...groups.values()];
  const shown = entries.slice(0, NAMED_VIOLATIONS_MAX).map((g) => {
    const count = g.n > 1 ? ` ×${g.n}` : "";
    // `route-missing`, `rule-errored` and `contrast-unmeasured` (#888) carry
    // their diagnostic in `help`, and for each of them that sentence IS the
    // finding — "rule-errored on a11y fixtures" tells an operator nothing,
    // while axe's own message, or the colour it could not parse and the
    // remedy, tells them exactly what to change. Every other rule's help is
    // generic advice the helpUrl repeats.
    const carriesItsOwnDiagnostic =
      g.id === "route-missing" || g.id === "rule-errored" || g.id === "contrast-unmeasured";
    const detail =
      carriesItsOwnDiagnostic && g.help
        ? ` (${g.help})`
        : g.duringReveal
          ? " (while the reveal pass ran)"
          : "";
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

/**
 * The reveal clause of the summary: every route whose reveal pass (#100) did
 * not finish cleanly, and why. Empty when every pass did, so a clean run keeps
 * its line byte-for-byte.
 *
 * Three ways a pass can stop short, each of which leaves part of the page
 * audited in a state no reader sees:
 *
 *   - it hit its step cap before the bottom, so reveals below that point never
 *     fired;
 *   - finite animations were still running when the settle budget ran out, so
 *     axe sampled them mid-way;
 *   - the page did not come back to the top, so everything scroll-dependent
 *     was measured at the wrong offset.
 *
 * None of them is a defect in the site's markup, which is why they warn and
 * never fail. But a green that quietly covered less than it says is the thing
 * #100 was about, so they are named.
 */
export function describeReveals(reveals: RevealRecord[]): string {
  const incomplete = reveals
    .map((r) => {
      const why: string[] = [];
      if (r.capped) why.push(`stopped at the step cap (${r.steps} steps) before the bottom`);
      if (r.unsettled > 0) {
        why.push(`${r.unsettled} animation${r.unsettled === 1 ? "" : "s"} still running after 5 s`);
      }
      if (r.finalScrollY !== 0) why.push(`left at scrollY ${r.finalScrollY}, not the top`);
      return why.length > 0 ? `${r.route} (${why.join("; ")})` : "";
    })
    .filter((line) => line.length > 0);
  if (incomplete.length === 0) return "";
  const routes = incomplete.length === 1 ? "1 route" : `${incomplete.length} routes`;
  return `reveal pass incomplete on ${routes}: ${incomplete.join(", ")}`;
}

/**
 * The frame clause of the summary: violation nodes inside cross-origin frames
 * that were not counted against the site. Information, never a status change —
 * but never silent either, because a filter nobody can see is how coverage
 * goes missing. Empty when nothing was dropped, so such a run keeps its line
 * byte-for-byte.
 */
export function describeFrameNodesDropped(dropped: FrameNodesDropped[]): string {
  const hit = dropped.filter((d) => d.count > 0);
  if (hit.length === 0) return "";
  const total = hit.reduce((sum, d) => sum + d.count, 0);
  const where = hit.map((d) => `${d.route} (${d.count}: ${d.rules.join(", ")})`).join(", ");
  return `${total} violation node${total === 1 ? "" : "s"} inside cross-origin frames not counted: ${where}`;
}

/**
 * The third-party clause of the summary: uncaught errors that a cross-origin
 * frame's own log recorded, by route and that frame's origin. They do not fail
 * the audit — a third party's embed is not the site's to fix — but they move a
 * clean run to `warn`, because an error the site's page shows its readers is
 * worth knowing about even when it is not the site's code. An error whose
 * stack merely STARTS on another origin is not one of these: a site crashing
 * inside a library it loaded from a CDN is still the site's `client-error`.
 * Empty when there are none.
 */
export function describeThirdPartyErrors(errors: ThirdPartyError[]): string {
  if (errors.length === 0) return "";
  const groups = new Map<string, { route: string; origin: string; n: number }>();
  for (const e of errors) {
    let origin = "unknown origin";
    try {
      if (e.frame) origin = new URL(e.frame).origin;
    } catch {
      // keep "unknown origin"
    }
    const key = `${e.route}\u0000${origin}`;
    const g = groups.get(key);
    if (g) g.n += 1;
    else groups.set(key, { route: e.route, origin, n: 1 });
  }
  const where = [...groups.values()]
    .map((g) => `${g.route} (${g.origin}${g.n > 1 ? ` ×${g.n}` : ""})`)
    .join(", ");
  const n = errors.length;
  return `${n} uncaught error${n === 1 ? "" : "s"} thrown inside cross-origin frames, not counted: ${where}`;
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
    // #100. A reveal pass that stopped short is named and warns, never fails.
    const revealNote = describeReveals(Array.isArray(artifact.reveals) ? artifact.reveals : []);
    const thirdPartyNote = describeThirdPartyErrors(
      Array.isArray(artifact.thirdPartyErrors) ? artifact.thirdPartyErrors : [],
    );
    // Information only: third-party frame contents never change the status.
    const frameNote = describeFrameNodesDropped(
      Array.isArray(artifact.frameNodesDropped) ? artifact.frameNodesDropped : [],
    );
    // A blend mode axe cannot compute is axe's gap, not the site's defect, so
    // it never fails; but contrast went unmeasured there, so it warns.
    const blendNote = describeBlendUnmeasured(
      Array.isArray(artifact.blendUnmeasured) ? artifact.blendUnmeasured : [],
    );
    const absenceDowngrade =
      undeclaredAbsent.length > 0 && absentSkips.some((r) => undeclaredAbsent.includes(r.path));
    const status: AuditResult["status"] = hasSerious
      ? "fail"
      : hasAny ||
          absenceDowngrade ||
          revealNote.length > 0 ||
          thirdPartyNote.length > 0 ||
          blendNote.length > 0
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
      (status === "pass"
        ? `a11y: 0 violations across ${scanned} (${smokeNote})`
        : `a11y: ${artifact.totalViolations} violations across ${scanned}${named ? ` — ${named}` : ""}`) +
      [revealNote, thirdPartyNote, blendNote, frameNote]
        .filter((note) => note.length > 0)
        .map((note) => `; ${note}`)
        .join("");

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

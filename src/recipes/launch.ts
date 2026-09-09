import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult, RecipeResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { selfUpdating } from "./self-updating/index.js";
import { runAudits } from "../audits/index.js";
import { hasRealScores, lighthouseScoresFromResult } from "../audits/lighthouse-airtable.js";
import { writeAuditsToAirtable } from "../audits/write-audits-to-airtable.js";
import { openBase, readAirtableConfig } from "../reports/airtable/client.js";
import type { AirtableBase } from "../reports/airtable/client.js";
import { listWebsites, siteSlug } from "../reports/airtable/websites.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
import {
  createDraft,
  findReportByPeriod,
  updateReportScores,
} from "../reports/airtable/reports.js";
import type { ReportRow } from "../reports/airtable/reports.js";
import type { ReportMirror } from "../reports/report-mirror.js";
import type { SiteMirror } from "../db/site-mirror.js";
import { queueDraft } from "../reports/queue.js";
import { uploadAttachment } from "../reports/airtable/attachments.js";
import { renderReportHtml } from "../reports/render.js";
import { resolveCopy } from "../reports/copy.js";
import type { LighthouseScores } from "../reports/types.js";

export type LaunchStepResult =
  | { kind: "recipe"; result: RecipeResult }
  | { kind: "audit"; results: AuditResult[]; scores: LighthouseScores }
  | { kind: "draft"; report: ReportRow }
  | { kind: "probe"; message: string }
  | { kind: "error"; message: string };

export type LaunchResult = {
  site: string;
  steps: Array<{ name: string; result: LaunchStepResult }>;
  /** True if every step ran (bootstrap + audit + draft); false if a step
   * errored or a recipe `failed` short-circuited the chain. */
  complete: boolean;
};

export type LaunchDeps = {
  /** Bootstrap step (Renovate + protection; ci.yml comes from the starter). Defaults to the real `selfUpdating`. */
  bootstrap?: (site: Site) => Promise<RecipeResult>;
  /** Audit step. Defaults to the real `runAudits`. */
  audit?: (site: Site) => Promise<AuditResult[]>;
  /** Airtable handle. Defaults to opening the live base from credentials. */
  base?: AirtableBase;
  /** #539 Phase 5: Turso write-through for everything this recipe writes — the
   *  Launch row (or a re-run's refreshed scores), the rendered body, and the
   *  queue flag. Wired at the CLI composition root, never defaulted here — the
   *  unit suite calls `launch` with a fake base and must not open a real
   *  libSQL handle. */
  reportMirror?: ReportMirror;
  /** #539 Phase 5: the Websites-row twin — launch writes the site's FIRST audit
   *  results and (on send) its launched status. Injected at the CLI root. */
  siteMirror?: SiteMirror;
  /** HTTP probe for `dev-guard`. Defaults to global fetch. INJECTED in tests:
   *  the suite stubs `global.fetch` for the Airtable attachment upload and that
   *  stub answers 200 to everything — which is precisely the state this step
   *  exists to fail on. */
  probe?: (url: string) => Promise<{ status: number; body: string }>;
};

/** The site's OWN 404. `src/routes/+error.svelte` renders `<h1>{page.status}</h1>`,
 *  so a real SvelteKit 404 from this app carries an `<h1>404</h1>`; a parked
 *  domain, a CDN 404 and a dead host do not. "The route is gone" and "the site
 *  is gone" must not look the same to this gate. */
const SITE_404_MARKER = /<h1[^>]*>\s*404\s*<\/h1>/i;

/** The UNGUARDED twin's OWN refusal. `src/routes/dev/match/[uid]/+page.server.ts`
 *  does `error(404, { message: \`no matching assembly for "${uid}" (have: ...)\` })`
 *  for any uid absent from its assembly map — and that message renders through
 *  the very same `+error.svelte` the guard's 404 uses, so it carries an
 *  `<h1>404</h1>` too. On a site whose uid set lacks "home", a LIVE twin and a
 *  guarded one are byte-indistinguishable to SITE_404_MARKER, and the check
 *  could never fail. Verified on disk: beachfront-dentistry's copy of that route
 *  imports `$app/environment` zero times.
 *
 *  BOTH wordings are covered. The on-disk twin says "no matching assembly for";
 *  the `ROUTE_PAGE` template the `match-harness` recipe will install says "no
 *  assembly for". A marker that knew only the first would go blind the moment
 *  that recipe ships.
 *
 *  This is a DENY clause and only ever a deny — it can refuse a green, never
 *  grant one. Widening it can only ever refuse a launch that would otherwise
 *  have proceeded, so widening is always the safe direction here. */
const UNGUARDED_TWIN_MARKER = /no (matching )?assembly for/i;

const MATCH_ROUTE_DIR = "src/routes/dev/match";

/** Positive evidence that `sitePath` is a SvelteKit checkout at all. Without it,
 *  the absence of MATCH_ROUTE_DIR is evidence of nothing: a path never cloned, a
 *  stale clone, a mistyped site name and the wrong working directory all produce
 *  exactly the same `false`, and `resolveSites` builds the path with
 *  `localPath(resolve(cwd, site))` and no existence check of its own. This is
 *  the filesystem twin of the `/health` control on the deployed gate — an absent
 *  error must never be allowed to grant a green. */
const CHECKOUT_MARKER = "src/routes";

/** Every placement a guard may legitimately take, most-preferred first.
 *
 *  `src/routes/dev/+layout.server.ts` is the STRONGEST, and it is the fleet-wide
 *  class-fix for "dev routes ship in production" (#717): one `load` doing
 *  `if (!dev) error(404)` runs for every `/dev/*` route, `/dev/match/[uid]`
 *  included. Reading only inside `/dev/match` reported such a site as "the
 *  matching twin would ship" — untrue, and it penalised the better fix. It also
 *  contradicted the deployed half of this same feature, which was deliberately
 *  redesigned to survive that class-fix: see the `/health` comment at the
 *  dev-guard step for why the 200 control was moved off `/dev/a11y-fixtures`.
 *
 *  Below it, the `/dev/match` layout covers every child of the twin, present and
 *  future; the page file is the narrowest placement and so the last one tried. */
const MATCH_GUARD_FILES = [
  "src/routes/dev/+layout.server.ts",
  "src/routes/dev/match/+layout.server.ts",
  "src/routes/dev/match/[uid]/+page.server.ts",
] as const;

/** Strip line and block comments, so the COMMON commented-out guard cannot
 *  satisfy the match — an import left in place above `// if (!dev) error(404);`
 *  is the likeliest real-world state, and it used to pass. String and template
 *  literals are skipped so a `//` inside a URL is not read as a comment.
 *
 *  This is a scanner, not a parser, and a REGEX LITERAL DEFEATS IT: a quote
 *  character inside one — `/[a-z0-9']+/` — opens a string that never closes, and
 *  everything to the next matching quote, comment text included, is preserved.
 *  The residual direction is therefore UNDER-strip, not over-strip; an earlier
 *  version of this comment asserted the opposite, and "can only deny" was not
 *  something it could back.
 *
 *  What stops that under-strip granting a pass today is `maskLiterals`, which
 *  `carriesGuard` runs over this output and which misreads the same region the
 *  same way — so the region is blanked rather than believed, and the observed
 *  failure on such a file is a REFUSED real guard, not an accepted absent one.
 *  Read that as one scanner's bug cancelling another's, not as a property
 *  either function guarantees. */
function stripComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length;) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i]!;
        i++;
        if (source[i - 1] === ch) break;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Blank the CONTENTS of string and template literals, keeping the quote
 *  characters, the newlines and the overall length. Only the guard scan uses
 *  this — never the `$app/environment` check, whose whole subject is an import
 *  specifier and therefore is itself a string literal.
 *
 *  It exists because `if (!dev) console.warn("this should throw error(404)")`
 *  read as a refusal. Masking can only ever REMOVE candidate refusal tokens, so
 *  it can only ever deny. Its own edge case is the same one `stripComments` has
 *  — a regex literal containing a quote character opens a literal that never
 *  closes — and there too the failure is over-masking, which denies. */
function maskLiterals(code: string): string {
  let out = "";
  for (let i = 0; i < code.length;) {
    const ch = code[i]!;
    if (ch !== '"' && ch !== "'" && ch !== "`") {
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
    while (i < code.length) {
      const c = code[i]!;
      if (c === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      i++;
      if (c === ch) {
        out += c;
        break;
      }
      out += c === "\n" ? "\n" : " ";
    }
  }
  return out;
}

/** The statement or block the `if (...)` ending at `from` actually governs: a
 *  braced block, or the single statement up to its terminating `;` — or, under
 *  ASI, the end of its line. Bracket depth is tracked so
 *  `error(404, {\n  message: "…"\n});` is ONE statement rather than three
 *  fragments. Expects `code` to be comment-stripped and literal-masked, so every
 *  bracket it sees is a real one. */
function consequentAt(code: string, from: number): string {
  let i = from;
  while (i < code.length && /\s/.test(code[i]!)) i++;
  const start = i;
  if (code[i] === "{") {
    let depth = 0;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) return code.slice(start, i + 1);
    }
    return code.slice(start);
  }
  let depth = 0;
  for (; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return code.slice(start, i);
      depth--;
    } else if (depth === 0 && (ch === ";" || ch === "\n")) return code.slice(start, i);
  }
  return code.slice(start);
}

/** An actual refusal: SvelteKit's `error(404, …)`, or any `throw`. */
const REFUSAL = /\berror\s*\(\s*404|\bthrow\b/;

/** A guard is `$app/environment` + an `if (!dev)` **whose own branch refuses**.
 *
 *  The three conditions used to be ANDed across the WHOLE file, with nothing
 *  tying the refusal to the `if`. Two shapes passed that should not have: a
 *  warn-only `if (!dev)` alongside the route's own unrelated `throw` (the exact
 *  half-fix this comment used to claim was closed), and a refusal occurring only
 *  inside a string. Reading the guard's consequent, on literal-masked source, is
 *  strictly narrower than the old whole-file grep — every input it rejects, the
 *  old predicate also had to reject on `$app/environment` or `if (!dev)`, or was
 *  a false pass. It can therefore only deny, never grant.
 *
 *  It is a contract with plan BC's `ROUTE_SERVER` template, which BC installs
 *  and this pre-flight must accept; tests/recipes/launch.test.ts lifts that
 *  template out of the plan and runs this predicate over it rather than
 *  restating the pattern. */
function carriesGuard(source: string): boolean {
  const code = stripComments(source);
  if (!code.includes("$app/environment")) return false;
  const masked = maskLiterals(code);
  const guards = /if\s*\(\s*!\s*dev\s*\)/g;
  for (let m = guards.exec(masked); m; m = guards.exec(masked)) {
    if (REFUSAL.test(consequentAt(masked, m.index + m[0].length))) return true;
  }
  return false;
}

/**
 * Pre-flight: a checkout that still carries the matching twin must carry the
 * dev guard the `match-harness` recipe installs with it. Nothing is deleted at
 * launch — the harness stays for the next round — so the guard is the whole
 * mechanism keeping `/dev/match/*` off the production build.
 *
 * Filesystem only, and it runs BEFORE any GitHub write: a site that will fail
 * the deployed check should not first acquire branch protection and an audit.
 *
 * Liveness first. `src/routes` has to be there before a missing
 * `src/routes/dev/match` may be read as "this site has no twin" — otherwise the
 * pass is granted by an absence, and four separate operator errors produce that
 * same absence. See CHECKOUT_MARKER.
 */
export async function matchingDisposition(
  sitePath: string,
): Promise<{ ok: boolean; message: string }> {
  if (!existsSync(join(sitePath, CHECKOUT_MARKER))) {
    return {
      ok: false,
      message: `${sitePath} has no ${CHECKOUT_MARKER} — this is not a SvelteKit checkout (never cloned, a stale clone, a mistyped site name, or the wrong working directory), so the twin's disposition cannot be established`,
    };
  }
  if (!existsSync(join(sitePath, MATCH_ROUTE_DIR))) {
    return {
      ok: true,
      message: `no ${MATCH_ROUTE_DIR} in this checkout (${CHECKOUT_MARKER} is present, so the absence is a real one)`,
    };
  }
  const read: string[] = [];
  for (const rel of MATCH_GUARD_FILES) {
    let source: string;
    try {
      source = await readFile(join(sitePath, rel), "utf-8");
    } catch {
      continue;
    }
    read.push(rel);
    if (carriesGuard(source)) {
      // Deliberately NOT "the twin is guarded in production". This function reads
      // source text on disk; it cannot observe the deployed build, and a field
      // that can only see configuration must not be named after the thing it
      // cannot see. The deployed behaviour is the `dev-guard` step's job.
      return {
        ok: true,
        message: `${rel} contains dev guard source — \`if (!dev)\` on \`$app/environment\` whose own branch refuses with a 404/throw (source text only; the deployed build is checked at the dev-guard step)`,
      };
    }
  }
  if (read.length === 0) {
    return {
      ok: false,
      message: `${MATCH_ROUTE_DIR} exists but none of ${MATCH_GUARD_FILES.join(", ")} could be read — the twin's disposition cannot be established`,
    };
  }
  return {
    ok: false,
    message: `none of ${read.join(", ")} carries an \`if (!dev)\` guard on \`$app/environment\` whose own branch refuses (\`error(404\` or \`throw\`), once comments are stripped and string contents masked — the matching twin would ship`,
  };
}

/** Undici's defaults are 300s headers + 300s body, and the body timeout is an
 *  INACTIVITY timer — so a trickling origin can hold this open for ~10 minutes,
 *  AFTER the GitHub writes and a full Lighthouse audit have already run.
 *
 *  15s is NOT the house number, and this comment used to imply it was by citing
 *  `audits/function-health.ts`, which is 10s. The 15s call sites are
 *  `audits/netlify-deploy.ts`, `github/gh-rest.ts`, `prismic/models/remote.ts`
 *  and the inline ones in `prospect/pipeline.ts` and `prospect/http-probes.ts`;
 *  `audits/function-health.ts`, `audits/form-e2e.ts`, `audits/browser.ts` and
 *  `prospect/dns.ts` are 10s, `prospect/ownership.ts` 12s, `prospect/crawl.ts`
 *  20s. Each is set for its own workload — see the note on PRISMIC_TIMEOUT_MS.
 *  15s here is a bound on a two-request pre-send check, not a convention.
 *
 *  An abort rejects, and dev-guard treats a rejection as a refusal, which is the
 *  correct reading: an origin that will not answer has proved nothing. */
const PROBE_TIMEOUT_MS = 15_000;

const defaultProbe = async (url: string): Promise<{ status: number; body: string }> => {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};

/**
 * Launch a site: bootstrap → first-audit → DRAFT a launch email. The M3
 * approve loop is what actually sends; `launch` never sends — it stops at a
 * dashboard-queued draft (`reportType: "Launch"`) carrying the just-audited
 * Lighthouse scores, so `sendOne`'s `report.lighthouse` guard passes.
 *
 * EXECUTION order, stopping on the first error or `failed` recipe:
 *   0. matchingDisposition — filesystem pre-flight, BEFORE any GitHub write.
 *   1. selfUpdating — Renovate + protection (platform auto-merge OFF; ci.yml is the starter's).
 *   2. audit — the Lighthouse scores that feed the draft are collected here.
 *   3. the Websites-row lookup, which supplies the url the next step probes.
 *  3b. dev-guard — the same twin, checked against the DEPLOYED url. It sits
 *      BETWEEN collecting the scores and writing them, so a site that fails it
 *      has been audited but leaves its Websites row untouched.
 *   4. writeAuditsToAirtable — the `audit --write-airtable` writer.
 *   5. createDraft — reportType "Launch", today's period, the audited scores.
 *
 * The REPORTED chain is deliberately not that order. The `audit` step is only
 * pushed once its write succeeds (:261), so the emitted steps read
 * `matching-disposition -> self-updating -> dev-guard -> audit -> draft`, which
 * is what the CLI prints and what tests/recipes/launch.test.ts asserts. Do not
 * renumber either list to match the other: one says when work happens, the
 * other says what has been proved. Only step 0 precedes a GitHub write —
 * dev-guard cannot, because it needs the row from step 3 to know the url.
 */
export async function launch(site: Site, deps: LaunchDeps = {}): Promise<LaunchResult> {
  const label = siteLabel(site);
  const bootstrap = deps.bootstrap ?? selfUpdating;
  const audit = deps.audit ?? runAudits;
  const base = deps.base ?? openBase(readAirtableConfig());
  const probe = deps.probe ?? defaultProbe;

  const steps: Array<{ name: string; result: LaunchStepResult }> = [];
  const stop = (): LaunchResult => ({ site: label, steps, complete: false });

  // 0. Matching disposition — filesystem, before any GitHub write.
  const disposition = await matchingDisposition(site.path);
  steps.push({
    name: "matching-disposition",
    result: disposition.ok
      ? { kind: "probe", message: disposition.message }
      : { kind: "error", message: disposition.message },
  });
  if (!disposition.ok) return stop();

  // 1. Bootstrap.
  let recipe: RecipeResult;
  try {
    recipe = await bootstrap(site);
  } catch (err) {
    steps.push({ name: "self-updating", result: errorOf(err) });
    return stop();
  }
  steps.push({ name: "self-updating", result: { kind: "recipe", result: recipe } });
  if (recipe.status === "failed") return stop();

  // 2. Audit + write scores back to Airtable.
  let results: AuditResult[];
  try {
    results = await audit(site);
  } catch (err) {
    steps.push({ name: "audit", result: errorOf(err) });
    return stop();
  }
  const lhResult = results.find((r) => r.audit === "lighthouse");
  if (!lhResult || !hasRealScores(lhResult)) {
    steps.push({
      name: "audit",
      result: { kind: "error", message: "lighthouse audit produced no real scores" },
    });
    return stop();
  }
  // The launch announcement renders a numeric score per category; a metric that
  // errored this run (now null from lighthouseScoresFromResult) keeps the prior
  // 0 behavior here rather than propagating null into the launch-email path. The
  // Airtable write path (write-audits-to-airtable) keeps the null → shows "—".
  const rawScores = lighthouseScoresFromResult(lhResult);
  const scores: LighthouseScores = {
    performance: rawScores.performance ?? 0,
    accessibility: rawScores.accessibility ?? 0,
    bestPractices: rawScores.bestPractices ?? 0,
    seo: rawScores.seo ?? 0,
  };

  const websites = await listWebsites(base);
  const target = websites.find((w) => siteSlug(w.name) === siteSlug(label));
  if (!target) {
    steps.push({
      name: "audit",
      result: { kind: "error", message: `no Websites row matched site "${label}"` },
    });
    return stop();
  }

  // 2b. The dev guard, on the DEPLOYED build. Two halves, both required:
  //     /dev/match/home must 404 WITH this site's own error page, and /health
  //     must answer 200. Without the second, a dead host, a wrong url and a
  //     parked domain all "pass" the first — an absent error granting a green,
  //     which is the one shape this fleet does not allow. Reading the deployed
  //     url makes this a production-build check by construction; no local build
  //     can substitute.
  //
  //     The control is /health, NOT a /dev/* route. It used to be
  //     /dev/a11y-fixtures, which made this gate require an unguarded dev page
  //     to be publicly reachable in production — so the obvious class-fix for
  //     "dev routes ship in production" (one src/routes/dev/+layout.server.ts
  //     doing `if (!dev) error(404)`) would have taken the control down with it
  //     and failed every correctly-guarded site. /health is a real production
  //     endpoint shipped by the starter and present in all 23 starter-derived
  //     repos, each declaring `prerender = false` — so a 200 from it is still a
  //     live render/function path, not a static file served by the CDN.
  const origin = target.url.replace(/\/+$/, "");
  let twin: { status: number; body: string };
  let control: { status: number; body: string };
  try {
    twin = await probe(`${origin}/dev/match/home`);
    control = await probe(`${origin}/health`);
  } catch (err) {
    steps.push({ name: "dev-guard", result: errorOf(err) });
    return stop();
  }
  if (control.status !== 200) {
    steps.push({
      name: "dev-guard",
      result: {
        kind: "error",
        message: `${origin}/health answered ${control.status}, not 200 — the twin's 404 proves nothing (host down, wrong url, or the site's /health function is not deploying, in which case the function-health audit is failing too)`,
      },
    });
    return stop();
  }
  const unguardedTell = twin.body.match(UNGUARDED_TWIN_MARKER);
  if (unguardedTell) {
    steps.push({
      name: "dev-guard",
      result: {
        kind: "error",
        message: `${origin}/dev/match/home answered ${twin.status} carrying the twin route's OWN "${unguardedTell[0]}" message — the twin is LIVE and merely has no assembly for the uid "home". That is not evidence of a dev guard.`,
      },
    });
    return stop();
  }
  if (twin.status !== 404 || !SITE_404_MARKER.test(twin.body)) {
    steps.push({
      name: "dev-guard",
      result: {
        kind: "error",
        message:
          twin.status === 404
            ? `${origin}/dev/match/home 404s, but not with this site's own error page — cannot tell the guard from a dead route`
            : `${origin}/dev/match/home answered ${twin.status} — the matching twin is live in production`,
      },
    });
    return stop();
  }
  steps.push({
    name: "dev-guard",
    result: {
      kind: "probe",
      message: `${origin}/dev/match/home 404 (site error page), /health 200`,
    },
  });

  try {
    const auditWrite = await writeAuditsToAirtable({
      base,
      websites,
      slug: siteSlug(target.name),
      results,
    });
    // #539 Phase 5: mirror the first-audit write-back. Launch is the ONE path
    // that writes a brand-new site's health, so without this its row reads empty
    // in the console until the next hourly sync.
    if (auditWrite.siteId && auditWrite.fields) {
      await deps.siteMirror?.health(auditWrite.siteId, auditWrite.fields);
    }
  } catch (err) {
    steps.push({ name: "audit", result: errorOf(err) });
    return stop();
  }
  steps.push({ name: "audit", result: { kind: "audit", results, scores } });

  // 3. Draft the launch email (reuses draft.ts's reportId/period scheme). DRAFTS
  //    ONLY — the M3 approve loop sends it and flips Status on send.
  const today = new Date();
  const period = today.toISOString().slice(0, 7);
  const slug = siteSlug(target.name);

  let report: ReportRow;
  try {
    // Re-run dedupe: reuse an existing Launch row for this (site, period) instead
    // of stacking a second draft. findReportByPeriod is the same idempotency
    // lookup draft.ts documents (dashboard/digest point lookup).
    const existing = await findReportByPeriod(base, target.id, "Launch", period);
    if (existing) {
      // Reuse path: the row was created on a prior run with THAT run's scores. This
      // re-run just produced fresh audit scores AND will re-render the preview from
      // them — so refresh the row's Lighthouse cells (+ Completed on) to match,
      // otherwise the sent email (which reads the row) ships stale scores. The
      // create path already writes fresh scores via createDraft.
      await updateReportScores(base, existing.id, scores, today);
      // Mirror the same refresh — see the announce reuse path for why.
      await deps.reportMirror?.patch(existing.id, {
        lighthouse_performance: scores.performance,
        lighthouse_accessibility: scores.accessibility,
        lighthouse_best_practices: scores.bestPractices,
        lighthouse_seo: scores.seo,
        completed_on: today.toISOString().slice(0, 10),
      });
      report = existing;
    } else {
      report = await createDraft(
        base,
        draftInputFor(target, scores, today, period),
        deps.reportMirror?.created,
      );
    }
  } catch (err) {
    steps.push({ name: "draft", result: errorOf(err) });
    return stop();
  }

  // Mirror draft.ts:135-154 — render → upload "Rendered HTML" preview → flip
  // Draft ready. Without setDraftReady the draft never enters the approve queue
  // (every pending-approval gate requires draftReady true), so it can never be
  // approved or sent. The upload is a review convenience; the ready flag is the
  // critical step.
  try {
    const { html } = await renderReportHtml({
      siteName: target.name,
      siteUrl: target.url,
      reportType: "Launch",
      completedOn: today,
      lighthouse: scores,
      lastTestedDate: null,
      commentary: null,
      copy: resolveCopy(target),
      headerImageCid: `${slug}-header`,
    });
    // A preview-upload hiccup must NOT fail the launch — log and continue.
    try {
      await uploadAttachment(
        report.id,
        "Rendered HTML",
        html,
        `${slug}-${today.toISOString().slice(0, 10)}.html`,
        "text/html",
      );
      // The console preview reads the body from Turso, not the attachment.
      await deps.reportMirror?.body(report.id, html);
    } catch (uploadErr) {
      console.warn(
        `⚠ Launch preview upload skipped for ${target.name}: ${
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
        }`,
      );
    }
    // Critical: NOT wrapped — a failure here must surface as a failed launch. queueDraft
    // supersedes any lower-tier (Maintenance/Testing) drafts queued for this site; a Launch is
    // top tier so it only stands down if another Launch/Announcement is already queued.
    await queueDraft(
      base,
      { id: report.id, siteId: target.id, reportType: "Launch" },
      deps.reportMirror,
    );
  } catch (err) {
    steps.push({ name: "draft", result: errorOf(err) });
    return stop();
  }

  steps.push({ name: "draft", result: { kind: "draft", report } });

  return { site: label, steps, complete: true };
}

/** Build the Launch `DraftInput`. reportId/period mirror `draftReportForSite`
 *  (draft.ts) — do not invent a new id scheme. `today`/`period` are threaded in
 *  from `launch()` so a single timestamp drives the render, the draft, the
 *  dedupe lookup, and the preview filename. Launch reports have no period window
 *  and no prior maintenance test, so periodStart/periodEnd/completedOn all
 *  collapse to "today" and `lastTestedDate` is null. */
function draftInputFor(
  target: WebsiteRow,
  scores: LighthouseScores,
  today: Date,
  period: string,
): Parameters<typeof createDraft>[1] {
  const reportType = "Launch" as const;
  const reportId = `${target.name} — ${reportType} — ${today.toISOString().slice(0, 10)}`;
  return {
    reportId,
    siteId: target.id,
    reportType,
    period,
    periodStart: today,
    periodEnd: today,
    completedOn: today,
    lighthouse: scores,
    lastTestedDate: null,
  };
}

function errorOf(err: unknown): LaunchStepResult {
  return { kind: "error", message: err instanceof Error ? err.message : String(err) };
}

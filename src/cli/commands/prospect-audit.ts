import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hostnameOf, isHttpUrl, isPrivateOrLoopbackHost } from "../../util/url.js";
import { reportUrl, reportPrintUrl } from "../../prospect/report-url.js";
import type { FinishedProspectAuditStatus } from "../../db/prospect-audits.js";
import type { Db } from "../../db/client.js";
import type { PipelineDeps, StageName } from "../../prospect/pipeline.js";
import type { ProspectAuditResult } from "../../prospect/types.js";
import type { SendAuditEmailResult } from "../../prospect/email.js";
import type { SiteGoal } from "../../prospect/goals.js";
import { PROSPECT_AUDIT_DAILY_CAP, dailyCapMessage } from "../../prospect/daily-cap.js";

/** The operator-selectable goals, in the order the dispatch dropdown lists
 *  them. `unknown` is deliberately absent: it is a finding the audit can reach
 *  on its own, never something an operator would choose. */
export const GOALS = [
  "book",
  "enquire",
  "call",
  "visit",
  "buy",
  "demo",
  "partner",
] as const satisfies readonly SiteGoal[];

function isSiteGoal(value: string): value is SiteGoal {
  return (GOALS as readonly string[]).includes(value);
}

export type ProspectAuditCliOptions = {
  business?: string;
  /**
   * The one action the site should produce from a visitor, chosen by the
   * operator instead of inferred from the site.
   *
   * Worth overriding because the operator knows things the site does not say.
   * A practice that wants online bookings but has never built one reads as
   * "call" from its own pages, and grading it as "call" would score it well for
   * doing the thing they are trying to stop doing.
   */
  goal?: string;
  /** Comma-separated competitor domains. */
  competitors?: string;
  /** cac sets this false for `--no-probes`. */
  probes?: boolean;
  out?: string;
  json?: boolean;
  /**
   * Email the internal sheet (scores, what wasn't measured and why, top
   * fixes, and the shareable link) to `PROSPECT_AUDIT_RECIPIENTS`, once the
   * report is rendered and the `--out`/Turso delivery attempts finish. A
   * missing/empty recipients var, or a Resend failure, is a warning — never a
   * crash — because by the time this runs the audit is already delivered (or
   * recovered) by the code above it.
   */
  email?: boolean;
  /**
   * #676. Search terms and buyer questions chosen by hand, comma-separated.
   *
   * Blank generates them, exactly as before — this is an override for a client
   * we already know, and for a comparison over time, where the terms have to
   * stay fixed between runs.
   */
  terms?: string;
  questions?: string;
  /** Test seam: injected pipeline deps. Never set from the CLI. */
  deps?: PipelineDeps;
  /**
   * Test seam: the database the run reserves its slot in and persists to.
   * Never set from the CLI — the real implementation opens Turso from env.
   * Opened ONCE per run and shared by the reservation and the persist, because
   * the persist finishes the very row the reservation wrote (#907).
   */
  openDb?: () => Promise<Db>;
  /** Test seam: injectable clock for the cap's 24h window. */
  now?: () => Date;
};

type RecoveryWrite = { htmlPath: string; jsonPath: string };

function fail(message: string): { output: string; code: number } {
  return { output: message, code: 2 };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scoreLine(label: string, value: number | null): string {
  return `${label.padEnd(14)} ${value === null ? "not measured" : String(value).padStart(3)}`;
}

/** Item 3: the `status` column exists to answer, without deserializing the
 *  whole result_json, whether this was a clean run or a degraded one. crawl
 *  is excluded — it's the one fatal stage (see pipeline.ts), so by the time a
 *  ProspectAuditResult exists it was always ok. Every other stage's
 *  StageResult already collapses "failed" and "deliberately skipped"
 *  (--no-probes, the checks→analyze cascade) into the same `ok: false` — both
 *  mean the report has a "not measured" section, so both count as partial
 *  here too. */
function auditStatus(result: ProspectAuditResult): FinishedProspectAuditStatus {
  const allStagesOk =
    result.checks.ok && result.lighthouse.ok && result.analyze.ok && result.probes.ok;
  return allStagesOk ? "complete" : "partial";
}

/** Filesystem-safe, never empty. Collapses anything outside [a-z0-9.-] to a
 *  single dash so a hostname becomes a sane filename fragment. */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "prospect";
}

/**
 * Last-resort write when NEITHER `--out` nor the database persist made it —
 * the one situation a paid, already-run audit must never end in silently. Lands
 * in `reports/`, mirroring header-image.ts's own convention for CLI-written
 * artifacts (mkdir -p, resolved against cwd), rather than a bare file dropped
 * into whatever directory the operator happened to be standing in when they
 * ran the command — often unrelated to this repo at all in fleet-tool usage.
 */
async function writeRecoveryFiles(
  result: ProspectAuditResult,
  html: string,
): Promise<RecoveryWrite> {
  const dir = resolve("reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `prospect-audit-${slugify(hostnameOf(result.url))}-${stamp}`;
  const htmlPath = resolve(dir, `${base}.html`);
  const jsonPath = resolve(dir, `${base}.json`);
  await writeFile(htmlPath, html, "utf-8");
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf-8");
  return { htmlPath, jsonPath };
}

function summarize(
  result: ProspectAuditResult,
  link: string | null,
  file: string | null,
  warnings: string[],
  recovery: RecoveryWrite | null,
  email: SendAuditEmailResult | null,
): string {
  const lines = [
    `Prospect audit — ${result.businessName ?? result.url}`,
    "",
    scoreLine("Findability", result.scores.findability),
    scoreLine("Readability", result.scores.readability),
    scoreLine("Answers", result.scores.answers),
    // No AI Visibility line: the score was removed from every presentation
    // surface (web, print, email, here) — the measurement lives on as the
    // report's receipts section, not as a number that reads as ours to move.
  ];
  for (const [name, stage] of [
    ["checks", result.checks],
    ["lighthouse", result.lighthouse],
    ["analyze", result.analyze],
    ["probes", result.probes],
  ] as const) {
    if (!stage.ok) lines.push(`  ! ${name} not measured — ${stage.error}`);
  }
  if (file) lines.push("", `Report written to ${file}`);
  if (link) lines.push("", `Shareable link: ${link}`);
  if (email?.sent) {
    lines.push("", `Emailed to ${email.recipients.join(", ")} (${email.messageId})`);
  }
  for (const w of warnings) lines.push("", `! ${w}`);
  if (recovery) {
    lines.push(
      "",
      "Neither --out nor the database took this report — wrote a recovery copy instead:",
      `  ${recovery.htmlPath}`,
      `  ${recovery.jsonPath}`,
    );
  }
  return lines.join("\n");
}

/** What the runaway brake concluded before any money was spent. */
type DailyCapCheck =
  /** A slot is held: a `running` row this run must finish (or release). */
  | { kind: "reserved"; db: Db; id: string; token: string }
  | { kind: "over"; count: number }
  /** The brake could not be applied at all — carries the sentence the operator
   *  must see, because a guard that quietly abstains is worse than none. */
  | { kind: "unchecked"; warning: string };

/** Every pipeline stage, classified by whether it pays a third party per call.
 *
 *  `paid`: `analyze` (the model), `probes` (the answer engines) and `accuracy`
 *  (the model again). `free`: everything else — the crawl, the local checks,
 *  the HTTP and DNS probes of the prospect's own site, Lighthouse — costs
 *  runner time only (`basics` names Anthropic and Perplexity only as the bot
 *  user-agents it fetches the prospect's site with). `analyze` alone would not
 *  do as the line: a failed checks stage skips it, and `probes` still runs and
 *  pays.
 *
 *  A record over `StageName`, not a hand-kept set of the paid ones, so that a
 *  stage added to the pipeline without a verdict here fails `tsc` (a missing
 *  key); tests/cli/prospect-audit-stage-cost.test.ts checks the same thing
 *  against the union in `pipeline.ts` at test time. */
export const STAGE_COST = {
  crawl: "free",
  checks: "free",
  lighthouse: "free",
  analyze: "paid",
  probes: "paid",
  assets: "free",
  basics: "free",
  stack: "free",
  siteChecks: "free",
  dns: "free",
  http: "free",
  accessibility: "free",
  accuracy: "paid",
} as const satisfies Record<StageName, "paid" | "free">;

const PAID_STAGES: ReadonlySet<StageName> = new Set(
  (Object.keys(STAGE_COST) as StageName[]).filter((name) => STAGE_COST[name] === "paid"),
);

const NO_DB_CAP_WARNING =
  "No TURSO_DATABASE_URL, so prior audits cannot be counted — the 24h runaway brake " +
  `(cap ${PROSPECT_AUDIT_DAILY_CAP}) is NOT protecting this run.`;

/**
 * MED-15 (2026-09-02): the daily cap was enforced only in the dashboard
 * dispatch path, and every batch to date — including the 29-site corpus — ran
 * through this CLI, which had none. #618 fixed exactly this shape for the
 * private-host guard twenty lines above, and its comment describes the guard it
 * did NOT fix: "one layer at the far end of the chain — so anyone running the
 * CLI directly, or any future second caller, had none."
 *
 * #907: and the cap it then got counted rows this CLI wrote at the very END of
 * a run, so a run was invisible to it for its whole duration and N concurrent
 * starts all passed the same count. It is now a reservation, taken here, before
 * the pipeline: first the cockpit's own reservation for this url if this run is
 * the job the cockpit dispatched (one audit, one slot), otherwise a new
 * `running` row written under the cap in one atomic statement
 * (`reserveProspectAudit`). The persist below finishes that same row.
 *
 * **When there is no database, this WARNS and lets the run proceed.** A run with
 * no persistence cannot count prior audits, and refusing would break the
 * documented `--out`-only local path — which is also, by construction, a
 * one-off: an unpersisted run is invisible to every later count, so it is not
 * the automated path the brake exists for. What it must never do is pass in
 * silence, so the sentence goes to stderr AND into the run's warnings, where
 * `--json` consumers see it too. Same answer if the reservation itself throws:
 * a Turso blip must not block a legitimate audit, but must not look like a
 * passed check either.
 */
async function reserveDailyCapSlot(
  url: string,
  getDb: (() => Promise<Db>) | null,
  now: Date,
  opts: { business: string | undefined; chosenTerms: string[]; chosenQuestions: string[] },
): Promise<DailyCapCheck> {
  if (getDb === null) return { kind: "unchecked", warning: NO_DB_CAP_WARNING };
  try {
    const db = await getDb();
    const { claimProspectAuditReservation, reserveProspectAudit } =
      await import("../../db/prospect-audits.js");
    const claimed = await claimProspectAuditReservation(db, url, now);
    if (claimed) return { kind: "reserved", db, ...claimed };
    const slot = await reserveProspectAudit(
      db,
      {
        url,
        business: opts.business || null,
        chosenTerms: opts.chosenTerms,
        chosenQuestions: opts.chosenQuestions,
        claimed: true,
      },
      { now },
    );
    return slot.kind === "reserved"
      ? { kind: "reserved", db, id: slot.id, token: slot.token }
      : { kind: "over", count: slot.count };
  } catch (err) {
    return {
      kind: "unchecked",
      warning:
        `Could not reserve a slot under the 24h runaway brake (cap ${PROSPECT_AUDIT_DAILY_CAP}), ` +
        `so it is NOT protecting this run: ${errorMessage(err)}`,
    };
  }
}

/**
 * Run one prospect audit end to end. Progress goes to stderr so `--json` stdout
 * stays pipeable. Persistence needs Turso; without it `--out` is mandatory,
 * because an audit nobody can read afterwards is just a bill.
 *
 * By the time `runProspectAudit` resolves, the money is already spent — only
 * the crawl is fatal, every other stage degrades rather than throwing. So the
 * `--out` write and the database persist below are each wrapped in their own
 * try/catch and attempted independently: a bad `--out` path must not cost a
 * working Turso persist (or vice versa), and if BOTH fail — or persist fails
 * with no `--out` given at all — a recovery copy goes to `reports/` rather
 * than the run ending with nothing anywhere. `--json` only changes the SHAPE
 * of stdout; it still runs the same `--out`/persist/recovery logic beneath it.
 */
export async function runProspectAuditCommand(
  url: string,
  opts: ProspectAuditCliOptions,
): Promise<{ output: string; code: number }> {
  if (!isHttpUrl(url)) {
    return fail(`"${url}" is not a URL. Pass the full address, e.g. https://example.com`);
  }
  // #612 review: this validated only the SHAPE. The sole private-address guard
  // was in `triggerProspectAudit` — one layer at the far end of the chain — so
  // anyone running the CLI directly, or any future second caller, had none.
  // `crawlSite` now refuses too; this keeps the refusal a clean message instead
  // of a thrown crawl error.
  if (isPrivateOrLoopbackHost(new URL(url).hostname)) {
    return fail(`"${url}" is a private or loopback address — refusing to audit it.`);
  }
  const canPersist = Boolean(process.env.TURSO_DATABASE_URL);
  if (!canPersist && !opts.out) {
    return fail(
      "No TURSO_DATABASE_URL, so the report cannot be saved or shared. Re-run with --out <file>, or set the Turso credentials.",
    );
  }

  const business = opts.business?.trim();
  const goal = opts.goal?.trim();
  // #676. Comma-separated on a flag (a newline is not typeable in one); the
  // cockpit's textareas split on newlines instead. Both drop blanks, and both
  // treat "nothing usable" as "generate".
  const splitList = (v: string | undefined): string[] =>
    (v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "");
  const chosenTerms = splitList(opts.terms);
  const chosenQuestions = splitList(opts.questions);
  // Every refusal that needs no database comes BEFORE the reservation below: a
  // run refused after taking its slot would hold that slot for nothing (#907).
  if (goal !== undefined && goal !== "" && !isSiteGoal(goal)) {
    return fail(`--goal must be one of: ${GOALS.join(", ")}`);
  }

  // Collected from here on, so the brake's verdict can be recorded BEFORE the
  // pipeline runs — a warning printed only in the summary arrives after the
  // money is spent.
  const warnings: string[] = [];

  // One connection for the whole run: the reservation and the persist must
  // reach the same database, since the persist finishes the reserved row.
  let dbPromise: Promise<Db> | null = null;
  const getDb = canPersist
    ? (): Promise<Db> =>
        (dbPromise ??=
          opts.openDb?.() ??
          import("../../db/client.js").then(({ openDb, readDbConfig }) => openDb(readDbConfig())))
    : null;
  // A failed open must not be cached into the persist: it gets its own try.
  const resetDbAfterFailure = (): void => {
    dbPromise = null;
  };

  // MED-15 / #907. The last refusal before anything is spent, and the slot this
  // run will finish (see reserveDailyCapSlot).
  const now = (opts.now ?? (() => new Date()))();
  const cap = await reserveDailyCapSlot(url, getDb, now, {
    business,
    chosenTerms,
    chosenQuestions,
  });
  if (cap.kind === "over") return fail(dailyCapMessage(cap.count));
  if (cap.kind === "unchecked") {
    resetDbAfterFailure();
    warnings.push(cap.warning);
    console.error(`! ${cap.warning}`);
  }
  const reservation = cap.kind === "reserved" ? cap : null;

  // Whether a paid stage has STARTED. The release below keys on this, not on
  // "the pipeline threw", because the pipeline still runs unwrapped code after
  // the paid stages (goal checklist, fix merging and reconciling, scoring): a
  // deterministic bug there throws after every run has paid, and releasing on
  // it would hand every slot straight back (review of #907). A call that fails
  // can still bill, so "start" is the line, not "ok".
  //
  // A run that throws after that is marked `failed` (P1-16), which counts for
  // the full 24h from the failure. Left `running`, it would stop counting
  // after PROSPECT_AUDIT_STALE_AFTER_MS (2h), and a run that pays and then
  // throws every time would be held to about 25 per 2 hours, not 25 a day.
  let spendStarted = false;
  const onStage = (name: StageName, status: "start" | "ok" | "fail", detail?: string): void => {
    if (status === "start" && PAID_STAGES.has(name)) spendStarted = true;
    if (status === "start") console.error(`… ${name}`);
    else if (status === "ok") console.error(`✓ ${name}`);
    else console.error(`! ${name} — ${detail ?? "failed"}`);
  };

  let result: ProspectAuditResult;
  let html: string;
  try {
    const { runProspectAudit } = await import("../../prospect/pipeline.js");
    result = await runProspectAudit(
      url,
      {
        ...(business ? { business } : {}),
        // An empty string is what a blank dispatch field sends; it must read as
        // "not supplied" so the model's own inference still runs, rather than
        // overriding it with nothing.
        ...(goal ? { goal } : {}),
        ...(opts.competitors
          ? {
              competitors: opts.competitors
                .split(",")
                .map((c) => c.trim())
                .filter(Boolean),
            }
          : {}),
        ...(opts.probes === false ? { probes: false } : {}),
        ...(chosenTerms.length > 0 ? { terms: chosenTerms } : {}),
        ...(chosenQuestions.length > 0 ? { questions: chosenQuestions } : {}),
      },
      { ...(opts.deps ?? {}), onStage },
    );
    // Inside the try: the render runs after every paid stage, so a bug in it
    // throws after the run has paid, like one at the pipeline's tail.
    const { renderProspectReport } = await import("../../prospect/render.js");
    html = renderProspectReport(result);
  } catch (err) {
    // Before any paid stage started — an unresolvable PROSPECT_LLM_AUTH, a
    // failed crawl (the pipeline's one fatal stage) — nothing was bought, so
    // the slot goes back. After one started, the run paid and its slot stays
    // held: the row is marked `failed`, which counts for 24h from now (P1-16).
    // Both are best effort, and the pipeline's own error is what is thrown
    // either way: a failed release or mark leaves the row `running`, held
    // until the stale window.
    if (reservation) {
      try {
        const { failProspectAudit, releaseProspectAuditReservation } =
          await import("../../db/prospect-audits.js");
        if (!spendStarted) {
          // This run's own row (claimed by it, or reserved already claimed).
          await releaseProspectAuditReservation(reservation.db, reservation.id, {
            onlyIfUnclaimed: false,
          });
        } else {
          const failedAt = (opts.now ?? (() => new Date()))();
          const marked = await failProspectAudit(reservation.db, reservation.id, failedAt);
          if (!marked) console.error("! Could not mark the run failed: its reserved row is gone.");
        }
      } catch (markErr) {
        console.error(
          spendStarted
            ? `! Could not mark the run failed: ${errorMessage(markErr)}`
            : `! Could not release the reserved slot: ${errorMessage(markErr)}`,
        );
      }
    }
    throw err;
  }

  let file: string | null = null;
  if (opts.out) {
    try {
      await writeFile(opts.out, html, "utf-8");
      file = opts.out;
    } catch (err) {
      warnings.push(`Could not write --out (${opts.out}): ${errorMessage(err)}`);
    }
  }

  let link: string | null = null;
  let token: string | null = null;
  let auditId: string | null = null;
  if (getDb) {
    try {
      const { createProspectAudit, finishProspectAudit } =
        await import("../../db/prospect-audits.js");
      const db = reservation?.db ?? (await getDb());
      const finished = {
        // Map at the boundary: ProspectAuditResult.businessName is the field
        // name (Item 2 — it's a resolved NAME, not a description); the
        // `prospect_audits.business` column keeps its existing name, since
        // renaming a column needs its own migration for no benefit here.
        business: result.businessName,
        status: auditStatus(result),
        resultJson: JSON.stringify(result),
        // #676: on the ROW, not only in result_json — a re-run reuses them and
        // the /audits listing marks them without reading the blob.
        chosenTerms: chosenTerms.length > 0 ? chosenTerms : null,
        chosenQuestions: chosenQuestions.length > 0 ? chosenQuestions : null,
      };
      // #907: finish the reserved row in place, so the slot it held becomes
      // this report. With no reservation (the brake could not be applied), or
      // one that vanished, insert — a paid report must land somewhere.
      const finishedAt = (opts.now ?? (() => new Date()))();
      const created =
        (reservation
          ? await finishProspectAudit(
              db,
              reservation.id,
              { url: result.url, ...finished },
              finishedAt,
            )
          : null) ?? (await createProspectAudit(db, { url: result.url, ...finished }));
      auditId = created.id;
      token = created.token;
      link = reportUrl(token);
    } catch (err) {
      warnings.push(`Could not save to the database: ${errorMessage(err)}`);
    }
  }

  const delivered = file !== null || link !== null;
  const recovery = delivered ? null : await writeRecoveryFiles(result, html);
  const code = delivered ? 0 : 1;

  // The audit is already delivered (or recovered) above — an email failure
  // must never take that away. Same independent try/catch shape as the
  // --out write and the Turso persist: record a warning, keep going, never
  // touch `code`. Dynamically imported for the same reason db/client.js and
  // prospect/render.js are above: it reaches `resend` (a devDependency) and
  // must stay out of bin.js's static import graph (see bin.ts's
  // central-dep-blocker comment).
  // The PDF leave-behind, printed from the website's print route — a document
  // designed for paper, not the interactive report with its evidence folded
  // away behind disclosures.
  //
  // Best-effort by design. Every other stage in this pipeline degrades rather
  // than throwing, and an attachment is not worth losing a delivered report
  // over: if this fails the email still goes, with the link, and a warning says
  // the PDF is missing. It also needs a token — with no persisted report there
  // is no page to print.
  let pdf: Buffer | null = null;
  if (opts.email && token) {
    try {
      const { renderReportPdf } = await import("../../prospect/pdf.js");
      pdf = await renderReportPdf(reportPrintUrl(token));
    } catch (err) {
      warnings.push(`Could not attach the PDF: ${errorMessage(err)}`);
    }
  }

  let email: SendAuditEmailResult | null = null;
  if (opts.email) {
    try {
      const { sendAuditEmail, parseProspectAuditRecipients } =
        await import("../../prospect/email.js");
      const recipients = parseProspectAuditRecipients(process.env.PROSPECT_AUDIT_RECIPIENTS);
      email = await sendAuditEmail(result, { link, recipients, auditId, pdf });
      if (!email.sent) {
        warnings.push(`Could not email the audit sheet: ${email.reason}`);
      }
    } catch (err) {
      warnings.push(`Could not email the audit sheet: ${errorMessage(err)}`);
    }
  }

  if (opts.json) {
    return {
      output: JSON.stringify(
        { result, out: file, link, token, recovery, warnings, email },
        null,
        2,
      ),
      code,
    };
  }

  return { output: summarize(result, link, file, warnings, recovery, email), code };
}

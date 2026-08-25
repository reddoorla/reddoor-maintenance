import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isHttpUrl } from "../../util/url.js";
import { resolveDashboardBaseUrl } from "../../dashboard/handler-helpers.js";
import type { PipelineDeps, StageName } from "../../prospect/pipeline.js";
import type { ProspectAuditResult } from "../../prospect/types.js";

export type ProspectAuditCliOptions = {
  business?: string;
  /** Comma-separated competitor domains. */
  competitors?: string;
  /** cac sets this false for `--no-probes`. */
  probes?: boolean;
  out?: string;
  json?: boolean;
  /** Test seam: injected pipeline deps. Never set from the CLI. */
  deps?: PipelineDeps;
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
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
): string {
  const lines = [
    `Prospect audit — ${result.business ?? result.url}`,
    "",
    scoreLine("Findability", result.scores.findability),
    scoreLine("Readability", result.scores.readability),
    scoreLine("Answers", result.scores.answers),
    scoreLine("AI Visibility", result.scores.aiVisibility),
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
  const canPersist = Boolean(process.env.TURSO_DATABASE_URL);
  if (!canPersist && !opts.out) {
    return fail(
      "No TURSO_DATABASE_URL, so the report cannot be saved or shared. Re-run with --out <file>, or set the Turso credentials.",
    );
  }

  const { runProspectAudit } = await import("../../prospect/pipeline.js");
  const onStage = (name: StageName, status: "start" | "ok" | "fail", detail?: string): void => {
    if (status === "start") console.error(`… ${name}`);
    else if (status === "ok") console.error(`✓ ${name}`);
    else console.error(`! ${name} — ${detail ?? "failed"}`);
  };

  const business = opts.business?.trim();
  const result = await runProspectAudit(
    url,
    {
      ...(business ? { business } : {}),
      ...(opts.competitors
        ? {
            competitors: opts.competitors
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
          }
        : {}),
      ...(opts.probes === false ? { probes: false } : {}),
    },
    { ...(opts.deps ?? {}), onStage },
  );

  const { renderProspectReport } = await import("../../prospect/render.js");
  const html = renderProspectReport(result);

  const warnings: string[] = [];

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
  if (canPersist) {
    try {
      const { openDb, readDbConfig } = await import("../../db/client.js");
      const { createProspectAudit } = await import("../../db/prospect-audits.js");
      const db = await openDb(readDbConfig());
      const created = await createProspectAudit(db, {
        url: result.url,
        business: result.business,
        resultJson: JSON.stringify(result),
      });
      token = created.token;
      link = `${resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL)}/r/${token}`;
    } catch (err) {
      warnings.push(`Could not save to the database: ${errorMessage(err)}`);
    }
  }

  const delivered = file !== null || link !== null;
  const recovery = delivered ? null : await writeRecoveryFiles(result, html);
  const code = delivered ? 0 : 1;

  if (opts.json) {
    return {
      output: JSON.stringify({ result, out: file, link, token, recovery, warnings }, null, 2),
      code,
    };
  }

  return { output: summarize(result, link, file, warnings, recovery), code };
}

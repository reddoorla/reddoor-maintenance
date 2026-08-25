import { writeFile } from "node:fs/promises";
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

function fail(message: string): { output: string; code: number } {
  return { output: message, code: 2 };
}

function scoreLine(label: string, value: number | null): string {
  return `${label.padEnd(14)} ${value === null ? "not measured" : String(value).padStart(3)}`;
}

function summarize(result: ProspectAuditResult, link: string | null, file: string | null): string {
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
  return lines.join("\n");
}

/**
 * Run one prospect audit end to end. Progress goes to stderr so `--json` stdout
 * stays pipeable. Persistence needs Turso; without it `--out` is mandatory,
 * because an audit nobody can read afterwards is just a bill.
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

  const result = await runProspectAudit(
    url,
    {
      ...(opts.business ? { business: opts.business } : {}),
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

  if (opts.json) return { output: JSON.stringify(result, null, 2), code: 0 };

  const { renderProspectReport } = await import("../../prospect/render.js");
  const html = renderProspectReport(result);

  let file: string | null = null;
  if (opts.out) {
    await writeFile(opts.out, html, "utf-8");
    file = opts.out;
  }

  let link: string | null = null;
  if (canPersist) {
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { createProspectAudit } = await import("../../db/prospect-audits.js");
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: result.url,
      business: result.business,
      resultJson: JSON.stringify(result),
    });
    link = `${resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL)}/r/${token}`;
  }

  return { output: summarize(result, link, file), code: 0 };
}

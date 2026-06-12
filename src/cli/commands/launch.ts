import { resolve } from "node:path";
import { launch, type LaunchResult, type LaunchStepResult } from "../../recipes/launch.js";
import { resolveSites } from "../fleet/resolve-sites.js";

export type LaunchCommandOptions = {
  cwd?: string;
};

function formatStep(name: string, r: LaunchStepResult): string {
  if (r.kind === "error") return `${name.padEnd(20)} error: ${r.message}`;
  if (r.kind === "audit") {
    const s = r.scores;
    return `${name.padEnd(20)} audited (P=${s.performance} A=${s.accessibility} BP=${s.bestPractices} SEO=${s.seo})`;
  }
  if (r.kind === "draft") {
    return `${name.padEnd(20)} drafted ${r.report.reportId}`;
  }
  const rec = r.result;
  if (rec.status === "noop") return `${name.padEnd(20)} noop${rec.notes ? ` — ${rec.notes}` : ""}`;
  if (rec.status === "failed")
    return `${name.padEnd(20)} failed${rec.notes ? ` — ${rec.notes}` : ""}`;
  return `${name.padEnd(20)} applied (${rec.commits.length} commit${rec.commits.length === 1 ? "" : "s"})${rec.notes ? ` — ${rec.notes}` : ""}`;
}

function formatResult(r: LaunchResult): string {
  const header = `[${r.site}] launch — ${r.complete ? "drafted (awaiting approval)" : "STOPPED"}`;
  const body = r.steps.map((s) => formatStep(s.name, s.result)).join("\n");
  return `${header}\n${body}`;
}

/**
 * `launch <site>` — single-site only. Bootstrap (CI + Renovate), first-audit
 * the site, and DRAFT its launch email into the M3 approve queue. Never sends;
 * the operator approves the draft and the next send run delivers the go-live
 * email (flipping Status → maintenance + stamping Launched at).
 */
export async function runLaunchCommand(
  site: string,
  opts: LaunchCommandOptions,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const sites = await resolveSites({ site, cwd });
  const target = sites[0];
  if (!target) {
    return { output: `No site resolved for "${site}".`, code: 1 };
  }

  const result = await launch(target);
  return { output: formatResult(result), code: result.complete ? 0 : 1 };
}

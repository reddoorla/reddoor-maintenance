import { resolve } from "node:path";
import { launch, type LaunchResult, type LaunchStepResult } from "../../recipes/launch.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import {
  LAUNCH_CHECK_STEPS,
  launchCheck,
  parseAllowMissing,
  type LaunchCheckDeps,
  type LaunchCheckStep,
} from "../../recipes/launch-check.js";
import type { LaunchDeps } from "../../recipes/launch.js";

/** The readiness half of `launch`'s deps: the live check, and the steps the
 *  operator allowed. Its own function so a test can see what the CLI wires. */
export function readinessDeps(
  check: LaunchCheckDeps,
  allowMissing: ReadonlySet<LaunchCheckStep>,
): Pick<LaunchDeps, "readiness" | "allowMissing"> {
  return { readiness: (row) => launchCheck(row, check), allowMissing };
}

export type LaunchCommandOptions = {
  cwd?: string;
  allowMissing?: string | string[];
};

export function formatStep(name: string, r: LaunchStepResult): string {
  if (r.kind === "error") return `${name.padEnd(20)} error: ${r.message}`;
  if (r.kind === "audit") {
    const s = r.scores;
    return `${name.padEnd(20)} audited (P=${s.performance} A=${s.accessibility} BP=${s.bestPractices} SEO=${s.seo})`;
  }
  if (r.kind === "draft") {
    return `${name.padEnd(20)} drafted ${r.report.reportId}`;
  }
  if (r.kind === "probe") return `${name.padEnd(20)} ok — ${r.message}`;
  if (r.kind === "readiness") {
    const head = `${name.padEnd(20)} ${r.ready ? "ok" : "NOT READY"}`;
    const lines = r.lines.map((l) => {
      const allowed = l.state !== "ok" && r.allowMissing.has(l.step) ? " (allowed)" : "";
      return `  ${l.step.padEnd(15)} ${l.state.padEnd(10)} ${l.detail}${allowed}`;
    });
    const hint = r.ready
      ? []
      : [
          "  Fix each step (docs/runbooks/site-launch.md), or name it in --allow-missing " +
            `<${LAUNCH_CHECK_STEPS.join("|")}> to launch without it.`,
        ];
    return [head, ...lines, ...hint].join("\n");
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
 * `launch <site>` — single-site only. Bootstrap (Renovate + protection), first-audit
 * the site, and DRAFT its launch email into the M3 approve queue. Never sends;
 * the operator approves the draft and the next send run delivers the go-live
 * email (flipping Status → maintenance + stamping Launched at).
 */
export async function runLaunchCommand(
  site: string,
  opts: LaunchCommandOptions,
): Promise<{ output: string; code: number }> {
  const allow = parseAllowMissing(opts.allowMissing);
  if (!allow.ok) return { output: allow.error, code: 2 };
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const sites = await resolveSites({ site, cwd });
  const target = sites[0];
  if (!target) {
    return { output: `No site resolved for "${site}".`, code: 1 };
  }

  // #539 Phase 5: create-side Turso write, wired at the composition root
  // (see runAnnounceCommand for why it is not defaulted inside the recipe).
  const { makeReportMirror } = await import("../../reports/report-mirror.js");
  const { makeSiteMirror } = await import("../../db/site-mirror.js");
  const { readFleetRoster } = await import("../../fleet/roster.js");
  const { defaultLaunchCheckDeps } = await import("../../recipes/launch-check-io.js");
  const result = await launch(target, {
    ...readinessDeps(await defaultLaunchCheckDeps(), allow.steps),
    roster: () => readFleetRoster(),
    reportMirror: await makeReportMirror(),
    siteMirror: await makeSiteMirror(),
  });
  return { output: formatResult(result), code: result.complete ? 0 : 1 };
}

import { resolve } from "node:path";
import { init, type InitResult, type InitStepResult } from "../../recipes/init.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { siteLabel } from "../../util/site.js";

export type InitCommandOptions = {
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatStep(name: string, r: InitStepResult): string {
  if (r.kind === "error") return `${name.padEnd(20)} error: ${r.message}`;
  if (r.kind === "audit") {
    const lines = r.results.map(
      (a) => `  ${a.audit.padEnd(12)} ${a.status.padEnd(5)} ${a.summary}`,
    );
    return `${name.padEnd(20)} ${r.results.length} audit(s):\n${lines.join("\n")}`;
  }
  const rec = r.result;
  if (rec.status === "noop") return `${name.padEnd(20)} noop${rec.notes ? ` — ${rec.notes}` : ""}`;
  if (rec.status === "failed")
    return `${name.padEnd(20)} failed${rec.notes ? ` — ${rec.notes}` : ""}`;
  return `${name.padEnd(20)} applied (${rec.commits.length} commit${rec.commits.length === 1 ? "" : "s"})${rec.notes ? ` — ${rec.notes}` : ""}`;
}

function formatResult(r: InitResult): string {
  const header = `[${r.site}] init — ${r.complete ? "complete" : "STOPPED"}`;
  const body = r.steps.map((s) => formatStep(s.name, s.result)).join("\n");
  return `${header}\n${body}`;
}

function exitCodeFor(r: InitResult): number {
  if (!r.complete) return 1;
  // A complete chain can still surface a failing audit at the end. Treat
  // any `fail`-status audit as exit 1 so CI signals a regression even when
  // every recipe applied cleanly.
  for (const step of r.steps) {
    if (step.result.kind === "audit" && step.result.results.some((a) => a.status === "fail")) {
      return 1;
    }
  }
  return 0;
}

export async function runInitCommand(
  site: string | undefined,
  opts: InitCommandOptions,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  const results: InitResult[] = [];
  for (const s of sites) {
    try {
      results.push(await init(s));
    } catch (err) {
      // Isolate a per-site throw (e.g. a transient git error) so the rest of the
      // fleet still runs — the same guarantee `runRecipeOverSites` gives the other
      // fleet commands, but `init` returns an `InitResult`, so synthesize a stopped
      // one here rather than reuse the shared helper.
      results.push({
        site: siteLabel(s),
        steps: [
          {
            name: "init",
            result: { kind: "error", message: err instanceof Error ? err.message : String(err) },
          },
        ],
        complete: false,
      });
    }
  }

  const output = results.map(formatResult).join("\n\n");
  const code = results.some((r) => exitCodeFor(r) !== 0) ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}

import { resolve } from "node:path";
import { init, type InitResult, type InitStepResult } from "../../recipes/init.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

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
    cwd,
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: InitResult[] = [];
  for (const s of sites) results.push(await init(s));

  const output = results.map(formatResult).join("\n\n");
  const code = results.some((r) => exitCodeFor(r) !== 0) ? 1 : 0;
  return { output, code };
}

import { resolve } from "node:path";
import { runAudits, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function parseOnly(value: string | undefined): AuditName[] | undefined {
  if (!value) return undefined;
  const names = value.split(",").map((s) => s.trim());
  for (const n of names) {
    if (!ALL_AUDIT_NAMES.includes(n as AuditName)) {
      throw Object.assign(new Error(`unknown audit in --only: ${n}`), { exitCode: 2 });
    }
  }
  return names as AuditName[];
}

function formatTable(results: AuditResult[]): string {
  return results
    .map((r) => `${r.audit.padEnd(12)} ${r.status.padEnd(5)} ${r.site}\n  ${r.summary}`)
    .join("\n");
}

function exitCode(results: AuditResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);
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

  const results: AuditResult[] = [];
  for (const s of sites) {
    const r = await runAudits(s, which);
    results.push(...r);
  }

  const output = opts.json ? JSON.stringify(results, null, 2) : formatTable(results);
  return { output, code: exitCode(results) };
}

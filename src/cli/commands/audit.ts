import { resolve } from "node:path";
import { runAudits, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult } from "../../types.js";

export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
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
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.audit.padEnd(12)} ${r.status.padEnd(5)} ${r.site}\n  ${r.summary}`);
  }
  return lines.join("\n");
}

function exitCode(results: AuditResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const sitePath = resolve(site ?? process.cwd());
  const which = parseOnly(opts.only);
  const results = await runAudits({ path: sitePath }, which);

  const output = opts.json ? JSON.stringify(results, null, 2) : formatTable(results);

  return { output, code: exitCode(results) };
}

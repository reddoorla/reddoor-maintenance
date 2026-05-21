import type { AuditResult, Site } from "../types.js";
import { defaultSpawn, type SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";

type AuditJson = {
  metadata?: {
    vulnerabilities?: {
      low?: number;
      moderate?: number;
      high?: number;
      critical?: number;
    };
  };
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

function classify(v: { low: number; moderate: number; high: number; critical: number }) {
  if (v.critical > 0 || v.high > 0) return "fail" as const;
  if (v.moderate > 0 || v.low > 0) return "warn" as const;
  return "pass" as const;
}

async function tryRun(
  spawn: (cmd: string, args: readonly string[], opts?: { cwd?: string }) => Promise<SpawnResult>,
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<SpawnResult | { missing: true }> {
  try {
    return await spawn(cmd, args, { cwd });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) return { missing: true };
    throw err;
  }
}

export async function securityAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  let used = "pnpm audit";
  let raw: SpawnResult | { missing: true } = await tryRun(
    spawn,
    "pnpm",
    ["audit", "--json", "--prod"],
    site.path,
  );

  if ("missing" in raw) {
    used = "npm audit";
    raw = await tryRun(spawn, "npm", ["audit", "--json", "--omit=dev"], site.path);
  }

  if ("missing" in raw) {
    return {
      audit: "security",
      site: label,
      status: "skip",
      summary: "neither pnpm nor npm is available on PATH",
    };
  }

  // pnpm/npm audit exit codes: 0 = clean, 1 = vulns found. Anything else is a real error.
  if (raw.code !== 0 && raw.code !== 1) {
    return {
      audit: "security",
      site: label,
      status: "skip",
      summary: `${used} exited with code ${raw.code}`,
      details: { stderr: raw.stderr },
    };
  }

  let parsed: AuditJson;
  try {
    parsed = JSON.parse(raw.stdout) as AuditJson;
  } catch (err) {
    return {
      audit: "security",
      site: label,
      status: "skip",
      summary: `${used} produced unparseable JSON`,
      details: { error: String(err), stdout: raw.stdout.slice(0, 500) },
    };
  }

  const vuln = {
    low: parsed.metadata?.vulnerabilities?.low ?? 0,
    moderate: parsed.metadata?.vulnerabilities?.moderate ?? 0,
    high: parsed.metadata?.vulnerabilities?.high ?? 0,
    critical: parsed.metadata?.vulnerabilities?.critical ?? 0,
  };

  const status = classify(vuln);
  const total = vuln.low + vuln.moderate + vuln.high + vuln.critical;
  const summary =
    status === "pass"
      ? `${used}: 0 vulnerabilities`
      : `${used}: ${total} vulnerabilities (${vuln.critical}C/${vuln.high}H/${vuln.moderate}M/${vuln.low}L)`;

  return {
    audit: "security",
    site: label,
    status,
    summary,
    details: vuln,
  };
}

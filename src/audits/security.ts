import type { AuditResult, Site } from "../types.js";
import { defaultSpawn, type SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";

type Severity = "low" | "moderate" | "high" | "critical";

type Counts = { low: number; moderate: number; high: number; critical: number };

type AdvisoryEntry = {
  module: string;
  severity: Severity;
  title: string;
  cves?: string[];
  url?: string;
};

// pnpm audit output (npm-compat with extra advisories map keyed by ID).
type PnpmAuditJson = {
  metadata?: { vulnerabilities?: Partial<Counts> };
  advisories?: Record<
    string,
    {
      id?: number;
      title?: string;
      module_name?: string;
      severity?: string;
      cves?: string[];
      url?: string;
    }
  >;
};

// npm v7+ shape (vulnerabilities keyed by package name).
type NpmAuditJson = {
  metadata?: { vulnerabilities?: Partial<Counts> };
  vulnerabilities?: Record<
    string,
    {
      name?: string;
      severity?: string;
      via?: unknown;
      url?: string;
    }
  >;
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

function classify(v: Counts) {
  if (v.critical > 0 || v.high > 0) return "fail" as const;
  if (v.moderate > 0 || v.low > 0) return "warn" as const;
  return "pass" as const;
}

function normalizeSeverity(s: unknown): Severity {
  if (s === "low" || s === "moderate" || s === "high" || s === "critical") return s;
  return "moderate";
}

function extractAdvisoriesFromPnpm(parsed: PnpmAuditJson): AdvisoryEntry[] {
  const out: AdvisoryEntry[] = [];
  for (const a of Object.values(parsed.advisories ?? {})) {
    if (!a) continue;
    out.push({
      module: a.module_name ?? "unknown",
      severity: normalizeSeverity(a.severity),
      title: a.title ?? "(no title)",
      ...(a.cves ? { cves: a.cves } : {}),
      ...(a.url ? { url: a.url } : {}),
    });
  }
  return out;
}

function extractAdvisoriesFromNpm(parsed: NpmAuditJson): AdvisoryEntry[] {
  const out: AdvisoryEntry[] = [];
  for (const [name, v] of Object.entries(parsed.vulnerabilities ?? {})) {
    if (!v) continue;
    // npm's `via` is either a string (name of upstream package) or an array
    // mixing strings and objects with title/url/cve fields. We try the first
    // object-shaped entry for the title; otherwise fall back to the package
    // name itself.
    let title = name;
    let url: string | undefined;
    if (Array.isArray(v.via)) {
      const detailed = v.via.find(
        (entry): entry is { title?: string; url?: string } =>
          typeof entry === "object" && entry !== null,
      );
      if (detailed) {
        title = detailed.title ?? name;
        url = detailed.url;
      }
    }
    out.push({
      module: v.name ?? name,
      severity: normalizeSeverity(v.severity),
      title,
      ...(url ? { url } : {}),
    });
  }
  return out;
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

  let used: "pnpm audit" | "npm audit" = "pnpm audit";
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

  let parsed: PnpmAuditJson & NpmAuditJson;
  try {
    parsed = JSON.parse(raw.stdout) as PnpmAuditJson & NpmAuditJson;
  } catch (err) {
    return {
      audit: "security",
      site: label,
      status: "skip",
      summary: `${used} produced unparseable JSON`,
      details: { error: String(err), stdout: raw.stdout.slice(0, 500) },
    };
  }

  const counts: Counts = {
    low: parsed.metadata?.vulnerabilities?.low ?? 0,
    moderate: parsed.metadata?.vulnerabilities?.moderate ?? 0,
    high: parsed.metadata?.vulnerabilities?.high ?? 0,
    critical: parsed.metadata?.vulnerabilities?.critical ?? 0,
  };

  const advisories =
    used === "pnpm audit" ? extractAdvisoriesFromPnpm(parsed) : extractAdvisoriesFromNpm(parsed);

  const status = classify(counts);
  const total = counts.low + counts.moderate + counts.high + counts.critical;
  const summary =
    status === "pass"
      ? `${used}: 0 vulnerabilities`
      : `${used}: ${total} vulnerabilities (${counts.critical}C/${counts.high}H/${counts.moderate}M/${counts.low}L)`;

  return {
    audit: "security",
    site: label,
    status,
    summary,
    details: { counts, advisories },
  };
}

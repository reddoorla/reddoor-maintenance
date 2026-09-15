import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { defaultSpawn, type SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { makeGitHubRest, type DependabotAlert } from "../github/gh-rest.js";
import { readGitHubConfig } from "../github/config.js";

type Severity = "low" | "moderate" | "high" | "critical";

type Counts = { low: number; moderate: number; high: number; critical: number };

type AdvisoryEntry = {
  module: string;
  severity: Severity;
  title: string;
  cves?: string[];
  url?: string;
  /** Dependency graph scope from Dependabot ("runtime" | "development"); absent for the
   *  lockfile `pnpm audit` fallback, which carries no per-package scope. Display-only. */
  scope?: "runtime" | "development";
  /** Dependency graph relationship from Dependabot; absent when GitHub reports "unknown"
   *  or for the `pnpm audit` fallback. "transitive" = no direct-dep fix vehicle, so the
   *  auto-fix-attempts counter and the digest treat nightly dispatches as no-ops. */
  relationship?: "direct" | "transitive" | "inconclusive";
};

/** An open alert filed against a manifest that is no longer on the default branch. GitHub's
 *  dependency graph retains a deleted manifest and keeps filing advisories against its frozen
 *  snapshot; no dependency update can ever close one, so it is excluded from the severity
 *  tallies and surfaced as repo hygiene instead of a live vulnerability (#702). */
type GhostAdvisoryEntry = AdvisoryEntry & { manifestPath: string };

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

function classify(v: Counts) {
  if (v.critical > 0 || v.high > 0) return "fail" as const;
  if (v.moderate > 0 || v.low > 0) return "warn" as const;
  return "pass" as const;
}

function normalizeSeverity(s: unknown): Severity {
  if (s === "low" || s === "moderate" || s === "high" || s === "critical") return s;
  // npm/pnpm sometimes emit "info" for informational advisories. Map down
  // rather than defaulting to "moderate" (which would inflate severity).
  return "low";
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

/** Walk an npm v7+ `via` chain to find the root entry whose `via` array
 * contains a real advisory object (rather than another package name string).
 * Returns the package name at the root and the advisory detail. */
function resolveNpmAdvisoryRoot(
  startName: string,
  vulnerabilities: NonNullable<NpmAuditJson["vulnerabilities"]>,
): { rootName: string; detail?: { title?: string; url?: string } } {
  const seen = new Set<string>();
  let current = startName;
  while (!seen.has(current)) {
    seen.add(current);
    const entry = vulnerabilities[current];
    if (!entry || !Array.isArray(entry.via)) return { rootName: current };

    const detailed = entry.via.find(
      (e): e is { title?: string; url?: string } => typeof e === "object" && e !== null,
    );
    if (detailed) return { rootName: current, detail: detailed };

    const next = entry.via.find((e): e is string => typeof e === "string");
    if (!next || next === current) return { rootName: current };
    current = next;
  }
  return { rootName: current };
}

function extractAdvisoriesFromNpm(parsed: NpmAuditJson): AdvisoryEntry[] {
  const vulnerabilities = parsed.vulnerabilities ?? {};
  const roots = new Map<string, AdvisoryEntry>();

  for (const [name, v] of Object.entries(vulnerabilities)) {
    if (!v) continue;
    const { rootName, detail } = resolveNpmAdvisoryRoot(name, vulnerabilities);
    if (roots.has(rootName)) continue; // already surfaced via another transitive entry

    const rootEntry = vulnerabilities[rootName];
    const severity = normalizeSeverity(rootEntry?.severity ?? v.severity);
    const title = detail?.title ?? rootName;
    const url = detail?.url;

    roots.set(rootName, {
      module: rootEntry?.name ?? rootName,
      severity,
      title,
      ...(url ? { url } : {}),
    });
  }

  return [...roots.values()];
}

type ToolResult =
  | { kind: "missing" }
  | { kind: "error"; reason: string }
  | { kind: "ok"; parsed: PnpmAuditJson & NpmAuditJson };

async function runAuditTool(
  spawn: (cmd: string, args: readonly string[], opts?: { cwd?: string }) => Promise<SpawnResult>,
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<ToolResult> {
  let raw: SpawnResult;
  try {
    raw = await spawn(cmd, args, { cwd });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) return { kind: "missing" };
    return { kind: "error", reason: `spawn failed: ${String(err).slice(0, 200)}` };
  }

  // 0 = clean, 1 = vulns found. Anything else is a real error.
  if (raw.code !== 0 && raw.code !== 1) {
    return {
      kind: "error",
      reason: `exit ${raw.code}${raw.stderr ? `: ${raw.stderr.slice(0, 150)}` : ""}`,
    };
  }

  let parsed: PnpmAuditJson & NpmAuditJson;
  try {
    parsed = JSON.parse(raw.stdout || "{}") as PnpmAuditJson & NpmAuditJson;
  } catch (err) {
    return { kind: "error", reason: `unparseable JSON: ${String(err).slice(0, 100)}` };
  }

  // pnpm error envelope: { error: { code, message } }. npm sometimes emits
  // a top-level error too. Either means the audit didn't actually run.
  const errEnvelope = (parsed as unknown as { error?: { code?: string } }).error;
  if (errEnvelope && typeof errEnvelope === "object") {
    return { kind: "error", reason: errEnvelope.code ?? "error envelope returned" };
  }

  // Without metadata.vulnerabilities there are no counts to report and we
  // can't trust the result. An empty `{}` is just as suspect as a missing
  // key — counts default to 0 and we'd silently report "pass". Treat both
  // as a tool failure so the caller can fall through to the other audit.
  const vulnsMeta = parsed.metadata?.vulnerabilities;
  if (!vulnsMeta || Object.keys(vulnsMeta).length === 0) {
    return { kind: "error", reason: "no metadata.vulnerabilities in output" };
  }

  return { kind: "ok", parsed };
}

/** The Dependabot fetch the security audit needs, injectable for tests. The real default is
 *  built from GITHUB_TOKEN; absent token (or a site with no gitRepo) → pnpm/npm audit fallback. */
export type DependabotDeps = {
  listAlerts: (repo: string) => Promise<DependabotAlert[]>;
  /** Whether an alert's `manifestPath` is still on the default branch. Optional: without it
   *  every alert counts, which is the loud direction. A lookup that THROWS also counts the
   *  alert — an API hiccup must never quietly suppress a real vulnerability (#702). */
  manifestExists?: (repo: string, path: string) => Promise<boolean>;
};

function defaultDependabotDeps(): DependabotDeps | null {
  const cfg = readGitHubConfig();
  if (!cfg) return null;
  const gh = makeGitHubRest({ token: cfg.token });
  return {
    listAlerts: (repo) => gh.listDependabotAlerts(repo, { state: "open" }),
    manifestExists: (repo, path) => gh.manifestExists(repo, path),
  };
}

/** Resolve each distinct manifest path once. Returns the set of paths confirmed ABSENT from
 *  the default branch; a path whose lookup errors is treated as present (counted). */
async function absentManifests(
  deps: DependabotDeps,
  repo: string,
  alerts: DependabotAlert[],
  label: string,
): Promise<Set<string>> {
  const absent = new Set<string>();
  if (!deps.manifestExists) return absent;
  const paths = new Set(alerts.flatMap((a) => (a.manifestPath ? [a.manifestPath] : [])));
  for (const path of paths) {
    try {
      if (!(await deps.manifestExists(repo, path))) absent.add(path);
    } catch (e) {
      console.error(
        `[security] ${label}: could not resolve manifest ${path} — counting its alerts: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return absent;
}

/** Map GitHub's severity vocabulary onto the app's. "medium" → "moderate"; an unrecognized
 *  value maps DOWN to "low" rather than inflating (mirrors `normalizeSeverity`). */
function ghSeverityToApp(s: string): Severity {
  if (s === "critical" || s === "high" || s === "low") return s;
  if (s === "medium" || s === "moderate") return "moderate";
  return "low";
}

/** Build a security AuditResult from GitHub Dependabot alerts, or null if the fetch failed so
 *  the caller falls back to `pnpm audit`. ALL open alerts count toward the severity tallies —
 *  the cockpit's auto-patching (amber) vs Renovate-exhausted (red) bands decide urgency, so the
 *  prod/dev scope is carried on each advisory for display only, not used to weight the counts. */
async function dependabotAudit(
  deps: DependabotDeps,
  repo: string,
  label: string,
): Promise<AuditResult | null> {
  let alerts: DependabotAlert[];
  try {
    alerts = await deps.listAlerts(repo);
  } catch (e) {
    // Loud, greppable degradation marker: the caller silently falls back to the
    // weaker lockfile `pnpm audit`, so a systematic token/permission regression
    // would otherwise be invisible across the whole fleet.
    console.error(
      `[security] ${label}: dependabot API failed — degraded to pnpm audit: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }

  const absent = await absentManifests(deps, repo, alerts, label);

  const counts: Counts = { low: 0, moderate: 0, high: 0, critical: 0 };
  const advisories: AdvisoryEntry[] = [];
  const ghostAdvisories: GhostAdvisoryEntry[] = [];
  for (const a of alerts) {
    const severity = ghSeverityToApp(a.severity);
    const entry: AdvisoryEntry = {
      module: a.package,
      severity,
      title: a.summary || "(no title)",
      ...(a.cves.length > 0 ? { cves: a.cves } : {}),
      ...(a.url ? { url: a.url } : {}),
      ...(a.scope ? { scope: a.scope } : {}),
      ...(a.relationship ? { relationship: a.relationship } : {}),
    };
    // A ghost: the manifest GitHub filed this against is gone from the tree. Nothing can
    // fix it (erp-industrial #55, data-dynamiq #41 sat red for five days on exactly this),
    // so it does not feed the tallies — but it is not silent either.
    if (a.manifestPath && absent.has(a.manifestPath)) {
      ghostAdvisories.push({ ...entry, manifestPath: a.manifestPath });
      continue;
    }
    counts[severity] += 1;
    advisories.push(entry);
  }

  const liveStatus = classify(counts);
  const total = counts.low + counts.moderate + counts.high + counts.critical;
  const liveSummary =
    liveStatus === "pass"
      ? ghostAdvisories.length > 0
        ? "Dependabot: 0 live alert(s)"
        : "Dependabot: 0 alerts"
      : `Dependabot: ${total} alert(s) (${counts.critical}C/${counts.high}H/${counts.moderate}M/${counts.low}L)`;

  if (ghostAdvisories.length === 0) {
    return {
      audit: "security",
      site: label,
      status: liveStatus,
      summary: liveSummary,
      details: { counts, advisories },
    };
  }

  // Ghosts alone are a warn, never a fail: the dead manifest is real cruft worth an operator's
  // minute (dismiss the alert as inaccurate, name the deletion commit), but it is not a live
  // vulnerability and must not land the site in the cockpit's Renovate-exhausted band.
  const status = liveStatus === "pass" ? "warn" : liveStatus;
  const manifests = [...new Set(ghostAdvisories.map((g) => g.manifestPath))].join(", ");
  const summary =
    `${liveSummary}; ${ghostAdvisories.length} alert(s) on a manifest GitHub no longer tracks ` +
    `(${manifests}) — dismiss as inaccurate`;
  return {
    audit: "security",
    site: label,
    status,
    summary,
    details: { counts, advisories, ghostAdvisories },
  };
}

export async function securityAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  // Prefer GitHub Dependabot alerts (ground truth: prod+dev, GitHub Advisory DB) for repo-backed
  // sites. The lockfile `pnpm audit` below stays the fallback for sites with no GitHub repo, no
  // token, or a transient API failure — a Dependabot hiccup must never fail an otherwise-fine site.
  if (site.gitRepo) {
    const dependabot = ctx.dependabotDeps ?? defaultDependabotDeps();
    if (dependabot) {
      const viaDependabot = await dependabotAudit(dependabot, site.gitRepo, label);
      if (viaDependabot) return viaDependabot;
    }
  }

  let used: "pnpm audit" | "npm audit" = "pnpm audit";
  let result = await runAuditTool(spawn, "pnpm", ["audit", "--json", "--prod"], site.path);

  // Fall through to npm if pnpm is missing OR pnpm couldn't actually
  // audit the project (e.g., no pnpm-lock.yaml). Previously we only fell
  // through on ENOENT, which meant npm-using sites silently reported "pass"
  // because pnpm returned an error envelope with no metadata.
  if (result.kind !== "ok") {
    const pnpmReason = result.kind === "missing" ? "not installed" : result.reason;
    const npmResult = await runAuditTool(
      spawn,
      "npm",
      ["audit", "--json", "--omit=dev"],
      site.path,
    );
    if (npmResult.kind === "ok") {
      result = npmResult;
      used = "npm audit";
    } else {
      const npmReason = npmResult.kind === "missing" ? "not installed" : npmResult.reason;
      return {
        audit: "security",
        site: label,
        status: "skip",
        summary: `cannot run audit — pnpm: ${pnpmReason}; npm: ${npmReason}`,
      };
    }
  }

  const parsed = result.parsed;

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

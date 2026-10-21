import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { defaultSpawn, type SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { makeGitHubRest, type DependabotAlert } from "../github/gh-rest.js";
import { readGitHubConfig } from "../github/config.js";

type Severity = "low" | "moderate" | "high" | "critical";

type Counts = { low: number; moderate: number; high: number; critical: number };

type AdvisoryIdentity = { module: string; title: string; cves?: string[]; ghsa?: string };

type AdvisoryEntry = {
  module: string;
  severity: Severity;
  title: string;
  cves?: string[];
  url?: string;
  /** The GitHub advisory id (GHSA-…), when the source names one: pnpm's `github_advisory_id` or
   *  advisory `url`, the `url` of the npm `via` detail the entry's title comes from, Dependabot's
   *  `ghsa_id`. What the merged audit dedupes on first, within one module (#1409). */
  ghsa?: string;
  /** Dependency graph scope from Dependabot ("runtime" | "development"); absent for the
   *  lockfile `pnpm audit` fallback, which carries no per-package scope. Display-only. */
  scope?: "runtime" | "development";
  /** Dependency graph relationship from Dependabot, or for the lockfile fallback whether
   *  `package.json` names the module; absent when GitHub reports "unknown" or `package.json`
   *  cannot be read. "transitive" = no direct-dep fix vehicle, so the
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
      github_advisory_id?: string;
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

/** A GHSA id inside an advisory URL (`https://github.com/advisories/GHSA-…`), as both pnpm and
 *  npm audit link their advisories. */
function ghsaFromUrl(url: string | undefined): string | undefined {
  return /\bGHSA(?:-[0-9a-z]{4}){3}\b/i.exec(url ?? "")?.[0];
}

function extractAdvisoriesFromPnpm(parsed: PnpmAuditJson): AdvisoryEntry[] {
  const out: AdvisoryEntry[] = [];
  for (const a of Object.values(parsed.advisories ?? {})) {
    if (!a) continue;
    const ghsa = a.github_advisory_id || ghsaFromUrl(a.url);
    out.push({
      module: a.module_name ?? "unknown",
      severity: normalizeSeverity(a.severity),
      title: a.title ?? "(no title)",
      ...(a.cves ? { cves: a.cves } : {}),
      ...(a.url ? { url: a.url } : {}),
      ...(ghsa ? { ghsa } : {}),
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
    // npm's `via` detail carries no CVE list; its url names the GHSA, which the merge dedupes on.
    // Only that one via's GHSA: an alert on a later via's GHSA is not deduped, which can only
    // over-count, never read clean.
    const ghsa = ghsaFromUrl(url);

    roots.set(rootName, {
      module: rootEntry?.name ?? rootName,
      severity,
      title,
      ...(url ? { url } : {}),
      ...(ghsa ? { ghsa } : {}),
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
      ...(a.ghsaId ? { ghsa: a.ghsaId } : {}),
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
  const summary = `${liveSummary}; ${ghostClause(ghostAdvisories)}`;
  return {
    audit: "security",
    site: label,
    status,
    summary,
    details: { counts, advisories, ghostAdvisories },
  };
}

/** The summary's note on ghost alerts, shared by Dependabot's own summary and the merged one. */
function ghostClause(ghosts: GhostAdvisoryEntry[]): string {
  const manifests = [...new Set(ghosts.map((g) => g.manifestPath))].join(", ");
  return (
    `${ghosts.length} alert(s) on a manifest GitHub no longer tracks ` +
    `(${manifests}) — dismiss as inaccurate`
  );
}

/** True when `pnpm-lock.yaml` holds more than one YAML document. pnpm 12 writes its own
 *  `packageManagerDependencies` as a first document and the project's dependencies as a second;
 *  GitHub's dependency graph reads only the first, so Dependabot sees pnpm and nothing else and
 *  answers "0 alerts" for every advisory in the tree (caltex-landing's graph listed 22 packages,
 *  all pnpm binaries and Actions, while `pnpm audit` found sharp's GHSA-wq5f-xc86-pv6w; P1-54).
 *  An unreadable lockfile is false: no evidence, so Dependabot stays the source. */
async function lockfileHiddenFromDependencyGraph(dir: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(join(dir, "pnpm-lock.yaml"), "utf8");
  } catch {
    return false;
  }
  return (text.match(/^lockfileVersion:/gm) ?? []).length > 1;
}

/** The packages `package.json` names itself, or null when it cannot be read or the site is a
 *  workspace (a package declared in a member's own `package.json` would wrongly read as
 *  transitive, which mutes the auto-fix counter). An aliased dependency (`"img": "npm:sharp@…"`)
 *  counts under the package it installs. An advisory on one of them has a direct-dep fix vehicle;
 *  any other is transitive. The lockfile audit carries no relationship of its own, and without
 *  one every transitive advisory would read as a failed direct auto-fix. */
async function directDependencies(dir: string): Promise<Set<string> | null> {
  try {
    const workspace = await readFile(join(dir, "pnpm-workspace.yaml"), "utf8");
    if (/^packages:/m.test(workspace)) return null;
  } catch {
    // No workspace file: a single-package site.
  }
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const names = new Set<string>();
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, spec] of Object.entries(deps)) {
        names.add(name);
        const alias = typeof spec === "string" ? /^npm:(@?[^@]+)/.exec(spec) : null;
        if (alias) names.add(alias[1]!);
      }
    }
    return names;
  } catch {
    return null;
  }
}

export async function securityAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  // Prefer GitHub Dependabot alerts (ground truth: prod+dev, GitHub Advisory DB) for repo-backed
  // sites. The lockfile `pnpm audit` below stays the fallback for sites with no GitHub repo, no
  // token, or a transient API failure — a Dependabot hiccup must never fail an otherwise-fine site.
  // A lockfile the dependency graph cannot read makes Dependabot's npm answer empty, not clean, but
  // its alerts on what the graph does see (Actions, the pnpm binary) are still real: take both.
  if (site.gitRepo) {
    const dependabot = ctx.dependabotDeps ?? defaultDependabotDeps();
    if (dependabot) {
      const viaDependabot = await dependabotAudit(dependabot, site.gitRepo, label);
      if (viaDependabot && !(await lockfileHiddenFromDependencyGraph(site.path)))
        return viaDependabot;
      if (viaDependabot) {
        console.error(
          `[security] ${label}: pnpm-lock.yaml has more than one YAML document, which GitHub's ` +
            `dependency graph cannot read — adding pnpm audit to Dependabot`,
        );
        // Every scope, not --prod: Dependabot counts dev-scope alerts too, and this audit stands
        // in for what Dependabot cannot see (#1408).
        const viaLockfile = await lockfileAudit(spawn, site.path, label, "all");
        if (viaLockfile.status !== "skip") return mergeAudits(viaLockfile, viaDependabot);
        // The lockfile audit could not run. Dependabot's live alerts are still real, so a skip
        // must not throw them away and leave the row's older counts standing (#1561). With none,
        // its "0" only means it saw nothing, and writing it would read as clean: skip. With some,
        // the result is partial: it saw no npm package, so the write may raise the row's counts
        // but never lower them (`partial`, read by planAuditWrite).
        return hasLiveCounts(viaDependabot)
          ? {
              ...viaDependabot,
              summary:
                `${viaDependabot.summary}; the lockfile audit could not run ` +
                `(${viaLockfile.summary}), so this counts only what GitHub's dependency graph sees`,
              details: { ...(viaDependabot.details as object), partial: true },
            }
          : viaLockfile;
      }
    }
  }
  return lockfileAudit(spawn, site.path, label, "prod");
}

/** True when a Dependabot result tallies at least one live alert (ghosts do not count). */
function hasLiveCounts(result: AuditResult): boolean {
  const counts = (result.details as { counts?: Record<string, number> } | undefined)?.counts;
  return !!counts && Object.values(counts).some((n) => n > 0);
}

/** The lockfile audit: `pnpm audit`, else `npm audit`, else skip (which writes no counts).
 *  `scope` "prod" audits production dependencies only (the stand-alone fallback); "all" adds
 *  devDependencies, for the merge with Dependabot, whose tallies count every scope. */
async function lockfileAudit(
  spawn: NonNullable<AuditContext["spawn"]>,
  dir: string,
  label: string,
  scope: "prod" | "all",
): Promise<AuditResult> {
  let used: "pnpm audit" | "npm audit" = "pnpm audit";
  const pnpmArgs = scope === "prod" ? ["audit", "--json", "--prod"] : ["audit", "--json"];
  const npmArgs = scope === "prod" ? ["audit", "--json", "--omit=dev"] : ["audit", "--json"];
  let result = await runAuditTool(spawn, "pnpm", pnpmArgs, dir);

  // Fall through to npm if pnpm is missing OR pnpm couldn't actually
  // audit the project (e.g., no pnpm-lock.yaml). Previously we only fell
  // through on ENOENT, which meant npm-using sites silently reported "pass"
  // because pnpm returned an error envelope with no metadata.
  if (result.kind !== "ok") {
    const pnpmReason = result.kind === "missing" ? "not installed" : result.reason;
    const npmResult = await runAuditTool(spawn, "npm", npmArgs, dir);
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

  const direct = await directDependencies(dir);
  const advisories = (
    used === "pnpm audit" ? extractAdvisoriesFromPnpm(parsed) : extractAdvisoriesFromNpm(parsed)
  ).map((a): AdvisoryEntry =>
    direct ? { ...a, relationship: direct.has(a.module) ? "direct" : "transitive" } : a,
  );

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

/** Whether two advisories are the same one. Only ever within one module; there, a shared GHSA id
 *  decides when both carry one, else a shared CVE, else the title (#1409: the two sources word
 *  titles differently, so a title match alone misses a duplicate). Also the identity a partial
 *  run's write-back keeps stored advisories by (#1561), so it takes a persisted one too. */
export function sameAdvisory(a: AdvisoryIdentity, b: AdvisoryIdentity): boolean {
  // Always within one module: one GHSA can cover several packages (GHSA-67hx-6x53-jw92 names
  // babel-traverse and @babel/traverse), and each is its own fix.
  if (a.module !== b.module) return false;
  if (a.ghsa && b.ghsa) return a.ghsa.toUpperCase() === b.ghsa.toUpperCase();
  if (a.cves?.length && b.cves?.length) return a.cves.some((c) => b.cves!.includes(c));
  return a.title === b.title;
}

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

/** One advisory both sources report. Each field that decides urgency takes the louder answer,
 *  whichever source came first: the higher severity; relationship "direct" if either says so,
 *  "transitive" only if both do (a missing relationship never mutes the auto-fix escalation, and
 *  pnpm leaves it missing on purpose for a workspace), else absent; scope "runtime" if either says
 *  so, else whichever scope is known. Display fields (title, url) and ids come from the kept
 *  entry, with the other's filling a gap, so a later alert must agree on the adopted ids. */
function combineAdvisories(kept: AdvisoryEntry, other: AdvisoryEntry): AdvisoryEntry {
  const severity =
    SEVERITY_ORDER[other.severity] > SEVERITY_ORDER[kept.severity] ? other.severity : kept.severity;
  const relationship =
    kept.relationship === "direct" || other.relationship === "direct"
      ? "direct"
      : kept.relationship === other.relationship
        ? kept.relationship
        : undefined;
  const scope =
    kept.scope === "runtime" || other.scope === "runtime" ? "runtime" : (kept.scope ?? other.scope);
  const { relationship: _r, scope: _s, ...rest } = { ...other, ...kept };
  return {
    ...rest,
    severity,
    ...(relationship ? { relationship } : {}),
    ...(scope ? { scope } : {}),
  };
}

/** One result from the lockfile audit and Dependabot, for a repo whose lockfile the dependency
 *  graph cannot read. A Dependabot advisory the lockfile audit already carries is counted once.
 *  Per severity the count is the larger of the merged advisories and pnpm's own metadata count,
 *  never their sum (#1411): pnpm's metadata may count per path, so adding Dependabot's per-alert
 *  tallies mixed units, while taking the larger keeps a severity pnpm counts without (full)
 *  advisory detail from reading clean. The cost: when pnpm's detail-less count and the merged
 *  advisories are different vulnerabilities, a severity can read low by that many, though never
 *  zero where either side has one, so the status never changes. Dependabot's ghost alerts ride
 *  along, with only their own clause in the summary (#1410): Dependabot's live count is already
 *  inside the merged one. */
function mergeAudits(lockfile: AuditResult, dependabot: AuditResult): AuditResult {
  const lock = lockfile.details as { counts: Counts; advisories: AdvisoryEntry[] };
  const dep = dependabot.details as {
    advisories: AdvisoryEntry[];
    ghostAdvisories?: GhostAdvisoryEntry[];
  };
  const advisories = [...lock.advisories];
  // pnpm's metadata, less each of its advisories that the merge moved to a higher severity, so
  // the max below does not count that advisory again at its old severity.
  const lockCounts: Counts = { ...lock.counts };
  for (const a of dep.advisories) {
    // Against the growing list, so two Dependabot alerts on one advisory (one per manifest)
    // count once.
    const i = advisories.findIndex((m) => sameAdvisory(m, a));
    if (i === -1) {
      advisories.push(a);
      continue;
    }
    advisories[i] = combineAdvisories(advisories[i]!, a);
  }
  lock.advisories.forEach((original, i) => {
    if (advisories[i]!.severity !== original.severity) {
      lockCounts[original.severity] = Math.max(0, lockCounts[original.severity] - 1);
    }
  });
  const counts: Counts = { low: 0, moderate: 0, high: 0, critical: 0 };
  for (const a of advisories) counts[a.severity] += 1;
  for (const sev of Object.keys(counts) as Severity[]) {
    counts[sev] = Math.max(counts[sev], lockCounts[sev]);
  }
  const ghosts = dep.ghostAdvisories ?? [];
  const liveStatus = classify(counts);
  const status = liveStatus === "pass" && ghosts.length > 0 ? "warn" : liveStatus;
  const total = counts.low + counts.moderate + counts.high + counts.critical;
  const tool = `${lockfile.summary.split(":")[0]} + Dependabot`;
  const summary =
    liveStatus === "pass"
      ? `${tool}: 0 vulnerabilities`
      : `${tool}: ${total} vulnerabilities (${counts.critical}C/${counts.high}H/${counts.moderate}M/${counts.low}L)`;
  return {
    audit: "security",
    site: lockfile.site,
    status,
    summary: ghosts.length > 0 ? `${summary}; ${ghostClause(ghosts)}` : summary,
    details:
      ghosts.length > 0 ? { counts, advisories, ghostAdvisories: ghosts } : { counts, advisories },
  };
}

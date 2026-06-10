import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { baselineVersions } from "../configs/baseline-versions.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import { scanOutdated, type OutdatedCounts } from "./deps-outdated.js";

export type Drift = "same" | "patch" | "minor" | "major" | "newer";

export type DepsDriftEntry = {
  pkg: string;
  baseline: string;
  actual: string;
  drift: Drift;
};

/** The deps audit reports TWO signals:
 *  - `entries`: declared-range drift vs the canonical baseline (what the
 *    package.json *asks for*, caret-stripped) — the long-standing signal.
 *  - `outdated`: real installed-version drift vs the registry's latest, from
 *    the committed lockfile (null when it can't be determined). Added so the
 *    "Deps Drifted" dashboard number stops being the only — and misleading —
 *    deps signal. */
export type DepsDetails = {
  entries: DepsDriftEntry[];
  outdated: OutdatedCounts | null;
};

function stripCaret(range: string): string {
  return range.replace(/^[\^~]/, "");
}

function parseSemver(v: string): [number, number, number] {
  const cleaned = stripCaret(v).split("-")[0] ?? "0.0.0";
  const parts = cleaned.split(".").map((n) => Number.parseInt(n, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareSemver(actual: string, baseline: string): Drift {
  const [aMajor, aMinor, aPatch] = parseSemver(actual);
  const [bMajor, bMinor, bPatch] = parseSemver(baseline);
  if (aMajor > bMajor) return "newer";
  if (aMajor < bMajor) return "major";
  if (aMinor > bMinor) return "newer";
  if (aMinor < bMinor) return "minor";
  if (aPatch > bPatch) return "newer";
  if (aPatch < bPatch) return "patch";
  return "same";
}

export async function depsAudit(ctx: AuditContext): Promise<AuditResult> {
  const pkgPath = join(ctx.site.path, "package.json");
  let pkgRaw: string;
  try {
    pkgRaw = await readFile(pkgPath, "utf-8");
  } catch (err) {
    return {
      audit: "deps",
      site: siteLabel(ctx.site),
      status: "skip",
      summary: `no package.json at ${pkgPath}`,
      details: { error: String(err) },
    };
  }

  const pkg = JSON.parse(pkgRaw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  const entries: DepsDriftEntry[] = [];
  for (const [name, baseline] of Object.entries(baselineVersions)) {
    const actual = installed[name];
    if (!actual) continue;
    entries.push({
      pkg: name,
      baseline,
      actual,
      drift: compareSemver(actual, baseline),
    });
  }

  const anyMajor = entries.some((d) => d.drift === "major");
  const anyMinor = entries.some((d) => d.drift === "minor");
  const anyNewer = entries.some((d) => d.drift === "newer");

  // Status stays driven by the declared-range baseline drift (unchanged
  // behavior). The outdated count is an independent, informational signal.
  const status: AuditResult["status"] = anyMajor ? "fail" : anyMinor || anyNewer ? "warn" : "pass";

  const driftSummary =
    status === "pass"
      ? `all ${entries.length} tracked deps in line with baseline`
      : status === "warn"
        ? `${entries.filter((d) => d.drift !== "same").length} of ${entries.length} tracked deps drifted`
        : `${entries.filter((d) => d.drift === "major").length} deps lagging by a major version`;

  const outdated = await scanOutdated(ctx.site.path, ctx.spawn ?? defaultSpawn);
  const summary = outdated
    ? `${driftSummary}; ${outdated.outdated} outdated install(s) (${outdated.major} major)`
    : driftSummary;

  return {
    audit: "deps",
    site: siteLabel(ctx.site),
    status,
    summary,
    details: { entries, outdated } satisfies DepsDetails,
  };
}

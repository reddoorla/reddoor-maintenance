import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult, Site } from "../types.js";
import { baselineVersions } from "../configs/baseline-versions.js";
import type { AuditContext } from "./util/inject.js";

export type Drift = "same" | "patch" | "minor" | "major" | "newer";

export type DepsDriftEntry = {
  pkg: string;
  baseline: string;
  actual: string;
  drift: Drift;
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

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

  const details: DepsDriftEntry[] = [];
  for (const [name, baseline] of Object.entries(baselineVersions)) {
    const actual = installed[name];
    if (!actual) continue;
    details.push({
      pkg: name,
      baseline,
      actual,
      drift: compareSemver(actual, baseline),
    });
  }

  const anyMajor = details.some((d) => d.drift === "major");
  const anyMinor = details.some((d) => d.drift === "minor");
  const anyNewer = details.some((d) => d.drift === "newer");

  const status: AuditResult["status"] = anyMajor ? "fail" : anyMinor || anyNewer ? "warn" : "pass";

  const summary =
    status === "pass"
      ? `all ${details.length} tracked deps in line with baseline`
      : status === "warn"
        ? `${details.filter((d) => d.drift !== "same").length} of ${details.length} tracked deps drifted`
        : `${details.filter((d) => d.drift === "major").length} deps lagging by a major version`;

  return {
    audit: "deps",
    site: siteLabel(ctx.site),
    status,
    summary,
    details,
  };
}

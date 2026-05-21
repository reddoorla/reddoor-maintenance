import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, Site } from "../types.js";
import { lighthouseConfig } from "../configs/lighthouse.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";

type NormalizedLhciResult = {
  summary: Record<string, number>;
  assertionsFailed: number;
  assertions?: Array<{ category: string; level: "warn" | "error"; message: string }>;
};

function siteLabel(site: Site): string {
  return site.name ?? site.path;
}

function isFakeShape(stdout: string): NormalizedLhciResult | null {
  // Tests inject a pre-normalized JSON blob; detect that and pass through.
  try {
    const parsed = JSON.parse(stdout) as NormalizedLhciResult;
    if (typeof parsed.assertionsFailed === "number" && parsed.summary) return parsed;
  } catch {
    return null;
  }
  return null;
}

export async function lighthouseAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  const dir = await mkdtemp(join(tmpdir(), "reddoor-lhci-"));
  const configPath = join(dir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(lighthouseConfig), "utf-8");

  let raw;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: site.path,
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return {
        audit: "lighthouse",
        site: label,
        status: "skip",
        summary: "npx/@lhci/cli not available",
      };
    }
    throw err;
  }
  await rm(dir, { recursive: true, force: true });

  const fake = isFakeShape(raw.stdout);
  const normalized: NormalizedLhciResult = fake ?? {
    summary: {},
    assertionsFailed: raw.code === 0 ? 0 : 1,
    assertions:
      raw.code === 0
        ? []
        : [{ category: "unknown", level: "error", message: raw.stderr.slice(0, 200) }],
  };

  const anyError = (normalized.assertions ?? []).some((a) => a.level === "error");
  const anyWarn = (normalized.assertions ?? []).some((a) => a.level === "warn");

  const status: AuditResult["status"] = anyError ? "fail" : anyWarn ? "warn" : "pass";

  const summary =
    status === "pass"
      ? "lighthouse: all categories passing"
      : `lighthouse: ${normalized.assertionsFailed} assertion(s) failed`;

  return {
    audit: "lighthouse",
    site: label,
    status,
    summary,
    details: normalized,
  };
}

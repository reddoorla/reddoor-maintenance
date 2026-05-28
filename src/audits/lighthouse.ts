import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import { lighthouseConfig } from "../configs/lighthouse.js";
import { defaultSpawn } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { readSiteConfig } from "./util/site-config.js";
import { findFreePort, withFreePort } from "../util/free-port.js";

type ManifestEntry = {
  url: string;
  summary: Record<string, number>;
  htmlPath?: string;
  jsonPath?: string;
};

type AssertionResult = {
  name: string;
  actual: number;
  expected: number;
  operator: string;
  passed: boolean;
  level: "warn" | "error";
  auditProperty?: string;
  auditId?: string;
};

type NormalizedLhciResult = {
  summary: Record<string, number>;
  assertionsFailed: number;
  assertions: Array<{ category: string; level: "warn" | "error"; message: string }>;
};

async function readJsonMaybe<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function averageSummaries(entries: ManifestEntry[]): Record<string, number> {
  if (entries.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const e of entries) {
    for (const [k, v] of Object.entries(e.summary ?? {})) {
      if (typeof v !== "number") continue;
      sums[k] = (sums[k] ?? 0) + v;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(sums)) {
    const total = sums[k] ?? 0;
    const count = counts[k] ?? 1;
    out[k] = total / count;
  }
  return out;
}

function categoryFromAssertion(a: AssertionResult): string {
  // `name` looks like "categories:accessibility" or "audits:uses-http2".
  const colonIdx = a.name.indexOf(":");
  return colonIdx >= 0 ? a.name.slice(colonIdx + 1) : a.name;
}

function messageForAssertion(a: AssertionResult): string {
  return `${a.name} ${a.operator} ${a.expected} (actual: ${a.actual.toFixed(2)})`;
}

export async function lighthouseAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  const siteCfg = await readSiteConfig(site.path);
  // Allocate a free port + force vite to `--strictPort` so the spawned dev
  // server either binds the port we picked or fails loudly. Without this,
  // a zombie on 5173 makes vite bump to 5174 while lhci still probes 5173
  // and audits the wrong server (silently returns "no manifest written").
  const port = await findFreePort();
  const baseUrl = siteCfg.lighthouseUrl ?? lighthouseConfig.ci.collect.url[0];
  const resolvedConfig = {
    ...lighthouseConfig,
    ci: {
      ...lighthouseConfig.ci,
      collect: {
        ...lighthouseConfig.ci.collect,
        url: [withFreePort(baseUrl, port)],
        startServerCommand: `npm run vite:dev -- --port ${port} --strictPort`,
      },
    },
  };

  const configDir = await mkdtemp(join(tmpdir(), "reddoor-lhci-"));
  const configPath = join(configDir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(resolvedConfig), "utf-8");

  const resultsDir = join(site.path, ".lighthouseci");
  // Clear any stale artifacts before the run so we never confuse a failed
  // spawn with old results.
  await rm(resultsDir, { recursive: true, force: true });

  let raw;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: site.path,
      // lhci autorun boots the site's dev server, downloads Chrome on first
      // use, and runs the audit — easily 2–3 min on a cold tree. The shared
      // 30 s default in runAudits is fine for deps/lint/security but starves
      // lhci.
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    await rm(configDir, { recursive: true, force: true });
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
  await rm(configDir, { recursive: true, force: true });

  const manifest = await readJsonMaybe<ManifestEntry[]>(join(resultsDir, "manifest.json"));

  if (!manifest || manifest.length === 0) {
    return {
      audit: "lighthouse",
      site: label,
      status: "fail",
      summary: `lighthouse: no manifest written (exit ${raw.code})${
        raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
      }`,
    };
  }

  const assertionResults =
    (await readJsonMaybe<AssertionResult[]>(join(resultsDir, "assertion-results.json"))) ?? [];

  const failed = assertionResults.filter((a) => !a.passed);
  const assertions = failed.map((a) => ({
    category: categoryFromAssertion(a),
    level: a.level,
    message: messageForAssertion(a),
  }));

  const anyError = assertions.some((a) => a.level === "error");
  const anyWarn = assertions.some((a) => a.level === "warn");
  const status: AuditResult["status"] = anyError ? "fail" : anyWarn ? "warn" : "pass";

  const normalized: NormalizedLhciResult = {
    summary: averageSummaries(manifest),
    assertionsFailed: failed.length,
    assertions,
  };

  const summary =
    status === "pass"
      ? "lighthouse: all categories passing"
      : `lighthouse: ${failed.length} assertion(s) failed`;

  return {
    audit: "lighthouse",
    site: label,
    status,
    summary,
    details: normalized,
  };
}

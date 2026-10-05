import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { lighthouseConfig } from "../configs/lighthouse.js";
import { defaultSpawn } from "./util/spawn.js";
import type { SpawnFn, SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { readSiteConfig } from "./util/site-config.js";
import { withFreePort } from "../util/free-port.js";
import { portInUse, spawnOutput, withPortRetry } from "../util/port-retry.js";

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

type LhrFile = {
  requestedUrl: string;
  finalUrl?: string;
  categories: Record<string, { score: number | null }>;
};

/**
 * Build manifest-equivalent entries by scanning the `.lighthouseci/` dir
 * for `lhr-*.json` files written by `lhci collect`. We used to read
 * `manifest.json` directly, but lhci 0.15+ no longer writes it — the
 * audit would silently return "no manifest written" against a perfectly
 * healthy run. Reproduced on caltex 2026-05-28 (0.10.5 dogfood).
 */
async function readLhrEntries(resultsDir: string): Promise<ManifestEntry[]> {
  const files = await readdir(resultsDir).catch(() => [] as string[]);
  const entries: ManifestEntry[] = [];
  for (const f of files) {
    if (!f.startsWith("lhr-") || !f.endsWith(".json")) continue;
    const lhr = await readJsonMaybe<LhrFile>(join(resultsDir, f));
    if (!lhr || !lhr.categories) continue;
    const summary: Record<string, number> = {};
    for (const [k, v] of Object.entries(lhr.categories)) {
      if (typeof v?.score === "number") summary[k] = v.score;
    }
    entries.push({ url: lhr.requestedUrl, summary });
  }
  return entries;
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
  // `a.actual` is parsed from external lhci/Lighthouse JSON; a malformed or
  // missing value (not a number) would make `.toFixed` throw and crash the whole
  // audit. Guard it and fall back to a readable string instead.
  const actual = typeof a.actual === "number" ? a.actual.toFixed(2) : "n/a";
  return `${a.name} ${a.operator} ${a.expected} (actual: ${actual})`;
}

function describeLhciFailure(raw: SpawnResult): string {
  const output = `${raw.stdout}\n${raw.stderr}`;
  const rootRefusal = /(Running as root without --no-sandbox is not supported\.?)/.exec(
    output,
  )?.[1];
  if (rootRefusal) return rootRefusal;
  const runtime = /^Runtime error encountered: (.+)$/m.exec(output)?.[1]?.trim();
  if (runtime) return runtime.slice(0, 200);
  const healthcheck = [...output.matchAll(/^❌\s+(.+)$/gm)].map((m) => m[1]!.trim());
  if (healthcheck.length > 0) return healthcheck.join(" / ").slice(0, 200);
  return raw.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/\bnpm warn\b/i.test(line))
    .join(" / ")
    .slice(0, 200);
}

function chromeFlags(): string | undefined {
  return process.getuid?.() === 0 ? "--no-sandbox" : undefined;
}

function withChromeFlags<T extends object>(settings: T): T & { chromeFlags?: string } {
  const flags = chromeFlags();
  return flags ? { ...settings, chromeFlags: flags } : settings;
}

/** Shared tail: scan `.lighthouseci/` for lhr-*.json + assertion-results.json and
 *  build the AuditResult. Identical for the checkout and deployed paths. */
async function parseLhciResults(
  resultsDir: string,
  label: string,
  raw: SpawnResult,
): Promise<AuditResult> {
  const manifest = await readLhrEntries(resultsDir);

  if (manifest.length === 0) {
    const detail = describeLhciFailure(raw);
    return {
      audit: "lighthouse",
      site: label,
      status: "fail",
      summary: `lighthouse: no lhr-*.json written (exit ${raw.code})${detail ? ` — ${detail}` : ""}`,
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

  return { audit: "lighthouse", site: label, status, summary, details: normalized };
}

/** Checkout mode (unchanged behavior): boot the site's vite dev server on a
 *  pinned free port and audit the local fixtures/override URL. */
async function checkoutLighthouse(spawn: SpawnFn, site: Site, label: string): Promise<AuditResult> {
  const siteCfg = await readSiteConfig(site.path);
  const baseUrl = siteCfg.lighthouseUrl ?? lighthouseConfig.ci.collect.url[0];
  const resultsDir = join(site.path, ".lighthouseci");
  // Allocate a free port + force vite to `--strictPort` so the spawned dev
  // server either binds the port we picked or fails loudly (caltex 2026-05-28
  // zombie-vite incident). A port taken between the pick and the bind is
  // retried on a fresh one (P1-27).
  const { result } = await withPortRetry(
    1,
    async ([port]) => runCheckoutLhci(spawn, site, label, baseUrl, resultsDir, port!),
    ({ raw }, [port]) => raw !== undefined && raw.code !== 0 && portInUse(spawnOutput(raw), port!),
  );
  return result;
}

async function runCheckoutLhci(
  spawn: SpawnFn,
  site: Site,
  label: string,
  baseUrl: string,
  resultsDir: string,
  port: number,
): Promise<{ result: AuditResult; raw?: SpawnResult }> {
  const resolvedConfig = {
    ...lighthouseConfig,
    ci: {
      ...lighthouseConfig.ci,
      collect: {
        ...lighthouseConfig.ci.collect,
        url: [withFreePort(baseUrl, port)],
        settings: withChromeFlags(lighthouseConfig.ci.collect.settings),
        startServerCommand: `npm run vite:dev -- --port ${port} --strictPort`,
      },
    },
  };

  const configDir = await mkdtemp(join(tmpdir(), "reddoor-lhci-"));
  const configPath = join(configDir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(resolvedConfig), "utf-8");

  await rm(resultsDir, { recursive: true, force: true });

  let raw: SpawnResult;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: site.path,
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    await rm(configDir, { recursive: true, force: true });
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return {
        result: {
          audit: "lighthouse",
          site: label,
          status: "skip",
          summary: "npx/@lhci/cli not available",
        },
      };
    }
    throw err;
  }
  await rm(configDir, { recursive: true, force: true });

  return { result: await parseLhciResults(resultsDir, label, raw), raw };
}

/** Deployed mode: audit a production URL directly — no checkout, no dev server.
 *  Runs in a throwaway tmp cwd; uploads to the filesystem so fleet runs never
 *  push 200 public reports to temporary-public-storage. */
async function deployedLighthouse(
  spawn: SpawnFn,
  deployedUrl: string,
  label: string,
): Promise<AuditResult> {
  const workDir = await mkdtemp(join(tmpdir(), "reddoor-lh-deployed-"));
  const resolvedConfig = {
    ci: {
      // Deliberately NOT spread from lighthouseConfig.ci.collect: deployed mode
      // must omit startServerCommand and the dev-server settings entirely.
      collect: {
        url: [deployedUrl],
        // 3 runs to damp Lighthouse's run-to-run variance; parseLhciResults
        // averages the lhr files. (Median is a tracked future refinement.)
        numberOfRuns: 3,
        // Use devtools (applied) throttling instead of the desktop preset's
        // default `simulate` (Lantern). Lantern estimates LCP from the
        // dependency graph and can't model an LCP element revealed by a
        // JS-load opacity fade (e.g. gallerysonder's GridImage): on a fast
        // observed load it finds no LCP node and throws NO_LCP, nulling the
        // perf score, which the cockpit then coerces to a misleading 0.
        // devtools reads the real LCP paint event from the throttled trace
        // instead. Trade-off: slightly noisier run-to-run, damped by the
        // numberOfRuns:3 average above.
        settings: withChromeFlags({
          preset: "desktop",
          throttlingMethod: "devtools",
          skipAudits: ["uses-http2"],
        }),
      },
      assert: lighthouseConfig.ci.assert,
      upload: { target: "filesystem", outputDir: join(workDir, "lhci-report") },
    },
  };

  const configPath = join(workDir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(resolvedConfig), "utf-8");

  const resultsDir = join(workDir, ".lighthouseci");

  let raw: SpawnResult;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: workDir,
      // 3 serial cold runs of a slow deployed site (lhci's own maxWaitForLoad
      // ~45-60s each) + first-use Chrome download can plausibly exceed 3 min →
      // SIGTERM → no lhr-*.json → spurious "no scores". Match the 5-min budget
      // the checkout path already gives (erp-industrials nightly flake,
      // morning-brief 2026-06-10 MEDIUM-F).
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    await rm(workDir, { recursive: true, force: true });
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

  try {
    return await parseLhciResults(resultsDir, label, raw);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function lighthouseAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  return site.deployedUrl
    ? deployedLighthouse(spawn, site.deployedUrl, label)
    : checkoutLighthouse(spawn, site, label);
}

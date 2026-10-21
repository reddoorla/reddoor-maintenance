import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domainAudit } from "../../src/audits/domain.js";
import { browserAudit } from "../../src/audits/browser.js";
import { functionHealthAudit } from "../../src/audits/function-health.js";
import { formE2eAudit } from "../../src/audits/form-e2e.js";
import { netlifyDeployAudit } from "../../src/audits/netlify-deploy.js";
import { smokeAudit } from "../../src/audits/smoke.js";
import {
  writeFleetAudits,
  fleetWriteGate,
  formatFleetWriteSummary,
} from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { recordingMirror } from "../_helpers/recording-mirror.js";
import type { AuditResult, Site } from "../../src/types.js";

/**
 * #1605: the fleet write gate reds an audit that measured nothing on a quarter of the
 * sites it applied to, so a skip that means "this site has nothing to measure" must say
 * so, and a skip that means "the measurement broke" must not. Every result here comes
 * from the REAL audit run on a site shaped for the case, never a mark set by hand.
 */

let dir: string;
let noScript: string;
let withScript: string;
let corrupt: string;
let noPackage: string;
let dirPackage: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "na-marks-"));
  noScript = join(dir, "no-script");
  withScript = join(dir, "with-script");
  mkdirSync(noScript);
  mkdirSync(withScript);
  noPackage = join(dir, "no-package");
  mkdirSync(noPackage);
  // A DIRECTORY named package.json: readFile fails with EISDIR, not ENOENT. (EACCES
  // cannot be staged here: the container runs as root.)
  dirPackage = join(dir, "dir-package");
  mkdirSync(join(dirPackage, "package.json"), { recursive: true });
  corrupt = join(dir, "corrupt");
  mkdirSync(corrupt);
  writeFileSync(join(corrupt, "package.json"), '{\n<<<<<<< HEAD\n  "name": "c"\n');
  writeFileSync(join(noScript, "package.json"), JSON.stringify({ name: "a", scripts: {} }));
  writeFileSync(
    join(withScript, "package.json"),
    JSON.stringify({ name: "b", scripts: { "test:smoke": "playwright test" } }),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const bare: Site = { name: "no-url", path: "/nonexistent/no-url" };
const deployed: Site = { ...bare, deployedUrl: "https://site.example" };

/** The by-design skips: the site lacks the thing the audit measures. */
const notApplicable: Array<[string, () => Promise<AuditResult>]> = [
  ["domain, no deployed URL", () => domainAudit({ site: bare })],
  ["browser, no deployed URL", () => browserAudit({ site: bare })],
  ["function-health, no deployed URL", () => functionHealthAudit({ site: bare })],
  ["form-e2e, no deployed URL", () => formE2eAudit({ site: bare })],
  ["netlify-deploy, no Netlify id", () => netlifyDeployAudit({ site: deployed })],
  ["smoke, no test:smoke script", () => smokeAudit({ site: { name: "a", path: noScript } })],
  ["smoke, no package.json at all", () => smokeAudit({ site: { name: "d", path: noPackage } })],
  [
    "form-e2e, no contact form (and still written)",
    () =>
      formE2eAudit({
        site: deployed,
        formRunner: { submit: async () => ({ formPresent: false }) },
      }),
  ],
];

/** A spawn that records it was called: a broken package.json must never reach pnpm. */
const spawned: string[] = [];
const recordingSpawn = async (cmd: string) => {
  spawned.push(cmd);
  return { code: 1, stdout: "", stderr: "" };
};

/** Skips the site's configuration does not explain: the measurement broke. */
const broken: Array<[string, () => Promise<AuditResult>]> = [
  [
    "netlify-deploy, no NETLIFY_PAT in the environment",
    () => {
      vi.stubEnv("NETLIFY_PAT", "");
      return netlifyDeployAudit({ site: { ...deployed, netlifyId: "abc-123" } });
    },
  ],
  [
    "function-health, /health unreachable",
    () =>
      functionHealthAudit({
        site: deployed,
        functionHealthDeps: {
          now: new Date("2026-10-21T06:30:00.000Z"),
          fetchHealth: async () => ({ present: false }),
        },
      }),
  ],
  [
    "smoke, package.json unparseable (a merge-conflict marker)",
    async () => {
      spawned.length = 0;
      const r = await smokeAudit({ site: { name: "c", path: corrupt }, spawn: recordingSpawn });
      expect(r.summary).toMatch(/^smoke: package\.json unparseable/);
      expect(spawned).toEqual([]);
      return r;
    },
  ],
  [
    "smoke, package.json unreadable (EISDIR)",
    async () => {
      spawned.length = 0;
      const r = await smokeAudit({ site: { name: "e", path: dirPackage }, spawn: recordingSpawn });
      expect(r.summary).toMatch(/^smoke: package\.json unreadable/);
      expect(spawned).toEqual([]);
      return r;
    },
  ],
  [
    "smoke, deps would not install",
    () =>
      smokeAudit({
        site: { name: "b", path: withScript },
        spawn: async () => ({ code: 1, stdout: "", stderr: "ERR_PNPM_FETCH_404" }),
      }),
  ],
];

describe("by-design skips carry notApplicable", () => {
  it.each(notApplicable)("%s", async (_name, run) => {
    const r = await run();
    expect(r.status).toBe("skip");
    expect(r.notApplicable).toBe(true);
  });

  it("a no-form site is written and counted as not applicable for form-e2e", async () => {
    const r = await formE2eAudit({
      site: { ...deployed, name: "no-form" },
      formRunner: { submit: async () => ({ formPresent: false }) },
    });
    const out = await writeFleetAudits({
      websites: websiteRowsFrom([
        { id: "rec1", fields: { Name: "no-form", Status: "maintenance" } },
      ]),
      results: [{ ...r, site: "no-form" }],
      mirror: recordingMirror().mirror,
      expectedSites: ["no-form"],
    });
    expect(out.written.map((w) => w.siteName)).toEqual(["no-form"]);
    expect(out.notApplicableAudits).toEqual({ "form-e2e": ["no-form"] });
    expect(fleetWriteGate(out)).toEqual({ red: false, reasons: [], warnings: [] });
    expect(formatFleetWriteSummary(out)).toContain(
      "\n· form-e2e not applicable by design on 1 site(s): no-form",
    );
  });
});

describe("a broken measurement does not", () => {
  it.each(broken)("%s", async (_name, run) => {
    const r = await run();
    expect(r.status).toBe("skip");
    expect(r.notApplicable).toBeUndefined();
  });
});

describe("through the write gate", () => {
  it("a site whose every real by-design skip is n/a is counted n/a, with no audit blind", async () => {
    const results: AuditResult[] = [];
    for (const [, run] of notApplicable) results.push({ ...(await run()), site: "no-url" });
    const out = await writeFleetAudits({
      websites: websiteRowsFrom([
        { id: "rec1", fields: { Name: "no-url", Status: "maintenance" } },
      ]),
      results,
      mirror: recordingMirror().mirror,
      expectedSites: ["no-url"],
    });
    expect(out.notApplicable).toEqual(["no-url"]);
    expect(out.unmeasuredAudits).toEqual({});
  });

  it("the real broken skips on every site are red", async () => {
    const sites = ["s0", "s1", "s2", "s3"];
    const results: AuditResult[] = [];
    for (const site of sites) {
      for (const [, run] of broken) results.push({ ...(await run()), site });
    }
    const out = await writeFleetAudits({
      websites: websiteRowsFrom(
        sites.map((s, i) => ({ id: `r${i}`, fields: { Name: s, Status: "maintenance" } })),
      ),
      results,
      mirror: recordingMirror().mirror,
      expectedSites: sites,
    });
    expect(out.written).toEqual([]);
    expect(out.notApplicable).toEqual([]);
    expect(fleetWriteGate(out).red).toBe(true);
  });
});

/** Every `notApplicable: true` in the audits, by file. A new by-design skip is added
 *  here on purpose; a mark on a skip that means "the measurement broke" (pnpm or npx
 *  missing, no lockfile, the live runner off) would drop that site from its audit's
 *  denominator and could green a fleet-wide outage, so it must turn this red. */
describe("the census of not-applicable marks", () => {
  it("marks exactly the seven by-design skips, and only ever with a literal true", () => {
    const audits = fileURLToPath(new URL("../../src/audits/", import.meta.url));
    const found: Record<string, number> = {};
    const other: string[] = [];
    for (const f of readdirSync(audits, { recursive: true }) as string[]) {
      // write-audits.ts reads the marks and keeps its own `notApplicable` list of sites;
      // it produces no AuditResult.
      if (!f.endsWith(".ts") || f === "write-audits.ts") continue;
      const src = readFileSync(join(audits, f), "utf-8");
      // Every property-position `notApplicable`: `notApplicable: x`, or the shorthand
      // `{ notApplicable }` / `, notApplicable,`. Reads such as `r.notApplicable` do not match.
      for (const m of src.matchAll(/(?<![.\w])notApplicable\b\s*(:\s*([^,\n}]+)|(?=[,}]))/g)) {
        const value = m[2]?.trim();
        if (value === "true") found[f] = (found[f] ?? 0) + 1;
        else other.push(`${f}: ${m[0]}`);
      }
    }
    expect(other).toEqual([]);
    expect(found).toEqual({
      "browser.ts": 1,
      "domain.ts": 1,
      "form-e2e.ts": 2,
      "function-health.ts": 1,
      "netlify-deploy.ts": 1,
      "smoke.ts": 1,
    });
  });
});

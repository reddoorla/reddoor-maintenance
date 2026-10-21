import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { domainAudit } from "../../src/audits/domain.js";
import { browserAudit } from "../../src/audits/browser.js";
import { functionHealthAudit } from "../../src/audits/function-health.js";
import { formE2eAudit } from "../../src/audits/form-e2e.js";
import { netlifyDeployAudit } from "../../src/audits/netlify-deploy.js";
import { smokeAudit } from "../../src/audits/smoke.js";
import { writeFleetAudits, fleetWriteGate } from "../../src/audits/write-audits.js";
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "na-marks-"));
  noScript = join(dir, "no-script");
  withScript = join(dir, "with-script");
  mkdirSync(noScript);
  mkdirSync(withScript);
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
];

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

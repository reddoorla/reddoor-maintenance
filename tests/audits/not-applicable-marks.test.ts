import { describe, it, expect } from "vitest";
import { domainAudit } from "../../src/audits/domain.js";
import { browserAudit } from "../../src/audits/browser.js";
import { functionHealthAudit } from "../../src/audits/function-health.js";
import { formE2eAudit } from "../../src/audits/form-e2e.js";
import { netlifyDeployAudit } from "../../src/audits/netlify-deploy.js";
import { writeFleetAudits, fleetWriteGate } from "../../src/audits/write-audits.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import { recordingMirror } from "../_helpers/recording-mirror.js";
import type { AuditResult, Site } from "../../src/types.js";

/**
 * #1605: the fleet write gate reds an audit that measured nothing on a quarter of the
 * sites it applied to, so the skips that mean "this site has nothing to measure" must
 * say so. Each mark is read off the REAL audit, run on a site without the thing it
 * needs, never set by hand on a fixture.
 */

const bare: Site = { name: "no-url", path: "/nonexistent/no-url" };

const runs: Array<[string, () => Promise<AuditResult>]> = [
  ["domain", () => domainAudit({ site: bare })],
  ["browser", () => browserAudit({ site: bare })],
  ["function-health", () => functionHealthAudit({ site: bare })],
  ["form-e2e", () => formE2eAudit({ site: bare })],
  [
    "netlify-deploy",
    () => netlifyDeployAudit({ site: { ...bare, deployedUrl: "https://no-id.example" } }),
  ],
];

describe("by-design skips carry notApplicable", () => {
  it.each(runs)("%s on a site without its input", async (_name, run) => {
    const r = await run();
    expect(r.status).toBe("skip");
    expect(r.notApplicable).toBe(true);
  });

  it("a fleet where most sites lack a deployed URL stays green through the real results", async () => {
    const results: AuditResult[] = [];
    for (const [, run] of runs.slice(0, 4)) results.push(await run());
    results.push({
      audit: "lighthouse",
      site: "no-url",
      status: "pass",
      summary: "",
      details: { summary: { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 } },
    });
    const out = await writeFleetAudits({
      websites: websiteRowsFrom([
        { id: "rec1", fields: { Name: "no-url", Status: "maintenance" } },
      ]),
      results,
      mirror: recordingMirror().mirror,
      expectedSites: ["no-url"],
    });
    expect(out.unmeasuredAudits).toEqual({});
    expect(fleetWriteGate(out)).toEqual({ red: false, reasons: [], warnings: [] });
  });
});

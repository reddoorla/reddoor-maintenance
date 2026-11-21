import { describe, it, expect } from "vitest";
import { writeBackOneSite } from "../../src/audits/write-audits.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import type { AuditResult } from "../../src/types.js";

const mirrorHealth = async () => true;

function siteRow(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "recSITE",
    name: "Caltex",
    securityVulnsCritical: 1,
    securityVulnsHigh: 1,
    certDaysRemaining: 80,
    ...over,
  } as WebsiteRow;
}

const securityClean: AuditResult = {
  site: "caltex",
  audit: "security",
  status: "pass",
  summary: "clean",
  details: { counts: { critical: 0, high: 0, moderate: 0, low: 0 } },
} as AuditResult;

// #2197: a new ready production deploy reaches the detector through writeBackOneSite,
// so dropping the netlifyDeploy line there turns every site_deployed event off.
const deployReady: AuditResult = {
  site: "caltex",
  audit: "netlify-deploy",
  status: "pass",
  summary: "deploy ready",
  details: {
    state: "ready",
    deployedAt: "2026-06-17T12:00:00.000Z",
    logUrl: "https://caltex.netlify.app",
    checkedAt: "2026-06-18T00:00:00.000Z",
  },
} as AuditResult;

describe("writeBackOneSite attaches detected events", () => {
  it("emits vuln_cleared when prior critical+high cleared to 0", async () => {
    const summary = await writeBackOneSite({
      mirrorHealth,
      websites: [siteRow({})],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events?.map((e) => e.type)).toContain("vuln_cleared");
  });

  it("emits no events when nothing transitioned", async () => {
    const summary = await writeBackOneSite({
      mirrorHealth,
      websites: [siteRow({ securityVulnsCritical: 0, securityVulnsHigh: 0 })],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events ?? []).toHaveLength(0);
  });

  it("emits site_deployed for a new ready deploy, stamped with its publish time", async () => {
    const summary = await writeBackOneSite({
      mirrorHealth,
      websites: [siteRow({ lastDeployAt: "2026-06-10T09:00:00.000Z" })],
      slug: "caltex",
      results: [deployReady],
    });
    const deployed = (summary.events ?? []).filter((e) => e.type === "site_deployed");
    expect(deployed.map((e) => e.ts)).toEqual(["2026-06-17T12:00:00.000Z"]);
  });
});

import { describe, it, expect } from "vitest";
import { writeAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AuditResult } from "../../src/types.js";

// A fake Airtable base: the only call writeAuditsToAirtable makes is base(table).update(...).
function fakeBase() {
  return (() => ({ update: async () => [] })) as never;
}

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

describe("writeAuditsToAirtable attaches detected events", () => {
  it("emits vuln_cleared when prior critical+high cleared to 0", async () => {
    const summary = await writeAuditsToAirtable({
      base: fakeBase(),
      websites: [siteRow({})],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events?.map((e) => e.type)).toContain("vuln_cleared");
  });

  it("emits no events when nothing transitioned", async () => {
    const summary = await writeAuditsToAirtable({
      base: fakeBase(),
      websites: [siteRow({ securityVulnsCritical: 0, securityVulnsHigh: 0 })],
      slug: "caltex",
      results: [securityClean],
    });
    expect(summary.events ?? []).toHaveLength(0);
  });
});

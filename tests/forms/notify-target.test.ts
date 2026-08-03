import { describe, it, expect } from "vitest";
import { describeNotifyTarget, resolveRecipients } from "../../src/forms/notify.js";
import type { WebsiteRow, NotifyRouting, Status } from "../../src/reports/airtable/websites.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSite",
    name: "1836dig",
    status: "maintenance" as Status,
    pointOfContact: "owner@client.com",
    notifyRouting: null,
    reportRecipientsTo: null,
    ...over,
  } as unknown as WebsiteRow;
}

function submission(extraFields: string | null): SubmissionRow {
  return { extraFields } as unknown as SubmissionRow;
}

describe("describeNotifyTarget", () => {
  it("a maintenance site with a POC would email THE CLIENT", () => {
    const t = describeNotifyTarget(site());
    expect(t.audience).toBe("client");
    expect(t.to).toEqual(["owner@client.com"]);
  });

  it("REGRESSION: the guard holding is reported as operator-only, not merely 'not client'", () => {
    // The 2026-08-03 incident: the operator believed this state was in effect.
    // Nothing reported it either way.
    const t = describeNotifyTarget(site({ status: "launch period" as Status }));
    expect(t.audience).toBe("operator");
    expect(t.to).not.toContain("owner@client.com");
    expect(t.reason).toMatch(/launch period/);
  });

  it("every status other than maintenance is guarded", () => {
    for (const status of ["in development", "hosting", "deprecated", "legacy", null]) {
      expect(describeNotifyTarget(site({ status: status as Status })).audience).toBe("operator");
    }
  });

  it("a routed site lists EVERY address any routing branch could reach", () => {
    const notifyRouting: NotifyRouting = {
      field: "interest",
      routes: { sales: "sales@client.com", support: ["a@client.com", "b@client.com"] },
      default: "front-desk@client.com",
      cc: ["cc@client.com"],
    };
    const t = describeNotifyTarget(site({ notifyRouting }));
    expect(t.audience).toBe("client");
    expect(t.to.sort()).toEqual(
      ["a@client.com", "b@client.com", "front-desk@client.com", "sales@client.com"].sort(),
    );
    expect(t.cc).toEqual(["cc@client.com"]);
  });

  it("a maintenance site that resolves to nothing says so, rather than reading as safe", () => {
    const t = describeNotifyTarget(site({ pointOfContact: null, reportRecipientsTo: null }));
    expect(t.audience).toBe("nobody");
    expect(t.to).toEqual([]);
  });

  it("REGRESSION: the answer is derived from resolveRecipients, so it cannot drift from it", () => {
    // A second implementation of the routing rules would be worse than no
    // answer — a confidently wrong one. Whatever the real send path resolves
    // for a concrete submission must appear in the advertised set.
    const notifyRouting: NotifyRouting = {
      field: "interest",
      routes: { sales: "sales@client.com" },
      default: "front-desk@client.com",
    };
    const s = site({ notifyRouting });
    const advertised = describeNotifyTarget(s).to;
    for (const value of ["sales", "anything-unmatched"]) {
      const actual = resolveRecipients(s, submission(JSON.stringify({ interest: value })));
      for (const addr of actual?.to ?? []) expect(advertised).toContain(addr);
    }
  });
});

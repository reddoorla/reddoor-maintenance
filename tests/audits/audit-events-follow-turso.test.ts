import { describe, it, expect } from "vitest";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { listWebsites } from "../../src/reports/airtable/websites.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

const ROWS = [
  { id: "recA", fields: { Name: "Acme Co", Status: "maintained", "Cert days remaining": 10 } },
];

const lighthouseMiss: AuditResult = {
  audit: "lighthouse",
  site: "acme-co",
  status: "fail",
  summary: "timed out",
  details: { summary: {} },
};

const renewedCert = {
  audit: "domain",
  site: "acme-co",
  status: "pass",
  summary: "",
  details: { resolved: true, certDaysRemaining: 90, checkedAt: "2026-09-28T08:00:00.000Z" },
} as unknown as AuditResult;

async function sweep(mirrorLands: boolean) {
  const base = makeFakeBase({ Websites: ROWS });
  const recorded: FleetEvent[] = [];
  const mirrored: Array<Record<string, unknown>> = [];
  const res = await runFleetWriteBack({
    results: [lighthouseMiss, renewedCert],
    which: ["lighthouse", "domain"],
    deps: {
      openBase: () => base,
      roster: async () => listWebsites(base as never),
      makeMirror: async () => async (_siteId: string, fields: Record<string, unknown>) => {
        mirrored.push(fields);
        return mirrorLands;
      },
      recordEvents: async (events) => {
        recorded.push(...events);
      },
      strict: true,
    },
  });
  return { res, recorded, mirrored };
}

describe("an audit event is recorded once Turso holds the transition", () => {
  it("records cert_renewed for a Lighthouse-miss site whose renewal reached Turso", async () => {
    const { res, recorded, mirrored } = await sweep(true);
    expect(mirrored[0]).toMatchObject({ "Cert days remaining": 90 });
    expect(res.anyFailed).toBe(true);
    expect(res.summary).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=1 total=1 mirrored=1");
    expect(recorded.map((e) => e.id)).toContainEqual(expect.stringMatching(/^cert_renewed:recA:/));
  });

  it("does not record it while Turso still holds the old value, so the next night re-detects it", async () => {
    const { recorded } = await sweep(false);
    expect(recorded.map((e) => e.type)).not.toContain("cert_renewed");
  });
});

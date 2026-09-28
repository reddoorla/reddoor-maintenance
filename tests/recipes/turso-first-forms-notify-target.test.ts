import { describe, it, expect, afterEach, vi } from "vitest";
import { formsNotifyTarget, VERIFY_STATUS } from "../../src/recipes/forms-notify-target.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";
import { canonicalizeStatus } from "../../src/reports/airtable/site-status.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const QUOTA = "Airtable monthly API call quota exhausted";

afterEach(() => vi.restoreAllMocks());

function orderedBase(log: string[], fail: boolean): AirtableBase {
  return ((table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      const [col, value] = Object.entries(records[0]!.fields)[0]!;
      log.push(`airtable:${table}:${records[0]!.id}.${col}=${String(value)}`);
      if (fail) throw Object.assign(new Error(QUOTA), { code: "AIRTABLE_QUOTA_EXHAUSTED" });
      return records;
    },
  })) as unknown as AirtableBase;
}

function flipOn(fail: boolean) {
  const log: string[] = [];
  let rows: WebsiteRow[] = [
    makeWebsiteRow({ id: "recSite", name: "1836dig", status: "maintained" }),
  ];
  const turso: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const outcome = formsNotifyTarget({
    base: orderedBase(log, fail),
    site: "1836dig",
    set: "on",
    roster: async () => rows.map((r) => ({ ...r })),
    siteMirror: {
      created: async () => {},
      hasRow: async () => true,
      health: async () => {},
      site: async (id, fields) => {
        const cell = String(fields.Status);
        log.push(`turso:${id}.Status=${cell}`);
        turso.push({ id, fields });
        rows = rows.map((r) =>
          r.id === id ? { ...r, status: canonicalizeStatus(cell), statusRaw: cell } : r,
        );
      },
    },
  });
  return { outcome, log, turso };
}

describe("forms-notify-target writes the deciding Turso Status before the Airtable shadow", () => {
  it("Turso first, then the same cell to Airtable, then the Turso read-back confirms (known-good control)", async () => {
    const { outcome, log } = flipOn(false);
    const r = await outcome;
    expect(log).toEqual([
      "turso:recSite.Status=launching",
      "airtable:Websites:recSite.Status=launching",
    ]);
    expect(r.flip).toEqual({ from: "maintained", to: VERIFY_STATUS, confirmed: true });
  });

  it("a failed Airtable shadow still lands the Turso flip, and still fails the command loudly", async () => {
    const { outcome, turso } = flipOn(true);
    await expect(outcome).rejects.toThrow(QUOTA);
    expect(turso).toEqual([{ id: "recSite", fields: { Status: "launching" } }]);
  });
});

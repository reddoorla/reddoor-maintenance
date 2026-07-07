import { describe, it, expect } from "vitest";
import { createDraft, parseAutoEvidence } from "../../src/reports/airtable/reports.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";

describe("parseAutoEvidence", () => {
  it("parses a valid evidence JSON object", () => {
    const raw = JSON.stringify({
      "Maint: Google Indexed": {
        result: "pass",
        checkedAt: "2026-06-18T12:00:00.000Z",
        note: "Page 1 (#3)",
      },
    });
    const ev = parseAutoEvidence(raw);
    expect(ev?.["Maint: Google Indexed"]?.result).toBe("pass");
  });

  it("returns null on non-string / malformed / array input", () => {
    expect(parseAutoEvidence(undefined)).toBeNull();
    expect(parseAutoEvidence("")).toBeNull();
    expect(parseAutoEvidence("{not json")).toBeNull();
    expect(parseAutoEvidence("[]")).toBeNull();
  });

  it("drops entries with an invalid inner shape and coerces note to a string", () => {
    const raw = JSON.stringify({
      "Maint: Google Indexed": { result: "bogus", note: "x" }, // bad result → dropped
      "Maint: Security Updates": { result: "pass" }, // missing note/checkedAt → coerced
    });
    const ev = parseAutoEvidence(raw);
    expect(ev?.["Maint: Google Indexed"]).toBeUndefined();
    expect(ev?.["Maint: Security Updates"]).toEqual({ result: "pass", checkedAt: null, note: "" });
  });

  it("returns null when no entry has a valid shape", () => {
    expect(parseAutoEvidence(JSON.stringify({ x: { result: "nope" } }))).toBeNull();
  });

  it("accepts an 'n/a' result (the widened union — a per-site not-applicable state)", () => {
    const raw = JSON.stringify({
      "Test: Form Functionality": {
        result: "n/a",
        checkedAt: "2026-07-06T12:00:00.000Z",
        note: "No contact form on this site",
      },
    });
    const ev = parseAutoEvidence(raw);
    expect(ev?.["Test: Form Functionality"]?.result).toBe("n/a");
  });
});

describe("createDraft writes checklist booleans + auto-evidence", () => {
  it("ticks supplied checklist fields and writes the evidence JSON", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, {
      reportId: "Acme Co — Maintenance — 2026-06-18",
      siteId: "rec_site",
      reportType: "Maintenance",
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2026-06-18T00:00:00Z"),
      completedOn: new Date("2026-06-18T00:00:00Z"),
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 },
      lastTestedDate: null,
      checklistTicks: ["Maint: Google Indexed"],
      autoEvidence: {
        "Maint: Google Indexed": {
          result: "pass",
          checkedAt: "2026-06-18T12:00:00.000Z",
          note: "Page 1 (#3)",
        },
      },
    });
    const create = base.__calls.find((c) => c.kind === "create")!;
    if (create.kind !== "create") throw new Error("expected create");
    const fields = create.records[0]!.fields;
    expect(fields["Maint: Google Indexed"]).toBe(true);
    expect(typeof fields["Checklist auto-evidence"]).toBe("string");
    const ev = JSON.parse(fields["Checklist auto-evidence"] as string);
    expect(ev["Maint: Google Indexed"].result).toBe("pass");
  });

  it("omits the evidence field and ticks nothing when no auto-checks supplied", async () => {
    const base = makeFakeBase({ Reports: [] });
    await createDraft(base, {
      reportId: "Acme Co — Maintenance — 2026-06-18",
      siteId: "rec_site",
      reportType: "Maintenance",
      periodStart: new Date("2026-06-01T00:00:00Z"),
      periodEnd: new Date("2026-06-18T00:00:00Z"),
      completedOn: new Date("2026-06-18T00:00:00Z"),
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 },
      lastTestedDate: null,
    });
    const create = base.__calls.find((c) => c.kind === "create")!;
    if (create.kind !== "create") throw new Error("expected create");
    const fields = create.records[0]!.fields;
    expect(fields["Checklist auto-evidence"]).toBeUndefined();
    expect(fields["Maint: Google Indexed"]).toBeUndefined();
  });
});

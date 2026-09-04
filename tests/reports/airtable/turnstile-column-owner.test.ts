import { describe, it, expect } from "vitest";
import { updateAuditFields } from "../../../src/reports/airtable/websites.js";
import { makeFakeBase } from "../_helpers/fake-airtable-base.js";

const base = () => makeFakeBase({ Websites: [{ id: "recA", fields: { Name: "Acme Co" } }] });
const STAMP = "2026-09-04T10:15:00.000Z";

/**
 * `Turnstile widget` moved from the function-health slice to form-e2e (#689).
 * The move is the whole fix, so it is pinned from BOTH sides — a writer that
 * silently reacquires the column would recreate the bug, and the cron order makes
 * it invisible: function-health runs 08:00, the digest reads 09:23, form-e2e
 * writes 10:15, so a function-health null would clear every browser verdict
 * before the red alarm ever saw one.
 */
describe("who owns the `Turnstile widget` column", () => {
  it("function-health does NOT write it — it only knows whether an env var is set", async () => {
    const fields = await updateAuditFields(base(), "recA", {
      functionHealth: {
        functionHealth: "pass",
        cmsReachable: "pass",
        turnstileWidget: "fail",
        checkedAt: "2026-09-04T08:00:00.000Z",
      },
    });
    expect(Object.keys(fields)).not.toContain("Turnstile widget");
    // ...and still writes everything else it owns.
    expect(fields["Function health"]).toBe("pass");
    expect(fields["CMS Reachable"]).toBe("pass");
  });

  it("form-e2e writes it, alongside its own verdict", async () => {
    const fields = await updateAuditFields(base(), "recA", {
      formE2e: { ok: "pass", checkedAt: STAMP, turnstileWidget: "fail" },
    });
    expect(fields["Turnstile widget"]).toBe("fail");
    expect(fields["Form E2E OK"]).toBe("pass");
  });

  it("an explicit null CLEARS the cell — looked, could not tell", async () => {
    const fields = await updateAuditFields(base(), "recA", {
      formE2e: { ok: "pass", checkedAt: STAMP, turnstileWidget: null },
    });
    expect(Object.keys(fields)).toContain("Turnstile widget");
    expect(fields["Turnstile widget"]).toBeNull();
  });

  it("an ABSENT verdict omits the key — preserve, never clear", async () => {
    // The distinction that keeps a probe which cannot see Turnstile from erasing
    // a real verdict. Absent ≠ null, and the writer must not coerce one to the
    // other: Airtable treats a written null as "clear this cell".
    const fields = await updateAuditFields(base(), "recA", {
      formE2e: { ok: "pass", checkedAt: STAMP },
    });
    expect(Object.keys(fields)).not.toContain("Turnstile widget");
    expect(fields["Form E2E OK"]).toBe("pass");
  });
});

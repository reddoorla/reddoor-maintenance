import { describe, it, expect } from "vitest";
import { isPendingApproval, mapRow } from "../../src/reports/report-fields.js";

const pending = (over: Record<string, unknown> = {}) =>
  mapRow({
    id: "recREP",
    fields: { "Report type": "Maintenance", Site: ["recSITE"], "Draft ready": true, ...over },
  });

describe("isPendingApproval — a withdrawn draft is not pending (P1-28)", () => {
  it("a ready, unapproved, unsent, unwithdrawn draft is pending", () => {
    expect(isPendingApproval(pending())).toBe(true);
  });

  it("the same draft, withdrawn, is not pending", () => {
    const r = pending({ "Withdrawn at": "2026-09-30T12:00:00.000Z", "Withdrawn by": "dashboard" });
    expect(r.withdrawnAt).toBe("2026-09-30T12:00:00.000Z");
    expect(r.withdrawnBy).toBe("dashboard");
    expect(isPendingApproval(r)).toBe(false);
  });

  it("mapRow reads an absent withdrawal as null", () => {
    const r = pending();
    expect(r.withdrawnAt).toBeNull();
    expect(r.withdrawnBy).toBeNull();
  });
});

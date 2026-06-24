import { describe, it, expect } from "vitest";
import { withGlobalCc, GLOBAL_REPORT_CC } from "../../../src/reports/send/orchestrate.js";

describe("withGlobalCc", () => {
  it("CCs info@reddoorla.com when a site has no per-site CC", () => {
    expect(withGlobalCc(null, ["client@acme.com"])).toEqual([GLOBAL_REPORT_CC]);
  });

  it("appends the global CC after the per-site CC, preserving order", () => {
    expect(withGlobalCc(["a@x.com", "b@y.com"], ["client@acme.com"])).toEqual([
      "a@x.com",
      "b@y.com",
      GLOBAL_REPORT_CC,
    ]);
  });

  it("does not duplicate the global CC when it's already a per-site CC (case-insensitive)", () => {
    expect(withGlobalCc(["Info@Reddoorla.com", "a@x.com"], ["client@acme.com"])).toEqual([
      "Info@Reddoorla.com",
      "a@x.com",
    ]);
  });

  it("does not CC the global address when it is already a To recipient", () => {
    expect(withGlobalCc(["a@x.com"], ["info@reddoorla.com"])).toEqual(["a@x.com"]);
    // ...and with no per-site CC, that leaves an empty CC list (caller omits it)
    expect(withGlobalCc(null, ["info@reddoorla.com"])).toEqual([]);
  });

  it("leaves the per-site CC untouched (no dedup against To — preserves prior behavior)", () => {
    // an address in both per-site CC and To stays in CC, exactly as before
    expect(withGlobalCc(["client@acme.com"], ["client@acme.com"])).toEqual([
      "client@acme.com",
      GLOBAL_REPORT_CC,
    ]);
  });
});

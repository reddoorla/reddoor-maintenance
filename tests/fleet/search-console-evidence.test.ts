import { describe, it, expect } from "vitest";
import {
  searchConsoleEvidence,
  searchConsoleFreshDays,
  searchConsolePasses,
  toSearchConsoleOutcome,
} from "../../src/fleet/search-console-evidence.js";
import { SEARCH_CONSOLE_OPT_OUT_KEYS } from "../../src/fleet/opt-outs.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-29T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function row(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({ maintenanceFreq: "Monthly", ...over });
}

describe("toSearchConsoleOutcome", () => {
  it.each(["resolved", "no-property", "soft-fail"])("keeps %s", (v) => {
    expect(toSearchConsoleOutcome(v)).toBe(v);
  });
  it.each([null, undefined, "", "RESOLVED", "pass", 1, true])(
    "reads %j as no evidence, never as resolved",
    (v) => {
      expect(toSearchConsoleOutcome(v)).toBeNull();
    },
  );
});

describe("searchConsoleFreshDays", () => {
  it("follows the shortest report cadence plus 14 days", () => {
    expect(searchConsoleFreshDays(row({ maintenanceFreq: "Monthly" }))).toBe(45);
    expect(searchConsoleFreshDays(row({ maintenanceFreq: "Quarterly" }))).toBe(106);
    expect(searchConsoleFreshDays(row({ maintenanceFreq: "Yearly" }))).toBe(380);
    expect(
      searchConsoleFreshDays(row({ maintenanceFreq: "Quarterly", testingFreq: "Monthly" })),
    ).toBe(45);
    expect(
      searchConsoleFreshDays(row({ maintenanceFreq: "Yearly", testingFreq: "Quarterly" })),
    ).toBe(106);
    expect(searchConsoleFreshDays(row({ maintenanceFreq: "None", testingFreq: "None" }))).toBe(45);
  });
});

describe("searchConsoleEvidence", () => {
  it("passes on a resolved lookup inside the window, carrying the property it queried", () => {
    const e = searchConsoleEvidence(
      row({
        searchConsoleOutcome: "resolved",
        searchConsoleResolved: "sc-domain:acme.example.com",
        searchConsoleCheckedAt: ago(24),
      }),
      NOW,
    );
    expect(e).toEqual({
      state: "verified",
      property: "sc-domain:acme.example.com",
      checkedAt: ago(24),
    });
    expect(searchConsolePasses(e)).toBe(true);
  });

  it("the window is literal days: 44 days 23 h is fresh, 45 days 1 h is stale on a monthly site", () => {
    const at = (h: number) =>
      searchConsoleEvidence(
        row({ searchConsoleOutcome: "resolved", searchConsoleCheckedAt: ago(h) }),
        NOW,
      ).state;
    expect(at(45 * 24 - 1)).toBe("verified");
    expect(at(45 * 24 + 1)).toBe("stale");
  });

  it("a quarterly site's 80-day-old lookup is still fresh; a monthly site's is stale", () => {
    const old = { searchConsoleOutcome: "resolved" as const, searchConsoleCheckedAt: ago(80 * 24) };
    expect(searchConsoleEvidence(row({ maintenanceFreq: "Quarterly", ...old }), NOW).state).toBe(
      "verified",
    );
    const monthly = searchConsoleEvidence(row({ maintenanceFreq: "Monthly", ...old }), NOW);
    expect(monthly).toEqual({ state: "stale", checkedAt: ago(80 * 24), freshDays: 45 });
    expect(searchConsolePasses(monthly)).toBe(false);
  });

  it("a recorded property with no lookup on record does not pass", () => {
    const e = searchConsoleEvidence(
      row({ searchConsoleProperty: "sc-domain:acme.example.com" }),
      NOW,
    );
    expect(e).toEqual({ state: "none" });
    expect(searchConsolePasses(e)).toBe(false);
  });

  it("a soft-fail reads as unknown, never as pass, however fresh", () => {
    const e = searchConsoleEvidence(
      row({ searchConsoleOutcome: "soft-fail", searchConsoleCheckedAt: ago(1) }),
      NOW,
    );
    expect(e).toEqual({ state: "unknown", checkedAt: ago(1) });
    expect(searchConsolePasses(e)).toBe(false);
  });

  it("a resolved outcome with a missing or unparseable timestamp reads as unknown", () => {
    for (const checkedAt of [null, "not-a-date"]) {
      const e = searchConsoleEvidence(
        row({ searchConsoleOutcome: "resolved", searchConsoleCheckedAt: checkedAt }),
        NOW,
      );
      expect(e.state).toBe("unknown");
      expect(searchConsolePasses(e)).toBe(false);
    }
  });

  it("no property matched does not pass, whatever its age", () => {
    for (const h of [1, 400 * 24]) {
      const e = searchConsoleEvidence(
        row({ searchConsoleOutcome: "no-property", searchConsoleCheckedAt: ago(h) }),
        NOW,
      );
      expect(e).toEqual({ state: "no-property", checkedAt: ago(h) });
      expect(searchConsolePasses(e)).toBe(false);
    }
  });

  it.each(SEARCH_CONSOLE_OPT_OUT_KEYS)("the opt-out %j wins over any stored outcome", (key) => {
    for (const outcome of ["no-property", "soft-fail", null] as const) {
      const e = searchConsoleEvidence(
        row({
          acceptedWatchConditions: [key],
          searchConsoleOutcome: outcome,
          searchConsoleCheckedAt: ago(1),
        }),
        NOW,
      );
      expect(e).toEqual({ state: "opted-out" });
      expect(searchConsolePasses(e)).toBe(true);
    }
  });
});

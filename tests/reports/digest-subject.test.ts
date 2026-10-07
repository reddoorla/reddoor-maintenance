import { describe, it, expect } from "vitest";
import { digestSubject } from "../../src/reports/digest.js";
import type { AttentionItem, ReadyItem } from "../../src/alerts/attention.js";

const item = (over: Partial<AttentionItem> & { key: string }): AttentionItem => ({
  kind: "vuln",
  siteName: "Acme",
  title: `title of ${over.key}`,
  severity: "warning",
  metric: 1,
  ...over,
});

const ready = (ageDays?: number): ReadyItem => ({
  siteName: "Acme",
  reportType: "Maintenance",
  period: "2026-09",
  dashboardUrl: "https://example.com/s/acme",
  ...(ageDays === undefined ? {} : { ageDays }),
});

const subject = (over: Partial<Parameters<typeof digestSubject>[0]> = {}): string =>
  digestSubject({
    date: "2026-10-07",
    readyForYourYes: [],
    needsAttention: [],
    changes: { added: [], worse: [] },
    lastSentOn: "2026-10-01",
    ...over,
  });

describe("digestSubject", () => {
  it("names a new critical line, its ask, and how many more", () => {
    const needsAttention = [
      item({ key: "w", title: "a warning" }),
      item({ key: "b", siteName: "Beta", severity: "critical", title: "beta down" }),
      item({ key: "c", severity: "critical", title: "vuln exhausted", ask: "merge #12" }),
    ];
    expect(
      subject({
        needsAttention,
        readyForYourYes: [ready(3)],
        changes: { added: ["w", "c"], worse: ["b"] },
      }),
    ).toBe("Your fleet — 2026-10-07: Act: Acme — vuln exhausted: merge #12 (+1 more)");
  });

  it("counts a critical line that got worse, or gained an ask, and drops the ask when absent", () => {
    const needsAttention = [item({ key: "c", severity: "critical", title: "site down" })];
    expect(subject({ needsAttention, changes: { added: [], worse: ["c"] } })).toBe(
      "Your fleet — 2026-10-07: Act: Acme — site down",
    );
    expect(subject({ needsAttention, changes: { added: ["c#new ask"], worse: [] } })).toBe(
      "Your fleet — 2026-10-07: Act: Acme — site down",
    );
  });

  it("ignores a standing critical line", () => {
    const needsAttention = [item({ key: "c", severity: "critical" })];
    expect(subject({ needsAttention, readyForYourYes: [ready()] })).toBe(
      "Your fleet — 2026-10-07: 1 report ready for your yes",
    );
  });

  it("counts reports and names the oldest once it is a day old", () => {
    expect(subject({ readyForYourYes: [ready(0), ready()] })).toBe(
      "Your fleet — 2026-10-07: 2 reports ready for your yes",
    );
    expect(subject({ readyForYourYes: [ready(1), ready(4), ready(0)] })).toBe(
      "Your fleet — 2026-10-07: 3 reports ready for your yes — oldest 4 days",
    );
  });

  it("names the first new line in render order when no report waits", () => {
    const needsAttention = [
      item({ key: "a1", siteName: "Acme", title: "old" }),
      item({ key: "b1", siteName: "Beta", title: "beta new" }),
      item({ key: "a2", siteName: "Acme", title: "acme new" }),
    ];
    expect(subject({ needsAttention, changes: { added: ["b1", "a2"], worse: [] } })).toBe(
      "Your fleet — 2026-10-07: 2 new — acme new",
    );
  });

  it("says no change on a heartbeat, and first digest with nothing behind it", () => {
    const needsAttention = [item({ key: "a" })];
    expect(subject({ needsAttention })).toBe("Your fleet — 2026-10-07: no change since 2026-10-01");
    expect(subject({ needsAttention, lastSentOn: null })).toBe(
      "Your fleet — 2026-10-07: first digest",
    );
  });
});

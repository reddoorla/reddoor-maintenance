/**
 * MED-15 of the 2026-09-02 review: `PROSPECT_AUDIT_DAILY_CAP` was enforced only
 * in the dashboard dispatch path. `prospect-audit` on the CLI — the path every
 * batch to date went through, including the 29-site corpus — had no cap at all.
 *
 * Driven entirely off injected deps, like `tests/dashboard/prospect-audit-
 * trigger.test.ts`: `listRecent` is the same seam there, and no test here opens
 * a database other than an in-memory one.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import { respondToProspectAuditTrigger } from "../../src/dashboard/prospect-audit-trigger.js";
import {
  PROSPECT_AUDIT_DAILY_CAP,
  DAILY_CAP_LOOKBACK,
  countAuditsInDailyWindow,
  dailyCapMessage,
} from "../../src/prospect/daily-cap.js";
import type { PipelineDeps } from "../../src/prospect/pipeline.js";
import type { ProspectAuditListItem } from "../../src/db/prospect-audits.js";

const ORIGINAL_ENV = { ...process.env };
const NOW = new Date("2026-09-17T12:00:00.000Z");

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

/** `n` distinct-url audits at `at`. Only `created_at` is read by the cap. */
function recentRun(n: number, at = "2026-09-17T09:00:00.000Z"): ProspectAuditListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pa_${i}`,
    token: `tok${String(i).padStart(19, "0")}`,
    url: `https://site-${i}.example/`,
    business: null,
    status: "complete",
    created_at: at,
    edited_at: null,
    opened_at: null,
    chosen_terms: null,
  }));
}

/** Offline pipeline stubs, plus a counter proving whether the crawl ran at all.
 *  A cap that refuses AFTER the pipeline would have spent the money it exists
 *  to save, so "did the crawl start" is the assertion that matters. */
function stubDeps(): { deps: PipelineDeps; crawled: () => number } {
  let crawls = 0;
  return {
    crawled: () => crawls,
    deps: {
      crawl: {
        async fetchUrl() {
          // Serves ANY url, so a run that should have been refused fails on the
          // refusal assertion rather than on an unrelated crawl error.
          crawls++;
          return {
            status: 200,
            body: "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Roofing in Boise.</p></body></html>",
            headers: {},
          };
        },
        async renderPages() {
          return new Map<string, string>();
        },
        maxPages: 2,
        delayMs: 0,
      },
      analyze: {
        run: async () => ({
          businessName: "Acme Roofing",
          business: "A residential roofing company operating in Boise, Idaho.",
          entityClarity: { score: 50, missing: [] },
          categoryQueries: [
            "roof repair contractor Boise",
            "roof replacement cost",
            "flat roof repair Idaho",
          ],
          buyerQuestions: [
            { id: "cost", answered: "no", quotable: false, page: null, evidence: null },
            { id: "who-for", answered: "no", quotable: false, page: null, evidence: null },
            { id: "proof", answered: "no", quotable: false, page: null, evidence: null },
            { id: "who-does-it", answered: "no", quotable: false, page: null, evidence: null },
            { id: "where", answered: "no", quotable: false, page: null, evidence: null },
            { id: "next-step", answered: "no", quotable: false, page: null, evidence: null },
          ],
          fixes: [],
          narrative: { findability: "a", readability: "b", answers: "c" },
        }),
      },
      lighthouse: async () => {
        throw new Error("skipped in test");
      },
      probeDelayMs: 0,
    },
  };
}

describe("prospect-audit CLI — the 24h runaway brake", () => {
  it("refuses at the cap, before the crawl spends anything", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { deps, crawled } = stubDeps();
    const { output, code } = await runProspectAuditCommand("https://brand-new.example/", {
      probes: false,
      deps,
      listRecent: async () => recentRun(PROSPECT_AUDIT_DAILY_CAP),
      now: () => NOW,
    });
    expect(code).toBe(2);
    expect(output).toContain(`(cap ${PROSPECT_AUDIT_DAILY_CAP})`);
    expect(crawled()).toBe(0);
  });

  it("still runs one below the cap (positive control)", async () => {
    // Without this, a cap that refused unconditionally would pass the test above.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { deps, crawled } = stubDeps();
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      listRecent: async () => recentRun(PROSPECT_AUDIT_DAILY_CAP - 1),
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(crawled()).toBeGreaterThan(0);
  });

  it("ignores audits older than 24h — the window rolls", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { deps } = stubDeps();
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      listRecent: async () => recentRun(PROSPECT_AUDIT_DAILY_CAP, "2026-09-15T09:00:00.000Z"),
      now: () => NOW,
    });
    expect(code).toBe(0);
  });

  it("says the same thing the dashboard says", async () => {
    // The two paths refuse for the same reason; wording them separately is how
    // they drift into disagreeing about what the operator should do.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const { deps } = stubDeps();
    const { output } = await runProspectAuditCommand("https://brand-new.example/", {
      probes: false,
      deps,
      listRecent: async () => recentRun(PROSPECT_AUDIT_DAILY_CAP),
      now: () => NOW,
    });
    const dashboard = respondToProspectAuditTrigger(
      { status: "daily-cap", count: PROSPECT_AUDIT_DAILY_CAP, cap: PROSPECT_AUDIT_DAILY_CAP },
      { recipientsLabel: "the team" },
    );
    expect(output).toContain(String(dashboard.body.message));
  });

  it("with no database to count against, warns LOUDLY and runs", async () => {
    // The decision recorded in the PR: a run with no persistence cannot count
    // prior audits, and refusing would break the documented `--out`-only local
    // path. What it must never do is pass in silence.
    delete process.env.TURSO_DATABASE_URL;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = stubDeps();
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      out: `${process.env.TMPDIR ?? "/tmp"}/prospect-cap-nodb-${Date.now()}.html`,
      deps,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(output).toMatch(/runaway brake/i);
    expect(err.mock.calls.some((c) => /runaway brake/i.test(String(c[0])))).toBe(true);
  });

  it("with the count unreadable, warns LOUDLY and runs", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = stubDeps();
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      listRecent: async () => {
        throw new Error("simulated turso outage");
      },
      now: () => NOW,
    });
    // A Turso blip must not block a legitimate audit — but it must not look
    // like a passed check either.
    expect(code).toBe(0);
    expect(output).toMatch(/runaway brake/i);
    expect(err.mock.calls.some((c) => /runaway brake/i.test(String(c[0])))).toBe(true);
  });
});

describe("the shared cap arithmetic", () => {
  it("the lookback exceeds the cap, or the brake could never engage", () => {
    // Moved with the constants: a lookback at or below the cap makes the limit
    // unreachable — a guard that reads as working while doing nothing.
    expect(DAILY_CAP_LOOKBACK).toBeGreaterThan(PROSPECT_AUDIT_DAILY_CAP);
  });

  it("counts inside the window and not outside it", () => {
    expect(countAuditsInDailyWindow(recentRun(3), NOW)).toBe(3);
    expect(countAuditsInDailyWindow(recentRun(3, "2026-09-15T09:00:00.000Z"), NOW)).toBe(0);
  });

  it("names both numbers", () => {
    expect(dailyCapMessage(25, 25)).toContain("25 audits");
    expect(dailyCapMessage(25, 25)).toContain("cap 25");
  });
});

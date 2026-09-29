/**
 * MED-15 of the 2026-09-02 review: `PROSPECT_AUDIT_DAILY_CAP` was enforced only
 * in the dashboard dispatch path. `prospect-audit` on the CLI — the path every
 * batch to date went through, including the 29-site corpus — had no cap at all.
 *
 * #907: and once it had one, it counted rows written AFTER the spend, so a
 * burst of concurrent runs all read the same count and all proceeded. The CLI
 * now reserves a `running` row before the pipeline runs, atomically, and
 * finishes that same row at the end.
 *
 * The database is injected through the `openDb` seam — a real migrated
 * in-memory libSQL database, seeded per test — because the property under test
 * is what the SQL does under concurrency, which no fake can show.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { KyselyPlugin } from "kysely";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import { respondToProspectAuditTrigger } from "../../src/dashboard/prospect-audit-trigger.js";
import { PROSPECT_AUDIT_DAILY_CAP, dailyCapMessage } from "../../src/prospect/daily-cap.js";
import type { PipelineDeps } from "../../src/prospect/pipeline.js";
import { openDb, type Db } from "../../src/db/client.js";
import {
  countProspectAuditsTowardCap,
  generateToken,
  reserveProspectAudit,
} from "../../src/db/prospect-audits.js";

const ORIGINAL_ENV = { ...process.env };
const NOW = new Date("2026-09-17T12:00:00.000Z");

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

/** A migrated in-memory database holding `n` finished audits at `at` — the
 *  rows a cap has to count. */
async function seededDb(n: number, at = "2026-09-17T09:00:00.000Z"): Promise<Db> {
  const db = await openDb({ url: ":memory:" });
  for (let i = 0; i < n; i++) {
    await db
      .insertInto("prospect_audits")
      .values({
        id: `pa_seed_${i}`,
        token: generateToken(),
        url: `https://site-${i}.example/`,
        business: null,
        created_at: at,
        status: "complete",
        result_json: "{}",
      })
      .execute();
  }
  return db;
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
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP);
    const { deps, crawled } = stubDeps();
    const { output, code } = await runProspectAuditCommand("https://brand-new.example/", {
      probes: false,
      deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(code).toBe(2);
    expect(output).toContain(`(cap ${PROSPECT_AUDIT_DAILY_CAP})`);
    expect(crawled()).toBe(0);
  });

  it("still runs one below the cap (positive control)", async () => {
    // Without this, a cap that refused unconditionally would pass the test above.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP - 1);
    const { deps, crawled } = stubDeps();
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(crawled()).toBeGreaterThan(0);
  });

  it("ignores audits older than 24h — the window rolls", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP, "2026-09-15T09:00:00.000Z");
    const { deps } = stubDeps();
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(code).toBe(0);
  });

  it("says the same thing the dashboard says", async () => {
    // The two paths refuse for the same reason; wording them separately is how
    // they drift into disagreeing about what the operator should do.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP);
    const { deps } = stubDeps();
    const { output } = await runProspectAuditCommand("https://brand-new.example/", {
      probes: false,
      deps,
      openDb: async () => db,
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

  it("with the reservation unwritable, warns LOUDLY and runs", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await seededDb(0);
    // Fails exactly the first statement the run issues — the reservation step —
    // and lets everything after it through, so the persist still lands.
    let failed = false;
    const failFirst: KyselyPlugin = {
      transformQuery: (args) => {
        if (!failed) {
          failed = true;
          throw new Error("simulated turso outage");
        }
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
    const { deps } = stubDeps();
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps,
      openDb: async () => db.withPlugin(failFirst),
      now: () => NOW,
    });
    // A Turso blip must not block a legitimate audit — but it must not look
    // like a passed check either.
    expect(code).toBe(0);
    expect(output).toMatch(/runaway brake/i);
    expect(err.mock.calls.some((c) => /runaway brake/i.test(String(c[0])))).toBe(true);
  });
});

/**
 * #907. The cap bound a slow serial batch and could not bind a burst: every
 * run was invisible to it until its row was written at the very end.
 */
describe("prospect-audit CLI — a burst of concurrent runs (#907)", () => {
  it("N concurrent runs against cap C with K existing rows admit exactly C − K, and only those crawl", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const K = PROSPECT_AUDIT_DAILY_CAP - 3;
    const N = 7;
    const db = await seededDb(K, "2026-09-17T09:00:00.000Z");
    const crawledHosts = new Set<string>();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const { deps } = stubDeps();
        const fetchUrl = deps.crawl!.fetchUrl;
        deps.crawl!.fetchUrl = async (url: string) => {
          crawledHosts.add(new URL(url).hostname);
          return fetchUrl(url);
        };
        return runProspectAuditCommand(`https://burst-${i}.example/`, {
          probes: false,
          deps,
          openDb: async () => db,
          now: () => NOW,
        });
      }),
    );
    const admitted = results.filter((r) => r.code === 0).length;
    const refused = results.filter((r) => r.code === 2).length;
    expect({ admitted, refused }).toEqual({ admitted: 3, refused: N - 3 });
    // The refusals happened BEFORE the spend: only the admitted runs crawled.
    expect(crawledHosts.size).toBe(3);
    // And every admitted run finished its row — nothing is left `running`.
    const statuses = await db
      .selectFrom("prospect_audits")
      .select("status")
      .where("id", "not like", "pa_seed_%")
      .execute();
    expect(statuses.map((s) => s.status).sort()).toEqual(["partial", "partial", "partial"]);
  });

  it("a finished run's row counts against the next one", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP - 1);
    const first = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps: stubDeps().deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(first.code).toBe(0);
    const { deps, crawled } = stubDeps();
    const second = await runProspectAuditCommand("https://another.example/", {
      probes: false,
      deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(second.code).toBe(2);
    expect(crawled()).toBe(0);
  });

  it("a run the cockpit dispatched is ONE row, not two: the CLI claims the cockpit's reservation", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(0);
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: "Acme", claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      json: true,
      deps: stubDeps().deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect((JSON.parse(output) as { token: string }).token).toBe(cockpit.token);
    const rows = await db.selectFrom("prospect_audits").select(["id", "status"]).execute();
    expect(rows).toEqual([{ id: cockpit.id, status: "partial" }]);
  });

  it("#907 review P6: the finished row carries the FINISH time from a clock that moved on", async () => {
    // Every other CLI test injects a constant clock, so a finish stamped with
    // the START time would pass them all — and in production would put P6
    // back: the cockpit's 10-minute duplicate guard would run from the start.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(0);
    const started = new Date("2026-09-17T12:00:00.000Z");
    const finished = new Date("2026-09-17T12:17:00.000Z");
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: started },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    let reads = 0;
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps: stubDeps().deps,
      openDb: async () => db,
      // The first read is the reservation's; every later read is the run
      // having moved on.
      now: () => (reads++ === 0 ? started : finished),
    });
    expect(code).toBe(0);
    const row = await db
      .selectFrom("prospect_audits")
      .select(["id", "status", "created_at"])
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      id: cockpit.id,
      status: "partial",
      created_at: finished.toISOString(),
    });
    // The clock was actually consulted again, not merely advanced by luck.
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it("a run whose pipeline throws before spending gives its slot back", async () => {
    // The crawl is the pipeline's one fatal stage, and it runs before any model
    // call. A slot held by a run that spent nothing would be a leak.
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(PROSPECT_AUDIT_DAILY_CAP - 1);
    const { deps } = stubDeps();
    deps.crawl!.fetchUrl = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(
      runProspectAuditCommand("https://gone.example/", {
        probes: false,
        deps,
        openDb: async () => db,
        now: () => NOW,
      }),
    ).rejects.toThrow();
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(PROSPECT_AUDIT_DAILY_CAP - 1);
  });

  it("an invalid --goal is refused before a slot is reserved", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await seededDb(0);
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      goal: "not-a-goal",
      deps: stubDeps().deps,
      openDb: async () => db,
      now: () => NOW,
    });
    expect(code).toBe(2);
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
  });
});

describe("the shared cap wording", () => {
  it("names both numbers", () => {
    expect(dailyCapMessage(25, 25)).toContain("25 audits");
    expect(dailyCapMessage(25, 25)).toContain("cap 25");
  });
});

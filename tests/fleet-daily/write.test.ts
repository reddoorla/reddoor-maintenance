/**
 * P1-78a: the nightly `fleet_daily` writer (workspace
 * briefs/2026-10-26-p1-78a-fleet-daily.md). Every decision is driven here through
 * `writeFleetDaily` over an in-memory Turso with the real migrations, a fixture
 * conductor log, and a fake GitHub, so each of the brief's mutations has a test
 * that turns red.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";
import { kyselyOverClient, type Db } from "../../src/db/client.js";
import { writeFleetDaily, type GitHubReads } from "../../src/fleet-daily/write.js";
import { nightOf, parseConductorLog, ageDeps } from "../../src/fleet-daily/core.js";
import { readRecentRows } from "../../src/fleet-daily/read.js";
import type { FleetDailyCounts } from "../../src/fleet-daily/types.js";
import type { CockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { countFirstParentMerges, githubReads } from "../../scripts/fleet-daily.mjs";

const PLANNED = [
  "fleet-db-backup.yml",
  "fleet-prismic-drift.yml",
  "fleet-prismic-sync.yml",
  "fleet-security.yml",
  "fleet-lighthouse.yml",
  "fleet-smoke.yml",
  "fleet-form-e2e.yml",
  "daily-reports.yml",
];

const ts = "2026-10-26T06:07:12.0000000Z ";

/** A conductor log as GitHub serves it: timestamp-prefixed lines. */
function logOf(lines: string[], summary: string): string {
  return [
    `${ts}##[group]Run node scripts/nightly-conductor.mjs --ref main`,
    ...lines.map((l) => ts + l),
    ts + summary,
  ].join("\n");
}

/** Tonight's full run: every step completed, but a dispatch failed and one ran long. */
const FULL_LOG = logOf(
  [
    "NIGHTLY fleet-db-backup.yml dispatched run=101 at=2026-10-26T06:07:13Z",
    "NIGHTLY fleet-db-backup.yml run=101 conclusion=success minutes=3.1",
    "NIGHTLY fleet-prismic-drift.yml dispatch=failed error=POST actions/workflows/fleet-prismic-drift.yml/dispatches: 500 boom",
    "NIGHTLY fleet-prismic-sync.yml dispatched run=103 at=2026-10-26T06:12:00Z",
    "NIGHTLY fleet-prismic-sync.yml run=103 conclusion=success minutes=2",
    "NIGHTLY fleet-security.yml dispatched run=104 at=2026-10-26T06:15:00Z",
    "NIGHTLY fleet-security.yml run=104 conclusion=success minutes=20",
    "NIGHTLY fleet-lighthouse.yml dispatched run=105 at=2026-10-26T06:35:00Z",
    "NIGHTLY fleet-lighthouse.yml run=105 still in_progress after 50 min; moving on, it files its own issue if it fails",
    "NIGHTLY fleet-smoke.yml dispatched run=106 at=2026-10-26T07:25:00Z",
    "NIGHTLY fleet-smoke.yml run=106 conclusion=failure minutes=30",
    "NIGHTLY fleet-form-e2e.yml dispatched run=107 at=2026-10-26T07:55:00Z",
    "NIGHTLY fleet-form-e2e.yml run=107 conclusion=success minutes=5",
    "NIGHTLY daily-reports.yml dispatched run=108 at=2026-10-26T08:00:00Z",
    "NIGHTLY daily-reports.yml run=108 conclusion=success minutes=4",
  ],
  "NIGHTLY_CONDUCTOR_SUMMARY dispatched=7 completed=6 wait_exceeded=1 skipped=0 dispatch_failed=1 total=8",
);

/** The night's second run, 12 seconds long: every step skipped by the guard. */
const SKIP_LOG = logOf(
  PLANNED.map(
    (f, i) =>
      `NIGHTLY ${f} skipped: run ${101 + i} (created 2026-10-26T06:07:13Z) was dispatched by the conductor within 12 h`,
  ),
  "NIGHTLY_CONDUCTOR_SUMMARY dispatched=0 completed=0 wait_exceeded=0 skipped=8 dispatch_failed=0 total=8",
);

/** The operator re-running fleet-smoke by hand at 9:51am PT. */
const ONLY_SMOKE_LOG = logOf(
  [
    "NIGHTLY fleet-smoke.yml dispatched run=201 at=2026-10-26T16:51:10Z",
    "NIGHTLY fleet-smoke.yml run=201 conclusion=success minutes=28",
  ],
  "NIGHTLY_CONDUCTOR_SUMMARY dispatched=1 completed=1 wait_exceeded=0 skipped=0 dispatch_failed=0 total=1",
);

const ONLY_SECURITY_LOG = logOf(
  [
    "NIGHTLY fleet-security.yml dispatched run=301 at=2026-10-26T17:00:10Z",
    "NIGHTLY fleet-security.yml run=301 conclusion=success minutes=20",
  ],
  "NIGHTLY_CONDUCTOR_SUMMARY dispatched=1 completed=1 wait_exceeded=0 skipped=0 dispatch_failed=0 total=1",
);

/** 11:07pm PT on Sun 10-25 (PDT, UTC-7). */
const NIGHT_RUN = {
  id: 9001,
  attempt: 1,
  event: "workflow_dispatch",
  createdAt: "2026-10-26T06:07:05Z",
  startedAt: "2026-10-26T06:07:10Z",
  conclusion: "failure",
  headBranch: "main",
};

let client: Client;
let db: Db;

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await runMigrations(client);
  db = await kyselyOverClient(client);
  await seed();
});

async function exec(sql: string, args: Array<string | number | null> = []): Promise<void> {
  await client.execute({ sql, args });
}

async function seed(): Promise<void> {
  await exec(
    "INSERT INTO sites (id, slug, name, status) VALUES ('recA','a','Alpha','maintained'), ('recB','b','Beta','maintained'), ('recC','c','Gamma','building')",
  );
  // Alpha read tonight; Beta's stamp is from two nights ago (no reading tonight).
  await exec(
    "INSERT INTO site_health (site_id, deps_behind_packages, deps_behind_packages_at, security_audit_at, last_smoke_at) VALUES (?,?,?,?,?), (?,?,?,?,?), ('recC', NULL, NULL, '2026-10-26T06:31:00.000Z', NULL)",
    [
      "recA",
      JSON.stringify(["vite@5", "kit@2"]),
      "2026-10-26T06:30:00.000Z",
      "2026-10-26T06:30:00.000Z",
      "2026-10-26T07:40:00.000Z",
      "recB",
      JSON.stringify(["old@1"]),
      "2026-10-24T06:30:00.000Z",
      "2026-10-24T06:30:00.000Z",
      null,
    ],
  );
  const sub = (id: string, status: string, notify: string) =>
    exec(
      "INSERT INTO submissions (id, site_id, form_type, name, email, status, notify_status) VALUES (?, 'recA', 'contact', 'n', 'e', ?, ?)",
      [id, status, notify],
    );
  await sub("s1", "new", "sent");
  await sub("s2", "read", "sent");
  await sub("s3", "archived", "skipped");
  await sub("s4", "spam_auto", "skipped");
  await sub("s5", "spam", "sent");
  await sub("s6", "new", "failed");
  // The legacy marked_spam column must never be read.
  await exec(
    "INSERT INTO spam_screenouts (site_id, date, honeypot, too_fast, marked_spam) VALUES ('recA','2026-10-20',3,1,50), ('recB','2026-10-21',2,0,40)",
  );
  const rep = (id: string, sentAt: string | null, by: string | null) =>
    exec(
      "INSERT INTO reports (id, site_id, report_id, sent_at, approved_by) VALUES (?, 'recA', ?, ?, ?)",
      [id, id, sentAt, by],
    );
  await rep("r1", "2026-09-01T16:07:00Z", "dashboard");
  await rep("r2", "2026-09-02T16:07:00Z", "test send via Claude");
  await rep("r3", "2026-09-03T16:07:00Z", null);
  await rep("r4", null, "dashboard");
  await event("e1", "pr_automerged", "2026-10-20T10:00:00Z");
  await event("e2", "vuln_cleared", "2026-10-21T10:00:00Z");
}

async function event(id: string, type: string, createdAt: string): Promise<void> {
  await exec(
    "INSERT INTO fleet_events (id, ts, type, summary, created_at) VALUES (?, ?, ?, 's', ?)",
    [id, createdAt, type, createdAt],
  );
}

const MODEL = {
  cards: [
    { tier: "attention", items: [{ key: "vuln:recA" }, { key: "renovate:recA:12" }], setup: [] },
    { tier: "watch", items: [], setup: [{ reason: "no GA4" }] },
  ],
  cardless: [{ key: "url-probe-stale" }],
  summary: { preLaunch: 1 },
} as unknown as CockpitModel;

type Gh = GitHubReads & { calls: string[] };
function github(over: Partial<GitHubReads> = {}, logs: Record<number, string> = {}): Gh {
  const calls: string[] = [];
  return {
    calls,
    conductorLog: async (id, attempt) => {
      calls.push(`log ${id}/${attempt}`);
      const l = logs[id];
      if (l === undefined) throw new Error(`no log for ${id}`);
      return l;
    },
    runConclusion: async (id) => {
      calls.push(`run ${id}`);
      return null;
    },
    mergesSince: async () => 4,
    ...over,
  };
}

async function write(
  run: typeof NIGHT_RUN,
  log: string,
  over: Partial<GitHubReads> = {},
  now = new Date("2026-10-26T08:20:00Z"),
): Promise<Awaited<ReturnType<typeof writeFleetDaily>>> {
  return writeFleetDaily({
    db,
    github: github(over, { [run.id]: log }),
    run,
    planned: PLANNED,
    cockpit: async () => MODEL,
    now,
  });
}

async function rows(): Promise<
  Array<{ night: string; counts: FleetDailyCounts; writtenAt: string }>
> {
  return readRecentRows(db, 100);
}

async function only(): Promise<FleetDailyCounts> {
  const r = await rows();
  expect(r).toHaveLength(1);
  return r[0]!.counts;
}

describe("the night key", () => {
  it("names the evening the 11:07pm PT clock ran in, and a run after midnight the evening before", () => {
    expect(nightOf("2026-10-26T06:07:05Z")).toBe("2026-10-25"); // 11:07pm PDT Sun
    expect(nightOf("2026-10-26T07:19:00Z")).toBe("2026-10-25"); // 12:19am PDT Mon
    expect(nightOf("2026-11-03T07:07:00Z")).toBe("2026-11-02"); // 11:07pm PST, after DST ends
  });
});

describe("the conductor's log", () => {
  it("reads every step's outcome and the summary from GitHub's timestamped lines", () => {
    const log = parseConductorLog(FULL_LOG);
    expect(log.summary).toEqual({
      dispatched: 7,
      completed: 6,
      waitExceeded: 1,
      skipped: 0,
      dispatchFailed: 1,
      total: 8,
    });
    expect(log.steps["fleet-db-backup.yml"]).toEqual({
      outcome: "completed",
      runId: 101,
      conclusion: "success",
    });
    expect(log.steps["fleet-lighthouse.yml"]).toEqual({
      outcome: "running",
      runId: 105,
      conclusion: null,
    });
  });
});

describe("a full night", () => {
  it("writes one row, keyed by the night, with every planned step", async () => {
    const out = await write(NIGHT_RUN, FULL_LOG);
    expect(out).toEqual({ action: "wrote", night: "2026-10-25" });
    const c = await only();
    expect(Object.keys(c.steps).sort()).toEqual([...PLANNED].sort());
    expect(c.steps["fleet-smoke.yml"]).toEqual({
      outcome: "completed",
      runId: 106,
      conclusion: "failure",
    });
  });

  it("records a failed dispatch as a failed step, never drops it", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const c = await only();
    expect(c.steps["fleet-prismic-drift.yml"]).toMatchObject({
      outcome: "failed",
      runId: null,
      conclusion: "dispatch-failed",
    });
  });

  it("writes ladder version 0 until the ladder ships", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).ladderVersion).toBe(0);
  });

  it("a re-run of the same night replaces the row, never adds one", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    await exec(
      "INSERT INTO submissions (id, site_id, form_type, name, email, status, notify_status) VALUES ('s9','recA','contact','n','e','new','sent')",
    );
    await write(
      { ...NIGHT_RUN, attempt: 2, startedAt: "2026-10-26T15:00:00Z" },
      FULL_LOG,
      {},
      new Date("2026-10-26T16:00:00Z"),
    );
    const c = await only();
    expect(c.run.attempt).toBe(2);
    expect(c.leads.value?.new).toBe(3);
  });

  it("counts leads by status and the notified real ones", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).leads).toEqual({
      value: { new: 2, read: 1, archived: 1, spamAuto: 1, spam: 1, notified: 2 },
    });
  });

  it("counts screen-outs from honeypot and too_fast, never the legacy marked_spam", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).screenouts).toEqual({ value: { honeypot: 5, tooFast: 1 } });
  });

  it("counts real sends only: a test send is out, a send with no approver is in", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).reportsSent).toEqual({ value: 2 });
  });

  it("counts the cockpit's verdicts: sites per tier and open items by key prefix", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const c = await only();
    expect(c.sites).toEqual({
      value: { cards: 2, tiers: { attention: 1, watch: 1 }, preLaunch: 1, setup: 1 },
    });
    expect(c.signals).toEqual({ value: { vuln: 1, renovate: 1, "url-probe-stale": 1 } });
  });

  it("stores a failed GitHub read as null with its reason, never 0", async () => {
    await write(NIGHT_RUN, FULL_LOG, {
      mergesSince: async () => {
        throw new Error("GET commits: 403");
      },
    });
    const c = await only();
    expect(c.prsMerged.value).toBeNull();
    expect(c.prsMerged.reason).toContain("403");
  });

  it("a cockpit that would not build is null with its reason, and the rest still writes", async () => {
    await writeFleetDaily({
      db,
      github: github({}, { [NIGHT_RUN.id]: FULL_LOG }),
      run: NIGHT_RUN,
      planned: PLANNED,
      cockpit: async () => {
        throw new Error("digest snapshot unreadable");
      },
      now: new Date("2026-10-26T08:20:00Z"),
    });
    const c = await only();
    expect(c.sites).toEqual({ value: null, reason: "cockpit: digest snapshot unreadable" });
    expect(c.leads.value).not.toBeNull();
  });

  it("counts the sites each step stamped since the run started", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const cov = (await only()).coverage.value!;
    // Gamma (building) was stamped too, but coverage counts maintained sites only.
    expect(cov.security_audit_at).toBe(1);
    expect(cov.last_smoke_at).toBe(1);
    expect(cov.lighthouse_at).toBe(0);
  });
});

describe("the runs that are not a full night", () => {
  it("the guard's skip run writes nothing, and leaves the night's steps as they were", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const before = await rows();
    const out = await write(
      {
        ...NIGHT_RUN,
        id: 9002,
        createdAt: "2026-10-26T07:19:00Z",
        startedAt: "2026-10-26T07:19:02Z",
        event: "schedule",
        conclusion: "success",
      },
      SKIP_LOG,
    );
    expect(out.action).toBe("none");
    expect(await rows()).toEqual(before);
  });

  it("a guard run that dispatches what the clock's dispatch failed on merges, never replaces the night", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const before = (await only()).steps;
    const retry = logOf(
      [
        ...PLANNED.filter((f) => f !== "fleet-prismic-drift.yml").map(
          (f) =>
            `NIGHTLY ${f} skipped: run 1 (created 2026-10-26T06:07:13Z) was dispatched by the conductor within 12 h`,
        ),
        "NIGHTLY fleet-prismic-drift.yml dispatched run=110 at=2026-10-26T07:19:05Z",
        "NIGHTLY fleet-prismic-drift.yml run=110 conclusion=success minutes=4",
      ],
      "NIGHTLY_CONDUCTOR_SUMMARY dispatched=1 completed=1 wait_exceeded=0 skipped=7 dispatch_failed=0 total=8",
    );
    // "Re-run failed jobs": attempt 2 of the same run, so the same night.
    const out = await write({ ...NIGHT_RUN, attempt: 2, startedAt: "2026-10-26T07:19:00Z" }, retry);
    expect(out).toEqual({ action: "merged", night: "2026-10-25" });
    const c = await only();
    expect(c.steps["fleet-prismic-drift.yml"]).toEqual({
      outcome: "completed",
      runId: 110,
      conclusion: "success",
    });
    for (const f of PLANNED.filter((x) => x !== "fleet-prismic-drift.yml"))
      expect(c.steps[f]).toEqual(before[f]);
    expect(c.run.id).toBe(NIGHT_RUN.id);
    expect(c.run.attempt).toBe(1);
    expect(c.deps.value!.sites.recA!.packages).toEqual(["kit@2", "vite@5"]);
  });

  it("reads this attempt's log, not the latest attempt's", async () => {
    const gh = github({}, { [NIGHT_RUN.id]: FULL_LOG });
    await writeFleetDaily({
      db,
      github: gh,
      run: { ...NIGHT_RUN, attempt: 3 },
      planned: PLANNED,
      cockpit: async () => MODEL,
      now: new Date("2026-10-26T08:20:00Z"),
    });
    expect(gh.calls[0]).toBe(`log ${NIGHT_RUN.id}/3`);
  });

  it("an --only run merges its steps into the night and leaves the other steps as they were", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const before = (await only()).steps;
    const out = await write(
      {
        ...NIGHT_RUN,
        id: 9003,
        createdAt: "2026-10-26T16:51:00Z",
        startedAt: "2026-10-26T16:51:05Z",
        conclusion: "success",
      },
      ONLY_SMOKE_LOG,
    );
    expect(out).toEqual({ action: "merged", night: "2026-10-25" });
    const c = await only();
    expect(c.steps["fleet-smoke.yml"]).toEqual({
      outcome: "completed",
      runId: 201,
      conclusion: "success",
    });
    for (const f of PLANNED.filter((x) => x !== "fleet-smoke.yml"))
      expect(c.steps[f]).toEqual(before[f]);
    expect(c.merges).toEqual([
      { runId: 9003, startedAt: "2026-10-26T16:51:05Z", steps: ["fleet-smoke.yml"] },
    ]);
  });

  it("a daytime --only run never makes a row of its own date", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    await write(
      {
        ...NIGHT_RUN,
        id: 9003,
        createdAt: "2026-10-26T16:51:00Z",
        startedAt: "2026-10-26T16:51:05Z",
      },
      ONLY_SMOKE_LOG,
    );
    expect((await rows()).map((r) => r.night)).toEqual(["2026-10-25"]);
  });

  it("an --only run with no night in the 24 hours before it writes nothing", async () => {
    const out = await write(
      {
        ...NIGHT_RUN,
        id: 9003,
        createdAt: "2026-10-26T16:51:00Z",
        startedAt: "2026-10-26T16:51:05Z",
      },
      ONLY_SMOKE_LOG,
    );
    expect(out.action).toBe("none");
    expect(await rows()).toEqual([]);
  });

  it("a log with no summary line is refused, not read as a skip", async () => {
    await expect(write(NIGHT_RUN, `${ts}nothing here`)).rejects.toThrow(
      /NIGHTLY_CONDUCTOR_SUMMARY/,
    );
  });

  it("a conductor run off main writes nothing", async () => {
    const out = await write({ ...NIGHT_RUN, headBranch: "claude/x" }, FULL_LOG);
    expect(out.action).toBe("none");
  });
});

describe("the next night", () => {
  const NEXT = {
    ...NIGHT_RUN,
    id: 9101,
    createdAt: "2026-10-27T06:07:05Z",
    startedAt: "2026-10-27T06:07:10Z",
  };

  it("fills in the conclusion of a run the conductor stopped waiting for", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    await write(
      NEXT,
      FULL_LOG.replaceAll("2026-10-26T", "2026-10-27T"),
      {
        runConclusion: async (id) => (id === 105 ? "success" : null),
      },
      new Date("2026-10-27T08:20:00Z"),
    );
    const prev = (await rows()).find((r) => r.night === "2026-10-25")!.counts;
    expect(prev.steps["fleet-lighthouse.yml"]).toEqual({
      outcome: "completed",
      runId: 105,
      conclusion: "success",
    });
  });

  it("adds tonight's events to the previous row's total, never re-counting it", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).events).toEqual({ value: { pr_automerged: 1, vuln_cleared: 1 } });
    await event("e3", "pr_automerged", "2026-10-26T20:00:00Z");
    await write(NEXT, FULL_LOG, {}, new Date("2026-10-27T08:20:00Z"));
    // A re-run of the next night takes the same base, not its own earlier row.
    await write({ ...NEXT, attempt: 2 }, FULL_LOG, {}, new Date("2026-10-27T09:00:00Z"));
    const next = (await rows()).find((r) => r.night === "2026-10-26")!.counts;
    expect(next.events).toEqual({ value: { pr_automerged: 2, vuln_cleared: 1 } });
  });

  it("takes the base from the newest earlier row, not an older one", async () => {
    const third = {
      ...NIGHT_RUN,
      id: 9201,
      createdAt: "2026-10-28T06:07:05Z",
      startedAt: "2026-10-28T06:07:10Z",
    };
    await write(NIGHT_RUN, FULL_LOG, { mergesSince: async () => 10 });
    await write(NEXT, FULL_LOG, { mergesSince: async () => 3 }, new Date("2026-10-27T08:20:00Z"));
    await event("e5", "pr_automerged", "2026-10-27T20:00:00Z");
    await write(third, FULL_LOG, { mergesSince: async () => 2 }, new Date("2026-10-28T08:20:00Z"));
    const r = (await rows()).find((x) => x.night === "2026-10-27")!.counts;
    expect(r.prsMerged).toEqual({ value: 15 });
    expect(r.events).toEqual({ value: { pr_automerged: 2, vuln_cleared: 1 } });
  });

  it("counts nothing written after the row's own cut-off, so the next night cannot count it twice", async () => {
    const until: string[] = [];
    await event("late", "pr_automerged", "2026-10-26T08:20:01Z");
    await write(NIGHT_RUN, FULL_LOG, {
      mergesSince: async (_s, u) => {
        until.push(u);
        return 1;
      },
    });
    expect((await only()).events).toEqual({ value: { pr_automerged: 1, vuln_cleared: 1 } });
    expect(until).toEqual(["2026-10-26T08:20:00.000Z"]);
    await write(NEXT, FULL_LOG, {}, new Date("2026-10-27T08:20:00Z"));
    const next = (await rows()).find((x) => x.night === "2026-10-26")!.counts;
    expect(next.events).toEqual({ value: { pr_automerged: 2, vuln_cleared: 1 } });
  });

  it("adds tonight's merges to the previous total, read since that row was written", async () => {
    const since: string[] = [];
    await write(NIGHT_RUN, FULL_LOG, { mergesSince: async () => 30 });
    await write(
      NEXT,
      FULL_LOG,
      {
        mergesSince: async (s) => {
          since.push(s);
          return 3;
        },
      },
      new Date("2026-10-27T08:20:00Z"),
    );
    expect(since).toEqual(["2026-10-26T08:20:00.000Z"]);
    expect((await rows()).find((r) => r.night === "2026-10-26")!.counts.prsMerged).toEqual({
      value: 33,
    });
  });

  it("never prunes an old night: the table is the history", async () => {
    await exec(
      "INSERT INTO fleet_daily (night, counts, written_at) VALUES ('2026-06-01', ?, '2026-06-02T08:00:00Z')",
      [
        JSON.stringify({
          run: { createdAt: "2026-06-02T06:07:00Z" },
          deps: { value: null, reason: "x" },
          events: { value: null, reason: "x" },
          prsMerged: { value: null, reason: "x" },
          steps: {},
        }),
      ],
    );
    await write(NIGHT_RUN, FULL_LOG);
    expect((await rows()).map((r) => r.night)).toEqual(["2026-10-25", "2026-06-01"]);
  });
});

describe("the dependency lists", () => {
  it("stores tonight's list, and null for a site whose stamp did not advance", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const deps = (await only()).deps.value!;
    expect(deps.sites.recA!.packages).toEqual(["kit@2", "vite@5"]);
    expect(deps.sites.recA!.firstSeen).toEqual({ "kit@2": "2026-10-25", "vite@5": "2026-10-25" });
    expect(deps.sites.recB!.packages).toBeNull();
    expect(deps.sites.recB!.reason).toContain("not read tonight");
    expect(deps.behind).toBe(2);
    expect(Object.keys(deps.sites)).toEqual(["recA", "recB"]);
  });

  it("a merge re-reads the coverage its steps stamped", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    expect((await only()).coverage.value!.last_smoke_at).toBe(1);
    await exec("UPDATE site_health SET last_smoke_at = ? WHERE site_id = 'recB'", [
      "2026-10-26T17:20:00.000Z",
    ]);
    await write(
      {
        ...NIGHT_RUN,
        id: 9003,
        createdAt: "2026-10-26T16:51:00Z",
        startedAt: "2026-10-26T16:51:05Z",
      },
      ONLY_SMOKE_LOG,
    );
    expect((await only()).coverage.value!.last_smoke_at).toBe(2);
  });

  it("a deps re-read that fails during a merge keeps the night's reading", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    const before = (await only()).deps;
    await exec("ALTER TABLE site_health RENAME TO site_health_gone");
    await write(
      {
        ...NIGHT_RUN,
        id: 9004,
        createdAt: "2026-10-26T17:00:00Z",
        startedAt: "2026-10-26T17:00:05Z",
      },
      ONLY_SECURITY_LOG,
    );
    const c = await only();
    expect(c.deps).toEqual(before);
    expect(c.coverage.value).not.toBeNull();
  });

  it("a list the row could not take because fleet-security was still running says so", async () => {
    await write(
      NIGHT_RUN,
      FULL_LOG.replace(
        "NIGHTLY fleet-security.yml run=104 conclusion=success minutes=20",
        "NIGHTLY fleet-security.yml run=104 still in_progress after 30 min; moving on, it files its own issue if it fails",
      ),
    );
    const deps = (await only()).deps.value!;
    expect(deps.sites.recB!.packages).toBeNull();
    expect(deps.sites.recB!.reason).toContain("fleet-security run 104 was still running");
  });

  it("an --only security run re-reads the lists for that night", async () => {
    await write(NIGHT_RUN, FULL_LOG);
    await exec(
      "UPDATE site_health SET deps_behind_packages = ?, deps_behind_packages_at = ? WHERE site_id = 'recB'",
      [JSON.stringify(["old@1"]), "2026-10-26T17:10:00.000Z"],
    );
    await write(
      {
        ...NIGHT_RUN,
        id: 9004,
        createdAt: "2026-10-26T17:00:00Z",
        startedAt: "2026-10-26T17:00:05Z",
      },
      ONLY_SECURITY_LOG,
    );
    const deps = (await only()).deps.value!;
    expect(deps.sites.recB!.packages).toEqual(["old@1"]);
    // Alpha's re-read failed (its stamp did not move): the night's reading stands.
    expect(deps.sites.recA!.packages).toEqual(["kit@2", "vite@5"]);
  });

  it("ages each key across nights, resets one the site upgraded, and skips a null night", () => {
    const n1 = ageDeps(
      [
        {
          id: "s",
          name: "S",
          packages: JSON.stringify(["a@1", "b@2"]),
          at: "2026-10-01T07:00:00Z",
        },
      ],
      null,
      "2026-09-30",
      "2026-10-01T06:00:00Z",
    );
    // Night 2: no reading. Nothing resets, nothing ends.
    const n2 = ageDeps(
      [{ id: "s", name: "S", packages: JSON.stringify(["a@1"]), at: "2026-10-01T07:00:00Z" }],
      n1.sites,
      "2026-10-01",
      "2026-10-02T06:00:00Z",
    );
    expect(n2.sites.s!.packages).toBeNull();
    expect(n2.sites.s!.firstSeen).toEqual({ "a@1": "2026-09-30", "b@2": "2026-09-30" });
    // Night 3: b upgraded (b@2 gone), c appears.
    const n3 = ageDeps(
      [
        {
          id: "s",
          name: "S",
          packages: JSON.stringify(["a@1", "c@3"]),
          at: "2026-10-03T07:00:00Z",
        },
      ],
      n2.sites,
      "2026-10-02",
      "2026-10-03T06:00:00Z",
    );
    expect(n3.sites.s!.firstSeen).toEqual({ "a@1": "2026-09-30", "c@3": "2026-10-02" });
    // Night 4: b@2 is back, so its run starts again.
    const n4 = ageDeps(
      [
        {
          id: "s",
          name: "S",
          packages: JSON.stringify(["a@1", "b@2"]),
          at: "2026-10-04T07:00:00Z",
        },
      ],
      n3.sites,
      "2026-10-03",
      "2026-10-04T06:00:00Z",
    );
    expect(n4.sites.s!.firstSeen).toEqual({ "a@1": "2026-09-30", "b@2": "2026-10-03" });
  });

  it("carries first-seen dates from the newest row that has them, past a night whose deps read failed", async () => {
    const first = {
      ...NIGHT_RUN,
      createdAt: "2026-10-24T06:07:05Z",
      startedAt: "2026-10-24T06:07:10Z",
    };
    await exec("UPDATE site_health SET deps_behind_packages_at = ? WHERE site_id = 'recA'", [
      "2026-10-24T06:30:00.000Z",
    ]);
    await write(first, FULL_LOG, {}, new Date("2026-10-24T08:20:00Z"));
    await exec(
      "INSERT INTO fleet_daily (night, counts, written_at) VALUES ('2026-10-24', ?, '2026-10-25T08:20:00Z')",
      [
        JSON.stringify({
          ...(await rows())[0]!.counts,
          run: { ...NIGHT_RUN, createdAt: "2026-10-25T06:07:05Z" },
          deps: { value: null, reason: "deps: boom" },
        }),
      ],
    );
    await exec("UPDATE site_health SET deps_behind_packages_at = ? WHERE site_id = 'recA'", [
      "2026-10-26T06:30:00.000Z",
    ]);
    await write(NIGHT_RUN, FULL_LOG);
    const r = (await rows()).find((x) => x.night === "2026-10-25")!.counts;
    expect(r.deps.value!.sites.recA!.firstSeen["vite@5"]).toBe("2026-10-23");
  });
});

describe("first-parent merges", () => {
  it("counts the PR commits on main's first-parent line, not a merged branch's own commits", () => {
    const c = new Map([
      ["h", { parents: ["g", "x2"], message: "Merge pull request #12 from a/b" }],
      ["x2", { parents: ["x1"], message: "wip (#999)" }],
      ["g", { parents: ["f"], message: "feat: thing (#11)\n\nbody" }],
      ["f", { parents: ["e"], message: "chore: direct push" }],
      ["e", { parents: ["d"], message: "fix: other (#10)" }],
    ]);
    expect(countFirstParentMerges("h", c)).toBe(3);
    expect(countFirstParentMerges(null, c)).toBe(0);
  });
});

describe("the GitHub reads", () => {
  it("fetches the conductor's jobs for the attempt being written, then that job's log", async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      if (url.includes("/jobs?"))
        return new Response(JSON.stringify({ jobs: [{ id: 77, name: "conduct" }] }));
      return new Response("log text");
    }) as unknown as typeof globalThis.fetch;
    const text = await githubReads(fetch, "t", "o/r").conductorLog(9001, 2);
    expect(text).toBe("log text");
    expect(urls).toEqual([
      "https://api.github.com/repos/o/r/actions/runs/9001/attempts/2/jobs?per_page=10",
      "https://api.github.com/repos/o/r/actions/jobs/77/logs",
    ]);
  });
});

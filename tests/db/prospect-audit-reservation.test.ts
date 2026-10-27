/**
 * #907. The prospect-audit daily cap counted rows that only existed after the
 * money was spent: `createProspectAudit` ran at the very end of a run, so every
 * run was invisible to the cap for its whole duration and N concurrent starts
 * all read the same count and all proceeded.
 *
 * The cap is now a RESERVATION. A `running` row is written before anything is
 * spent, by one conditional INSERT that counts and inserts in the same
 * statement, and the count is `running` rows plus finished rows inside the
 * 24h window — minus `running` rows old enough to be a crashed run.
 *
 * Every test here runs against a real migrated in-memory libSQL database. The
 * property under test is what the SQL does, so a fake would prove nothing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs } from "kysely";
import { openDb } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  claimProspectAuditReservation,
  countProspectAuditsTowardCap,
  failProspectAudit,
  finishProspectAudit,
  generateToken,
  getProspectAuditByToken,
  listRecentProspectAudits,
  releaseProspectAuditReservation,
  reserveProspectAudit,
  setProspectAuditOverrides,
  siteKey,
} from "../../src/db/prospect-audits.js";
import {
  PROSPECT_AUDIT_DAILY_CAP,
  PROSPECT_AUDIT_STALE_AFTER_MS,
} from "../../src/prospect/daily-cap.js";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** ISO timestamp `ms` before NOW. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

/** A row written straight into the table, so a test can place one at any age
 *  and in any state without going through the code under test. */
async function seed(
  n: number,
  over: {
    status?: string;
    createdAt?: string;
    claimedAt?: string | null;
    url?: (i: number) => string;
  } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `seed_${over.status ?? "complete"}_${i}_${Math.random().toString(36).slice(2)}`;
    const url = over.url ? over.url(i) : `https://seeded-${i}.example/`;
    await db
      .insertInto("prospect_audits")
      .values({
        id,
        token: generateToken(),
        url,
        // Set, as every real writer sets it. Left NULL, the claim could never
        // match a seeded row, and a claim test would pass for that reason
        // instead of the one it names (review of c538d9c9).
        site_key: siteKey(url),
        business: null,
        created_at: over.createdAt ?? ago(3 * HOUR),
        status: over.status ?? "complete",
        result_json: "{}",
        claimed_at: over.claimedAt ?? null,
      })
      .execute();
    ids.push(id);
  }
  return ids;
}

function start(i: number): { url: string; business: null; claimed: true } {
  return { url: `https://burst-${i}.example/`, business: null, claimed: true };
}

async function burst(n: number, cap: number): Promise<number> {
  const outcomes = await Promise.all(
    Array.from({ length: n }, (_, i) => reserveProspectAudit(db, start(i), { now: NOW, cap })),
  );
  return outcomes.filter((o) => o.kind === "reserved").length;
}

describe("reserveProspectAudit — N concurrent starts against cap C with K existing rows", () => {
  // The issue's own shape: distinct hostnames, all started at once. Several
  // (C, K, N) so a reservation that happened to be right at one point cannot
  // pass, including K >= C (admit none) and N < C - K (admit all N).
  const cases: Array<[cap: number, existing: number, starts: number]> = [
    [5, 0, 12],
    [5, 3, 12],
    [5, 5, 12],
    [5, 7, 12],
    [10, 2, 4],
    [PROSPECT_AUDIT_DAILY_CAP, 20, 30],
  ];
  for (const [cap, existing, starts] of cases) {
    const expected = Math.min(starts, Math.max(0, cap - existing));
    it(`C=${cap}, K=${existing}, N=${starts} admits exactly ${expected}`, async () => {
      await seed(existing);
      expect(await burst(starts, cap)).toBe(expected);
      // And the table agrees: exactly that many `running` rows were written.
      const running = await db
        .selectFrom("prospect_audits")
        .select("id")
        .where("status", "=", "running")
        .execute();
      expect(running).toHaveLength(expected);
    });
  }

  it("a refusal carries the count, so the message can name both numbers", async () => {
    await seed(5);
    const out = await reserveProspectAudit(db, start(0), { now: NOW, cap: 5 });
    expect(out).toEqual({ kind: "capped", count: 5 });
  });
});

describe("what the cap counts", () => {
  it("a finished run's row counts", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 });
    if (r.kind !== "reserved") throw new Error("positive control: the first start must reserve");
    const done = await finishProspectAudit(db, r.id, {
      url: start(0).url,
      business: "Acme",
      status: "complete",
      resultJson: '{"ok":true}',
    });
    expect(done).toEqual({ id: r.id, token: r.token });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
    expect((await reserveProspectAudit(db, start(1), { now: NOW, cap: 1 })).kind).toBe("capped");
  });

  it("a partial run's row counts too — it spent the same money", async () => {
    await seed(1, { status: "partial" });
    expect((await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 })).kind).toBe("capped");
  });

  it("a fresh `running` row does NOT free its slot", async () => {
    // Just inside the stale window: still a live run as far as the cap knows.
    await seed(1, { status: "running", createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS - MIN) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
    expect((await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 })).kind).toBe("capped");
  });

  it("a stale `running` row frees its slot", async () => {
    // Just past the stale window: a run that never reached a terminal state.
    await seed(1, { status: "running", createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + MIN) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
    expect((await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 })).kind).toBe("reserved");
  });

  it("a run CLAIMED recently still counts, however long ago the cockpit dispatched it (review P3)", async () => {
    // Dispatched 125 min ago, so past the stale window by its creation time;
    // picked up by its job 10 min ago, so it is spending right now. Judged by
    // `created_at` it would free its slot mid-spend.
    await seed(1, {
      status: "running",
      createdAt: ago(125 * MIN),
      claimedAt: ago(10 * MIN),
    });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
    expect((await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 })).kind).toBe("capped");
  });

  it("a claimed run goes stale from its CLAIM, not before", async () => {
    await seed(1, {
      status: "running",
      createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + 2 * HOUR),
      claimedAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + MIN),
    });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
  });

  it("a FINISHED row older than the stale window still counts — staleness is for `running` only", async () => {
    await seed(1, { status: "complete", createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + HOUR) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
  });

  it("a `failed` row older than the stale window still counts, and stops at 24h (P1-16)", async () => {
    await seed(1, { status: "failed", createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + HOUR) });
    await seed(1, { status: "failed", createdAt: ago(24 * HOUR - MIN) });
    await seed(1, { status: "failed", createdAt: ago(24 * HOUR + MIN) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(2);
  });

  it("nothing older than 24h counts, finished or not — the window still rolls", async () => {
    await seed(3, { status: "complete", createdAt: ago(24 * HOUR + MIN) });
    await seed(3, { status: "running", createdAt: ago(24 * HOUR + MIN) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
  });

  it("counts past the old 50-row lookback — the SQL count has no LIMIT", async () => {
    // The cap used to count the newest DAILY_CAP_LOOKBACK (50) rows in JS. A
    // COUNT(*) has no such ceiling; this pins that it stayed that way.
    await seed(60);
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(60);
  });
});

/**
 * The mutation this exists for: a reservation written as "count, then insert"
 * in two statements. Promise.all already interleaves those, but this makes the
 * interleave DETERMINISTIC and visible: start A is held after its first
 * statement until start B's first statement has completed. With a single
 * conditional INSERT, A's first statement IS its reservation, so B sees it and
 * is refused. With count-then-insert, A and B both count 0 before either
 * inserts, and both are admitted against a cap of 1.
 */
describe("the reservation is one atomic statement", () => {
  function barrier(): {
    holdA: KyselyPlugin;
    signalB: KyselyPlugin;
    statementsA: string[];
    statementsB: string[];
  } {
    let release!: () => void;
    const bDone = new Promise<void>((r) => (release = r));
    let aFirst = true;
    let bFirst = true;
    const statementsA: string[] = [];
    const statementsB: string[] = [];
    const recorder = (into: string[]) => (args: PluginTransformQueryArgs) => {
      into.push(args.node.kind);
      return args.node;
    };
    return {
      statementsA,
      statementsB,
      holdA: {
        transformQuery: recorder(statementsA),
        async transformResult(args: PluginTransformResultArgs) {
          if (aFirst) {
            aFirst = false;
            await bDone;
          }
          return args.result;
        },
      },
      signalB: {
        transformQuery: recorder(statementsB),
        async transformResult(args: PluginTransformResultArgs) {
          if (bFirst) {
            bFirst = false;
            release();
          }
          return args.result;
        },
      },
    };
  }

  it("A held between its first and second statement, B runs in the gap: exactly one admitted", async () => {
    const b = barrier();
    const dbA = db.withPlugin(b.holdA);
    const dbB = db.withPlugin(b.signalB);
    const [a, bb] = await Promise.all([
      reserveProspectAudit(dbA, start(0), { now: NOW, cap: 1 }),
      reserveProspectAudit(dbB, start(1), { now: NOW, cap: 1 }),
    ]);
    const admitted = [a, bb].filter((o) => o.kind === "reserved").length;
    expect(
      admitted,
      `A issued [${b.statementsA.join(", ")}], B issued [${b.statementsB.join(", ")}]`,
    ).toBe(1);
  });
});

/**
 * SQLITE_BUSY is how SQLite refuses the second of two concurrent writers — the
 * atomicity working — and it arrives exactly when a burst does. The CLI treats
 * a reservation that throws as a blip and runs unbraked (the MED-15 fail-open
 * decision), so an unretried BUSY would let every loser of the lock race
 * through. Measured on 2026-09-29 with twelve OS processes against one SQLite
 * file: 3 to 8 of them got SQLITE_BUSY rather than an answer, until retried.
 */
describe("a busy database is retried, not mistaken for a blip", () => {
  function failFirst(times: number, err: () => Error): KyselyPlugin {
    let left = times;
    return {
      transformQuery(args) {
        if (args.node.kind === "InsertQueryNode" || args.node.kind === "UpdateQueryNode") {
          if (left > 0) {
            left--;
            throw err();
          }
        }
        return args.node;
      },
      transformResult: async (args) => args.result,
    };
  }
  const busy = () =>
    Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" });

  it("a reservation that meets SQLITE_BUSY twice still gets its answer", async () => {
    const r = await reserveProspectAudit(db.withPlugin(failFirst(2, busy)), start(0), { now: NOW });
    expect(r.kind).toBe("reserved");
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
  });

  it("a claim that meets SQLITE_BUSY still claims", async () => {
    await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    const claimed = await claimProspectAuditReservation(
      db.withPlugin(failFirst(1, busy)),
      "https://acme.example/",
      NOW,
    );
    expect(claimed).not.toBeNull();
  });

  it("any OTHER error is not retried — it propagates on the first attempt", async () => {
    await expect(
      reserveProspectAudit(
        db.withPlugin(failFirst(1, () => new Error("no such table: prospect_audits"))),
        start(0),
        { now: NOW },
      ),
    ).rejects.toThrow(/no such table/);
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
  });
});

describe("the cockpit → runner handoff: one audit, one row", () => {
  it("the CLI claims the cockpit's unclaimed reservation for the same url", async () => {
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: "Acme", claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    const claimed = await claimProspectAuditReservation(db, "https://acme.example/", NOW);
    expect(claimed).toEqual({ id: cockpit.id, token: cockpit.token });
    // A second claimant for the same url gets nothing: the claim is taken.
    expect(await claimProspectAuditReservation(db, "https://acme.example/", NOW)).toBeNull();
  });

  it("concurrent claims of one reservation: exactly one wins", async () => {
    await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        claimProspectAuditReservation(db, "https://acme.example/", NOW),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("does not claim a reservation the CLI itself made (already claimed)", async () => {
    await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: true },
      { now: NOW },
    );
    expect(await claimProspectAuditReservation(db, "https://acme.example/", NOW)).toBeNull();
  });

  it("does not claim a STALE reservation — that slot is no longer counted, so it must be re-reserved under the cap", async () => {
    await seed(1, {
      status: "running",
      createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + MIN),
      url: () => "https://acme.example/",
    });
    expect(await claimProspectAuditReservation(db, "https://acme.example/", NOW)).toBeNull();
  });

  it("claims the UNCLAIMED reservation when an older CLAIMED one exists for the same site (review M1)", async () => {
    // A direct CLI run of acme took the older row; the cockpit then dispatched
    // acme again. The dispatched job must find the second row. Were the
    // subquery to pick the oldest running row regardless of claim, the outer
    // `claimed_at IS NULL` re-check would reject it, the claim would return
    // null, and the job would reserve a second slot for one audit.
    await seed(1, {
      status: "running",
      createdAt: ago(20 * MIN),
      claimedAt: ago(20 * MIN),
      url: () => "https://acme.example/",
    });
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    expect(await claimProspectAuditReservation(db, "https://acme.example/", NOW)).toEqual({
      id: cockpit.id,
      token: cockpit.token,
    });
  });

  it("claims across spellings of the same site — a reshaped url must not cost a second slot", async () => {
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://www.acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    expect(await claimProspectAuditReservation(db, "http://acme.example", NOW)).toEqual({
      id: cockpit.id,
      token: cockpit.token,
    });
  });

  it("does not claim another site's reservation", async () => {
    await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    expect(await claimProspectAuditReservation(db, "https://other.example/", NOW)).toBeNull();
  });
});

describe("finishing and releasing", () => {
  it("finishing updates the reserved row in place to complete/partial, keeping its token", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    expect(await getProspectAuditByToken(db, r.token)).toBeNull(); // running: not servable
    await finishProspectAudit(db, r.id, {
      url: start(0).url,
      business: "Acme",
      status: "partial",
      resultJson: '{"x":1}',
      chosenTerms: ["a"],
    });
    const row = await getProspectAuditByToken(db, r.token);
    expect(row?.status).toBe("partial");
    expect(row?.result_json).toBe('{"x":1}');
    expect(row?.business).toBe("Acme");
    expect(row?.chosen_terms).toBe('["a"]');
    expect(await db.selectFrom("prospect_audits").select("id").execute()).toHaveLength(1);
  });

  it("finishing records the url the RUN audited, and its site, not the reservation's (review P2)", async () => {
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    const claimed = await claimProspectAuditReservation(db, "https://www.acme.example/", NOW);
    expect(claimed?.id).toBe(cockpit.id);
    await finishProspectAudit(db, cockpit.id, {
      url: "https://www.acme.example/",
      business: null,
      status: "complete",
      resultJson: "{}",
    });
    const row = await db
      .selectFrom("prospect_audits")
      .select(["url", "site_key"])
      .where("id", "=", cockpit.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ url: "https://www.acme.example/", site_key: "acme.example" });
  });

  it("finishing re-stamps created_at to the finish, which is what it meant before #907 (review P6)", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: new Date(ago(20 * MIN)) });
    if (r.kind !== "reserved") throw new Error("positive control");
    await finishProspectAudit(
      db,
      r.id,
      { url: start(0).url, business: null, status: "complete", resultJson: "{}" },
      new Date(ago(5 * MIN)),
    );
    const row = await db
      .selectFrom("prospect_audits")
      .select("created_at")
      .where("id", "=", r.id)
      .executeTakeFirstOrThrow();
    expect(row.created_at).toBe(ago(5 * MIN));
  });

  it("the cockpit's release never deletes a row a job has already claimed (review P4)", async () => {
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    await claimProspectAuditReservation(db, "https://acme.example/", NOW);
    await releaseProspectAuditReservation(db, cockpit.id, { onlyIfUnclaimed: true });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
  });

  it("the cockpit's release still frees a reservation no job has claimed", async () => {
    const cockpit = await reserveProspectAudit(
      db,
      { url: "https://acme.example/", business: null, claimed: false },
      { now: NOW },
    );
    if (cockpit.kind !== "reserved") throw new Error("positive control");
    await releaseProspectAuditReservation(db, cockpit.id, { onlyIfUnclaimed: true });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(0);
  });

  it("finishing a row that is gone returns null, so the caller can insert instead", async () => {
    expect(
      await finishProspectAudit(db, "pa_missing", {
        url: "https://gone.example/",
        business: null,
        status: "complete",
        resultJson: "{}",
      }),
    ).toBeNull();
  });

  it("releasing a reservation gives its slot back", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 });
    if (r.kind !== "reserved") throw new Error("positive control");
    await releaseProspectAuditReservation(db, r.id, { onlyIfUnclaimed: false });
    expect((await reserveProspectAudit(db, start(1), { now: NOW, cap: 1 })).kind).toBe("reserved");
  });

  it("releasing never deletes a finished report", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    await finishProspectAudit(db, r.id, {
      url: start(0).url,
      business: null,
      status: "complete",
      resultJson: "{}",
    });
    await releaseProspectAuditReservation(db, r.id, { onlyIfUnclaimed: false });
    expect(await getProspectAuditByToken(db, r.token)).not.toBeNull();
  });
});

describe("readers tolerate `running` rows", () => {
  it("the /audits listing still shows a running row, with its status", async () => {
    await reserveProspectAudit(db, start(0), { now: NOW });
    const list = await listRecentProspectAudits(db, 10);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("running");
  });

  it("the public by-token read does not serve a running row (no report exists yet)", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    expect(await getProspectAuditByToken(db, r.token)).toBeNull();
  });
});

describe("failing a run that paid (P1-16)", () => {
  it("marks the reserved row `failed` in place: same id and token, placeholder kept", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    expect(await failProspectAudit(db, r.id, new Date(NOW.getTime() + HOUR))).toEqual({
      id: r.id,
      token: r.token,
    });
    const rows = await db
      .selectFrom("prospect_audits")
      .select(["id", "token", "status", "created_at", "result_json"])
      .execute();
    expect(rows).toEqual([
      {
        id: r.id,
        token: r.token,
        status: "failed",
        created_at: new Date(NOW.getTime() + HOUR).toISOString(),
        result_json: "{}",
      },
    ]);
  });

  it("re-stamps created_at to the failure, so the slot counts for 24h from it", async () => {
    const r = await reserveProspectAudit(db, start(0), {
      now: new Date(ago(24 * HOUR + 30 * MIN)),
    });
    if (r.kind !== "reserved") throw new Error("positive control");
    await failProspectAudit(db, r.id, new Date(ago(23 * HOUR + 30 * MIN)));
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
  });

  it("a failed row keeps its slot past the stale window, where a `running` one would not", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 });
    if (r.kind !== "reserved") throw new Error("positive control");
    await failProspectAudit(db, r.id, NOW);
    const later = new Date(NOW.getTime() + 3 * HOUR);
    expect(await countProspectAuditsTowardCap(db, later)).toBe(1);
    expect((await reserveProspectAudit(db, start(1), { now: later, cap: 1 })).kind).toBe("capped");
  });

  it("never touches a finished report, and returns null for it", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    await finishProspectAudit(
      db,
      r.id,
      { url: start(0).url, business: null, status: "complete", resultJson: '{"x":1}' },
      NOW,
    );
    expect(await failProspectAudit(db, r.id, new Date(NOW.getTime() + HOUR))).toBeNull();
    const row = await getProspectAuditByToken(db, r.token);
    expect(row?.status).toBe("complete");
    expect(row?.created_at).toBe(NOW.toISOString());
    expect(row?.result_json).toBe('{"x":1}');
  });

  it("never touches a partial report, nor re-stamps a row already failed", async () => {
    const [partialId] = await seed(1, { status: "partial", createdAt: ago(3 * HOUR) });
    const [failedId] = await seed(1, { status: "failed", createdAt: ago(2 * HOUR) });
    expect(await failProspectAudit(db, partialId!, NOW)).toBeNull();
    expect(await failProspectAudit(db, failedId!, NOW)).toBeNull();
    const rows = await db
      .selectFrom("prospect_audits")
      .select(["id", "status", "created_at"])
      .orderBy("created_at")
      .execute();
    expect(rows).toEqual([
      { id: partialId, status: "partial", created_at: ago(3 * HOUR) },
      { id: failedId, status: "failed", created_at: ago(2 * HOUR) },
    ]);
  });

  it("a row that is gone returns null", async () => {
    expect(await failProspectAudit(db, "pa_missing", NOW)).toBeNull();
  });

  it("a failed row is not served by token, and takes no overrides", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    await failProspectAudit(db, r.id, NOW);
    expect(await getProspectAuditByToken(db, r.token)).toBeNull();
    expect(await setProspectAuditOverrides(db, r.token, {})).toEqual({
      status: "not-found",
      token: r.token,
    });
    const done = await reserveProspectAudit(db, start(1), { now: NOW });
    if (done.kind !== "reserved") throw new Error("positive control");
    await finishProspectAudit(db, done.id, {
      url: start(1).url,
      business: null,
      status: "complete",
      resultJson: "{}",
    });
    expect((await setProspectAuditOverrides(db, done.token, {})).status).toBe("updated");
  });

  it("positive control: a report with a legacy status nobody lists is still served", async () => {
    const [id] = await seed(1, { status: "legacy-whatever" });
    const row = await db
      .selectFrom("prospect_audits")
      .select("token")
      .where("id", "=", id!)
      .executeTakeFirstOrThrow();
    expect((await getProspectAuditByToken(db, row.token))?.status).toBe("legacy-whatever");
  });
});

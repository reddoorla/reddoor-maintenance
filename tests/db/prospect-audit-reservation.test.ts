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
  finishProspectAudit,
  generateToken,
  getProspectAuditByToken,
  listRecentProspectAudits,
  releaseProspectAuditReservation,
  reserveProspectAudit,
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
  over: { status?: string; createdAt?: string; url?: (i: number) => string } = {},
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db
      .insertInto("prospect_audits")
      .values({
        id: `seed_${over.status ?? "complete"}_${i}_${Math.random().toString(36).slice(2)}`,
        token: generateToken(),
        url: over.url ? over.url(i) : `https://seeded-${i}.example/`,
        business: null,
        created_at: over.createdAt ?? ago(3 * HOUR),
        status: over.status ?? "complete",
        result_json: "{}",
      })
      .execute();
  }
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

  it("a FINISHED row older than the stale window still counts — staleness is for `running` only", async () => {
    await seed(1, { status: "complete", createdAt: ago(PROSPECT_AUDIT_STALE_AFTER_MS + HOUR) });
    expect(await countProspectAuditsTowardCap(db, NOW)).toBe(1);
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

  it("finishing a row that is gone returns null, so the caller can insert instead", async () => {
    expect(
      await finishProspectAudit(db, "pa_missing", {
        business: null,
        status: "complete",
        resultJson: "{}",
      }),
    ).toBeNull();
  });

  it("releasing a reservation gives its slot back", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW, cap: 1 });
    if (r.kind !== "reserved") throw new Error("positive control");
    await releaseProspectAuditReservation(db, r.id);
    expect((await reserveProspectAudit(db, start(1), { now: NOW, cap: 1 })).kind).toBe("reserved");
  });

  it("releasing never deletes a finished report", async () => {
    const r = await reserveProspectAudit(db, start(0), { now: NOW });
    if (r.kind !== "reserved") throw new Error("positive control");
    await finishProspectAudit(db, r.id, { business: null, status: "complete", resultJson: "{}" });
    await releaseProspectAuditReservation(db, r.id);
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

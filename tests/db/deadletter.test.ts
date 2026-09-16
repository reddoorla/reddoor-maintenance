import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createDeadLetter,
  listUnreplayedDeadLetters,
  markDeadLetterReplayed,
  countUnreplayedDeadLettersBySlug,
} from "../../src/db/deadletter.js";
import { createSubmission, stampNotified } from "../../src/db/submissions.js";
import { replayDeadLetters } from "../../src/forms/replay.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { IngestDeps } from "../../src/forms/ingest.js";

const NOW = new Date("2026-08-23T12:00:00.000Z");

const LEAD = {
  siteSlug: "acme",
  payload: { email: "ada@example.com", name: "Ada", message: "hello there" },
  // Hostname matches the makeWebsiteRow fixture's own host — a mismatched solved
  // hostname on a requireTurnstile site is spam_auto BY DESIGN, and the gated-site
  // replay test below depends on this lead being genuinely clean.
  turnstile: { outcome: "pass" as const, hostname: "acme.example.com" },
  error: "Error: airtable 429 quota",
  receivedAt: NOW,
};

describe("db/deadletter", () => {
  it("round-trips a captured lead, payload and verification intact", async () => {
    const db = await openDb({ url: ":memory:" });
    const { id } = await createDeadLetter(db, LEAD);
    expect(id).toMatch(/^dl_/);
    const rows = await listUnreplayedDeadLetters(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id,
      siteSlug: "acme",
      payload: LEAD.payload,
      turnstile: LEAD.turnstile,
      error: LEAD.error,
      receivedAt: NOW.toISOString(),
    });
  });

  it("lists oldest first and hides replayed rows", async () => {
    const db = await openDb({ url: ":memory:" });
    const late = await createDeadLetter(db, {
      ...LEAD,
      receivedAt: new Date("2026-08-23T13:00:00Z"),
    });
    const early = await createDeadLetter(db, {
      ...LEAD,
      receivedAt: new Date("2026-08-23T11:00:00Z"),
    });
    expect((await listUnreplayedDeadLetters(db)).map((r) => r.id)).toEqual([early.id, late.id]);
    await markDeadLetterReplayed(db, early.id, "accepted", "sub_1", NOW);
    expect((await listUnreplayedDeadLetters(db)).map((r) => r.id)).toEqual([late.id]);
  });
});

describe("replayDeadLetters", () => {
  /** Real db-backed persist; site lookup injectable per test. */
  const replayDeps = (
    db: Awaited<ReturnType<typeof openDb>>,
    over: Partial<IngestDeps> = {},
  ): Omit<IngestDeps, "deadLetter"> => ({
    getWebsiteBySlug: vi.fn().mockResolvedValue(makeWebsiteRow({ id: "recSITE" })),
    createSubmission: (input) => createSubmission(db, input),
    notify: vi.fn().mockResolvedValue({ status: "sent", messageId: "msg_r" }),
    stampNotified: (id, status, messageId) => stampNotified(db, id, status, messageId),
    now: () => NOW,
    ...over,
  });

  it("replays a captured lead into a REAL submission via the normal pipeline", async () => {
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, LEAD);
    const deps = replayDeps(db);

    const result = await replayDeadLetters(db, deps);
    expect(result.stillFailing).toEqual([]);
    expect(result.replayed).toHaveLength(1);
    expect(result.replayed[0]?.outcome).toBe("accepted");
    const subId = result.replayed[0]?.submissionId;
    expect(subId).toMatch(/^sub_/);

    // The pipeline actually ran: the row exists, notify fired for the resolved site.
    expect(deps.notify).toHaveBeenCalledTimes(1);
    // Terminal: a second run owes nothing and touches nothing.
    expect(await listUnreplayedDeadLetters(db)).toEqual([]);
    const again = await replayDeadLetters(db, deps);
    expect(again.replayed).toEqual([]);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("leaves a row for the next run when the lookup throws AGAIN — and never duplicates", async () => {
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, LEAD);
    const stillDown = replayDeps(db, {
      getWebsiteBySlug: vi.fn().mockRejectedValue(new Error("still 429")),
    });

    const r1 = await replayDeadLetters(db, stillDown);
    expect(r1.replayed).toEqual([]);
    expect(r1.stillFailing).toHaveLength(1);
    expect(r1.stillFailing[0]?.error).toMatch(/still 429/);

    // The row is untouched, and crucially there is still exactly ONE of it — a
    // deadLetter dep smuggled into the replay deps would mint a duplicate per
    // retry. replayDeadLetters strips it even when force-passed.
    const r2 = await replayDeadLetters(db, {
      ...stillDown,
      deadLetter: vi.fn().mockResolvedValue({ id: "dl_dup" }),
    } as Omit<IngestDeps, "deadLetter">);
    expect(r2.stillFailing).toHaveLength(1);
    expect(await listUnreplayedDeadLetters(db)).toHaveLength(1);

    // Store recovers → the same row converges to a submission.
    const r3 = await replayDeadLetters(db, replayDeps(db));
    expect(r3.replayed).toHaveLength(1);
    expect(await listUnreplayedDeadLetters(db)).toEqual([]);
  });

  /**
   * #645 REVERSES this. It used to read "marks unknown-site terminal — a slug the
   * store rejects can never improve", and that was true while `unknown-site` was
   * a dead end: nothing could ever create the missing row, so burning the row
   * cost nothing.
   *
   * Two things changed. `ensure-site` can now HEAL a missing Turso row, so the
   * lookup's answer is no longer fixed; and `ingestSubmission` now dead-letters
   * `unknown-site` leads, so real client leads sit in this queue. Together they
   * make terminality an ordering trap: an operator who runs `replay-deadletters`
   * BEFORE `ensure-site` would mark every one of those leads replayed-and-lost,
   * and the losing order is the one a person reaches for first.
   *
   * The cost of the reversal is a slug that is genuinely gone piling up rows and
   * holding the command at exit 1 forever. That is the right trade: it is loud,
   * it is visible in the cockpit, and a lead nobody can place is a lead somebody
   * should look at — where the old behaviour's cost was silent and unrecoverable.
   */
  it("leaves unknown-site UNREPLAYED — ensure-site can still heal the row (#645)", async () => {
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, { ...LEAD, siteSlug: "gone" });
    const deps = replayDeps(db, { getWebsiteBySlug: vi.fn().mockResolvedValue(null) });

    const result = await replayDeadLetters(db, deps);

    expect(result.replayed).toEqual([]);
    expect(result.stillFailing).toEqual([
      { id: expect.stringMatching(/^dl_/), error: expect.stringContaining("unknown-site") },
    ]);
    expect(result.stillFailing[0]!.error).toContain("gone");
    // Still queued: the next run, after the row is healed, converges it.
    expect(await listUnreplayedDeadLetters(db)).toHaveLength(1);
  });

  it("converges that same row once the site resolves — the heal-then-replay order", async () => {
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, { ...LEAD, siteSlug: "gone" });

    const missing = await replayDeadLetters(
      db,
      replayDeps(db, { getWebsiteBySlug: vi.fn().mockResolvedValue(null) }),
    );
    expect(missing.stillFailing).toHaveLength(1);

    // `ensure-site` heals the Turso row; the same queue is replayed again.
    const healed = await replayDeadLetters(db, replayDeps(db));

    expect(healed.replayed).toEqual([
      { id: expect.stringMatching(/^dl_/), outcome: "accepted", submissionId: expect.any(String) },
    ]);
    expect(await listUnreplayedDeadLetters(db)).toEqual([]);
  });

  it("replays with the STORED verification — a Turnstile-gated site accepts the old pass", async () => {
    // Tokens expire in 300s; by replay time re-verification is impossible. The
    // verification computed at receipt (pass + solved hostname) must carry, or a
    // requireTurnstile site would spam-bucket every replayed lead as absent.
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, LEAD); // pass @ acme.test
    const gated = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const deps = replayDeps(db, { getWebsiteBySlug: vi.fn().mockResolvedValue(gated) });
    const result = await replayDeadLetters(db, deps);
    expect(result.replayed[0]?.outcome).toBe("accepted");
    // Accepted as a real lead, not silently captured-as-spam: notify fired.
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it("a stored FAIL still escalates on a gated site — replay must not launder spam", async () => {
    // The mutation-killer for "just replay as unverifiable": an unverifiable
    // outcome is deliberately neutral on a requireTurnstile site (a real browser
    // rendered the widget), so ONLY the faithfully-carried stored verdict
    // distinguishes a failed token from an expired one. A bot whose token FAILED
    // at receipt must not come out of the dead-letter queue as a clean lead.
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, {
      ...LEAD,
      turnstile: { outcome: "fail", hostname: null },
    });
    const gated = makeWebsiteRow({ id: "recSITE", requireTurnstile: true });
    const deps = replayDeps(db, { getWebsiteBySlug: vi.fn().mockResolvedValue(gated) });
    const result = await replayDeadLetters(db, deps);
    // Still "accepted" (captured), but as spam: silent, no operator email.
    expect(result.replayed[0]?.outcome).toBe("accepted");
    expect(deps.notify).not.toHaveBeenCalled();
    const { getSubmissionById } = await import("../../src/db/submissions.js");
    const row = await getSubmissionById(db, result.replayed[0]!.submissionId!);
    expect(row?.status).toBe("spam_auto");
    expect(row?.spamReason).toContain("turnstile-required-failed");
  });
});

/**
 * #645. The alarm's input. Counted in SQL because these rows carry full lead
 * payloads — a dashboard request must never pull a client's PII across just to
 * learn how many rows there are.
 */
describe("countUnreplayedDeadLettersBySlug (#645)", () => {
  it("is empty when nothing is queued", async () => {
    const db = await openDb({ url: ":memory:" });
    expect([...(await countUnreplayedDeadLettersBySlug(db))]).toEqual([]);
  });

  it("groups unreplayed rows by slug", async () => {
    const db = await openDb({ url: ":memory:" });
    await createDeadLetter(db, { ...LEAD, siteSlug: "acme" });
    await createDeadLetter(db, { ...LEAD, siteSlug: "acme" });
    await createDeadLetter(db, { ...LEAD, siteSlug: "ghost" });

    const counts = await countUnreplayedDeadLettersBySlug(db);

    expect(counts.get("acme")).toBe(2);
    expect(counts.get("ghost")).toBe(1);
  });

  it("drops a slug once its last row is replayed — the alarm clears itself", async () => {
    const db = await openDb({ url: ":memory:" });
    const { id } = await createDeadLetter(db, { ...LEAD, siteSlug: "acme" });

    await markDeadLetterReplayed(db, id, "accepted", "sub_1", NOW);

    expect((await countUnreplayedDeadLettersBySlug(db)).has("acme")).toBe(false);
  });
});

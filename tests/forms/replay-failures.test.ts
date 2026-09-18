import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createDeadLetter, listUnreplayedDeadLetters } from "../../src/db/deadletter.js";
import { createSubmission, stampNotified } from "../../src/db/submissions.js";
import { replayDeadLetters } from "../../src/forms/replay.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import type { IngestDeps } from "../../src/forms/ingest.js";

/**
 * MED-10 (b) and (c) — the two ways replay loses or duplicates a lead.
 *
 * (b) `markDeadLetterReplayed` used to run OUTSIDE `replayOne`'s try/catch. A
 *     throw there — a Turso write failure in the moment right after a
 *     successful re-ingest — propagated out of `replayDeadLetters`, aborted the
 *     whole loop, and left the row unmarked while a real submission existed for
 *     it. The next run re-ingests the same lead and mints a DUPLICATE.
 *
 * (c) `listUnreplayedDeadLetters` `JSON.parse`d inside a `.map` over the whole
 *     result set, so one undecodable payload threw before any row was returned
 *     and wedged replay for EVERY other lead — the `import-reap` shape, where
 *     one bad record froze the sync permanently.
 *
 * `markDeadLetterReplayed` is not injectable through `IngestDeps`, so the (b)
 * cases mock the db module and fail the mark for one nominated row id.
 */
const hooks = vi.hoisted(() => ({
  /** Row ids whose terminal mark should throw. Reset per test. */
  markThrowsFor: new Set<string>(),
}));

vi.mock("../../src/db/deadletter.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/db/deadletter.js")>();
  return {
    ...actual,
    markDeadLetterReplayed: async (
      ...args: Parameters<typeof actual.markDeadLetterReplayed>
    ): Promise<void> => {
      const id = args[1];
      if (hooks.markThrowsFor.has(id)) {
        throw new Error(`turso 500: could not mark ${id}`);
      }
      return actual.markDeadLetterReplayed(...args);
    },
  };
});

const NOW = new Date("2026-09-17T12:00:00.000Z");

const lead = (n: number) => ({
  siteSlug: "acme",
  payload: { email: `lead${n}@example.com`, name: `Lead ${n}`, message: `message number ${n}` },
  turnstile: { outcome: "pass" as const, hostname: "acme.example.com" },
  error: "Error: turso 503",
  receivedAt: new Date(Date.UTC(2026, 8, 17, 10, n, 0)),
});

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

/** Write a row whose stored `payload` is not valid JSON — the (c) defect's input. */
async function createUndecodableDeadLetter(
  db: Awaited<ReturnType<typeof openDb>>,
  receivedAt: Date,
): Promise<string> {
  const id = `dl_${crypto.randomUUID()}`;
  await db
    .insertInto("submission_deadletter")
    .values({
      id,
      site_slug: "acme",
      payload: '{"email":"truncated@example.com",',
      turnstile: JSON.stringify({ outcome: "pass", hostname: "acme.example.com" }),
      error: "Error: turso 503",
      received_at: receivedAt.toISOString(),
      replayed_at: null,
      replay_outcome: null,
      replay_submission_id: null,
    })
    .execute();
  return id;
}

beforeEach(() => {
  hooks.markThrowsFor.clear();
});

describe("replayDeadLetters — a failed terminal mark (MED-10b)", () => {
  /** Deliberately asserts ONLY behaviour that exists before this change too, so
   *  it passes on unfixed source — the control that keeps the four tests below
   *  from being a suite that can only ever fail. */
  it("POSITIVE CONTROL: a queue of three good rows replays exactly as it does today", async () => {
    const db = await openDb({ url: ":memory:" });
    for (const n of [1, 2, 3]) await createDeadLetter(db, lead(n));

    const result = await replayDeadLetters(db, replayDeps(db));

    expect(result.replayed).toHaveLength(3);
    expect(result.replayed.map((r) => r.outcome)).toEqual(["accepted", "accepted", "accepted"]);
    expect(result.stillFailing).toEqual([]);
    expect(await listUnreplayedDeadLetters(db)).toEqual([]);
  });

  it("reports the re-ingested-but-unmarked row as its OWN outcome, not an ordinary retry", async () => {
    const db = await openDb({ url: ":memory:" });
    const { id } = await createDeadLetter(db, lead(1));
    hooks.markThrowsFor.add(id);

    const result = await replayDeadLetters(db, replayDeps(db));

    // It must not throw out of the loop, and it must not land in `stillFailing`
    // — that bucket means "nothing was written, retry freely", which is exactly
    // the wrong thing to believe about a lead that already has a submission.
    expect(result.stillFailing).toEqual([]);
    expect(result.replayed).toEqual([]);
    expect(result.unmarked).toEqual([
      {
        id,
        outcome: "accepted",
        submissionId: expect.stringMatching(/^sub_/),
        error: expect.stringContaining("could not mark"),
      },
    ]);
  });

  it("confines one row's mark failure — the rows behind it still replay", async () => {
    const db = await openDb({ url: ":memory:" });
    const first = await createDeadLetter(db, lead(1));
    const middle = await createDeadLetter(db, lead(2));
    const last = await createDeadLetter(db, lead(3));
    hooks.markThrowsFor.add(middle.id);

    const result = await replayDeadLetters(db, replayDeps(db));

    expect(result.replayed.map((r) => r.id)).toEqual([first.id, last.id]);
    expect(result.unmarked.map((r) => r.id)).toEqual([middle.id]);
    // Only the unmarked row is still queued; nothing behind it was skipped.
    expect((await listUnreplayedDeadLetters(db)).map((r) => r.id)).toEqual([middle.id]);
  });
});

describe("replayDeadLetters — an undecodable payload (MED-10c)", () => {
  it("replays the good rows around a corrupt one and surfaces the corrupt row", async () => {
    const db = await openDb({ url: ":memory:" });
    const first = await createDeadLetter(db, lead(1));
    const corrupt = await createUndecodableDeadLetter(db, new Date(Date.UTC(2026, 8, 17, 10, 2)));
    const last = await createDeadLetter(db, lead(3));

    const result = await replayDeadLetters(db, replayDeps(db));

    expect(result.replayed.map((r) => r.id)).toEqual([first.id, last.id]);
    expect(result.unreadable).toEqual([
      {
        id: corrupt,
        siteSlug: "acme",
        error: expect.stringMatching(/payload/i),
        receivedAt: new Date(Date.UTC(2026, 8, 17, 10, 2)).toISOString(),
      },
    ]);
    // Surfaced, never buried: the row is still queued (an operator can fix the
    // payload, or abandon it deliberately under #786), and it still counts
    // toward the cockpit's dead-letter alarm, which is computed in SQL.
    const { countUnreplayedDeadLettersBySlug } = await import("../../src/db/deadletter.js");
    expect((await countUnreplayedDeadLettersBySlug(db)).get("acme")).toBe(1);
  });

  it("an undecodable turnstile column is reported the same way", async () => {
    const db = await openDb({ url: ":memory:" });
    const good = await createDeadLetter(db, lead(1));
    const id = `dl_${crypto.randomUUID()}`;
    await db
      .insertInto("submission_deadletter")
      .values({
        id,
        site_slug: "acme",
        payload: JSON.stringify({ email: "a@b.co", name: "A", message: "hi there friend" }),
        turnstile: "not json at all",
        error: "Error: turso 503",
        received_at: new Date(Date.UTC(2026, 8, 17, 10, 5)).toISOString(),
        replayed_at: null,
        replay_outcome: null,
        replay_submission_id: null,
      })
      .execute();

    const result = await replayDeadLetters(db, replayDeps(db));

    expect(result.replayed.map((r) => r.id)).toEqual([good.id]);
    expect(result.unreadable.map((r) => r.id)).toEqual([id]);
  });
});

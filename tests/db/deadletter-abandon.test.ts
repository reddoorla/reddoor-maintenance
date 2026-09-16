import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createDeadLetter,
  listUnreplayedDeadLetters,
  markDeadLetterReplayed,
  countUnreplayedDeadLettersBySlug,
  abandonDeadLetters,
} from "../../src/db/deadletter.js";
import type { Db } from "../../src/db/client.js";

/**
 * #786 item 1, the other half of #785.
 *
 * #785 made `unknown-site` non-terminal on replay so that BOTH recovery orders
 * are safe (`ensure-site` then replay, or replay then `ensure-site`) — without
 * it, replay-before-heal silently burns every queued lead, and that is the order
 * a person reaches for first.
 *
 * The cost was named at the time and is what this closes: a genuinely dead slug
 * that is still deployed and posting grows the queue without bound, holds
 * `db replay-deadletters` at exit 1 forever, and leaves a standing CRITICAL
 * cockpit item with no escape short of deleting rows by hand.
 *
 * `abandoned` is that escape — resolved-by-DECISION rather than by outcome, so
 * it records who, when and why.
 */

let db: Db;

const NOW = new Date("2026-09-15T12:00:00.000Z");

const lead = (slug: string, receivedAt = NOW) => ({
  siteSlug: slug,
  payload: { email: "ada@example.com", name: "Ada", message: "hello there" },
  turnstile: { outcome: "pass" as const, hostname: "acme.example.com" },
  error: "Error: unknown-site",
  receivedAt,
});

/** The stored audit columns for one row. */
async function auditOf(id: string) {
  return db
    .selectFrom("submission_deadletter")
    .select(["abandoned_at", "abandoned_by", "abandoned_reason", "replayed_at", "replay_outcome"])
    .where("id", "=", id)
    .executeTakeFirst();
}

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

describe("abandonDeadLetters — a terminal outcome the operator decides", () => {
  it("abandons every unreplayed row for a slug and returns their ids", async () => {
    const a = await createDeadLetter(db, lead("ghost-co"));
    const b = await createDeadLetter(db, lead("ghost-co"));
    const ids = await abandonDeadLetters(db, {
      slug: "ghost-co",
      by: "tucker",
      reason: "site was retired in 2025; the form is still deployed",
      now: NOW,
    });
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it("drops them from the replay queue AND from the alarm count", async () => {
    // The two things the standing CRITICAL item and the exit-1 depend on.
    await createDeadLetter(db, lead("ghost-co"));
    expect(await listUnreplayedDeadLetters(db)).toHaveLength(1);
    expect((await countUnreplayedDeadLettersBySlug(db)).get("ghost-co")).toBe(1);

    await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "retired", now: NOW });

    expect(await listUnreplayedDeadLetters(db)).toEqual([]);
    expect((await countUnreplayedDeadLettersBySlug(db)).has("ghost-co")).toBe(false);
  });

  it("records who, when and why — the decision has to outlive the person", async () => {
    const { id } = await createDeadLetter(db, lead("ghost-co"));
    await abandonDeadLetters(db, {
      slug: "ghost-co",
      by: "tucker@reddoorla.com",
      reason: "client cancelled; slug will never exist",
      now: NOW,
    });
    expect(await auditOf(id)).toMatchObject({
      abandoned_at: NOW.toISOString(),
      abandoned_by: "tucker@reddoorla.com",
      abandoned_reason: "client cancelled; slug will never exist",
    });
  });

  it("keeps the row and its payload — abandoning is not deleting", async () => {
    // The alternative today is deleting rows by hand. A decision that destroys
    // the lead it was made about cannot be reviewed later.
    const { id } = await createDeadLetter(db, lead("ghost-co"));
    await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "retired", now: NOW });
    const row = await db
      .selectFrom("submission_deadletter")
      .select(["id", "payload", "site_slug"])
      .where("id", "=", id)
      .executeTakeFirst();
    expect(row).toMatchObject({ id, site_slug: "ghost-co" });
    expect(JSON.parse(row!.payload) as { email: string }).toMatchObject({
      email: "ada@example.com",
    });
  });

  it("does NOT mark the row replayed — abandoned is its own terminal state", async () => {
    // Reusing `replayed_at` would read as "this lead was placed", which is the
    // opposite of what happened to it.
    const { id } = await createDeadLetter(db, lead("ghost-co"));
    await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "retired", now: NOW });
    expect(await auditOf(id)).toMatchObject({ replayed_at: null, replay_outcome: null });
  });

  it("abandons ONE row by id", async () => {
    const keep = await createDeadLetter(db, lead("ghost-co"));
    const drop = await createDeadLetter(db, lead("ghost-co"));
    const ids = await abandonDeadLetters(db, {
      id: drop.id,
      by: "tucker",
      reason: "duplicate of a lead already handled by email",
      now: NOW,
    });
    expect(ids).toEqual([drop.id]);
    expect((await listUnreplayedDeadLetters(db)).map((r) => r.id)).toEqual([keep.id]);
  });

  // ── the refusals, each paired with the grant it must not swallow ──────────

  it("NEVER touches another slug's rows", async () => {
    const other = await createDeadLetter(db, lead("acme-co"));
    await createDeadLetter(db, lead("ghost-co"));
    await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "retired", now: NOW });
    expect((await listUnreplayedDeadLetters(db)).map((r) => r.id)).toEqual([other.id]);
    expect((await countUnreplayedDeadLettersBySlug(db)).get("acme-co")).toBe(1);
  });

  it("is idempotent: a second abandon of the same slug writes nothing", async () => {
    const { id } = await createDeadLetter(db, lead("ghost-co"));
    await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "first", now: NOW });
    const again = await abandonDeadLetters(db, {
      slug: "ghost-co",
      by: "someone-else",
      reason: "second",
      now: new Date("2026-09-16T12:00:00.000Z"),
    });
    expect(again).toEqual([]);
    // The FIRST decision stands — that is the one that was actually made.
    expect(await auditOf(id)).toMatchObject({
      abandoned_by: "tucker",
      abandoned_reason: "first",
      abandoned_at: NOW.toISOString(),
    });
  });

  it("leaves an already-REPLAYED row alone (it is already terminal)", async () => {
    const { id } = await createDeadLetter(db, lead("ghost-co"));
    await markDeadLetterReplayed(db, id, "accepted", "sub_1", NOW);
    expect(
      await abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "retired", now: NOW }),
    ).toEqual([]);
    expect(await auditOf(id)).toMatchObject({ replay_outcome: "accepted", abandoned_at: null });
  });

  it("abandons a slug whose leads COULD still replay — the operator decides, not the queue", async () => {
    // The grant side. Abandoning is a judgement about the site, not a property
    // of the row, so nothing here may require the lead to be unreplayable first.
    await createDeadLetter(db, lead("acme-co"));
    const ids = await abandonDeadLetters(db, {
      slug: "acme-co",
      by: "tucker",
      reason: "lead was handled by phone; do not re-send the notification",
      now: NOW,
    });
    expect(ids).toHaveLength(1);
  });

  it("returns an empty list for a slug that has no rows at all", async () => {
    expect(
      await abandonDeadLetters(db, { slug: "nobody", by: "tucker", reason: "x", now: NOW }),
    ).toEqual([]);
  });

  it("refuses a call that names neither a slug nor an id, or both", async () => {
    // A mistyped invocation must never mean "abandon everything".
    await createDeadLetter(db, lead("ghost-co"));
    await expect(abandonDeadLetters(db, { by: "tucker", reason: "x", now: NOW })).rejects.toThrow(
      /slug or id/i,
    );
    await expect(
      abandonDeadLetters(db, { slug: "ghost-co", id: "dl_1", by: "tucker", reason: "x", now: NOW }),
    ).rejects.toThrow(/slug or id/i);
    expect(await listUnreplayedDeadLetters(db)).toHaveLength(1);
  });

  it("refuses a blank reason — an undocumented decision is the thing being fixed", async () => {
    await createDeadLetter(db, lead("ghost-co"));
    await expect(
      abandonDeadLetters(db, { slug: "ghost-co", by: "tucker", reason: "   ", now: NOW }),
    ).rejects.toThrow(/reason/i);
    expect(await listUnreplayedDeadLetters(db)).toHaveLength(1);
  });
});

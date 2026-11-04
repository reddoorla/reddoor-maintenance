import type { Db } from "./client.js";

/**
 * The [TEST] send log (P1-33(c), migration 0054): one row per
 * `report --test-send`, and the operator's verdict on each.
 *
 * Before this, every [TEST] email came from a scratchpad script that was never
 * committed, and the record was a hand-kept table in BACKLOG that two passes
 * counted as 1 and 0. The table is now the record and `cleanSendStreak` is the
 * one count.
 */
export type TestSendVerdict = "awaiting" | "clean" | "problem";

export type TestSendRow = {
  id: string;
  reportId: string;
  siteId: string;
  subject: string;
  sentTo: string;
  resendMessageId: string | null;
  sentAt: string;
  verdict: TestSendVerdict;
  problem: string | null;
  verdictAt: string | null;
};

export type TestSendInput = {
  id: string;
  reportId: string;
  siteId: string;
  subject: string;
  sentTo: string;
  resendMessageId: string | null;
  sentAt: Date;
};

/** Opaque, collision-free id, minted BEFORE the send so it can key the
 *  Resend idempotency header and then the row. */
export function newTestSendId(): string {
  return `ts_${crypto.randomUUID()}`;
}

/** Log one send, verdict `awaiting`. */
export async function insertTestSend(db: Db, input: TestSendInput): Promise<void> {
  await db
    .insertInto("report_test_sends")
    .values({
      id: input.id,
      report_id: input.reportId,
      site_id: input.siteId,
      subject: input.subject,
      sent_to: input.sentTo,
      resend_message_id: input.resendMessageId,
      sent_at: input.sentAt.toISOString(),
      verdict: "awaiting",
      problem: null,
      verdict_at: null,
    })
    .execute();
}

/** Every send, oldest first: `(sent_at, id)`, the order the streak reads. */
export async function listTestSends(db: Db): Promise<TestSendRow[]> {
  const rows = await db
    .selectFrom("report_test_sends")
    .selectAll()
    .orderBy("sent_at", "asc")
    .orderBy("id", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    reportId: r.report_id,
    siteId: r.site_id,
    subject: r.subject,
    sentTo: r.sent_to,
    resendMessageId: r.resend_message_id,
    sentAt: r.sent_at,
    verdict: r.verdict,
    problem: r.problem,
    verdictAt: r.verdict_at,
  }));
}

/**
 * Parse the operator's verdict as `report --test-verdict` takes it: the word
 * `clean`, or one line saying what was wrong. PURE. A blank verdict is refused:
 * an empty problem would record "something was wrong" with nothing to act on.
 */
export function parseVerdict(raw: string | undefined): {
  verdict: "clean" | "problem";
  problem: string | null;
} {
  const text = (raw ?? "").trim();
  if (text === "") {
    throw Object.assign(
      new Error('--test-verdict needs a verdict: `clean`, or "<what was wrong>"'),
      { exitCode: 2 },
    );
  }
  if (text.toLowerCase() === "clean") return { verdict: "clean", problem: null };
  return { verdict: "problem", problem: text };
}

/** Record a verdict on one send. Returns the row as it was before, or null when
 *  no send has that id (nothing is written). A later verdict replaces an
 *  earlier one: the operator's last word is the record, and the CLI prints
 *  what it replaced. */
export async function setTestSendVerdict(
  db: Db,
  id: string,
  v: { verdict: "clean" | "problem"; problem: string | null },
  now: Date,
): Promise<TestSendRow | null> {
  const before = (await listTestSends(db)).find((r) => r.id === id) ?? null;
  if (!before) return null;
  await db
    .updateTable("report_test_sends")
    .set({ verdict: v.verdict, problem: v.problem, verdict_at: now.toISOString() })
    .where("id", "=", id)
    .execute();
  return before;
}

/**
 * The clean-send streak, by the rule maintenance's BACKLOG set when it kept
 * this table by hand (#974): "The streak is the number of `clean` rows counted
 * up from the bottom, stopping at the first row that is not `clean`. An
 * `awaiting` row stops it too."
 *
 * `rows` is oldest first, as `listTestSends` returns it. PURE.
 */
export function cleanSendStreak(rows: ReadonlyArray<Pick<TestSendRow, "verdict">>): number {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.verdict !== "clean") break;
    n++;
  }
  return n;
}

/** The `report --test-streak` output: the count on its own machine-greppable
 *  line, then every row oldest first, so the count can be checked by eye
 *  against the rows it came from. */
export function formatTestStreak(rows: ReadonlyArray<TestSendRow>): string {
  const awaiting = rows.filter((r) => r.verdict === "awaiting").length;
  const lines = [
    `TEST_SEND_STREAK streak=${cleanSendStreak(rows)} sends=${rows.length} awaiting=${awaiting}`,
  ];
  for (const r of rows) {
    const verdict = r.verdict === "problem" ? `problem: ${r.problem ?? ""}` : r.verdict;
    lines.push(`${r.sentAt} ${r.id} report=${r.reportId} ${verdict}`);
  }
  return lines.join("\n");
}

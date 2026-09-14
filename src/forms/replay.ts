import type { Db } from "../db/client.js";
import {
  listUnreplayedDeadLetters,
  markDeadLetterReplayed,
  type DeadLetterRow,
} from "../db/deadletter.js";
import { ingestSubmission, type IngestDeps } from "./ingest.js";

export type ReplayResult = {
  /** Terminal outcomes this run: the row will never be picked up again. */
  replayed: Array<{ id: string; outcome: string; submissionId: string | null }>;
  /** Rows whose lookup threw AGAIN — left unreplayed for the next run. */
  stillFailing: Array<{ id: string; error: string }>;
};

/**
 * Run every unreplayed dead-letter back through `ingestSubmission` — the SAME
 * pipeline a live submission takes, so a replayed lead gets real spam
 * classification, notify, and fan-out, not a bespoke re-implementation.
 *
 * Each row replays with the Turnstile verification computed at receipt (tokens
 * expire in 300s; re-verifying is impossible by design, see deadletter.ts).
 *
 * `deps` must NOT wire `deadLetter`: a lookup that throws during replay would
 * otherwise dead-letter the SAME lead a second time while the original row stays
 * unreplayed — every retry would mint a duplicate. Enforced here by stripping the
 * key rather than trusting the caller. A thrown lookup leaves the row untouched
 * for the next run; `accepted` and `rejected` are terminal — re-running cannot
 * improve on an answer the store actually gave. `unknown-site` USED to be
 * terminal too and no longer is: see replayOne below (#645).
 *
 * Oldest-first (listUnreplayedDeadLetters orders by received_at) so the
 * duplicate/velocity spam signals see submissions in arrival order.
 */
export async function replayDeadLetters(
  db: Db,
  deps: Omit<IngestDeps, "deadLetter">,
): Promise<ReplayResult> {
  const rows = await listUnreplayedDeadLetters(db);
  const result: ReplayResult = { replayed: [], stillFailing: [] };

  for (const row of rows) {
    const outcome = await replayOne(db, deps, row);
    if (outcome.terminal) {
      result.replayed.push({
        id: row.id,
        outcome: outcome.outcome,
        submissionId: outcome.submissionId,
      });
    } else {
      result.stillFailing.push({ id: row.id, error: outcome.error });
    }
  }
  return result;
}

async function replayOne(
  db: Db,
  deps: Omit<IngestDeps, "deadLetter">,
  row: DeadLetterRow,
): Promise<
  | { terminal: true; outcome: string; submissionId: string | null }
  | { terminal: false; error: string }
> {
  // Strip deadLetter defensively even though the type forbids it — a structurally
  // wider object passed through `as` must not re-arm the duplicate loop.
  const { deadLetter: _stripped, ...safeDeps } = deps as IngestDeps;
  void _stripped;
  let res;
  try {
    res = await ingestSubmission(safeDeps, row.siteSlug, row.payload, row.turnstile);
  } catch (err) {
    return { terminal: false, error: String(err) };
  }
  const now = deps.now();
  if (res.status === "accepted") {
    await markDeadLetterReplayed(db, row.id, "accepted", res.submissionId, now);
    return { terminal: true, outcome: "accepted", submissionId: res.submissionId };
  }
  // #645. `unknown-site` is NO LONGER terminal. It used to be, on the reasoning
  // that a slug the store rejects "can never improve" — true while nothing could
  // create the missing row. `ensure-site` can now heal one (#645 item 1), and
  // `ingestSubmission` now dead-letters `unknown-site` leads instead of dropping
  // them, so this queue holds real client leads whose site is merely absent.
  //
  // Terminality would then be an ORDERING TRAP: replay-before-heal marks every
  // such lead replayed-and-lost, and that is the order a person reaches for
  // first. Leaving the row queued makes both orders safe.
  //
  // The cost is a slug that is genuinely gone piling up rows and holding this
  // command at exit 1. Deliberate: loud and recoverable beats silent and not.
  if (res.status === "unknown-site") {
    return { terminal: false, error: `unknown-site: no fleet row for '${row.siteSlug}'` };
  }
  const outcome = `rejected:${res.reason}`;
  await markDeadLetterReplayed(db, row.id, outcome, null, now);
  return { terminal: true, outcome, submissionId: null };
}

import type { Db } from "../db/client.js";
import {
  readUnreplayedDeadLetters,
  markDeadLetterReplayed,
  type DeadLetterRow,
  type UnreadableDeadLetterRow,
} from "../db/deadletter.js";
import { ingestSubmission, type IngestDeps } from "./ingest.js";

export type ReplayResult = {
  /** Terminal outcomes this run: the row will never be picked up again. */
  replayed: Array<{ id: string; outcome: string; submissionId: string | null }>;
  /** Rows whose lookup threw AGAIN — left unreplayed for the next run. */
  stillFailing: Array<{ id: string; error: string }>;
  /** MED-10(b). Rows that DID re-ingest — a real submission exists for them —
   *  but whose terminal mark could not be written. Distinct from `stillFailing`
   *  on purpose: that bucket means "nothing was written, retry freely", which is
   *  the one thing nobody may believe about these. Re-running replay before the
   *  row is reconciled WILL mint a duplicate submission, so each entry names the
   *  submission that already exists. */
  unmarked: Array<{ id: string; outcome: string; submissionId: string | null; error: string }>;
  /** MED-10(c). Rows whose stored JSON could not be decoded — they cannot be
   *  replayed at all until a human looks. Reported so they are visible; still
   *  queued, so nothing is destroyed by reporting them. */
  unreadable: UnreadableDeadLetterRow[];
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
  const queue = await readUnreplayedDeadLetters(db);
  const result: ReplayResult = {
    replayed: [],
    stillFailing: [],
    unmarked: [],
    unreadable: [...queue.unreadable],
  };

  for (const row of queue.rows) {
    // MED-10(b). One row's failure must never abort the ones behind it. Every
    // outcome replayOne can reach is already a return value; this catch is the
    // backstop for anything it cannot anticipate (a `deps.now()` that throws, a
    // dep wired wrong), so a surprise costs one lead's run, not the queue's.
    let outcome: Awaited<ReturnType<typeof replayOne>>;
    try {
      outcome = await replayOne(db, deps, row);
    } catch (err) {
      result.stillFailing.push({ id: row.id, error: `replay threw: ${String(err)}` });
      continue;
    }
    if (outcome.terminal) {
      result.replayed.push({
        id: row.id,
        outcome: outcome.outcome,
        submissionId: outcome.submissionId,
      });
    } else if (outcome.unmarked) {
      result.unmarked.push({
        id: row.id,
        outcome: outcome.outcome,
        submissionId: outcome.submissionId,
        error: outcome.error,
      });
    } else {
      result.stillFailing.push({ id: row.id, error: outcome.error });
    }
  }
  return result;
}

/**
 * MED-10(b). Write the terminal mark, and never let its failure escape.
 *
 * ORDERING. Ingest-then-mark is kept, because the alternative (mark first) turns
 * every ingest failure into a lead marked replayed that no submission exists
 * for — silent loss, which is strictly worse than a duplicate the operator can
 * see. What changes is what a failed mark MEANS: it is no longer an exception
 * that unwinds `replayDeadLetters` with the row looking like an ordinary retry.
 * It is its own outcome, naming the submission that already exists, and it
 * cannot touch the rows behind it.
 *
 * RESIDUAL, stated honestly: the mark is a durable write and its failure means
 * the store refused a write. Nothing in-process can persist the fact, so the
 * row IS still queued and the next unattended run will re-ingest it and mint a
 * duplicate. That is why this is not retried quietly and not folded into
 * `stillFailing`: the run's output is the only record that exists, so it has to
 * be loud enough to reach a person before the next run does.
 */
async function markTerminal(
  db: Db,
  row: DeadLetterRow,
  outcome: string,
  submissionId: string | null,
  now: Date,
): Promise<ReplayOutcome> {
  try {
    await markDeadLetterReplayed(db, row.id, outcome, submissionId, now);
  } catch (err) {
    return { terminal: false, unmarked: true, outcome, submissionId, error: String(err) };
  }
  return { terminal: true, outcome, submissionId };
}

type ReplayOutcome =
  | { terminal: true; outcome: string; submissionId: string | null }
  | { terminal: false; unmarked?: false; error: string }
  | {
      terminal: false;
      unmarked: true;
      outcome: string;
      submissionId: string | null;
      error: string;
    };

async function replayOne(
  db: Db,
  deps: Omit<IngestDeps, "deadLetter">,
  row: DeadLetterRow,
): Promise<ReplayOutcome> {
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
    return markTerminal(db, row, "accepted", res.submissionId, now);
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
  return markTerminal(db, row, `rejected:${res.reason}`, null, now);
}

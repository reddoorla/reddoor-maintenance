import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, getSubmissionById } from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";
import { SPAM_THRESHOLD } from "../../src/forms/spam-classifier.js";
import {
  rescoreNewSubmissions,
  runSubmissionsCommand,
  RESCORE_REASON_MARKER,
} from "../../src/cli/commands/submissions.js";

// Two seller-voice keyword phrases (+30 each) put a message at/above the 60
// threshold under the CURRENT classifier — the exact pre-tuning-backlog shape
// the rescore exists for (these rows arrived before the 2026-07-15 keyword
// expansion, so their stored ingest-time score is low/absent).
const PITCH = "We do link building and guest post outreach for businesses like yours.";
const PITCH_SHORT = "Interested in link building? We write one guest post per week.";
const GENUINE = "Hi — could I get a quote for family portraits next month?";

const base = {
  siteId: "recA",
  formType: "contact" as const,
  name: "Sam",
  email: "sam@example.com",
  submittedAt: new Date("2026-06-20T00:00:00.000Z"),
};

let db: Db;
let pitchNew: SubmissionRow; // status new, stale low score — must re-bucket
let genuineNew: SubmissionRow; // status new, clean — must stay
let pitchRead: SubmissionRow; // spam content but operator already read it — untouchable
let pitchExtra: SubmissionRow; // spam signals ONLY in extraFields JSON

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  pitchNew = await createSubmission(db, {
    ...base,
    message: PITCH,
    spamScore: 20,
    spamReason: "links:1",
  });
  genuineNew = await createSubmission(db, { ...base, message: GENUINE });
  pitchRead = await createSubmission(db, { ...base, message: PITCH, status: "read" });
  pitchExtra = await createSubmission(db, {
    ...base,
    extraFields: { comments: PITCH_SHORT },
  });
});

describe("rescoreNewSubmissions — dry run (default)", () => {
  it("flags only status='new' rows at/above the threshold and writes NOTHING", async () => {
    const { scanned, flagged } = await rescoreNewSubmissions(db, { apply: false });
    // pitchRead is not even scanned — the loader filters on status='new'
    expect(scanned).toBe(3);
    expect(flagged.map((f) => f.row.id).sort()).toEqual([pitchNew.id, pitchExtra.id].sort());
    expect(flagged.every((f) => f.newScore >= SPAM_THRESHOLD)).toBe(true);
    expect(flagged.every((f) => !f.written)).toBe(true);
    // db untouched: statuses, scores, and reasons all as seeded
    const after = await getSubmissionById(db, pitchNew.id);
    expect(after?.status).toBe("new");
    expect(after?.spamScore).toBe(20);
    expect(after?.spamReason).toBe("links:1");
    expect((await getSubmissionById(db, pitchExtra.id))?.status).toBe("new");
  });

  it("appends the retro-rescore marker to the NEW verdict's reasons", async () => {
    const { flagged } = await rescoreNewSubmissions(db, { apply: false });
    for (const f of flagged) {
      expect(f.newReason.endsWith(`,${RESCORE_REASON_MARKER}`)).toBe(true);
      // and the new reasons are the classifier's, not the stale stored trail
      expect(f.newReason).toContain("keywords:");
    }
  });
});

describe("rescoreNewSubmissions — apply", () => {
  it("re-buckets flagged rows to spam_auto, REPLACING score + reasons", async () => {
    const { flagged } = await rescoreNewSubmissions(db, { apply: true });
    expect(flagged.every((f) => f.written)).toBe(true);

    const after = await getSubmissionById(db, pitchNew.id);
    expect(after?.status).toBe("spam_auto");
    expect(after?.spamScore).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
    expect(after?.spamScore).not.toBe(20); // replaced, not preserved
    expect(after?.spamReason).toMatch(new RegExp(`${RESCORE_REASON_MARKER}$`));
    expect(after?.spamReason).not.toContain("links:1"); // old trail superseded

    // extraFields-only signals count too (same folding as ingest)
    expect((await getSubmissionById(db, pitchExtra.id))?.status).toBe("spam_auto");
  });

  it("leaves sub-threshold and operator-touched rows alone", async () => {
    await rescoreNewSubmissions(db, { apply: true });
    expect((await getSubmissionById(db, genuineNew.id))?.status).toBe("new");
    const read = await getSubmissionById(db, pitchRead.id);
    expect(read?.status).toBe("read");
    expect(read?.spamScore).toBeNull();
  });
});

describe("runSubmissionsCommand", () => {
  it("rejects an unknown action with a non-zero code", async () => {
    const r = await runSubmissionsCommand("frobnicate", {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/unknown submissions action/i);
  });

  it("rejects --apply combined with --dry-run", async () => {
    const r = await runSubmissionsCommand("rescore", { apply: true, dryRun: true });
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/conflict/i);
  });

  it("rescore against an empty :memory: db reports a clean no-op (no Airtable/Turso env needed)", async () => {
    const r = await runSubmissionsCommand("rescore", { url: ":memory:" });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/Scanned 0 status='new' submissions/);
    expect(r.output).toMatch(/Nothing to re-bucket/i);
  });
});

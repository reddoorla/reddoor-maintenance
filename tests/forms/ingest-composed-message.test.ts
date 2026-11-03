import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestSubmission, type IngestDeps } from "../../src/forms/ingest.js";
import type { TurnstileOutcome, TurnstileVerification } from "../../src/forms/turnstile.js";
import { openDb, type Db } from "../../src/db/client.js";
import { createSubmission, findRecentDuplicateSubmissions } from "../../src/db/submissions.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

// reddoor's landing-page modal writes the SAME sentence for every visitor's step
// one, so the fleet duplicate scan read every lead after the first in a 30-day
// window as a spray (`duplicate-body`) and lost it silently (2026-11-03,
// sub_4bc17c8e…, a real headed submission whose Turnstile token PASSED). The site
// now marks a message it composed; ingest skips the duplicate scans for it only on
// a site that requires Turnstile, with a token that passed on the site's own host.
// The lookup is the REAL one over an in-memory store, wired exactly as
// netlify/functions/form-ingest.mts wires it, seeded with the prior step ones.

const STEP_ONE = 'Landing-page inquiry — opened from "The Diagnosis".';
const NOW = new Date("2026-11-03T20:40:00.000Z");
const SITE_ID = "recREDDOOR";

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  for (const [i, email] of ["p1@x.com", "p2@x.com", "p3@x.com", "p4@x.com"].entries()) {
    await createSubmission(db, {
      siteId: SITE_ID,
      formType: "inquiry",
      name: email,
      email,
      message: STEP_ONE,
      status: "new",
      submittedAt: new Date(NOW.getTime() - (i + 1) * 86_400_000),
    });
  }
});

function setup(siteOver: { requireTurnstile?: boolean } = {}) {
  const site = makeWebsiteRow({
    id: SITE_ID,
    url: "https://reddoorla.com",
    requireTurnstile: true,
    ...siteOver,
  });
  const findRecentDuplicates = vi.fn((message: string, since: Date) =>
    findRecentDuplicateSubmissions(db, message, since.toISOString()),
  );
  const retroBucket = vi.fn().mockResolvedValue(undefined);
  const d: IngestDeps = {
    getWebsiteBySlug: vi.fn().mockResolvedValue(site),
    createSubmission: vi.fn().mockResolvedValue(makeSubmissionRow({ id: "recSUB" })),
    notify: vi.fn().mockResolvedValue({ status: "sent", messageId: "msg_1" }),
    stampNotified: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    classifySpam: () => ({ score: 0, reasons: [] }),
    findRecentDuplicates,
    retroBucket,
  };
  return { d, findRecentDuplicates, retroBucket };
}

const payload = (extra?: Record<string, unknown>) => ({
  formType: "inquiry",
  email: "new-visitor@example.com",
  name: "new-visitor@example.com",
  message: STEP_ONE,
  ...(extra ? { extra } : {}),
});

const pass = (hostname: string | null = "reddoorla.com"): TurnstileVerification => ({
  outcome: "pass",
  hostname,
});

function stored(d: IngestDeps) {
  return vi.mocked(d.createSubmission).mock.calls[0]![0];
}

describe("ingestSubmission — a site-composed message on a Turnstile-gated site", () => {
  it("CONTROL: the real lookup finds the prior step ones as exact duplicates", async () => {
    const r = await findRecentDuplicateSubmissions(db, STEP_ONE, "2026-10-01T00:00:00.000Z");
    expect(r.exact).toHaveLength(4);
  });

  it("is delivered as new when the flag is set, the site requires Turnstile and the token passed", async () => {
    const { d, findRecentDuplicates, retroBucket } = setup();
    const r = await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), pass());
    expect(r.status).toBe("accepted");
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(findRecentDuplicates).not.toHaveBeenCalled();
    expect(retroBucket).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("keeps the flag on the stored row, so the dashboard shows why the scan was skipped", async () => {
    const { d } = setup();
    await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), pass());
    expect(stored(d).extraFields).toMatchObject({ composedMessage: true });
  });

  it("still buckets the same message WITHOUT the flag as duplicate-body (visitor-typed text)", async () => {
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", payload(), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).toHaveBeenCalledTimes(1);
  });

  it("only a literal `true` counts as the flag", async () => {
    const { d } = setup();
    await ingestSubmission(d, "reddoor", payload({ composedMessage: "true" }), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
  });

  it("still buckets a flagged message on a site that does NOT require Turnstile", async () => {
    const { d, retroBucket } = setup({ requireTurnstile: false });
    await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).toHaveBeenCalledTimes(1);
  });

  it.each<TurnstileOutcome>(["unverifiable", "absent", "fail"])(
    "still runs the scan and its retro-bucketing for a flagged message whose token is %s",
    async (outcome) => {
      const { d, findRecentDuplicates, retroBucket } = setup();
      await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), outcome);
      expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
      expect(retroBucket).toHaveBeenCalledTimes(1);
      expect(stored(d).status).toBe("spam_auto");
      expect(stored(d).spamReason).toMatch(
        outcome === "unverifiable" ? /^duplicate-body$/ : /^turnstile-required-/,
      );
    },
  );

  it("still runs the scan for a flagged message whose passing token was solved on a foreign host", async () => {
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      payload({ composedMessage: true }),
      pass("token-farm.example"),
    );
    expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
    expect(retroBucket).toHaveBeenCalledTimes(1);
    expect(stored(d)).toMatchObject({
      status: "spam_auto",
      spamReason: "turnstile-required-hostname",
    });
  });

  it("skips the scan when the passing token carries no hostname (older responses fail open)", async () => {
    const { d, findRecentDuplicates } = setup();
    await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), pass(null));
    expect(findRecentDuplicates).not.toHaveBeenCalled();
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
  });
});

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
  const findRecentDuplicates = vi.fn(
    (message: string, since: Date, opts?: { againstVisitorText?: boolean }) =>
      findRecentDuplicateSubmissions(db, message, since.toISOString(), opts),
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

  it("ignores a top-level `composedMessage` key: only the `extra` envelope counts", async () => {
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", { ...payload(), composedMessage: true }, pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).toHaveBeenCalledTimes(1);
  });

  it("only a literal `true` counts as the flag", async () => {
    const { d } = setup();
    await ingestSubmission(d, "reddoor", payload({ composedMessage: "true" }), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
  });

  it("still buckets a flagged message on a site that does NOT require Turnstile, without retro-bucketing", async () => {
    const { d, retroBucket } = setup({ requireTurnstile: false });
    await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it.each<TurnstileOutcome>(["unverifiable", "absent", "fail"])(
    "still runs the scan for a flagged message whose token is %s, but retro-buckets none of the earlier leads",
    async (outcome) => {
      const { d, findRecentDuplicates, retroBucket } = setup();
      await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), outcome);
      expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
      expect(retroBucket).not.toHaveBeenCalled();
      expect(stored(d).status).toBe("spam_auto");
      expect(stored(d).spamReason).toMatch(
        outcome === "unverifiable" ? /^duplicate-body$/ : /^turnstile-required-/,
      );
    },
  );

  it("still runs the scan for a flagged message whose passing token was solved on a foreign host, without retro-bucketing", async () => {
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      payload({ composedMessage: true }),
      pass("token-farm.example"),
    );
    expect(findRecentDuplicates).toHaveBeenCalledTimes(1);
    expect(retroBucket).not.toHaveBeenCalled();
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

// The application message repeats the survey's labels and options for everyone,
// but its free-text answers are typed by the visitor. The site sends those as
// `extra.visitorText`; on the verified path ingest scans only that, against both
// earlier messages and earlier visitorText (decision 2026-11-03-2108, option 1).
const APP_TEMPLATE = [
  'Landing-page application — opened from "The Diagnosis".',
  "",
  "What problems are you experiencing? Outdated sales and marketing materials; Scattered messaging with inconsistent look and feel",
  "What are your goals for this project? Building brand recognition and trust that converts customers",
  "Is there anyone else involved in this project? Just myself",
  "Would you expect to pay $10,000+ to diagnose the problem and rebrand your business if needed? Yes",
];
const appMessage = (website: string) =>
  [
    ...APP_TEMPLATE.slice(0, 3),
    `Where can we check out your work? ${website}`,
    ...APP_TEMPLATE.slice(3),
    "SMS consent: no",
  ].join("\n");
const PITCH =
  "We build ten thousand high authority backlinks for your domain every single month, " +
  "raising organic rankings across competitive keywords quickly while your competitors " +
  "wonder what happened, reply today for a complimentary audit and pricing sheet";

async function seedApplication(email: string, website: string, visitorText: string) {
  const row = await createSubmission(db, {
    siteId: SITE_ID,
    formType: "inquiry",
    name: email,
    email,
    message: appMessage(website),
    extraFields: { composedMessage: true, visitorText },
    status: "new",
    submittedAt: new Date(NOW.getTime() - 3_600_000),
  });
  return row.id;
}

const appPayload = (website: string, visitorText: string) => ({
  formType: "inquiry",
  email: "applicant@example.com",
  name: "Ada Applicant",
  message: appMessage(website),
  extra: { composedMessage: true, visitorText },
});

describe("ingestSubmission — a composed application is scanned on what the visitor typed", () => {
  it("CONTROL: the whole message of two genuine applications is a duplicate", async () => {
    await seedApplication("p5@x.com", "https://acme.com", "The Diagnosis https://acme.com");
    const r = await findRecentDuplicateSubmissions(
      db,
      appMessage("https://zenith.io"),
      "2026-10-01T00:00:00.000Z",
    );
    expect(r.exact.length + r.similar.length).toBeGreaterThan(0);
  });

  it("delivers a genuine application although earlier applications share its labels and options", async () => {
    await seedApplication("p5@x.com", "https://acme.com", "The Diagnosis https://acme.com");
    await seedApplication("p6@x.com", "https://beta.org", "The Diagnosis https://beta.org");
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      appPayload("https://zenith.io", "The Diagnosis https://zenith.io"),
      pass(),
    );
    expect(findRecentDuplicates).toHaveBeenCalledWith(
      "The Diagnosis https://zenith.io",
      expect.any(Date),
      { againstVisitorText: true },
    );
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("catches a pitch typed into an answer against an earlier answer, and retro-buckets it", async () => {
    const prior = await seedApplication("bot1@spam.example", PITCH, `The Diagnosis ${PITCH}`);
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", appPayload(PITCH, `The Diagnosis ${PITCH}`), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).toHaveBeenCalledWith([prior], "retro:duplicate-body");
  });

  it("catches a pitch typed into an answer against the same pitch sprayed to another site", async () => {
    const other = await createSubmission(db, {
      siteId: "recOTHER",
      formType: "contact",
      name: "Spray",
      email: "spray@spam.example",
      message: PITCH,
      status: "new",
      submittedAt: new Date(NOW.getTime() - 3_600_000),
    });
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", appPayload(PITCH, `The Diagnosis ${PITCH}`), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "similar-body" });
    expect(retroBucket).toHaveBeenCalledWith([other.id], "retro:duplicate-body");
  });

  it("stores visitorText on the row, so a later copy can be matched against it", async () => {
    const { d } = setup();
    await ingestSubmission(d, "reddoor", appPayload(PITCH, `The Diagnosis ${PITCH}`), pass());
    expect(stored(d).extraFields).toMatchObject({ visitorText: `The Diagnosis ${PITCH}` });
  });

  it("ignores a top-level visitorText: a step one with one is still not scanned", async () => {
    const { d, findRecentDuplicates } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      { ...payload({ composedMessage: true }), visitorText: PITCH },
      pass(),
    );
    expect(findRecentDuplicates).not.toHaveBeenCalled();
  });
});

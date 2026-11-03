import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestSubmission, type IngestDeps } from "../../src/forms/ingest.js";
import { classifySpam } from "../../src/forms/spam-classifier.js";
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

  it.each<TurnstileOutcome>(["absent", "fail"])(
    "still scans the whole message for a flagged copy whose token is %s, but retro-buckets none of the earlier leads",
    async (outcome) => {
      const { d, findRecentDuplicates, retroBucket } = setup();
      await ingestSubmission(d, "reddoor", payload({ composedMessage: true }), outcome);
      expect(findRecentDuplicates).toHaveBeenCalledWith(STEP_ONE, expect.any(Date));
      expect(retroBucket).not.toHaveBeenCalled();
      expect(stored(d).status).toBe("spam_auto");
      expect(stored(d).spamReason).toMatch(/^turnstile-required-/);
    },
  );

  // "unverifiable" is an expired token, a siteverify outage or a missing secret:
  // turnstile.ts holds it must never punish a possibly-real visitor, so a flagged
  // copy gets the visitorText scan, and the template never sinks it.
  it("delivers a flagged step one whose token is unverifiable, scanning only its visitorText", async () => {
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      payload({ composedMessage: true, visitorText: "The Diagnosis" }),
      "unverifiable",
    );
    expect(findRecentDuplicates).toHaveBeenCalledWith("The Diagnosis", expect.any(Date));
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(retroBucket).not.toHaveBeenCalled();
  });

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

  it("delivers a production-shaped step one (visitorText is the step) as new", async () => {
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      payload({ composedMessage: true, visitorText: "The Diagnosis" }),
      pass(),
    );
    expect(findRecentDuplicates).toHaveBeenCalledWith("The Diagnosis", expect.any(Date));
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(retroBucket).not.toHaveBeenCalled();
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
// Genuine free text, each long enough to clear the lookup's floors, and unrelated.
const GENUINE_A =
  "We are a regional orthopedic device maker rebranding after an acquisition, and our sales decks still show the old parent company logo everywhere";
const GENUINE_B =
  "Our nonprofit clinic network needs one consistent look across twelve locations before the spring donor campaign and a new patient portal launch";
const GENUINE_C =
  "Small surgical robotics startup preparing for a trade show in March, the current website was built by a founder over a weekend and it shows";
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
  it("CONTROL: the same two applications, stored WITHOUT the flag, match on the template", async () => {
    await createSubmission(db, {
      siteId: SITE_ID,
      formType: "inquiry",
      name: "p5",
      email: "p5@x.com",
      message: appMessage("https://acme.com"),
      status: "new",
      submittedAt: new Date(NOW.getTime() - 3_600_000),
    });
    const r = await findRecentDuplicateSubmissions(
      db,
      appMessage("https://zenith.io"),
      "2026-10-01T00:00:00.000Z",
    );
    expect(r.exact.length + r.similar.length).toBe(1);
  });

  it("never matches a stored composed row by its template message, on any scan path", async () => {
    await seedApplication("p5@x.com", "https://acme.com", "The Diagnosis https://acme.com");
    const r = await findRecentDuplicateSubmissions(
      db,
      appMessage("https://zenith.io"),
      "2026-10-01T00:00:00.000Z",
    );
    expect(r).toEqual({ exact: [], similar: [] });
  });

  it("delivers a genuine application whose typed text is long, although earlier applications share its template", async () => {
    await seedApplication("p5@x.com", "https://acme.com", `The Diagnosis\n${GENUINE_A}`);
    await seedApplication("p6@x.com", "https://beta.org", `The Diagnosis\n${GENUINE_B}`);
    const { d, findRecentDuplicates, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      appPayload("https://zenith.io", `The Diagnosis\n${GENUINE_C}`),
      pass(),
    );
    expect(findRecentDuplicates).toHaveBeenCalledWith(
      `The Diagnosis\n${GENUINE_C}`,
      expect.any(Date),
    );
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("a crafted step equal to the template retro-buckets none of the composed step ones", async () => {
    const ids: string[] = [];
    for (const email of ["c1@x.com", "c2@x.com"]) {
      const row = await createSubmission(db, {
        siteId: SITE_ID,
        formType: "inquiry",
        name: email,
        email,
        message: STEP_ONE,
        extraFields: { composedMessage: true, visitorText: "The Diagnosis" },
        status: "new",
        submittedAt: new Date(NOW.getTime() - 3_600_000),
      });
      ids.push(row.id);
    }
    const { d, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      payload({ composedMessage: true, visitorText: STEP_ONE }),
      pass(),
    );
    const retroed = retroBucket.mock.calls.flatMap((c) => c[0] as string[]);
    for (const id of ids) expect(retroed).not.toContain(id);
  });

  it("an unflagged plain copy of the template on another site retro-buckets none of the composed step ones", async () => {
    const row = await createSubmission(db, {
      siteId: SITE_ID,
      formType: "inquiry",
      name: "c1",
      email: "c1@x.com",
      message: STEP_ONE,
      extraFields: { composedMessage: true, visitorText: "The Diagnosis" },
      status: "new",
      submittedAt: new Date(NOW.getTime() - 3_600_000),
    });
    const { d, retroBucket } = setup({ requireTurnstile: false });
    await ingestSubmission(d, "other-site", payload(), "absent");
    const retroed = retroBucket.mock.calls.flatMap((c) => c[0] as string[]);
    expect(retroed).not.toContain(row.id);
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

  it("catches a near-copy of a pitch against an earlier answer's visitorText (similar tier)", async () => {
    const prior = await seedApplication("bot1@spam.example", PITCH, `The Diagnosis ${PITCH}`);
    const variant = `The Diagnosis ${PITCH.replace("today", "now")}`;
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", appPayload(PITCH, variant), pass());
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "similar-body" });
    expect(retroBucket).toHaveBeenCalledWith([prior], "retro:duplicate-body");
  });

  it("matches a plain spray against an earlier reddoor answer that carried the same pitch", async () => {
    const prior = await seedApplication("bot1@spam.example", PITCH, `The Diagnosis ${PITCH}`);
    const { d, retroBucket } = setup({ requireTurnstile: false });
    await ingestSubmission(
      d,
      "other-site",
      { email: "spray@spam.example", message: PITCH },
      "absent",
    );
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "similar-body" });
    expect(retroBucket).toHaveBeenCalledWith([prior], "retro:duplicate-body");
  });

  it("an unverifiable flagged application is still judged on its visitorText, without retro-bucketing", async () => {
    await seedApplication("bot1@spam.example", PITCH, `The Diagnosis ${PITCH}`);
    const { d, retroBucket } = setup();
    await ingestSubmission(
      d,
      "reddoor",
      appPayload(PITCH, `The Diagnosis ${PITCH}`),
      "unverifiable",
    );
    expect(stored(d)).toMatchObject({ status: "spam_auto", spamReason: "duplicate-body" });
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("exempts the same sender's own resend on the same site on the visitorText path", async () => {
    await seedApplication("applicant@example.com", PITCH, `The Diagnosis ${PITCH}`);
    const { d, retroBucket } = setup();
    await ingestSubmission(d, "reddoor", appPayload(PITCH, `The Diagnosis ${PITCH}`), pass());
    expect(stored(d)).toMatchObject({ status: "new", spamReason: null });
    expect(retroBucket).not.toHaveBeenCalled();
  });

  it("a malformed extra_fields column neither throws nor blinds the scan to other rows", async () => {
    const bad = await seedApplication("p9@x.com", "https://x.com", "irrelevant");
    await db
      .updateTable("submissions")
      .set({ extra_fields: "{not json" })
      .where("id", "=", bad)
      .execute();
    const prior = await seedApplication("bot1@spam.example", PITCH, `The Diagnosis ${PITCH}`);
    const r = await findRecentDuplicateSubmissions(
      db,
      `The Diagnosis ${PITCH}`,
      "2026-10-01T00:00:00.000Z",
    );
    expect(r.exact.map((m) => m.id)).toEqual([prior]);
  });

  it("scores a pasted URL once, not again through visitorText", async () => {
    const { d } = setup();
    // Wired as netlify/functions/form-ingest.mts wires it.
    d.classifySpam = (n, outcome) =>
      classifySpam({
        name: n.name,
        email: n.email,
        ...(n.message !== undefined ? { message: n.message } : {}),
        formType: n.formType,
        extraFields: n.extraFields,
        turnstile: outcome,
      });
    await ingestSubmission(
      d,
      "reddoor",
      appPayload("https://acmeclinic.com", "The Diagnosis\nhttps://acmeclinic.com"),
      pass(),
    );
    expect(stored(d).spamReason ?? "").not.toMatch(/links:2/);
    expect(stored(d).extraFields).toMatchObject({
      visitorText: "The Diagnosis\nhttps://acmeclinic.com",
    });
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

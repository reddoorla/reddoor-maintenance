/**
 * P1-78d: the operator digest on the severity ladder (workspace
 * briefs/2026-10-26-p1-78d-digest-ladder.md). Broken and Attention are mailed, in
 * that order; Watch stays in the snapshot, where its age lives, and is never mailed;
 * a rise in level is news.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { runDigest, digestSubject, orderAttention } from "../../src/reports/digest.js";
import {
  coerceSendLog,
  digestChanges,
  nextSent,
  type DigestSendLog,
} from "../../src/alerts/digest-send.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { websiteRowsFrom, reportRowsFrom, type RawRow } from "../_helpers/raw-rows.js";

const BASE = "https://reddoor-maintenance.netlify.app";

beforeEach(() => {
  process.env.OPERATOR_EMAIL = "tucker@reddoorla.com";
});

function day(n: number): Date {
  return new Date(Date.UTC(2026, 9, 1 + n, 13, 0, 0));
}

function world() {
  let snap: Record<string, { metric: number; firstFlaggedAt: string }> = {};
  let log: DigestSendLog = { sentOn: null, sent: {}, readySince: {} };
  const captured: ResendSendInput[] = [];
  const client: ResendClient = {
    send: async (input: ResendSendInput) => {
      captured.push(input);
      return { messageId: `msg_${captured.length}` };
    },
  } as unknown as ResendClient;
  return {
    captured,
    digestState: { read: async () => snap, write: async (n: typeof snap) => void (snap = n) },
    sendLog: { read: async () => log, write: async (n: DigestSendLog) => void (log = n) },
    client,
    snapshot: () => snap,
  };
}

async function run(w: ReturnType<typeof world>, sites: RawRow[], now: Date) {
  return runDigest({
    digestState: w.digestState,
    sendLog: w.sendLog,
    roster: async () => websiteRowsFrom(sites),
    allReports: async () => reportRowsFrom([]),
    resend: w.client,
    baseUrl: BASE,
    submissionCounts: null,
    now,
  });
}

/** A maintained site whose GitHub signals were swept at `now`: its Renovate count
 *  and CI state are fresh. */
function site(now: Date, over: Record<string, unknown> = {}): RawRow {
  return {
    id: "rec_acme",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      Status: "maintained",
      "URL Resolves": "pass",
      "URL Checked At": now.toISOString(),
      "GitHub Signals At": now.toISOString(),
      ...over,
    },
  };
}

describe("what the digest mails", () => {
  it("mails Attention, and never a Watch item beside it (the email and its send log)", async () => {
    const w = world();
    await run(
      w,
      [site(day(0), { "Renovate Failing CIs": 1, "Default Branch CI": "failing" })],
      day(0),
    );
    expect(w.captured).toHaveLength(1);
    const html = w.captured[0]!.html;
    expect(html).toContain("Default-branch CI failing");
    expect(html).not.toContain("Renovate PR");
    const sent = (await w.sendLog.read()).sent;
    expect(Object.keys(sent)).toEqual(["ci:rec_acme"]);
    // Still in the snapshot: its age counts from there.
    expect(Object.keys(w.snapshot())).toContain("renovate:rec_acme");
  });

  it("a night whose only items are Watch sends nothing", async () => {
    const w = world();
    const r = await run(w, [site(day(0), { "Renovate Failing CIs": 1 })], day(0));
    expect(w.captured).toHaveLength(0);
    expect(r.output).toContain("skipped");
  });

  it("puts Broken above Attention", async () => {
    const w = world();
    await run(
      w,
      [
        site(day(0), { "Default Branch CI": "failing" }),
        {
          id: "rec_beta",
          fields: { ...site(day(0)).fields, Name: "Beta", "Deploy status": "error" },
        },
      ],
      day(0),
    );
    const html = w.captured[0]!.html;
    expect(html.indexOf("Broken — ")).toBeGreaterThan(-1);
    expect(html.indexOf("Broken — ")).toBeLessThan(html.indexOf("Attention — "));
  });

  it("a Renovate PR red for seven days, from an empty state, rises to Attention and sends on day 7", async () => {
    const w = world();
    for (let n = 0; n < 7; n++) {
      await run(w, [site(day(n), { "Renovate Failing CIs": 1 })], day(n));
      expect(w.captured).toHaveLength(0);
    }
    const r = await run(w, [site(day(7), { "Renovate Failing CIs": 1 })], day(7));
    expect(r.output).toContain("Digest sent");
    expect(w.captured).toHaveLength(1);
    expect(w.captured[0]!.html).toContain("Attention — fix this week");
    expect(w.captured[0]!.html).toContain("Renovate PR failing CI");
    // Its first mailing is news, though the snapshot has held it for 7 days.
    expect(w.captured[0]!.html).toMatch(/>NEW<\/strong> /);
  });
});

const item = (over: Partial<AttentionItem>): AttentionItem => ({
  key: "k",
  kind: "ci",
  siteName: "Acme",
  title: "t",
  severity: "warning",
  metric: 1,
  ...over,
});

describe("the subject and the order", () => {
  it("never says Act: for a Watch item", () => {
    const watch = item({
      key: "renovate:a",
      kind: "renovate",
      severity: "critical",
      title: "renovate red",
      level: "watch",
    });
    const s = digestSubject({
      date: "2026-10-08",
      readyForYourYes: [],
      needsAttention: [watch],
      changes: { added: ["renovate:a"], worse: [] },
      lastSentOn: "2026-10-01",
    });
    expect(s).not.toContain("Act:");
  });

  it("orders a Broken item before an Attention one, whatever their severity", () => {
    const attention = item({
      key: "ci:a",
      siteName: "Acme",
      severity: "critical",
      level: "attention",
    });
    const broken = item({ key: "deploy:b", kind: "deploy", siteName: "Beta", level: "broken" });
    expect(orderAttention([attention, broken]).map((i) => i.key)).toEqual(["deploy:b", "ci:a"]);
  });
});

describe("a rise in level is news", () => {
  it("a key mailed at Attention that is now Broken, same count, is worse", () => {
    const log: DigestSendLog = {
      sentOn: "2026-10-07",
      sent: { "cert:a": { metric: 1, level: "attention" } },
      readySince: {},
    };
    expect(digestChanges([{ key: "cert:a", metric: 1, level: "broken" }], log)).toEqual({
      added: [],
      worse: ["cert:a"],
    });
    // And a fall is not.
    const down: DigestSendLog = { ...log, sent: { "cert:a": { metric: 1, level: "broken" } } };
    expect(digestChanges([{ key: "cert:a", metric: 1, level: "attention" }], down)).toEqual({
      added: [],
      worse: [],
    });
  });
});

describe("the send log carries each key's level (review round 1)", () => {
  it("a sent digest records the level each key was mailed at, and a read keeps it", async () => {
    const w = world();
    await run(w, [site(day(0), { "Default Branch CI": "failing" })], day(0));
    const log = await w.sendLog.read();
    expect(log.sent["ci:rec_acme"]).toMatchObject({ level: "attention" });
    expect(coerceSendLog(JSON.parse(JSON.stringify(log))).sent["ci:rec_acme"]).toMatchObject({
      level: "attention",
    });
  });

  it("a skipped night keeps the level last mailed", () => {
    const prior = { k: { metric: 1, level: "broken" as const } };
    const kept = nextSent(
      prior,
      [{ key: "k", metric: 1, level: "attention" }],
      "2026-10-08",
      false,
    );
    expect(kept.k).toMatchObject({ level: "broken" });
    const sent = nextSent(prior, [{ key: "k", metric: 1, level: "attention" }], "2026-10-08", true);
    expect(sent.k).toMatchObject({ level: "attention" });
  });
});

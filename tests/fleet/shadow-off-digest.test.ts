import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ touched: [] as string[] }));

vi.mock("../../src/reports/airtable/client.js", async (importOriginal) => {
  const { untouchableBase } = await import("./_helpers/untouchable-airtable.js");
  return {
    ...(await importOriginal<typeof import("../../src/reports/airtable/client.js")>()),
    openBase: () => untouchableBase(h.touched),
  };
});

import { runDigest } from "../../src/reports/digest.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import { mapRow as mapReport } from "../../src/reports/airtable/reports.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { untouchableFetch } from "./_helpers/untouchable-airtable.js";

const NOW = new Date("2026-09-28T09:00:00.000Z");

const SITE = makeWebsiteRow({
  id: "rec_site_acme",
  name: "Acme Co",
  pointOfContact: "owner@acme.example.com",
  headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" } as never,
  pScore: 95,
  rScore: 100,
  bpScore: 100,
  seoScore: 100,
});

const PENDING = mapReport({
  id: "rec_report_ready",
  fields: {
    "Report ID": "Acme Co — Launch — 2026-09",
    Site: ["rec_site_acme"],
    "Report type": "Launch",
    Period: "2026-09",
    "Completed on": "2026-09-27",
    "Lighthouse — Performance": 95,
    "Lighthouse — Accessibility": 100,
    "Lighthouse — Best Practices": 100,
    "Lighthouse — SEO": 100,
    "Draft ready": true,
    "Approved to send": false,
  },
});

let logged: () => string;
let warned: () => string;

beforeEach(() => {
  h.touched.length = 0;
  vi.stubGlobal("fetch", untouchableFetch(h.touched));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("AIRTABLE_PAT", "pat_test");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_test");
  vi.stubEnv("OPERATOR_EMAIL", "tucker@reddoorla.com");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
  warned = () => warn.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function harness(reports: ReturnType<typeof mapReport>[]) {
  const snapshots: DigestSnapshot[] = [];
  const rollups: Date[] = [];
  const sent: ResendSendInput[] = [];
  const resend: ResendClient = {
    send: async (input) => {
      sent.push(input);
      return { messageId: "msg_digest" };
    },
  };
  const options = {
    resend,
    baseUrl: "https://reddoor-maintenance.netlify.app",
    roster: async () => [SITE],
    allReports: async () => reports,
    submissionCounts: null,
    now: NOW,
    digestState: {
      read: async () => ({}) as DigestSnapshot,
      write: async (snap: DigestSnapshot) => {
        snapshots.push(snap);
      },
    },
    cockpitRollup: {
      write: async (at: Date) => {
        rollups.push(at);
      },
    },
  };
  return { options, snapshots, rollups, sent };
}

describe("shipped shadow-off: the digest's snapshot write never touches Airtable", () => {
  it("sends, snapshots to Turso and prints airtable=off", async () => {
    const { options, snapshots, rollups, sent } = harness([PENDING]);
    const r = await runDigest(options);
    expect(h.touched).toEqual([]);
    expect(r).toEqual({ output: "Digest sent to tucker@reddoorla.com (msg_digest)", code: 0 });
    expect(sent).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    expect(rollups).toEqual([NOW]);
    expect(logged()).toContain("DIGEST_STATE_WRITE turso=1 airtable=off rollup=1");
    expect(logged()).toContain("AIRTABLE_SHADOW skipped=shadow-off writer=writeDigestState");
    expect(warned()).not.toContain("digest state write failed");
  });

  it("a quiet-day skip still snapshots to Turso and prints airtable=off", async () => {
    const { options, snapshots, sent } = harness([]);
    const r = await runDigest(options);
    expect(h.touched).toEqual([]);
    expect(r).toEqual({
      output: "Digest skipped (nothing ready, nothing needs attention).",
      code: 0,
    });
    expect(sent).toEqual([]);
    expect(snapshots).toHaveLength(1);
    expect(logged()).toContain("DIGEST_STATE_WRITE turso=1 airtable=off rollup=1");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";

// No network: GA/Search enrichment and the header fetch/downscale are stubbed.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
  fetchSearch: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
}));
vi.mock("../../src/reports/airtable/attachments.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/airtable/attachments.js")>()),
  fetchAttachmentBytes: vi
    .fn()
    .mockResolvedValue({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
}));
vi.mock("../../src/reports/maintenance-email/header-image.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/maintenance-email/header-image.js")>()),
  prepareHeaderImage: vi.fn().mockResolvedValue({
    bytes: new Uint8Array([1]),
    contentType: "image/jpeg",
    displayWidth: 600,
    displayHeight: 200,
    placeholderColor: "#eee",
  }),
}));

import { selftestEmail } from "../../src/recipes/selftest-email.js";

function scored(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    "Header image": [{ url: "https://x/h.jpg", filename: "h.jpg", type: "image/jpeg" }],
    ...over,
  };
}

function captureResend(): { client: ResendClient; sent: ResendSendInput[] } {
  const sent: ResendSendInput[] = [];
  return {
    sent,
    client: {
      async send(input) {
        sent.push(input);
        return { messageId: `msg_${sent.length}` };
      },
    },
  };
}

const NOW = new Date("2026-06-26T12:00:00Z");

beforeEach(() => {
  process.env.AIRTABLE_PAT = "pat";
  process.env.AIRTABLE_BASE_ID = "app";
  delete process.env.OPERATOR_EMAIL;
});

describe("selftestEmail", () => {
  it("sends one announcement to the operator default and writes NOTHING to Airtable", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({ base, resend: client, site: "acme-co", now: NOW });

    expect(res.results).toEqual([
      {
        site: "Acme Co",
        status: "sent",
        subject: expect.any(String),
        recipients: ["info@reddoorla.com"],
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["info@reddoorla.com"]);
    expect(sent[0]!.cc).toBeUndefined(); // private: no global ops CC
    expect(sent[0]!.subject).toContain("Your testing & maintenance report for Acme Co");
    // The core guarantee: zero Airtable mutations.
    expect(base.__calls.filter((c) => c.kind === "create" || c.kind === "update")).toHaveLength(0);
  });

  it("honors --to (comma-separated) and the requested type", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    await selftestEmail({
      base,
      resend: client,
      site: "acme-co",
      type: "Testing",
      to: "a@x.com, b@y.com",
      now: NOW,
    });
    expect(sent[0]!.to).toEqual(["a@x.com", "b@y.com"]);
    expect(sent[0]!.subject).toContain("Testing Report");
  });

  it("--all sends one email per report-eligible site (maintenance + hosting); a scores-less site is skipped", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "r1",
          fields: { Name: "Good Co", url: "https://good.com", Status: "maintenance", ...scored() },
        },
        {
          id: "r2",
          fields: {
            Name: "No Scores",
            url: "https://ns.com",
            Status: "maintenance",
            "Header image": [{ url: "u", filename: "f", type: "image/jpeg" }],
          },
        },
        {
          id: "r3",
          fields: { Name: "Hosting Co", url: "https://h.com", Status: "hosting", ...scored() },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({ base, resend: client, all: true, now: NOW });
    const byName = new Map(res.results.map((r) => [r.site, r.status]));
    expect(byName.get("Good Co")).toBe("sent");
    expect(byName.get("No Scores")).toBe("skipped");
    expect(byName.get("Hosting Co")).toBe("sent"); // hosting is report-eligible, not excluded
    expect(sent).toHaveLength(2);
  });

  it("--dry-run renders without sending", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scored(),
          },
        },
      ],
      Reports: [],
    });
    const { client, sent } = captureResend();
    const res = await selftestEmail({
      base,
      resend: client,
      site: "acme-co",
      dryRun: true,
      now: NOW,
    });
    expect(res.results[0]!.status).toBe("dry-run");
    expect(sent).toHaveLength(0);
  });
});

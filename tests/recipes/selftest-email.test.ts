import { describe, it, expect, vi, beforeEach } from "vitest";
import { websiteRowsFrom, type RawRow } from "../_helpers/raw-rows.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { OPERATOR_FALLBACK } from "../../src/util/operator.js";

// No network: GA/Search enrichment and the header downscale are stubbed.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
  fetchSearch: vi.fn().mockResolvedValue({ value: null, softFailed: false }),
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
// The stamp is the step a preview exists to show; stub it so the wiring — not sharp —
// is what's under test. Returns bytes distinct from the stored plate so the assertion
// below can prove prepareHeaderImage received the STAMPED image, not the raw one.
vi.mock("../../src/reports/header-image/index.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/header-image/index.js")>()),
  applyReportTypeHeadline: vi.fn().mockResolvedValue(new Uint8Array([9, 9])),
}));

import { selftestEmail } from "../../src/recipes/selftest-email.js";
import { prepareHeaderImage } from "../../src/reports/maintenance-email/header-image.js";
import { applyReportTypeHeadline } from "../../src/reports/header-image/index.js";

function scored(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    ...over,
  };
}

const PLATE = new Uint8Array([1]);

/** The Turso reads selftest makes: the roster, and each site's stored header plate.
 *  `plates` lists the site ids that have one. */
function reads(websites: RawRow[], plates: string[] = websites.map((w) => w.id)) {
  const plateReads: string[] = [];
  return {
    plateReads,
    roster: async () => websiteRowsFrom(websites),
    loadHeaderPlate: async (siteId: string) => {
      plateReads.push(siteId);
      return plates.includes(siteId) ? PLATE : null;
    },
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
  delete process.env.OPERATOR_EMAIL;
});

describe("selftestEmail", () => {
  it("sends one announcement to the operator default", async () => {
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    const { plateReads, ...store } = reads(websites);
    const res = await selftestEmail({ ...store, resend: client, site: "acme-co", now: NOW });

    expect(res.results).toEqual([
      {
        site: "Acme Co",
        status: "sent",
        subject: expect.any(String),
        recipients: [OPERATOR_FALLBACK],
      },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([OPERATOR_FALLBACK]);
    expect(sent[0]!.cc).toBeUndefined(); // private: no global ops CC
    expect(sent[0]!.subject).toContain("Your testing & maintenance report for Acme Co");
    expect(plateReads).toEqual(["rec1"]);
  });

  it("honors --to (comma-separated) and the requested type", async () => {
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      type: "Testing",
      to: "a@x.com, b@y.com",
      now: NOW,
    });
    expect(sent[0]!.to).toEqual(["a@x.com", "b@y.com"]);
    expect(sent[0]!.subject).toContain("Testing Report");
  });

  it("--all sends one email per report-eligible site (maintained + hosted-only); a scores-less site is skipped", async () => {
    const websites: RawRow[] = [
      {
        id: "r1",
        fields: { Name: "Good Co", url: "https://good.com", Status: "maintained", ...scored() },
      },
      {
        id: "r2",
        fields: {
          Name: "No Scores",
          url: "https://ns.com",
          Status: "maintained",
        },
      },
      {
        id: "r3",
        fields: { Name: "Hosting Co", url: "https://h.com", Status: "hosted-only", ...scored() },
      },
    ];
    const { client, sent } = captureResend();
    const res = await selftestEmail({ ...reads(websites), resend: client, all: true, now: NOW });
    const byName = new Map(res.results.map((r) => [r.site, r.status]));
    expect(byName.get("Good Co")).toBe("sent");
    expect(byName.get("No Scores")).toBe("skipped");
    expect(byName.get("Hosting Co")).toBe("sent"); // hosted-only is report-eligible, not excluded
    expect(sent).toHaveLength(2);
  });

  it("--dry-run renders without sending", async () => {
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    const res = await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      dryRun: true,
      now: NOW,
    });
    expect(res.results[0]!.status).toBe("dry-run");
    expect(sent).toHaveLength(0);
  });

  // REGRESSION (2026-08-24): selftest called prepareHeaderImage on the stored header
  // directly, skipping the headline stamp that orchestrate.ts applies. Since the stored
  // header is the CLEAN plate, every preview shipped a header with an EMPTY headline
  // band — so the one artifact meant to catch a bad header was itself wrong, and
  // matched no real send. The preview must run the SAME two steps, in the same order.
  it("stamps the requested type's headline before downscaling, like a real send", async () => {
    vi.mocked(applyReportTypeHeadline).mockClear();
    vi.mocked(prepareHeaderImage).mockClear();
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client } = captureResend();
    await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      type: "Launch",
      now: NOW,
    });

    // Stamped with the type the operator asked to preview, from the stored plate...
    expect(applyReportTypeHeadline).toHaveBeenCalledWith(new Uint8Array([1]), "Launch");
    // ...and the downscale consumed the STAMPED result, not the raw header.
    expect(prepareHeaderImage).toHaveBeenCalledWith(new Uint8Array([9, 9]));
  });

  it("skips a site with no stored header plate, without sending", async () => {
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    const res = await selftestEmail({
      ...reads(websites, []),
      resend: client,
      site: "acme-co",
      now: NOW,
    });
    expect(res.results).toEqual([
      { site: "Acme Co", status: "skipped", reason: "no Header image" },
    ]);
    expect(sent).toHaveLength(0);
  });

  it("drops the rows whose evidence is n/a from the rendered email (decision 17)", async () => {
    const stamp = "2026-06-26T06:00:00Z";
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          "Function health checked at": stamp,
          "Prismic Models Checked At": stamp,
          "Form E2E checked at": stamp,
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      type: "Testing",
      now: NOW,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).not.toContain("CMS Checked");
    expect(sent[0]!.html).not.toContain("Form Functionality");
    expect(sent[0]!.html).toContain("Uptime Checked");
    expect(sent[0]!.html).toContain("Mobile Browsers");
  });

  it("a Maintenance selftest drops the n/a CMS row too", async () => {
    const stamp = "2026-06-26T06:00:00Z";
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          "Function health checked at": stamp,
          "Prismic Models Checked At": stamp,
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      type: "Maintenance",
      now: NOW,
    });
    expect(sent[0]!.html).not.toContain("CMS Checked");
    expect(sent[0]!.html).toContain("Uptime Checked");
  });

  it("keeps every row when nothing is n/a", async () => {
    const websites: RawRow[] = [
      {
        id: "rec1",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          ...scored(),
        },
      },
    ];
    const { client, sent } = captureResend();
    await selftestEmail({
      ...reads(websites),
      resend: client,
      site: "acme-co",
      type: "Testing",
      now: NOW,
    });
    expect(sent[0]!.html).toContain("CMS Checked");
    expect(sent[0]!.html).toContain("Form Functionality");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildPocNotification,
  buildAutoresponder,
  notifySubmission,
  makeNotify,
  resolveRecipients,
} from "../../src/forms/notify.js";
import type { NotifyRouting } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

describe("buildPocNotification", () => {
  it("addresses the POC, sets Reply-To to the submitter, names the site in From", () => {
    const site = makeWebsiteRow({ name: "Acme Co", pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({ email: "lead@x.com", formType: "inquiry" });
    const input = buildPocNotification(site, sub)!;
    expect(input.to).toEqual(["owner@acme.com"]);
    expect(input.replyTo).toBe("lead@x.com");
    expect(input.from).toContain("Acme Co Forms <forms@reddoorla.com>");
    expect(input.subject).toBe("New inquiry from Acme Co");
  });

  it("falls back to reportRecipientsTo, and returns null with no contact", () => {
    const withCc = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: "to@acme.com" });
    expect(buildPocNotification(withCc, makeSubmissionRow())!.to).toEqual(["to@acme.com"]);
    const none = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: null });
    expect(buildPocNotification(none, makeSubmissionRow())).toBeNull();
  });

  it("renders extraFields (the artwork an inquiry is about) into the email, dropping empty values", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const sub = makeSubmissionRow({
      formType: "inquiry",
      email: "lead@x.com",
      extraFields: JSON.stringify({
        piece: "Untitled (2025)",
        artist: "Jane Doe",
        appointment_date: "", // empty → dropped
      }),
    });
    const input = buildPocNotification(site, sub)!;
    expect(input.html).toContain("Piece");
    expect(input.html).toContain("Untitled (2025)");
    expect(input.html).toContain("Artist");
    expect(input.html).toContain("Jane Doe");
    expect(input.html).not.toContain("Appointment date");
  });

  it("escapes HTML in extraFields and tolerates malformed JSON without throwing", () => {
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const evil = buildPocNotification(
      site,
      makeSubmissionRow({ extraFields: JSON.stringify({ note: "<img src=x onerror=alert(1)>" }) }),
    )!;
    expect(evil.html).toContain("&lt;img src=x");
    expect(evil.html).not.toContain("<img src=x");
    const bad = buildPocNotification(site, makeSubmissionRow({ extraFields: "{not json" }))!;
    expect(bad.html).toContain("New contact submission"); // malformed JSON → still renders, no extra rows
  });

  it("escapes HTML in the body and strips quotes/newlines from the From display name", () => {
    const site = makeWebsiteRow({ name: 'Acme "Co"\r\n<x>', pointOfContact: "owner@acme.com" });
    const input = buildPocNotification(
      site,
      makeSubmissionRow({ message: "<script>alert(1)</script>" }),
    )!;
    expect(input.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(input.html).not.toContain("<script>");
    expect(input.from).not.toContain('"');
    expect(input.from).not.toMatch(/[\r\n]/);
  });
});

describe("buildAutoresponder", () => {
  it("uses per-site copy when present and replies to the POC", () => {
    const site = makeWebsiteRow({
      name: "Acme",
      pointOfContact: "owner@acme.com",
      copyIntro: "Hi from Acme!",
    });
    const input = buildAutoresponder(site, makeSubmissionRow({ email: "lead@x.com" }))!;
    expect(input.to).toEqual(["lead@x.com"]);
    expect(input.replyTo).toBe("owner@acme.com");
    expect(input.html).toContain("Hi from Acme!");
  });

  it("returns null when the submitter has no email", () => {
    expect(buildAutoresponder(makeWebsiteRow(), makeSubmissionRow({ email: "" }))).toBeNull();
  });
});

describe("notifySubmission", () => {
  it("returns sent + message id and also fires the autoresponder", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "msg_1" });
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out).toEqual({ status: "sent", messageId: "msg_1" });
    expect(send).toHaveBeenCalledTimes(2); // POC + autoresponder
  });

  it("returns failed when the POC send throws, without throwing", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const site = makeWebsiteRow({ pointOfContact: "owner@acme.com" });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out.status).toBe("failed");
  });

  it("returns skipped when there is no POC", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "x" });
    const site = makeWebsiteRow({ pointOfContact: null, reportRecipientsTo: null });
    const out = await notifySubmission({ send }, site, makeSubmissionRow({ email: "l@x.com" }));
    expect(out.status).toBe("skipped");
    expect(send).toHaveBeenCalledTimes(1); // autoresponder only
  });
});

describe("buildPocNotification — status-aware recipient", () => {
  afterEach(() => {
    delete process.env.OPERATOR_EMAIL;
  });

  const sub = makeSubmissionRow({ formType: "contact", name: "A", email: "lead@x.co" });

  it("routes a non-maintenance (launch period) site to the operator fallback", () => {
    const out = buildPocNotification(makeWebsiteRow({ status: "launch period" }), sub);
    expect(out?.to).toEqual(["tucker@reddoorla.com"]);
  });

  it("routes a null-status site to the operator fallback", () => {
    const out = buildPocNotification(
      makeWebsiteRow({ name: "X", status: null }),
      makeSubmissionRow({ formType: "contact", email: "lead@x.co" }),
    );
    expect(out?.to).toEqual(["tucker@reddoorla.com"]);
  });

  it("honors OPERATOR_EMAIL for a non-maintenance site", () => {
    process.env.OPERATOR_EMAIL = "ops@reddoorla.com";
    const out = buildPocNotification(makeWebsiteRow({ status: "hosting" }), sub);
    expect(out?.to).toEqual(["ops@reddoorla.com"]);
  });

  it("routes a maintenance site to its POC", () => {
    const out = buildPocNotification(
      makeWebsiteRow({ status: "maintenance", pointOfContact: "client@site.com" }),
      sub,
    );
    expect(out?.to).toEqual(["client@site.com"]);
  });

  it("skips (null) a maintenance site with no POC", () => {
    const out = buildPocNotification(
      makeWebsiteRow({ status: "maintenance", pointOfContact: null, reportRecipientsTo: null }),
      sub,
    );
    expect(out).toBeNull();
  });
});

describe("makeNotify", () => {
  it("marks the notification failed without sending when the Resend client is unavailable", async () => {
    const notify = makeNotify(null);
    const out = await notify(
      makeWebsiteRow({ pointOfContact: "owner@acme.com" }),
      makeSubmissionRow({ email: "l@x.com" }),
    );
    expect(out).toEqual({ status: "failed", messageId: null });
  });

  it("delegates to notifySubmission when a send fn is provided", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "msg_9" });
    const notify = makeNotify(send);
    const out = await notify(
      makeWebsiteRow({ pointOfContact: "owner@acme.com" }),
      makeSubmissionRow({ email: "l@x.com" }),
    );
    expect(out).toEqual({ status: "sent", messageId: "msg_9" });
    expect(send).toHaveBeenCalled();
  });
});

describe("resolveRecipients — field-based routing", () => {
  afterEach(() => {
    delete process.env.OPERATOR_EMAIL;
  });

  const routing: NotifyRouting = {
    field: "interest",
    routes: {
      Leasing: "lease@erp.com",
      "Investor Relations": "invest@erp.com",
      Both: ["a@erp.com", "b@erp.com"],
    },
    default: "fallback@erp.com",
    cc: ["tucker@reddoorla.com"],
  };
  const routed = (over: Partial<Parameters<typeof makeWebsiteRow>[0]> = {}) =>
    makeWebsiteRow({ status: "maintenance", notifyRouting: routing, ...over });
  const withInterest = (interest: string) =>
    makeSubmissionRow({
      formType: "contact",
      email: "lead@x.co",
      extraFields: JSON.stringify({ interest }),
    });

  it("routes by the interest field value and applies CC", () => {
    expect(resolveRecipients(routed(), withInterest("Leasing"))).toEqual({
      to: ["lease@erp.com"],
      cc: ["tucker@reddoorla.com"],
    });
  });

  it("uses the default recipient when the value matches no route", () => {
    expect(resolveRecipients(routed(), withInterest("Nope"))).toEqual({
      to: ["fallback@erp.com"],
      cc: ["tucker@reddoorla.com"],
    });
  });

  it("supports an array route (multiple recipients)", () => {
    expect(resolveRecipients(routed(), withInterest("Both"))).toEqual({
      to: ["a@erp.com", "b@erp.com"],
      cc: ["tucker@reddoorla.com"],
    });
  });

  it("ignores routing for a pre-launch site (operator only, no CC)", () => {
    expect(resolveRecipients(routed({ status: "launch period" }), withInterest("Leasing"))).toEqual(
      {
        to: ["tucker@reddoorla.com"],
        cc: [],
      },
    );
  });

  it("falls through to the POC when routing yields nothing and no default is set", () => {
    const noDefault: NotifyRouting = { field: "interest", routes: { Leasing: "lease@erp.com" } };
    const out = resolveRecipients(
      makeWebsiteRow({
        status: "maintenance",
        notifyRouting: noDefault,
        pointOfContact: "poc@erp.com",
      }),
      withInterest("Unknown"),
    );
    expect(out).toEqual({ to: ["poc@erp.com"], cc: [] });
  });

  it("keeps single-POC behavior when no routing is configured", () => {
    expect(
      resolveRecipients(
        makeWebsiteRow({ status: "maintenance", pointOfContact: "poc@erp.com" }),
        makeSubmissionRow({ extraFields: null }),
      ),
    ).toEqual({ to: ["poc@erp.com"], cc: [] });
  });

  it("degrades a whitespace-only or non-string route value to the POC", () => {
    const blankRoute: NotifyRouting = { field: "interest", routes: { Leasing: "   " } };
    expect(
      resolveRecipients(
        makeWebsiteRow({
          status: "maintenance",
          notifyRouting: blankRoute,
          pointOfContact: "poc@erp.com",
        }),
        withInterest("Leasing"),
      ),
    ).toEqual({ to: ["poc@erp.com"], cc: [] });

    // A non-string route value (operator JSON typo) must not become a recipient.
    const badType = { field: "interest", routes: { Leasing: 42 } } as unknown as NotifyRouting;
    expect(
      resolveRecipients(
        makeWebsiteRow({
          status: "maintenance",
          notifyRouting: badType,
          pointOfContact: "poc@erp.com",
        }),
        withInterest("Leasing"),
      ),
    ).toEqual({ to: ["poc@erp.com"], cc: [] });
  });

  it("de-dupes repeated recipients in routes and cc", () => {
    const dupes: NotifyRouting = {
      field: "interest",
      routes: { Both: ["a@erp.com", "a@erp.com", "b@erp.com"] },
      cc: ["tucker@reddoorla.com", "tucker@reddoorla.com"],
    };
    expect(
      resolveRecipients(
        makeWebsiteRow({ status: "maintenance", notifyRouting: dupes }),
        withInterest("Both"),
      ),
    ).toEqual({ to: ["a@erp.com", "b@erp.com"], cc: ["tucker@reddoorla.com"] });
  });

  it("buildPocNotification emits CC only when present and addresses the routed recipient", () => {
    const out = buildPocNotification(routed(), withInterest("Investor Relations"))!;
    expect(out.to).toEqual(["invest@erp.com"]);
    expect(out.cc).toEqual(["tucker@reddoorla.com"]);
    expect(out.replyTo).toBe("lead@x.co");

    const plain = buildPocNotification(
      makeWebsiteRow({ status: "maintenance", pointOfContact: "poc@x.com" }),
      makeSubmissionRow({ email: "lead@x.co" }),
    )!;
    expect(plain.cc).toBeUndefined();
  });
});

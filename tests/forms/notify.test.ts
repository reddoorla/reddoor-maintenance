import { describe, it, expect, vi } from "vitest";
import {
  buildPocNotification,
  buildAutoresponder,
  notifySubmission,
} from "../../src/forms/notify.js";
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

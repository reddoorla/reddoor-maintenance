import { describe, it, expect } from "vitest";
import { reportRecipients, GLOBAL_REPORT_CC } from "../../../src/reports/send/addresses.js";

/** P1-127: a Reddoor person always receives what the client receives. */
const cells = (over: Partial<Parameters<typeof reportRecipients>[0]> = {}) => ({
  reportRecipientsTo: null,
  pointOfContact: "owner@client.example.com",
  reportRecipientsCc: null,
  reddoorContact: "tim@reddoorla.com",
  ...over,
});

describe("reportRecipients", () => {
  it("keeps the Reddoor contact in CC when Report recipients (To) override the point of contact", () => {
    const r = reportRecipients(
      cells({ reportRecipientsTo: "a@client.example.com, b@client.example.com" }),
    );
    expect(r.to).toEqual(["a@client.example.com", "b@client.example.com"]);
    expect(r.cc).toEqual(["tim@reddoorla.com", GLOBAL_REPORT_CC]);
  });

  it("CCs the Reddoor contact when To falls back to the point of contact", () => {
    const r = reportRecipients(cells());
    expect(r.to).toEqual(["owner@client.example.com"]);
    expect(r.cc).toEqual(["tim@reddoorla.com", GLOBAL_REPORT_CC]);
  });

  it("orders CC as per-site CC, then the Reddoor contact, then the ops inbox", () => {
    const r = reportRecipients(cells({ reportRecipientsCc: "partner@client.example.com" }));
    expect(r.cc).toEqual(["partner@client.example.com", "tim@reddoorla.com", GLOBAL_REPORT_CC]);
  });

  it("never repeats an address already in To or the per-site CC (case-insensitive)", () => {
    expect(reportRecipients(cells({ reportRecipientsTo: "Tim@ReddoorLA.com" })).cc).toEqual([
      GLOBAL_REPORT_CC,
    ]);
    expect(reportRecipients(cells({ reportRecipientsCc: "TIM@reddoorla.com" })).cc).toEqual([
      "tim@reddoorla.com",
      GLOBAL_REPORT_CC,
    ]);
  });

  it("takes several Reddoor contacts", () => {
    const r = reportRecipients(cells({ reddoorContact: "tim@reddoorla.com, erik@reddoorla.com" }));
    expect(r.cc).toEqual(["tim@reddoorla.com", "erik@reddoorla.com", GLOBAL_REPORT_CC]);
  });

  it("without a Reddoor contact, CC is what it was before P1-127", () => {
    const r = reportRecipients(
      cells({ reddoorContact: null, reportRecipientsCc: "x@client.example.com" }),
    );
    expect(r.cc).toEqual(["x@client.example.com", GLOBAL_REPORT_CC]);
  });
});

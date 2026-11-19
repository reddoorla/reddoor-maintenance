import { describe, it, expect } from "vitest";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView, sendDayLabel } from "../../src/lib/site/view.js";
import { renderPage } from "../_helpers/parity.js";
import { input, pending, reportRow } from "./fixtures.js";

/**
 * P1-117: a report drafted up to 7 days before its due date can be approved
 * early, and the send holds it until the 8:07am PT send on that date. The site
 * page says so: an early-approved report reads "approved, sends <date>", not as
 * pending or sent.
 */
const NOW = new Date("2026-11-18T19:00:00.000Z"); // Wed 11-18, 11am PT
const view = (reports: Parameters<typeof input>[0]["reports"], now = NOW) => {
  const i = input({ now, reports });
  return buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
};
const html = (reports: Parameters<typeof input>[0]["reports"], now = NOW) =>
  renderPage(Page, { data: { view: view(reports, now) } });
const early = () =>
  reportRow({
    id: "recEARLY",
    sentAt: null,
    deliveryStatus: "pending",
    resendMessageId: null,
    approvedAt: "2026-11-18T18:00:00.000Z",
    approvedBy: "dashboard",
    dueOn: "2026-11-21",
  });

describe("/s/:slug — P1-117 an early-approved report shows its send day", () => {
  it("labels a due date as the send that delivers it, in PST and in PDT", () => {
    expect(sendDayLabel("2026-11-21")).toBe("Sat 11-21, 8:07am PT");
    expect(sendDayLabel("2027-04-02")).toBe("Fri 04-02, 9:07am PT");
  });

  it("names no send day for an approved row that is not queued (it will never send)", () => {
    const row = view([{ ...early(), draftReady: false }]).history.find((h) => h.id === "recEARLY")!;
    expect(row.action).toMatchObject({ kind: "approved", sendsOn: null });
  });

  it("an approved report due Sat 11-21 reads 'approved, sends Sat 11-21, 8:07am PT'", () => {
    const row = view([early()]).history.find((h) => h.id === "recEARLY")!;
    expect(row.action).toMatchObject({ kind: "approved", sendsOn: "Sat 11-21, 8:07am PT" });
    // The history's date is the email's date: the due date.
    expect(row.date).toBe("2026-11-21");
    expect(html([early()])).toContain("approved, sends Sat 11-21, 8:07am PT");
  });

  it("on its due date it goes in the next send, so no hold line", () => {
    const due = new Date("2026-11-21T15:00:00.000Z"); // Sat 11-21, 7am PT
    const row = view([early()], due).history.find((h) => h.id === "recEARLY")!;
    expect(row.action).toMatchObject({ kind: "approved", sendsOn: null });
    expect(html([early()], due)).not.toContain("approved, sends");
  });

  it("the pending draft's send line says approving holds it until the due date", () => {
    const v = view([pending({ id: "recPEND", dueOn: "2026-11-21" })]);
    expect(v.pending[0]!.sendLine).toBe(
      "approve ≠ send: due Sat 11-21, 8:07am PT — approving now holds it until that day's send",
    );
  });

  it("a pending draft with no due date keeps today's countdown line", () => {
    const v = view([pending({ id: "recPEND" })]);
    expect(v.pending[0]!.sendLine).toMatch(/^approve ≠ send: goes out at the next send, 16:07 UTC/);
  });
});

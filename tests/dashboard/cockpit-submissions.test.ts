import { describe, it, expect } from "vitest";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

const baseUrl = "https://dash.example.com";
const now = new Date("2026-06-14T12:00:00Z");

describe("buildCockpitModel — submissions", () => {
  it("defaults to an empty submissions queue when none are passed", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme", status: "maintenance" });
    const model = buildCockpitModel([site], [], {}, baseUrl, now);
    expect(model.submissions).toEqual([]);
    expect(model.summary.newSubmissions).toBe(0);
  });

  it("builds entries, per-card counts, and the summary from NEW submissions", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme Co", status: "maintenance" });
    const subs = [
      makeSubmissionRow({ id: "s1", siteId: "recSITE", formType: "contact" }),
      makeSubmissionRow({ id: "s2", siteId: "recSITE", formType: "rsvp" }),
    ];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.summary.newSubmissions).toBe(2);
    expect(model.submissions?.map((s) => s.submissionId)).toEqual(["s1", "s2"]);
    expect(model.submissions?.[0]?.slug).toBe("acme-co");
    expect(model.cards[0]?.newSubmissions).toBe(2);
  });

  it("skips an orphan submission whose site is unknown", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme", status: "maintenance" });
    const subs = [makeSubmissionRow({ id: "s1", siteId: "recGONE" })];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.submissions).toEqual([]);
    expect(model.summary.newSubmissions).toBe(0);
  });

  it("surfaces a submission for a hidden site in the strip (resolves against ALL sites)", () => {
    const hidden = makeWebsiteRow({ id: "recHID", name: "Hidden", status: "hosting" });
    const subs = [makeSubmissionRow({ id: "s1", siteId: "recHID" })];
    const model = buildCockpitModel([hidden], [], {}, baseUrl, now, subs);
    expect(model.submissions?.length).toBe(1);
  });

  it("splits new submissions into leads vs newsletter/rsvp signups (card + summary)", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme Co", status: "maintenance" });
    const subs = [
      makeSubmissionRow({ id: "s1", siteId: "recSITE", formType: "contact" }),
      makeSubmissionRow({ id: "s2", siteId: "recSITE", formType: "contact" }),
      makeSubmissionRow({ id: "s3", siteId: "recSITE", formType: "newsletter" }),
      makeSubmissionRow({ id: "s4", siteId: "recSITE", formType: "rsvp" }),
    ];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.cards[0]?.newSubmissions).toBe(4);
    expect(model.cards[0]?.newLeads).toBe(2);
    expect(model.cards[0]?.newSignups).toBe(2);
    expect(model.summary.newSubmissions).toBe(4);
    expect(model.summary.newLeads).toBe(2);
    expect(model.summary.newSignups).toBe(2);
  });

  it("counts inquiry/reserve as leads (lead-ness by exclusion)", () => {
    const site = makeWebsiteRow({ id: "recSITE", name: "Acme Co", status: "maintenance" });
    const subs = [
      makeSubmissionRow({ id: "s1", siteId: "recSITE", formType: "inquiry" }),
      makeSubmissionRow({ id: "s2", siteId: "recSITE", formType: "reserve" }),
    ];
    const model = buildCockpitModel([site], [], {}, baseUrl, now, subs);
    expect(model.cards[0]?.newLeads).toBe(2);
    expect(model.cards[0]?.newSignups).toBe(0);
  });
});

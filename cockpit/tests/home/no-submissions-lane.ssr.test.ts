import { describe, it, expect } from "vitest";
import Page from "../../src/routes/triage/+page.svelte";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { buildCockpitModel, type CockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import { renderPage } from "../_helpers/parity.js";
import { withoutComments } from "../legacy/render.js";
import { siteRow, NOW, BASE } from "./fixtures.js";

/**
 * #2241: submissions have their own page (/submissions), so /triage carries no
 * submissions lane (the operator, 2026-11-23: "remove the submissions bit from
 * triage, it has its own page now"). A model full of submissions renders the
 * same /triage as one with none, and the verdict and the Needs-you count never
 * read them.
 */

const sub = (n: number) =>
  ({
    id: `s${n}`,
    siteId: "recSITE",
    formType: n % 3 === 0 ? "newsletter" : "contact",
    name: `Person ${n}`,
    email: `p${n}@example.com`,
    submittedAt: `2026-06-${String(10 + (n % 10)).padStart(2, "0")}T12:00:00Z`,
  }) as never;

/** One site needing attention, so the verdict and the feed are not empty. */
function model(withSubmissions: boolean): CockpitModel {
  const site = siteRow({ id: "recSITE", name: "Acme Co", securityVulnsCritical: 2 });
  const subs = withSubmissions ? Array.from({ length: 13 }, (_, i) => sub(i + 1)) : [];
  // The fleet spam totals and the auto-filtered count left the model with the
  // lane (the follow-up to #2248), so submissions are all that is left to vary.
  return buildCockpitModel([site], [], {}, BASE, NOW, subs);
}

const html = (m: CockpitModel) =>
  withoutComments(renderPage(Page, { data: { view: buildCockpitView(m, NOW) } }));

describe("/triage carries no submissions lane (#2241)", () => {
  it("renders no submission row, lane, spam roll-up or auto-filtered line", () => {
    const m = model(true);
    // Positive control: the model really carries what the old lane showed.
    expect(m.submissions?.length).toBe(13);
    const out = html(m);
    expect(out).not.toContain('data-signal="submissions"');
    expect(out).not.toContain('class="inbox"');
    expect(out).not.toContain("Submissions (");
    expect(out).not.toContain("Spam (30d)");
    expect(out).not.toContain("auto-filtered this week");
    expect(out).not.toContain('href="/submissions?status=spam_auto"');
    expect(out).not.toContain("View all submissions");
    // The page itself still renders: the verdict and the feed are there.
    expect(out).toContain('class="verdict');
    expect(out).toContain('class="needs-you');
  });

  it("gives the same verdict and Needs-you count with or without submissions", () => {
    const withSubs = buildCockpitView(model(true), NOW);
    const without = buildCockpitView(model(false), NOW);
    expect(withSubs.feedCount).toBeGreaterThan(0);
    expect(withSubs.verdict).toEqual(without.verdict);
    expect(withSubs.feedCount).toBe(without.feedCount);
    expect(withSubs.feed).toEqual(without.feed);
    expect(withSubs).not.toHaveProperty("inbox");
  });

  it("renders the same page body with or without submissions", () => {
    expect(html(model(true))).toBe(html(model(false)));
  });
});

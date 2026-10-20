import { describe, it, expect } from "vitest";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { renderSiteDashboardHtml } from "../../../src/dashboard/render.js";
import { buildSiteView } from "../../src/lib/site/view.js";
import { canonical, bodyOf, renderPage } from "../_helpers/parity.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { CASES, input, pending, type SiteInput } from "./fixtures.js";

/**
 * /s/:slug, ported (#582): the page renders what renderSiteDashboardHtml did,
 * line for line in canonical form. Dropped on purpose, because the shell now
 * provides them: the old page's own auth fragment and its "← Fleet home" link.
 */
const OLD_ONLY = ["a.home", 'div[style^="float:right"]'];

/** The old page with its one intended difference: the site-details controls
 *  and the commentary textareas are server-rendered disabled until their save
 *  handlers attach (review round 2), so an edit before hydration is never lost
 *  without a ✓/✗. A `data-detail-field` or `data-commentary-for` attribute
 *  marks exactly those controls. */
const withDisabledEditors = (html: string) =>
  html.replace(/ (data-detail-field|data-commentary-for)="/g, ' disabled $1="');

function both(i: SiteInput) {
  const before = canonical(
    withDisabledEditors(
      bodyOf(
        renderSiteDashboardHtml(
          i.site,
          i.reports,
          i.submissions,
          i.spam,
          i.now,
          i.alarm,
          "op@x.com",
        ),
      ),
    ),
    OLD_ONLY,
  );
  const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
  const after = canonical(renderPage(Page, { data: { view } }));
  return { before, after };
}

describe("/s/:slug parity with renderSiteDashboardHtml", () => {
  for (const [name, i] of CASES) {
    it(name, () => {
      const { before, after } = both(i);
      expect(after).toEqual(before);
    });
  }

  // The send-timing line's windows: well before the run, inside the hour, under
  // a minute, mid-flight after 16:07, and after the grace window.
  for (const iso of [
    "2026-06-15T10:00:00.000Z",
    "2026-06-15T15:30:00.000Z",
    "2026-06-15T16:06:30.000Z",
    "2026-06-15T16:30:00.000Z",
    "2026-06-15T17:20:00.000Z",
  ]) {
    it(`send-timing line at ${iso}`, () => {
      const { before, after } = both(input({ now: new Date(iso), reports: [pending()] }));
      expect(after).toEqual(before);
    });
  }

  it("submission rows: provenance, reasons, bounces, fan-out, every detail", () => {
    const rows = [
      makeSubmissionRow({
        id: "a",
        status: "spam_auto",
        spamScore: 7,
        spamReason: "a, b, c, d, e",
        message: "line1\nline2",
        phone: "555",
        utm: "src=x",
        sourceUrl: "https://src.example/p?q=1",
        extraFields: '{"k":"v","n":2}',
      }),
      makeSubmissionRow({
        id: "b",
        notifyStatus: "bounced",
        bounceType: "Permanent",
        bounceSubType: "General",
        bounceMessage: "550 no such user",
        fanoutStatus: "webhook:ok,mailchimp:error",
      }),
      makeSubmissionRow({
        id: "c",
        notifyStatus: "bounced",
        bounceType: "Transient",
        bounceSubType: "ContentRejected",
        bounceAckAt: "2026-06-14T00:00:00.000Z",
        extraFields: "not json",
        sourceUrl: "javascript:x",
      }),
      makeSubmissionRow({
        id: "d",
        notifyStatus: "bounced",
        name: "",
        email: "",
        submittedAt: null,
        extraFields: "[1,2]",
        spamScore: 2,
      }),
      makeSubmissionRow({
        id: "e",
        status: "spam",
        spamReason: "manual",
        resendMessageId: "re_1",
        submissionId: null,
      }),
    ];
    const { before, after } = both(input({ submissions: rows }));
    expect(after).toEqual(before);
  });

  it("the instrument sees a one-character difference", () => {
    const i = input({ reports: [pending()] });
    const before = canonical(
      withDisabledEditors(
        bodyOf(renderSiteDashboardHtml(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm)),
      ),
      OLD_ONLY,
    );
    const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
    const after = canonical(
      renderPage(Page, { data: { view } }).replace("Don't send", "Dont send"),
    );
    expect(after).not.toEqual(before);
  });
});

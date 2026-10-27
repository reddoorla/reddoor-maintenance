import { describe, it, expect } from "vitest";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView } from "../../src/lib/site/view.js";
import { renderPage } from "../_helpers/parity.js";
import { input, reportRow, pending, type SiteInput } from "./fixtures.js";

/**
 * `/s/:slug` shows who approved each approved report (#672 step 4): the
 * signed-in operator's email the approve endpoint stamped into `approved_by`.
 */

const html = (i: SiteInput) =>
  renderPage(Page, {
    data: { view: buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm) },
  });

const approver = (out: string): string[] =>
  [...out.matchAll(/<span class="muted approved-by">approved by ([^<]*)<\/span>/g)].map(
    (m) => m[1]!,
  );

describe("/s/:slug — who approved", () => {
  it("names the approver of a report still waiting for its send", () => {
    const out = html(
      input({
        reports: [
          reportRow({ sentAt: null, deliveryStatus: "pending", approvedBy: "op@example.com" }),
        ],
      }),
    );
    expect(approver(out)).toEqual(["op@example.com"]);
  });

  it("names the approver of a sent report", () => {
    expect(
      approver(html(input({ reports: [reportRow({ approvedBy: "op@example.com" })] }))),
    ).toEqual(["op@example.com"]);
  });

  it("names no one for a pending report, or an approval with no approver on record", () => {
    expect(approver(html(input({ reports: [pending({ approvedBy: "op@example.com" })] })))).toEqual(
      [],
    );
    expect(approver(html(input({ reports: [reportRow({ approvedBy: null })] })))).toEqual([]);
  });

  it("escapes the stored value like any other text", () => {
    const out = html(input({ reports: [reportRow({ approvedBy: "<b>x</b>" })] }));
    expect(out).toContain("approved by &lt;b>x&lt;/b>");
  });
});

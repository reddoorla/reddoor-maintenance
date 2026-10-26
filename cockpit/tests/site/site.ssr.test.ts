import { describe, it, expect, vi, afterEach } from "vitest";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView } from "../../src/lib/site/view.js";
import { canonical, renderPage } from "../_helpers/parity.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { CASES, input, pending, siteRow, type SiteInput } from "./fixtures.js";

/**
 * /s/:slug, ported (#582): the page renders what renderSiteDashboardHtml did,
 * line for line in canonical form. Dropped on purpose, because the shell now
 * provides them: the old page's own auth fragment and its "← Fleet home" link.
 */
/**
 * Since the cutover (#582) the old renderer is gone. Each case's markup is
 * pinned by a snapshot written while parity with the old renderer held (commit
 * "freeze each page's canonical markup as a snapshot, verified by parity"), so
 * each snapshot is what the old page rendered. Keep these test names: the
 * snapshots are keyed on them.
 */
function rendered(i: SiteInput): string[] {
  const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);
  return canonical(renderPage(Page, { data: { view } }));
}

// The send-timing line's windows: well before the run, inside the hour, under
// a minute, mid-flight after 16:07, and after the grace window.
const SEND_TIMING_NOWS = [
  "2026-06-15T10:00:00.000Z",
  "2026-06-15T15:30:00.000Z",
  "2026-06-15T16:06:30.000Z",
  "2026-06-15T16:30:00.000Z",
  "2026-06-15T17:20:00.000Z",
];
const sendTimingInput = (iso: string): SiteInput =>
  input({ now: new Date(iso), reports: [pending()] });

const SUBMISSION_ROWS = "submission rows: provenance, reasons, bounces, fan-out, every detail";
function submissionRowsInput(): SiteInput {
  return input({
    submissions: [
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
    ],
  });
}

describe("/s/:slug parity with renderSiteDashboardHtml", () => {
  for (const [name, i] of CASES) {
    it(name, () => {
      expect(rendered(i)).toMatchSnapshot();
    });
  }

  for (const iso of SEND_TIMING_NOWS) {
    it(`send-timing line at ${iso}`, () => {
      expect(rendered(sendTimingInput(iso))).toMatchSnapshot();
    });
  }

  it(SUBMISSION_ROWS, () => {
    expect(rendered(submissionRowsInput())).toMatchSnapshot();
  });
});

/**
 * Every relative time on the page reads the view's `now`, never the wall clock.
 * Three did, so the snapshots drifted as real days passed ("3mo ago" became
 * "4mo ago" on 2026-10-21 and failed CI with no code change).
 */
describe("/s/:slug reads only the injected clock", () => {
  afterEach(() => vi.useRealTimers());
  const all: Array<[string, SiteInput]> = [
    ...CASES,
    ...SEND_TIMING_NOWS.map((iso): [string, SiteInput] => [
      `send-timing line at ${iso}`,
      sendTimingInput(iso),
    ]),
    [SUBMISSION_ROWS, submissionRowsInput()],
  ];
  for (const [name, i] of all) {
    it(`${name}: the same markup with the wall clock in 2031`, () => {
      const today = rendered(i);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));
      expect(rendered(i)).toEqual(today);
    });
  }
});

/**
 * The fixtures themselves read no clock and postdate nothing (#1601, #1603): a
 * wall-clock timestamp in a fixture rots the snapshot it reaches, and a row
 * dated after the view's `now` floors to "just now", so it pins no real age.
 */
describe("/s/:slug fixtures", () => {
  afterEach(() => vi.useRealTimers());

  it("build the same site row whatever the wall clock says", () => {
    const today = siteRow();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));
    expect(siteRow()).toEqual(today);
  });

  it("date every timestamp before the view's now", () => {
    for (const [name, i] of CASES) {
      const stamps = [
        i.site.searchConsoleCheckedAt,
        ...i.submissions.map((s) => s.submittedAt),
      ].filter((t): t is string => t != null);
      for (const t of stamps) {
        expect(Date.parse(t), `${name}: ${t}`).toBeLessThan(i.now.getTime());
      }
    }
  });
});

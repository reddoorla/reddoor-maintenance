import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildSubmissionsPageData } from "../../src/routes/submissions/data.js";
import Page from "../../src/routes/submissions/+page.svelte";
import { renderSubmissionsPageHtml } from "../../../src/dashboard/submissions-page-render.js";
import type { SubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";
import { canonical, bodyOf, renderPage } from "../_helpers/parity.js";
import { model } from "./fixtures.js";

/**
 * /submissions, ported (#582): the page renders what renderSubmissionsPageHtml
 * did. Dropped from the old page: its own "← Fleet home" link and auth
 * fragment (the shell renders the nav and the fragment). The bulk form's inline
 * `onsubmit="return confirm(…)"` attribute is now a Svelte handler; the DOM
 * tests cover its confirm.
 */

const OLD_ONLY = ["a.home", 'div[style^="float:right"]'];

/** The old page, with its two intended differences applied: the inline
 *  `onsubmit` confirm became a Svelte handler (the DOM tests cover it), and the
 *  bulk button is server-rendered disabled until that handler is attached, so
 *  it can never post unconfirmed (review round 1). */
function oldBody(m: SubmissionsPageModel): string {
  return bodyOf(renderSubmissionsPageHtml(m, "op@example.com"))
    .replace(/ onsubmit="[^"]*"/g, "")
    .replace('<button type="submit">Mark all', '<button type="submit" disabled>Mark all');
}

const CASES: Array<[string, Partial<SubmissionsPageModel>]> = [
  ["every row shape, first page", {}],
  [
    "active filters reflected in the form",
    {
      filter: {
        site: "site-b",
        type: "newsletter",
        status: "new",
        q: `a "q" & <b>`,
        from: "2026-01-01",
        to: "2026-02-01",
        reason: "",
      },
    },
  ],
  ["middle page of three", { page: 2, total: 120 }],
  ["last page of three", { page: 3, total: 120 }],
  ["paged past the last page", { rows: [], page: 5, total: 120 }],
  ["paged past the only page", { rows: [], page: 2, total: 1 }],
  ["no submissions", { rows: [], total: 0 }],
  ["one submission", { total: 1, rows: [], page: 1 }],
  [
    "mark-read shown for many",
    {
      markableNewCount: 17,
      filter: { site: "site-a", type: "", status: "", q: "x&y", from: "", to: "", reason: "" },
    },
  ],
  ["mark-read shown for one", { markableNewCount: 1 }],
  [
    "spam_auto facets",
    {
      filter: { site: "", type: "", status: "spam_auto", q: "", from: "", to: "", reason: "" },
      facetReasons: [
        "keywords:4, link-heavy",
        "keywords:2",
        "turnstile-required-absent",
        " , ",
        "a<b>",
      ],
    },
  ],
  [
    "spam facets with an active reason",
    {
      filter: {
        site: "site-a",
        type: "",
        status: "spam",
        q: "",
        from: "",
        to: "",
        reason: "keywords",
      },
      facetReasons: ["keywords:4, link-heavy", "keywords"],
    },
  ],
  [
    "spam view with no reasons",
    {
      filter: { site: "", type: "", status: "spam", q: "", from: "", to: "", reason: "" },
      facetReasons: [],
    },
  ],
  ["facets ignored off the spam views", { facetReasons: ["keywords"] }],
];

describe("/submissions parity with renderSubmissionsPageHtml", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  });
  afterAll(() => vi.useRealTimers());

  for (const [name, over] of CASES) {
    it(name, () => {
      const m = model(over);
      expect(canonical(renderPage(Page, { data: buildSubmissionsPageData(m) }))).toEqual(
        canonical(oldBody(m), OLD_ONLY),
      );
    });
  }

  it("the instrument sees a missing space between two inline elements", () => {
    const m = model();
    const after = canonical(
      renderPage(Page, { data: buildSubmissionsPageData(m) }).replace(
        "</strong> · ",
        "</strong>· ",
      ),
    );
    expect(after).not.toEqual(canonical(oldBody(m), OLD_ONLY));
  });
});

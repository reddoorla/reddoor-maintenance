import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildSubmissionsPageData } from "../../src/routes/submissions/data.js";
import Page from "../../src/routes/submissions/+page.svelte";
import type { SubmissionsPageModel } from "../../../src/dashboard/submissions-page.js";
import { canonical, renderPage } from "../_helpers/parity.js";
import { model } from "./fixtures.js";

/**
 * Since the cutover (#582) the old renderer is gone. Each case's markup is
 * pinned by a snapshot written while parity with the old renderer held (commit
 * "freeze each page's canonical markup as a snapshot, verified by parity"), so
 * each snapshot is what the old page rendered. Keep these test names: the
 * snapshots are keyed on them.
 */
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
      const after = canonical(renderPage(Page, { data: buildSubmissionsPageData(m) }));
      expect(after).toMatchSnapshot();
    });
  }
});

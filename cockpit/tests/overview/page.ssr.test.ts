import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { parse, TextNode, type HTMLElement, type Node } from "node-html-parser";
import Layout from "../../src/routes/+layout.svelte";
import OverviewPage from "../../src/routes/+page.svelte";
import TriagePage from "../../src/routes/triage/+page.svelte";
import {
  overviewFromSnapshot,
  HOW_WE_COUNT,
  type OverviewView,
} from "../../src/lib/overview/view.js";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { cockpitModelFromSnapshot } from "../../../src/dashboard/snapshot-views.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { withoutComments } from "../legacy/render.js";
import { NOW, FRESH, healthy, night, report, snapshot } from "./fixtures.js";

/**
 * P1-78g review round 1 (T1, T2, T6, T7): the overview page itself, rendered inside
 * the real layout from a real view (`overviewFromSnapshot` over fixture rows), as
 * a visitor receives it. The model's tests pin the numbers; these pin that the
 * page shows them, and shows nothing it did not get from the model.
 */

/** A Broken site, a healthy one, and an RSVP site holding most of the leads. */
const SNAP = snapshot({
  sites: [
    healthy({
      id: "recA",
      name: "Acme",
      pScore: 90,
      rScore: 95,
      bpScore: 85,
      seoScore: 99,
      lastLighthouseAuditAt: FRESH,
    }),
    healthy({ id: "recB", name: "Bravo", reachableOk: "fail" }),
    healthy({ id: "recR", name: "Rsvp Site" }),
  ],
  digest: { "uptime:recB": { metric: 1, firstFlaggedAt: "2026-10-25" } },
  submissions: [
    ...Array.from({ length: 9 }, (_, i) =>
      makeSubmissionRow({
        id: `r${i}`,
        siteId: "recR",
        formType: "rsvp",
        status: "read",
        notifyStatus: "sent",
        submittedAt: "2026-10-10T12:00:00.000Z",
      }),
    ),
    makeSubmissionRow({ id: "a1", siteId: "recA", status: "new", submittedAt: FRESH }),
    ...["s1", "s2", "s3"].map((id) =>
      makeSubmissionRow({
        id,
        siteId: "recA",
        status: "spam_auto",
        submittedAt: "2026-07-02T12:00:00.000Z",
      }),
    ),
  ],
  reports: [report({ id: "sent1" })],
  nights: [night("2026-10-26")],
});

function pageHtml(view: OverviewView, email: string | null = null): string {
  const inner = render(OverviewPage, { props: { data: { view } } });
  const children = createRawSnippet(() => ({ render: () => inner.body }));
  const outer = render(Layout, { props: { data: { email, path: "/" }, children } });
  return withoutComments(`<!doctype html><html><head>${outer.head}${inner.head}</head>
<body><div style="display: contents">${outer.body}</div></body></html>`);
}

const VIEW = overviewFromSnapshot(SNAP, NOW);
const HTML = pageHtml(VIEW);
const DOC = parse(HTML);
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, " ").trim();
/** Everything below the shell's header: the page a visitor reads. */
const pageText = (doc: HTMLElement) =>
  doc
    .querySelectorAll("h1, section, details")
    .map((e) => text(e))
    .join(" ");

describe("the overview page, rendered from a real view (T1)", () => {
  it("has the seven sections, each under its h2", () => {
    expect(DOC.querySelectorAll("h2").map(text)).toEqual([
      "Status",
      "Is every site live?",
      "Leads",
      "Client reports",
      "What runs every night",
      "Upkeep",
      "How changes ship",
    ]);
  });

  it("names the Broken site in section 1, with its age", () => {
    const li = DOC.querySelectorAll(".ov-status .ov-list.broken li").map(text);
    expect(li).toEqual(["Bravo: a page on the site did not answer at the last check, for 2 days"]);
    // Each count links to its own group on the Triage page, and looks like a link.
    const links = DOC.querySelectorAll(".ov-line a").map((a) => [text(a), a.getAttribute("href")]);
    expect(links).toContainEqual(["1 site broken.", "/triage#broken"]);
  });

  it("keeps the RSVP site in the per-site leads rows", () => {
    const rows = DOC.querySelectorAll(".ov-leads-sites tbody tr").map((tr) =>
      tr.querySelectorAll("th, td").map(text),
    );
    expect(rows).toEqual([
      ["Rsvp Site", "9", "9", "9", "0", "0"],
      ["Acme", "4", "1", "0", "3", "0"],
    ]);
    // ...and the headline names it with its share, beside the total.
    expect(pageText(DOC)).toContain(
      "13 submissions since Jul 2, 2026. 10 were accepted as real, and the client was notified of 9. Of the 13 submissions, 9 (69%) came from one site, Rsvp Site, through an RSVP form; 9 of the 10 accepted are from it.",
    );
  });

  it("never shows the two spam counters added together", () => {
    // 248 stopped before storage (the night) and 3 screened: no element reads 251.
    const stopped = DOC.querySelectorAll(".ov-leads-totals tr").find((tr) =>
      text(tr).startsWith("Stopped before storage"),
    )!;
    expect(stopped.querySelectorAll("td").map(text)).toEqual(["0", "248, as of Oct 26"]);
    const sum = String(Number(VIEW.leads.stoppedAllTime) + VIEW.leads.allTime!.screened);
    expect(sum).toBe("251");
    expect(DOC.querySelectorAll("*").filter((e) => text(e) === sum)).toEqual([]);
    expect(pageText(DOC)).not.toMatch(new RegExp(`\\b${sum}\\b`));
  });

  it("says how many checks a report carries from the model, not a typed word", () => {
    expect(pageText(DOC)).toContain(
      `Every maintenance report carries ${VIEW.reports.checks.length} checks.`,
    );
    const fewer = pageHtml({
      ...VIEW,
      reports: { ...VIEW.reports, checks: VIEW.reports.checks.slice(0, 5) },
    });
    expect(pageText(parse(fewer))).toContain("Every maintenance report carries 5 checks.");
  });

  it("shows the Live cell's check time", () => {
    const acme = DOC.querySelectorAll(".ov-live tbody tr").find((tr) =>
      text(tr).startsWith("Acme"),
    )!;
    expect(text(acme.querySelector('td[data-label="Live"]')!)).toBe(
      "Live, checked Oct 26, 11:30pm PT",
    );
  });
});

/** The digit runs a visitor reads below the shell, one text node at a time, so two
 *  neighbouring cells ("10", "10") never read as one number ("1010"). */
function shownNumbers(doc: HTMLElement): string[] {
  const runs: string[] = [];
  const walk = (n: Node) => {
    if (n instanceof TextNode) runs.push(n.text);
    else for (const c of n.childNodes) walk(c);
  };
  for (const el of doc.querySelectorAll("h1, section, details")) walk(el);
  return runs.join(" | ").match(/\d+/g) ?? [];
}

/** Every digit run the model handed the page, plus the one count the page derives
 *  itself (how many checks: `v.reports.checks.length`). */
const ALLOWED = new Set([
  ...(JSON.stringify({ VIEW, HOW_WE_COUNT }).match(/\d+/g) ?? []),
  String(VIEW.reports.checks.length),
]);

describe("no count is typed into the page (T2)", () => {
  it("every number the page shows came from the view or the How-we-count copy", () => {
    const shown = shownNumbers(DOC);
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.filter((d) => !ALLOWED.has(d))).toEqual([]);
  });

  it("is an instrument that can fail: a typed count is caught", () => {
    // Control: the same check over the page with one count typed in.
    const typed = HTML.replace("13 submissions", "705 submissions");
    expect(shownNumbers(parse(typed)).filter((d) => !ALLOWED.has(d))).toEqual(["705"]);
  });
});

describe("How we count (T6)", () => {
  it("has one line for every label the page marks as a count, and no other", () => {
    // From the rendered labels, not a typed list: each number's label carries data-term.
    const marked = [
      ...new Set(DOC.querySelectorAll("[data-term]").map((e) => e.getAttribute("data-term")!)),
    ];
    const terms = DOC.querySelectorAll(".ov-how dt").map(text);
    expect(marked.length).toBeGreaterThan(20);
    expect([...marked].sort()).toEqual([...terms].sort());
    expect(terms).toEqual(HOW_WE_COUNT.map((h) => h.term));
  });

  it("covers the counts of a page with no Broken site and no biggest share too", () => {
    const quiet = parse(pageHtml(overviewFromSnapshot(snapshot(), NOW)));
    const terms = new Set(quiet.querySelectorAll(".ov-how dt").map(text));
    for (const e of quiet.querySelectorAll("[data-term]"))
      expect(terms).toContain(e.getAttribute("data-term"));
  });
});

describe("everyone signed in sees the same page (T7)", () => {
  it("the operator, Erik and Tim get the same overview; only the header names them", () => {
    const below = (html: string) => html.slice(html.indexOf("</header>"));
    const op = pageHtml(VIEW, "op@reddoor.example");
    const erik = pageHtml(VIEW, "erik@reddoor.example");
    const tim = pageHtml(VIEW, "tim@reddoor.example");
    expect(below(erik)).toBe(below(op));
    expect(below(tim)).toBe(below(op));
    // Control: the header does differ, so the slice is not comparing nothing.
    expect(op).not.toBe(erik);
    expect(below(op)).toContain("Is every site live?");
  });
});

describe("the triage page carries the anchors the overview links to (O3)", () => {
  it("each feed group and the fleet-wide lane has the id its count links to", () => {
    const model = cockpitModelFromSnapshot(SNAP, NOW);
    const html = render(TriagePage, {
      props: { data: { view: buildCockpitView(model, NOW) } },
    }).body;
    const ids = parse(html)
      .querySelectorAll("[id]")
      .map((e) => e.getAttribute("id"));
    expect(ids).toContain("broken");
    // The overview's every link into /triage names one of the groups' ids.
    const groups = new Set(["broken", "attention", "watch", "approval", "cardless"]);
    for (const a of DOC.querySelectorAll('a[href^="/triage#"]'))
      expect(groups).toContain(a.getAttribute("href")!.slice("/triage#".length));
    const src = readFileSync(
      new URL("../../src/routes/triage/+page.svelte", import.meta.url),
      "utf8",
    );
    expect(src).toContain("id={g.group}");
    expect(src).toContain('<summary id="cardless">');
  });
});

describe("the overview's stylesheet (T5)", () => {
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  /** A colour written as a value: hex, a colour function, or a named colour. */
  const LITERAL =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|:\s*(?:[^;]*\s)?(?:red|green|blue|orange|yellow|purple|pink|gray|grey|black|white|darkred|crimson|tomato)\b/i;

  it("has no colour literal: every colour is a token", () => {
    expect(css.split("\n").filter((l) => LITERAL.test(l))).toEqual([]);
    // Control: the same check catches one.
    expect(LITERAL.test(".x { color: #d71920; }")).toBe(true);
    expect(LITERAL.test(".x { border-left-color: darkred; }")).toBe(true);
  });

  it("paints red only on a .broken selector", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const red = rules.filter(([, , body]) => /var\(--(broken|broken-fill)\)/.test(body!));
    expect(red.length).toBeGreaterThan(0);
    for (const [, sel] of red) expect(sel).toMatch(/\.broken\b/);
  });
});

/**
 * Review round 2 (T1, T2): the sentinel render. Every number the view hands the page
 * (a number, or a count carried as text, "248") becomes its own distinct sentinel,
 * and each is asserted in its labelled cell. A count typed into the page, even one
 * that matches a fixture value, and a binding to the wrong field (all time in the
 * This-month column) both fail here: the digit check above cannot see either.
 */
function sentinelize(view: OverviewView): { view: OverviewView; at: Map<string, string> } {
  const at = new Map<string, string>();
  let next = 70001;
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "number") {
      const n = next++;
      at.set(path, String(n));
      return n;
    }
    if (typeof v === "string" && /^\d+$/.test(v)) {
      const n = String(next++);
      at.set(path, n);
      return n;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, path ? `${path}.${k}` : k)]),
      );
    return v;
  };
  return { view: walk(view, "") as OverviewView, at };
}

const S = sentinelize(VIEW);
const SV = S.view;
const SDOC = parse(pageHtml(SV));
const sent = (path: string): string => {
  const v = S.at.get(path);
  if (v === undefined) throw new Error(`no sentinel at ${path}`);
  return v;
};

describe("the sentinel render: each number in its labelled cell (T1, T2)", () => {
  it("gives every number in the view its own sentinel", () => {
    // Enough to mean something, and none repeated.
    expect(S.at.size).toBeGreaterThan(40);
    expect(new Set(S.at.values()).size).toBe(S.at.size);
  });

  it("shows every sentinel the page renders, so no count is typed in its place", () => {
    const shown = new Set(shownNumbers(SDOC));
    // Numbers the view carries that the page does not show: the status counts reach
    // it only inside the status line's text, this month's submissions and the test
    // sends are worked out but not shown.
    const unrendered = (p: string) =>
      p.startsWith("status.counts.") ||
      p === "leads.thisMonth.submissions" ||
      p === "reports.sent.testSends";
    for (const [path, v] of S.at) {
      if (unrendered(path)) continue;
      expect.soft(shown.has(v), `${path} (${v}) is on the page`).toBe(true);
    }
  });

  it("the leads headline reads each count from its own field", () => {
    const span = (term: string) =>
      text(
        SDOC.querySelector(`section[aria-labelledby="ov-leads"] > p span[data-term="${term}"]`)!,
      );
    expect(span("Submissions")).toMatch(
      new RegExp(`^${sent("leads.allTime.submissions")} submissions`),
    );
    expect(span("Accepted as real")).toBe(
      `${sent("leads.allTime.accepted")} were accepted as real,`,
    );
    expect(span("Client notified")).toBe(
      `and the client was notified of ${sent("leads.allTime.notified")}.`,
    );
    expect(span("Biggest share")).toBe(
      `Of the ${sent("leads.allTime.submissions")} submissions, ${sent("leads.biggest.submissions")} (${sent("leads.biggest.share")}%) came from one site, Rsvp Site, through an RSVP form; ${sent("leads.biggest.accepted")} of the ${sent("leads.allTime.accepted")} accepted are from it. Every site's own count is in the table below.`,
    );
  });

  it("the totals table puts this month and all time each in its own column", () => {
    const row = (term: string) => {
      const tr = SDOC.querySelector(`.ov-leads-totals tr[data-term="${term}"]`)!;
      return [
        text(tr.querySelector('td[data-label="This month"]')!),
        text(tr.querySelector('td[data-label="All time"]')!),
      ];
    };
    const fields = [
      ["Accepted as real", "accepted"],
      ["Client notified", "notified"],
      ["Screened as spam", "screened"],
      ["Marked spam by hand", "byHand"],
    ] as const;
    for (const [term, f] of fields)
      expect(row(term), term).toEqual([sent(`leads.thisMonth.${f}`), sent(`leads.allTime.${f}`)]);
    expect(row("Stopped before storage")).toEqual([
      sent("leads.stoppedThisMonth"),
      `${sent("leads.stoppedAllTime")}, as of Oct 26`,
    ]);
  });

  it("the per-site leads rows read each column from its own field", () => {
    const rows = SDOC.querySelectorAll(".ov-leads-sites tbody tr");
    expect(rows.length).toBe(SV.leads.perSite.length);
    rows.forEach((tr, i) => {
      const cell = (label: string) => text(tr.querySelector(`td[data-label="${label}"]`)!);
      expect(cell("Submissions")).toBe(sent(`leads.perSite[${i}].submissions`));
      expect(cell("Accepted")).toBe(sent(`leads.perSite[${i}].accepted`));
      expect(cell("Notified")).toBe(sent(`leads.perSite[${i}].notified`));
      expect(cell("Screened")).toBe(sent(`leads.perSite[${i}].screened`));
      expect(cell("By hand")).toBe(sent(`leads.perSite[${i}].byHand`));
    });
  });

  it("the reports sentence, the medians and the per-site waiting read their own fields", () => {
    expect(text(SDOC.querySelector('p[data-term="Reports sent"]')!)).toBe(
      `${sent("reports.sent.real")} reports sent to clients: ${sent("reports.sent.approvedFirst")} approved by one of us before sending, and ${sent("reports.sent.aroundGate")} without that yes.`,
    );
    const lh = text(SDOC.querySelector('p[data-term="Lighthouse"]')!);
    SV.reports.lighthouse.forEach((l, i) =>
      expect(lh).toContain(`${l.label} ${sent(`reports.lighthouse[${i}].median`)}`),
    );
    const waiting = SDOC.querySelectorAll('.ov-due td[data-label="Waiting"]').map(text);
    expect(waiting).toEqual(
      SV.reports.perSite.map((_, i) => sent(`reports.perSite[${i}].waiting`)),
    );
  });
});

describe("every number on the page sits under a How-we-count label (T6)", () => {
  /** Each text node holding a digit, below the shell (the How-we-count list itself
   *  is the explanation, not a count), with the nearest `data-term` above it. */
  function unlabelled(doc: HTMLElement): string[] {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n instanceof TextNode) {
        if (/\d/.test(n.text) && (n.parentNode as HTMLElement).closest("[data-term]") === null)
          out.push(n.text.trim());
      } else for (const c of n.childNodes) walk(c);
    };
    for (const el of doc.querySelectorAll("h1, section, .ov-how > p")) walk(el);
    return out;
  }

  it("holds on the full fixture and the sentinel render", () => {
    expect(shownNumbers(DOC).length).toBeGreaterThan(20);
    expect(unlabelled(DOC)).toEqual([]);
    expect(unlabelled(SDOC)).toEqual([]);
  });

  it("is an instrument that can fail: a number with no label is caught", () => {
    const bare = HTML.replace(
      "<h1>Overview</h1>",
      "<h1>Overview</h1><section><p>42 things</p></section>",
    );
    expect(unlabelled(parse(bare))).toEqual(["42 things"]);
  });
});

describe("every link from the overview lands on an anchor that exists (review round 2, C4)", () => {
  const draft = (id: string, siteId: string) =>
    report({ id, siteId, approvedToSend: false, sentAt: null, approvedAt: null });
  const cases: Array<[string, Parameters<typeof snapshot>[0]]> = [
    ["the page's own fixture", {}],
    [
      // Every draft on an Attention site: the Triage page has no approval group.
      "drafts only on Attention sites",
      {
        sites: [healthy({ id: "recA", name: "Acme" })],
        reports: [draft("p1", "recA")],
      },
    ],
    [
      // A fleet-wide Broken item (a dead letter for no fleet site) and no Broken site.
      "a fleet-wide Broken item only",
      { deadLetters: new Map([["ghost-site", 2]]) },
    ],
    [
      "a draft on a healthy site",
      {
        sites: [
          healthy({
            id: "recA",
            name: "Acme",
            reportRecipientsTo: "client@acme.example",
            headerImage: { url: "https://x.example/h.png", filename: "h.png", type: "image/png" },
          }),
        ],
        // Nothing blocks its approval: recipients, a header image, scores, and the
        // health gate overridden with a reason.
        reports: [
          report({
            id: "p1",
            siteId: "recA",
            approvedToSend: false,
            sentAt: null,
            approvedAt: null,
            lighthouse: { performance: 90, accessibility: 90, bestPractices: 90, seo: 90 },
            sendOverride: true,
            overrideReason: "checked by hand",
          }),
        ],
      },
    ],
  ];

  const seen = new Set<string>();
  it.each(cases)("%s", (_name, over) => {
    const snap = Object.keys(over ?? {}).length === 0 ? SNAP : snapshot(over);
    const view = overviewFromSnapshot(snap, NOW);
    const doc = parse(pageHtml(view));
    const triageIds = new Set(
      parse(
        render(TriagePage, {
          props: { data: { view: buildCockpitView(cockpitModelFromSnapshot(snap, NOW), NOW) } },
        }).body,
      )
        .querySelectorAll("[id]")
        .map((e) => e.getAttribute("id")!),
    );
    const ownIds = new Set(doc.querySelectorAll("[id]").map((e) => e.getAttribute("id")!));
    const hrefs = doc.querySelectorAll(".ov-line a").map((a) => a.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      seen.add(href);
      if (href.startsWith("/triage#")) expect(triageIds, href).toContain(href.slice(8));
      else if (href.startsWith("#")) expect(ownIds, href).toContain(href.slice(1));
      else expect(href).toBe("/triage");
    }
  });
  it("the cases above reach every kind of link, both approval targets included", () => {
    for (const href of ["/triage#broken", "/triage#cardless", "/triage#approval", "#ov-reports"])
      expect(seen).toContain(href);
  });
});

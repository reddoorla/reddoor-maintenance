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
    healthy({ id: "recA", name: "Acme" }),
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
    expect(links).toContainEqual(["1 broken.", "/triage#broken"]);
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
      "13 submissions since Jul 2, 2026. 10 were accepted as real, and the client was notified of 9. 9 of them (69%) came from one site, Rsvp Site;",
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

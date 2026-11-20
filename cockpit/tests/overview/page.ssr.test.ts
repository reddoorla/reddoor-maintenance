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
  tickLabel,
  trendGeometry,
  HOW_WE_COUNT,
  HEALTH_CHECK_NAMES,
  type OverviewView,
} from "../../src/lib/overview/view.js";
import { BAR_MS, BAR_STAGGER_MS, SPARK_MS, FEED_MS } from "../../src/lib/overview/motion.js";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { cockpitModelFromSnapshot } from "../../../src/dashboard/snapshot-views.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { withoutComments } from "../legacy/render.js";
import {
  NOW,
  FRESH,
  STALE,
  event,
  healthy,
  night,
  report,
  snapshot,
  trafficBlock,
} from "./fixtures.js";

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
  // P1-87 PR 4: one fleet event, so the sentinel render covers the Lately feed's text.
  feedEvents: [event({ id: "pr4-1", ts: FRESH, type: "pr_automerged", summary: "auto-merged x" })],
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
  it("has the first screen's three panels, then the kept sections, each under its h2", () => {
    expect(DOC.querySelectorAll("h2").map(text)).toEqual([
      "Status",
      "Fleet health · 3 sites",
      "How much is happening",
      "Lately",
      // P1-87 PR 5a: the nightly audit bar, under the three panels.
      "The nightly audit",
      "Every site",
      "Leads",
      "Client reports",
      "Upkeep",
      "Trends",
    ]);
  });

  it("names the Broken site in section 1, with its age", () => {
    const li = DOC.querySelectorAll(".ov-status .ov-list.broken li").map(text);
    expect(li).toEqual([
      "Bravo (first flagged 2 days ago): a page on the site did not answer at the last check",
    ]);
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

  it("the spam tile is the stopped count, with the screened count beside it", () => {
    const tile = DOC.querySelectorAll(".ov-tile").find((t) =>
      text(t).includes("spam submissions stopped before storage"),
    )!;
    expect(text(tile.querySelector(".ov-num")!)).toBe("248");
    expect(text(tile.querySelector(".ov-context")!)).toBe(
      "as of Oct 26; 3 more screened after arriving",
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
    expect(below(op)).toContain("How much is happening");
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

  it("tells the trend series apart by more than colour (P1-78h review round 2, T3)", () => {
    const rule = (sel: string) =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";
    expect(rule(".ov-line-mark.second")).toMatch(/stroke-dasharray:\s*[1-9]/);
    // The hover targets lie over every mark, so they must stay see-through (round 3).
    expect(rule(".ov-hit")).toMatch(/fill:\s*transparent/);
    expect(rule(".ov-dot.broken")).toMatch(/fill:\s*var\(--broken\)/);
    expect(rule(".ov-line-mark.broken")).toMatch(/stroke:\s*var\(--broken\)/);
    expect(rule(".ov-earlier")).toMatch(/fill:\s*var\(--band\)/);
  });

  it("draws each mark under forced colours with a border the browser forces, not a fill (round 1, item 8; round 2, I; round 3, E)", () => {
    // The forced palette replaces fills, so the marks keep a border: a pass solid, the
    // not-checked dotted, each tier its own border style, and the sparkline in the text
    // colour. Only the forced block is read: a rule outside it is not a forced rule.
    expect(css).not.toMatch(/forced-color-adjust:\s*none/);
    const at = css.indexOf("@media (forced-colors: active)");
    let depth = 0;
    let end = css.indexOf("{", at);
    for (let i = end; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const forced = css.slice(at, end + 1).replace(/\/\*[\s\S]*?\*\//g, "");
    const block = (sel: string) =>
      [...forced.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";
    expect(block(".ov-check-fill")).toMatch(/border:\s*0;\s*border-top:\s*8px solid/);
    expect(block(".ov-check-unknown")).toMatch(/border:\s*2px dotted/);
    expect(block(".ov-seg.ok")).toMatch(/border:\s*0;\s*border-top:\s*2\.25rem solid/);
    expect(block(".ov-seg.watch")).toMatch(/border-style:\s*dashed/);
    expect(block(".ov-seg.attention")).toMatch(/border-style:\s*dotted/);
    expect(block(".ov-seg.broken")).toMatch(/border-width:\s*6px;\s*border-style:\s*double/);
    expect(block(".ov-tier-inside")).toMatch(/display:\s*none/);
    // Review round 4 (tests minor 4): the all-OK counts keep their size under forced colours,
    // so a count is not a 1px clipped box, and the hidden copy reads as it did.
    const hiddenCounts = block(".ov-tier-counts.visually-hidden");
    expect(hiddenCounts).toMatch(/position:\s*static/);
    expect(hiddenCounts).toMatch(/width:\s*auto/);
    expect(hiddenCounts).toMatch(/height:\s*auto/);
    expect(hiddenCounts).toMatch(/overflow:\s*visible/);
    expect(hiddenCounts).toMatch(/clip:\s*auto/);
    expect(hiddenCounts).toMatch(/white-space:\s*normal/);
    expect(block(".ov-spark polyline")).toMatch(/stroke:\s*currentColor/);
    expect(block(".ov-spark circle")).toMatch(/fill:\s*currentColor/);
  });

  it("holds no rule for the sections removed from the page (round 1, item 14)", () => {
    for (const gone of [
      /\.ov-how\b/,
      /\.ov-checks(?![\w-])/,
      /\.ov-steps\b/,
      /\.ov-step-name\b/,
      /td\.bad\b/,
    ])
      expect(css).not.toMatch(gone);
    // The unknown cell style stays: the tables still use it.
    expect(css).toMatch(/\.ov-table td\.unknown/);
  });

  it("paints red only on a .broken selector", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const red = rules.filter(([, , body]) => /var\(--(broken|broken-fill)\)/.test(body!));
    expect(red.length).toBeGreaterThan(0);
    for (const [, sel] of red) expect(sel).toMatch(/\.broken\b/);
  });
});

/**
 * Review round 2 (T1, T2), widened in round 3 (T1): the sentinel render. Every leaf the
 * view hands the page becomes its own distinct sentinel: a number becomes a number
 * (70001, 70002, …), and a string becomes a marker naming its own path
 * (`⟦upkeep.automerged⟧`, indices as letters so a marker holds no digit). Each is
 * asserted in its labelled element. A count typed into the page, even one that
 * matches a fixture value, and a binding to the wrong field (all time in the
 * This-month column, the deploy cell showing the certificate, a count carried inside
 * words) all fail here: the digit check above cannot see any of them.
 */
const letters = (i: number): string =>
  (i >= 26 ? letters(Math.floor(i / 26) - 1) : "") + String.fromCharCode(97 + (i % 26));

function sentinelize(view: OverviewView): { view: OverviewView; at: Map<string, string> } {
  const at = new Map<string, string>();
  let next = 70001;
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "number") {
      const n = next++;
      at.set(path, String(n));
      return n;
    }
    if (typeof v === "string") {
      const m = `⟦${path}⟧`;
      at.set(path, m);
      return m;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${letters(i)}]`));
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, path ? `${path}.${k}` : k)]),
      );
    return v;
  };
  return { view: walk(view, "") as OverviewView, at };
}

/** A y-axis tick is drawn as its count's short form (P1-87 PR 7b item 1), so sentinel
 *  70001 on a tick reads "70.001k": the page shows that form, and its digits are the
 *  sentinel's own. */
const TICK_PATH = /^trends\.charts\[[a-z]+\]\.(high|mid|low)$/;
/** The digit runs a sentinel render may show: each sentinel, and each y tick's short form. */
function sentinelDigits(at: Map<string, string>): Set<string> {
  const ticks = [...at]
    .filter(([path, v]) => TICK_PATH.test(path) && !v.startsWith("⟦"))
    .flatMap(([, v]) => tickLabel(Number(v)).match(/\d+/g) ?? []);
  return new Set([...at.values(), ...ticks]);
}

/** The page's fixture, with an open vulnerability on Bravo, so "Open now" has a row. */
const SNAP_OPEN = {
  ...SNAP,
  sites: SNAP.sites!.map((x) =>
    x.id === "recB"
      ? { ...x, securityVulnsHigh: 2, lastSecurityAuditAt: FRESH, securityAdvisories: [] }
      : x,
  ),
};
const S = sentinelize(overviewFromSnapshot(SNAP_OPEN, NOW));
const SV = S.view;
const SDOC = parse(pageHtml(SV));
const sent = (path: string): string => {
  const v = S.at.get(path);
  if (v === undefined) throw new Error(`no sentinel at ${path}`);
  return v;
};
const one = (sel: string): string => {
  const el = SDOC.querySelector(sel);
  if (el === null) throw new Error(`no element ${sel}`);
  return text(el);
};

describe("the sentinel render: each leaf in its labelled element (T1, T2; round 3 T1)", () => {
  it("gives every leaf in the view its own sentinel", () => {
    // Enough to mean something, and none repeated.
    expect(S.at.size).toBeGreaterThan(150);
    expect(new Set(S.at.values()).size).toBe(S.at.size);
    // The fixture reaches the open-vulnerability list.
    expect(SV.upkeep.open).toHaveLength(1);
  });

  it("shows every sentinel the page renders as text, so none is typed in its place", () => {
    const shown = new Set(shownNumbers(SDOC));
    const words = pageText(SDOC);
    // Leaves the page does not show as text: the status counts reach it only inside
    // the status line's parts (and the line itself is those parts joined), this
    // month's submissions and the test sends are worked out but not shown, and ids,
    // links, classes, terms and raw stamps are attributes or keys.
    const unrendered = (p: string) =>
      // Fields the page no longer renders (P1-87 PR 3): the model keeps them.
      /^(live|nightly)(\.|\[)/.test(p) ||
      // The page shows a stamp's date and time apart (P1-87 PR 4, review round 2 B).
      /^lately\.lines\[[a-z]+\]\.when$/.test(p) ||
      // P1-87 PR 5a: the bar's mode, its running label and instants are read as
      // attributes or inside its line; the marker is a style the page computes; a
      // step's file and state are its class and its inferred place.
      /^cycle\.(mode|runningLabel|nowIso|windowEndIso|staleAfterIso|marker|refresh\.(fromIso|untilIso)|next\.startIso)$/.test(
        p,
      ) ||
      /^cycle\.steps\[[a-z]+\]\.(file|state)$/.test(p) ||
      // The Upkeep section keeps only Open now and the major upgrades (the operator,
      // 11-16): the two counts on /how and the tiles are not shown here.
      p === "upkeep.automerged" ||
      p === "upkeep.vulnsCleared" ||
      p === "prsMerged" ||
      p === "nightsCollected" ||
      p.startsWith("reports.checks") ||
      /\.spark(\[|$)/.test(p) ||
      // The sum of the three unknown kinds below, which the page reads as its parts.
      /^health\.checks\[[a-z]+\]\.unknown$/.test(p) ||
      p.startsWith("status.counts.") ||
      p === "status.line" ||
      p === "status.cls" ||
      p === "leads.thisMonth.submissions" ||
      // Feeds the leads tile's number and context, which numbersView computes before the
      // page renders them as numbers[0] (round 1, fix 6); the page never reads the leaf.
      p.startsWith("leads.leadsSent.") ||
      p === "reports.sent.testSends" ||
      /\.(siteId|key|url|href|term|tier|atIso)$/.test(p);
    let checked = 0;
    for (const [path, v] of S.at) {
      if (unrendered(path)) continue;
      checked++;
      const on = v.startsWith("⟦") ? words.includes(v) : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("the status line and the Broken list read their own fields", () => {
    const parts = SDOC.querySelectorAll(".ov-line > span[data-term]").map(text);
    expect(parts).toEqual(SV.status.parts.map((_, i) => sent(`status.parts[${letters(i)}].text`)));
    expect(SDOC.querySelectorAll(".ov-list.broken li").map(text)).toEqual(
      SV.status.broken.map((b, i) => {
        const p = `status.broken[${letters(i)}]`;
        return `${sent(`${p}.siteName`)}${b.age ? ` (${sent(`${p}.age`)})` : ""}: ${sent(`${p}.reasons`)}`;
      }),
    );
  });

  it("the leads headline reads each count from its own field", () => {
    const span = (term: string) =>
      one(`section[aria-labelledby="ov-leads"] > p span[data-term="${term}"]`);
    expect(span("Submissions")).toBe(
      `${sent("leads.allTime.submissions")} submissions since ${sent("leads.since")}.`,
    );
    expect(span("Accepted as real")).toBe(
      `${sent("leads.allTime.accepted")} were accepted as real,`,
    );
    expect(span("Client notified")).toBe(
      `and the client was notified of ${sent("leads.allTime.notified")}.`,
    );
    expect(span("Biggest share")).toBe(
      `Of the ${sent("leads.allTime.submissions")} submissions, ${sent("leads.biggest.submissions")} (${sent("leads.biggest.share")}%) came from one site, ${sent("leads.biggest.siteName")}, through ${sent("leads.biggest.formKind")}; ${sent("leads.biggest.accepted")} of the ${sent("leads.allTime.accepted")} accepted are from it. Every site's own count is in the table below.`,
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
      `${sent("leads.stoppedAllTime")}, as of ${sent("leads.stoppedAsOf")}`,
    ]);
  });

  it("the per-site leads rows read each column from its own field", () => {
    const rows = SDOC.querySelectorAll(".ov-leads-sites tbody tr");
    expect(rows.length).toBe(SV.leads.perSite.length);
    rows.forEach((tr, i) => {
      const p = `leads.perSite[${letters(i)}]`;
      const cell = (label: string) => text(tr.querySelector(`td[data-label="${label}"]`)!);
      expect(text(tr.querySelector("th")!)).toBe(sent(`${p}.siteName`));
      expect(cell("Submissions")).toBe(sent(`${p}.submissions`));
      expect(cell("Accepted")).toBe(sent(`${p}.accepted`));
      expect(cell("Notified")).toBe(sent(`${p}.notified`));
      expect(cell("Screened")).toBe(sent(`${p}.screened`));
      expect(cell("By hand")).toBe(sent(`${p}.byHand`));
    });
  });

  it("the Upkeep section reads Open now and the major upgrades from their own fields (the operator, 11-16)", () => {
    expect(
      one('section[aria-labelledby="ov-upkeep"] p[data-term="Major-version upgrades waiting"]'),
    ).toBe(`Major-version upgrades waiting: ${sent("upkeep.depsBehind")}.`);
    expect(SDOC.querySelectorAll('ul[data-term="Open now"] li').map(text)).toEqual(
      SV.upkeep.open.map(
        (_, i) =>
          `${sent(`upkeep.open[${letters(i)}].siteName`)} ${sent(`upkeep.open[${letters(i)}].text`)}.`,
      ),
    );
    expect(SDOC.querySelectorAll('section[aria-labelledby="ov-upkeep"] h3').map(text)).toEqual([
      "Open now",
    ]);
    // The ladder stays on /how; it is not repeated here.
    expect(text(SDOC.querySelector('section[aria-labelledby="ov-upkeep"]')!)).not.toContain(
      "Broken:",
    );
  });

  it("the reports section reads each field: sends, due and waiting; the medians sit in Fleet health", () => {
    expect(one('p[data-term="Reports sent"]')).toBe(
      `${sent("reports.sent.real")} reports sent to clients: ${sent("reports.sent.approvedFirst")} approved by one of us before sending, and ${sent("reports.sent.aroundGate")} without that yes.`,
    );
    const meds = SDOC.querySelectorAll(".ov-medians dt").map(text);
    expect(meds).toEqual(
      SV.reports.lighthouse.map((_, i) => sent(`reports.lighthouse[${letters(i)}].label`)),
    );
    expect(SDOC.querySelectorAll(".ov-medians dd").map(text)).toEqual(
      SV.reports.lighthouse.map((_, i) => sent(`reports.lighthouse[${letters(i)}].median`)),
    );
    expect(one(".ov-lighthouse-line")).toContain(
      `from audits as old as ${sent("reports.lighthouseAsOf")}.`,
    );
    const rows = SDOC.querySelectorAll(".ov-due tbody tr");
    expect(rows.length).toBe(SV.reports.perSite.length);
    rows.forEach((tr, i) => {
      const p = `reports.perSite[${letters(i)}]`;
      expect(text(tr.querySelector("th")!)).toBe(sent(`${p}.siteName`));
      expect(text(tr.querySelector('td[data-label="Next due"]')!)).toBe(sent(`${p}.nextDue`));
      expect(text(tr.querySelector('td[data-label="Waiting"]')!)).toBe(sent(`${p}.waiting`));
    });
  });
});

describe("review round 3: the page reads right for one, and for a form test not yet trusted", () => {
  it("one submission and one accepted read in the singular (O7)", () => {
    const doc = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            submissions: [
              makeSubmissionRow({ id: "a1", siteId: "recA", status: "new", submittedAt: FRESH }),
            ],
          }),
          NOW,
        ),
      ),
    );
    expect(pageText(doc)).toContain(
      "1 submission since Oct 26, 2026. 1 was accepted as real, and the client was notified of 0.",
    );
  });

  it("a failed form test is not a pass nor a fail in Fleet health: it is not yet a verdict (O1)", () => {
    const doc = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({ sites: [healthy({ id: "recA", name: "Acme", formE2eOk: "fail" })] }),
          NOW,
        ),
      ),
    );
    const row = doc.querySelectorAll(".ov-check").find((r) => text(r).startsWith("Contact form"))!;
    // The screen reader's " of 1" is part of the count (round 1, item 13).
    // A test that ran and failed is named as such, not "not checked" (review round 2, A).
    expect(text(row.querySelector(".ov-check-count")!)).toBe(
      "0 of 1 · 1 test failed, not yet a verdict",
    );
    // The failed test changes no level: the site is counted in OK (round 1, restored).
    expect(text(doc.querySelector(".ov-tier-counts")!)).toBe(
      "1 OK · 0 watch · 0 attention · 0 broken",
    );
  });

  it("reads a failed, a no-verdict and a not-checked Contact form apart (review round 2, A)", () => {
    const doc = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            sites: [
              healthy({ id: "recA", name: "Acme", formE2eOk: "fail", formE2eCheckedAt: FRESH }),
              healthy({ id: "recB", name: "Bravo", formE2eOk: null, formE2eCheckedAt: FRESH }),
              healthy({ id: "recC", name: "Charlie", formE2eOk: "pass", formE2eCheckedAt: STALE }),
            ],
          }),
          NOW,
        ),
      ),
    );
    const row = doc.querySelectorAll(".ov-check").find((r) => text(r).startsWith("Contact form"))!;
    expect(text(row.querySelector(".ov-check-count")!)).toBe(
      "0 of 3 · 1 test failed, not yet a verdict · 1 no verdict · 1 not checked",
    );
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

describe("review round 4: emphasis, the none-open sentence, and the shipping copy", () => {
  it("says none is open only when every site has a fresh security check (C2)", () => {
    const NONE = "No critical or high vulnerability is open.";
    expect(pageText(parse(pageHtml(overviewFromSnapshot(snapshot(), NOW))))).toContain(NONE);
    const never = snapshot({
      sites: [
        healthy({ id: "recA", name: "Acme" }),
        healthy({
          id: "recR",
          name: "Rsvp Site",
          lastSecurityAuditAt: null,
          securityVulnsCritical: null,
          securityVulnsHigh: null,
        }),
      ],
    });
    const words = pageText(parse(pageHtml(overviewFromSnapshot(never, NOW))));
    expect(words).not.toContain(NONE);
    expect(words).toContain(
      "Rsvp Site has no security check on record, so we cannot say what is open now.",
    );
  });

  it("the status band is the Broken one when a site is broken, and the quiet one otherwise (T4)", () => {
    expect(DOC.querySelector("section.ov-status")!.classList.contains("broken")).toBe(true);
    // Control: a quiet page's band is not.
    const quiet = parse(pageHtml(overviewFromSnapshot(snapshot(), NOW)));
    expect(quiet.querySelector("section.ov-status")!.classList.contains("ok")).toBe(true);
  });
});

/** The digit runs a visitor reads outside How we count's definitions: every text node
 *  under the body, plus `title` and `aria-label`, where every number must be a binding
 *  (review round 6: the whole body, not three selectors). The page's two fixed
 *  phrases are taken out by their own words, never by allowing their digits
 *  page-wide: Lighthouse's scale ("out of 100") and the one count the page derives
 *  ("carries N checks", from `checks.length`). */
function boundNumbers(doc: HTMLElement, checks: number): string[] {
  const runs: string[] = [];
  const walk = (n: Node) => {
    if (n instanceof TextNode) {
      runs.push(n.text);
      return;
    }
    const el = n as HTMLElement;
    if (el.tagName === "DL" && el.closest(".ov-how") !== null) return;
    for (const a of ["title", "aria-label"]) {
      const v = el.getAttribute?.(a);
      if (v) runs.push(v);
    }
    for (const c of n.childNodes) walk(c);
  };
  walk(doc.querySelector("body") ?? doc);
  return (
    runs
      .join(" | ")
      .replace(/out of 100\b/g, "")
      .replace(new RegExp(`carries ${checks} checks`, "g"), "")
      .match(/\d+/g) ?? []
  );
}

describe("no count is typed into the page, over the sentinel render (review rounds 5 and 6)", () => {
  // In the sentinel render every number the view hands over is 70001 or above, so a
  // digit run that is not one of them was typed into the template, whatever its value.
  const allowed = sentinelDigits(S.at);
  const n = SV.reports.checks.length;
  const stray = (html: string) => boundNumbers(parse(html), n).filter((d) => !allowed.has(d));

  it("every digit run outside How we count's definitions is a sentinel", () => {
    expect(boundNumbers(SDOC, n).length).toBeGreaterThan(20);
    expect(stray(pageHtml(SV))).toEqual([]);
  });

  it("is an instrument that can fail: a number typed into an existing element is caught", () => {
    const html = pageHtml(SV);
    const leads = '<h2 id="ov-leads">Leads</h2>';
    expect(html).toContain(leads);
    expect(stray(html.replace(leads, '<h2 id="ov-leads">Leads 30 nights</h2>'))).toEqual(["30"]);
    // The page's own fixed values typed elsewhere are caught too.
    expect(stray(html.replace(leads, `<h2 id="ov-leads">Leads ${n} steps, 100 runs</h2>`))).toEqual(
      [String(n), "100"],
    );
    // And in an attribute.
    expect(stray(html.replace("<h1", '<h1 title="30 nights a month"'))).toEqual(["30"]);
  });
});

describe("P1-78h: section 8 while collecting (review round 1, T4)", () => {
  it("says how many nights it has and draws no chart", () => {
    const sec = DOC.querySelector('section[aria-labelledby="ov-trends"]')!;
    expect(text(sec.querySelector("p")!)).toBe(`${VIEW.trends.status}.`);
    expect(VIEW.trends.status).toMatch(/^Collecting: 1 of 14 nights/);
    expect(sec.querySelectorAll("figure, svg")).toHaveLength(0);
  });
});

describe("P1-78h: section 8 drawn, once fleet_daily holds 14 nights", () => {
  // Sixteen nights to Oct 26: Oct 20 has no row, and the two oldest were counted on
  // an earlier ladder, so the level chart has a break and a gap.
  const nights = Array.from({ length: 17 }, (_, i) => {
    const date = new Date(Date.parse("2026-10-26T00:00:00Z") - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return night(date, {
      ladderVersion: i >= 15 ? 1 : 2,
      sites: {
        value: {
          cards: 3,
          tiers: { broken: i % 2, attention: 2, healthy: 1 },
          preLaunch: 0,
          setup: 0,
        },
      },
      leads: {
        value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 300 - 2 * i },
      },
    });
  }).filter((n) => n.night !== "2026-10-20");
  const TSNAP = { ...SNAP, nights };
  const TVIEW = overviewFromSnapshot(TSNAP, NOW);
  const TDOC = parse(pageHtml(TVIEW));
  const section = TDOC.querySelector('section[aria-labelledby="ov-trends"]')!;

  it("draws seven charts, each a slider with a name and a description", () => {
    expect(TVIEW.trends.charts).toHaveLength(7);
    const figs = section.querySelectorAll("figure.ov-trend");
    expect(figs.map((f) => text(f.querySelector("figcaption")!))).toEqual(
      TVIEW.trends.charts!.map((c) => c.title),
    );
    for (const [i, f] of figs.entries()) {
      const svg = f.querySelector("svg.ov-chart")!;
      // P1-87 PR 8a, review round 1 (D): the chart is a slider, named by its caption and described by its summary.
      expect(svg.getAttribute("role")).toBe("slider");
      expect(svg.getAttribute("aria-labelledby")).toBe(`ov-trend-${i}`);
      expect(text(svg.querySelector("desc")!)).toBe(TVIEW.trends.charts![i]!.summary);
    }
  });

  it("the Broken line is drawn in pieces around the gap and the break, in the Broken style", () => {
    const fig = section.querySelectorAll("figure.ov-trend")[0]!;
    const broken = fig.querySelectorAll("svg.ov-chart path.ov-line-mark.broken");
    // Oct 13 to Oct 19, and Oct 21 to Oct 26: never one line across the gap.
    expect(broken).toHaveLength(2);
    expect(fig.querySelectorAll("svg.ov-chart rect.ov-earlier")).toHaveLength(1);
    expect(text(fig.querySelector(".ov-trend-note")!)).toBe(TVIEW.trends.charts![0]!.note);
  });

  it("each chart's table gives every night, with why a night has no point", () => {
    for (const [i, f] of section.querySelectorAll("figure.ov-trend").entries()) {
      const c = TVIEW.trends.charts![i]!;
      const rows = f.querySelectorAll(".ov-trend-table tbody tr");
      expect(rows.map((r) => r.querySelectorAll("th, td").map(text).join(" "))).toEqual(
        c.nights.map(
          (label, k) =>
            `${label} ${c.series
              .map((s) => {
                const q = s.points[k]!;
                return q.value === null ? q.note : q.note ? `${q.value}, ${q.note}` : q.value;
              })
              .join(" ")}`,
        ),
      );
    }
    const gap = section.querySelectorAll(".ov-trend-table tbody tr")[10]!;
    expect(gap.querySelectorAll("th, td").map(text)).toEqual([
      "Oct 20",
      "no count that night",
      "no count that night",
    ]);
  });

  it("draws exactly the marks the geometry gives, in its order (review round 1, T2)", () => {
    for (const [i, f] of section.querySelectorAll("figure.ov-trend").entries()) {
      const g = trendGeometry(TVIEW.trends.charts![i]!);
      const svg = f.querySelector("svg.ov-chart")!;
      const attrs = (sel: string, names: string[]) =>
        svg.querySelectorAll(sel).map((e) => names.map((n) => e.getAttribute(n)));
      expect(attrs("path.ov-bar", ["d"])).toEqual(g.bars.map((b) => [b.d]));
      expect(attrs("path.ov-line-mark", ["d", "class"])).toEqual(
        g.lines.map((l) => [
          l.d,
          `ov-line-mark ${l.broken ? "broken" : ""} ${l.series > 0 ? "second" : ""}`,
        ]),
      );
      expect(attrs("circle.ov-dot", ["cx", "cy", "class"])).toEqual(
        g.dots.map((d) => [
          String(d.x),
          String(d.y),
          `ov-dot ${d.broken ? "broken" : ""} ${d.series > 0 ? "second" : ""}`,
        ]),
      );
      // Review round 2 (T1): every coordinate of the break, so it cannot be moved off
      // the plot or drawn with no length.
      expect(attrs("rect.ov-earlier", ["x", "y", "width", "height"])).toEqual(
        g.earlier.map((e) => [
          String(e.x),
          String(g.top),
          String(e.width),
          String(g.baseline - g.top),
        ]),
      );
      expect(attrs("line.ov-break", ["x1", "x2", "y1", "y2"])).toEqual(
        g.breaks.map((x) => [String(x), String(x), String(g.top), String(g.baseline)]),
      );
      // The zero axis where columns stand, and the ticks in the view's words.
      expect(attrs("line.ov-axis", ["y1", "y2"])).toEqual([[String(g.zero), String(g.zero)]]);
      const c = TVIEW.trends.charts![i]!;
      // Round 3 (T2): the halfway label sits at its own height, not on the top one.
      if (c.mid !== null)
        expect(svg.querySelectorAll("text.ov-tick")[1]!.getAttribute("y")).toBe(
          String(g.midY! + 4),
        );
      expect(svg.querySelectorAll("text.ov-tick").map(text)).toEqual([
        tickLabel(c.high),
        ...(c.mid === null ? [] : [tickLabel(c.mid)]),
        tickLabel(c.low),
        c.nights[0],
        c.nights.at(-1),
      ]);
      // Review round 2 (T2): a chart of two series names each in its key, with the
      // mark it is drawn with.
      const key = f.querySelectorAll(".ov-key li");
      expect(key.map(text)).toEqual(c.series.length > 1 ? c.series.map((s) => s.name) : []);
      for (const [k, li] of key.entries()) {
        const s = c.series[k]!;
        const mark = li.querySelector("svg.ov-key-mark > *")!;
        expect(mark.tagName.toLowerCase()).toBe(s.bars ? "rect" : "line");
        expect(mark.getAttribute("class")).toBe(
          s.bars ? "ov-bar" : `ov-line-mark ${s.broken ? "broken" : ""} ${k > 0 ? "second" : ""}`,
        );
      }
    }
    // Both two-series charts carry a key.
    expect(section.querySelectorAll(".ov-key")).toHaveLength(2);
    expect(TVIEW.trends.charts!.some((c) => c.mid !== null)).toBe(true);
    // The fixture reaches every kind of mark.
    const all = TVIEW.trends.charts!.map((c) => trendGeometry(c));
    for (const k of ["bars", "lines", "dots", "earlier", "breaks"] as const)
      expect(
        all.some((g) => g[k].length > 0),
        k,
      ).toBe(true);
    expect(TVIEW.trends.charts![0]!.series).toHaveLength(2);
  });

  // P1-87 PR 8a, item 5: the hover target carries its night's words as data (the readout reads
  // them), and no native tooltip, which would draw over the hover line.
  it("every hover target names its night, as data and not as a tooltip", () => {
    const fig = section.querySelectorAll("figure.ov-trend")[0]!;
    const titles = fig.querySelectorAll("rect.ov-hit").map((h) => h.getAttribute("data-title"));
    expect(titles).toHaveLength(17);
    expect(titles).toContain("Oct 20: no count that night");
    expect(section.querySelectorAll("rect.ov-hit title")).toHaveLength(0);
  });

  it("gives every hover target the words the geometry gives its night (P1-87 PR 8a, item 5)", () => {
    for (const [i, f] of section.querySelectorAll("figure.ov-trend").entries()) {
      const g = trendGeometry(TVIEW.trends.charts![i]!);
      expect(
        f.querySelectorAll("rect.ov-hit").map((h) => h.getAttribute("data-title")),
        TVIEW.trends.charts![i]!.title,
      ).toEqual(g.slots.map((t) => t.title));
    }
  });

  // P1-87 PR 8a, item 5: each chart is reachable by keyboard and is a slider (review round 1, D): its
  // value is the selected night, and its text is that night's words. Its visible readout is idle
  // until a night is read.
  it("makes each chart a focusable slider over its nights (P1-87 PR 8a, item 5, review round 1 D)", () => {
    const figs = section.querySelectorAll("figure.ov-trend");
    expect(figs.length).toBe(TVIEW.trends.charts!.length);
    for (const [ci, f] of figs.entries()) {
      const svg = f.querySelector("svg.ov-chart")!;
      const titles = svg.querySelectorAll("rect.ov-hit").map((h) => h.getAttribute("data-title"));
      expect(svg.getAttribute("tabindex"), `chart ${ci}`).toBe("0");
      expect(svg.getAttribute("role"), `chart ${ci}`).toBe("slider");
      expect(svg.getAttribute("aria-labelledby"), `chart ${ci}`).toBe(`ov-trend-${ci}`);
      expect(svg.getAttribute("aria-describedby"), `chart ${ci}`).toBe(
        `ov-trend-${ci}-desc ov-trend-${ci}-hint`,
      );
      expect(svg.getAttribute("aria-valuemin"), `chart ${ci}`).toBe("1");
      expect(svg.getAttribute("aria-valuemax"), `chart ${ci}`).toBe(String(titles.length));
      expect(svg.getAttribute("aria-valuenow"), `chart ${ci}`).toBe(String(titles.length));
      expect(svg.getAttribute("aria-valuetext"), `chart ${ci}`).toBe(titles.at(-1));
      const readout = f.querySelector("p.ov-trend-readout")!;
      expect(readout.getAttribute("id"), `chart ${ci}`).toBe(`ov-trend-${ci}-readout`);
      expect(readout.getAttribute("aria-hidden"), `chart ${ci}`).toBe("true");
      expect(readout.getAttribute("class")).toContain("muted");
      expect(readout.text.trim(), `chart ${ci}`).toBe(
        "Point at a night, or focus the chart and use the arrow keys, to read it.",
      );
      // P1-87 PR 8a, round 2 (G, R2): the slider's own value is the announcement, so a chart has
      // no live region: a key step is said once, not again by a polite region.
      // P1-87 PR 8a, round 3 (t1): a region is a live region whatever its role, and the figure itself
      // can carry the attribute, so the check covers the figure and every descendant.
      const LIVE = '[aria-live],[role="status"],[role="log"],[role="alert"]';
      expect(
        f.querySelectorAll(LIVE).length,
        `chart ${ci}: no live region inside a chart`,
      ).toBe(0);
      expect(
        f.hasAttribute("aria-live") ||
          ["status", "log", "alert"].includes(f.getAttribute("role") ?? ""),
        `chart ${ci}: the figure is no live region`,
      ).toBe(false);
      const hint = f.querySelector(`#ov-trend-${ci}-hint`)!;
      expect(hint.text.trim(), `chart ${ci}`).toBe(
        "Point at a night, or focus the chart and use the arrow keys, to read it.",
      );
    }
  });

  it("draws the focus ring and the hover line from tokens, and in the system text colour when forced", () => {
    const css = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.ov-chart:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
    expect(css).toMatch(/\.ov-trend-cursor\s*\{[^}]*stroke:\s*var\(--ink\)/);
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{[^}]*\.ov-trend-cursor\s*\{\s*stroke:\s*currentColor[\s\S]*?\.ov-chart:focus-visible\s*\{\s*outline-color:\s*currentColor/,
    );
  });

  it("every number in the section came from the view", () => {
    const allowed = new Set([...(JSON.stringify({ TVIEW, HOW_WE_COUNT }).match(/\d+/g) ?? [])]);
    expect(shownNumbers(TDOC).filter((d) => !allowed.has(d))).toEqual([]);
  });

  it("over the sentinel render: each leaf is on the page, and no digit is typed in", () => {
    const ST = sentinelize(TVIEW);
    const html = pageHtml(ST.view);
    const doc = parse(html);
    const words = pageText(doc);
    const shown = new Set(shownNumbers(doc));
    let checked = 0;
    for (const [path, v] of ST.at) {
      if (!path.startsWith("trends.") || path.endsWith(".term")) continue;
      checked++;
      const on = v.startsWith("⟦")
        ? words.includes(v)
        : TICK_PATH.test(path)
          ? words.includes(tickLabel(Number(v)))
          : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(150);
    const allowed = sentinelDigits(ST.at);
    const n = ST.view.reports.checks.length;
    expect(boundNumbers(doc, n).filter((d) => !allowed.has(d))).toEqual([]);
  });
});

/**
 * P1-87 PR 3: the first screen. The strip and two panels above the kept sections, the
 * removed sections gone, and a closing link to /how.
 */
describe("the first screen (P1-87 PR 3)", () => {
  const quietSites = ["Acme", "Rsvp Site"];
  const quiet = parse(pageHtml(overviewFromSnapshot(snapshot(), NOW)));
  const screen = (doc: HTMLElement) =>
    doc
      .querySelectorAll(".ov-first")
      .map((e) => e.toString())
      .join("");

  it("shows no site name in the panels on a quiet day", () => {
    const panels = parse(screen(quiet));
    // The three panels and, since P1-87 PR 5a, the nightly audit bar under them.
    expect(panels.querySelectorAll("section").length).toBe(4);
    for (const name of quietSites) expect(screen(quiet)).not.toContain(name);
    // Control: the same scan finds a name when a site is broken and listed in the strip.
    expect(text(DOC.querySelector("section.ov-status")!)).toContain("Bravo");
  });

  it("the tier bar's counts read as text, in the order OK, watch, attention, broken", () => {
    expect(text(DOC.querySelector(".ov-tier-counts")!)).toBe(
      "2 OK · 0 watch · 0 attention · 1 broken",
    );
  });

  it("the check rows come in the sketch's order, each with its counts", () => {
    const rows = DOC.querySelectorAll(".ov-check").map((r) =>
      text(r.querySelector(".ov-check-name")!),
    );
    expect(rows).toEqual([
      "Live",
      "Certificate",
      "Deploy",
      "Contact form",
      "Security",
      "Accessibility",
      "Build + tests",
    ]);
    // Bravo's Live is failing: one failing, and the pass count first.
    const live = DOC.querySelectorAll(".ov-check")[0]!;
    expect(text(live.querySelector(".ov-check-count")!)).toBe("2 of 3 · 1 failing");
  });

  it("the broken fixture: the strip is red, names the site, and drops the quiet-day sentence", () => {
    const strip = DOC.querySelector("section.ov-status")!;
    expect(strip.classList.contains("broken")).toBe(true);
    expect(text(strip.querySelector(".ov-list.broken")!)).toContain("Bravo");
    expect(text(strip)).not.toContain("Nothing needs attention");
    expect(text(strip)).not.toContain("All live");
  });

  it("the Lighthouse medians sit in the health panel, under a muted line", () => {
    expect(one(".ov-lighthouse-line")).toContain(
      "Google Lighthouse, the middle score across our sites",
    );
    expect(DOC.querySelectorAll(".ov-medians dt").map(text)).toEqual([
      "Performance",
      "Accessibility",
      "Best practices",
      "SEO",
    ]);
  });

  it("the removed sections are gone from the page", () => {
    const all = text(DOC.querySelector("body")!);
    for (const gone of [
      "Is every site live?",
      "What runs every night",
      "How changes ship",
      "How we count",
      "The ladder",
      "Dependency updates merged (opened by Renovate",
    ])
      expect(all, gone).not.toContain(gone);
  });

  it("closes with a link to /how, after the trends", () => {
    const link = DOC.querySelectorAll('a[href="/how"]').find((a) => text(a) === "How this works")!;
    expect(link).toBeDefined();
    // The shell's nav has its own /how link above the page; this one is the closing link.
    expect(HTML.lastIndexOf('href="/how"')).toBeGreaterThan(HTML.indexOf('id="ov-trends"'));
  });

  it("an unmeasured tile reads its words, never 0", () => {
    const none = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({ sites: snapshot().sites, submissions: null, nights: null, reports: null }),
          NOW,
        ),
      ),
    );
    const nums = none.querySelectorAll(".ov-tile .ov-num").map(text);
    expect(nums.length).toBe(8);
    expect(nums).not.toContain("0");
    expect(nums.every((n) => n === "not readable")).toBe(true);
  });

  it("each tile names its number, its label and its context; the sparkline is hidden from readers", () => {
    const tiles = DOC.querySelectorAll(".ov-tile");
    expect(tiles.length).toBe(8);
    for (const t of tiles) {
      expect(t.querySelector(".ov-label")).not.toBeNull();
      const svg = t.querySelector("svg");
      if (svg) expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("a night with no value is a gap in the sparkline, never a drop to 0", () => {
    // Two-week fixture: the leads line breaks around its two empty nights.
    const fourteen = Array.from({ length: 14 }, (_, i) =>
      night(
        new Date(Date.parse("2026-10-13T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10),
        {
          leads:
            i === 5
              ? { value: null, reason: "not read" }
              : { value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: i } },
          // The checks tile reads these: night 5 has no count (round 1, fix 6 test).
          coverage: {
            value: {
              a: i === 5 ? { value: null, reason: "not read" } : { value: i + 1 },
            },
          },
        },
      ),
    ).reverse();
    const page = parse(pageHtml(overviewFromSnapshot(snapshot({ nights: fourteen }), NOW)));
    // The checks tile is the fifth (round 1, fix 6 removed the leads sparkline; PR 7a put the
    // two traffic tiles first): its sixth night has no count, so the line breaks there: a run
    // of 5, then a run of 8.
    const checks = page.querySelectorAll(".ov-tile")[4]!;
    const runs = [...checks.querySelectorAll("polyline")];
    expect(runs.length).toBe(2);
    expect(runs[0]!.getAttribute("points")!.split(" ").length).toBe(5);
    expect(runs[1]!.getAttribute("points")!.split(" ").length).toBe(8);
  });
});

// P1-87 PR 3, review round 1: the tier bar's sizes and counts, the check bars, the
// launching line, and what the panels name. Each fixture gives every count its own value.
const TRANSITIVE_HIGH = [
  {
    module: "x",
    severity: "high" as const,
    title: "t",
    cves: [],
    url: null,
    relationship: "transitive" as const,
  },
];
const TIERED = snapshot({
  sites: [
    healthy({ id: "tA", name: "Ok One" }),
    healthy({ id: "tB", name: "Ok Two" }),
    healthy({ id: "tC", name: "Ok Three" }),
    healthy({
      id: "tW",
      name: "Watch Site",
      securityVulnsHigh: 2,
      securityAdvisories: TRANSITIVE_HIGH,
      lastSecurityAuditAt: FRESH,
    }),
    healthy({ id: "tT1", name: "Cert One", certDaysRemaining: 18 }),
    healthy({ id: "tT2", name: "Cert Two", certDaysRemaining: 18 }),
  ],
  digest: { "vuln:tW": { metric: 2, firstFlaggedAt: "2026-10-01" } },
});

describe("the first screen's bars and launching line (P1-87 PR 3, round 1)", () => {
  const tiered = parse(pageHtml(overviewFromSnapshot(TIERED, NOW)));
  const seg = (k: string) => tiered.querySelector(`.ov-seg.${k}`)!.getAttribute("style");

  it("sizes each tier segment by its count: OK 3, watch 1, attention 2", () => {
    expect(seg("ok")).toBe("flex-grow: 3");
    expect(seg("watch")).toBe("flex-grow: 1");
    expect(seg("attention")).toBe("flex-grow: 2");
    expect(tiered.querySelector(".ov-seg.broken")).toBeNull();
    expect(text(tiered.querySelector(".ov-tier-counts")!)).toBe(
      "3 OK · 1 watch · 2 attention · 0 broken",
    );
  });

  it("prints the counts inside the bar when every site is OK, and not under it", () => {
    const allOk = parse(
      pageHtml(overviewFromSnapshot(snapshot({ sites: [healthy({ id: "z", name: "Zed" })] }), NOW)),
    );
    expect(text(allOk.querySelector(".ov-tierbar .ov-tier-inside")!)).toBe(
      "1 OK · 0 watch · 0 attention · 0 broken",
    );
    expect(allOk.querySelector(".ov-tier-counts")!.classList.contains("visually-hidden")).toBe(
      true,
    );
    // Not all OK: the counts are under the bar, and nothing is printed inside it.
    expect(tiered.querySelector(".ov-tier-inside")).toBeNull();
    expect(tiered.querySelector(".ov-tier-counts")!.classList.contains("visually-hidden")).toBe(
      false,
    );
  });

  it("fills each check's bar to its pass count, the unknown part grey beside it", () => {
    // SNAP's Accessibility: no scan on any of its three sites, so none passes and all three
    // are not checked: the pass fill is empty and the grey part spans the whole track.
    const acc = DOC.querySelectorAll(".ov-check")[5]!;
    expect(acc.querySelector(".ov-check-fill")).toBeNull();
    expect(acc.querySelector(".ov-check-unknown")!.getAttribute("style")).toBe(
      "left: 0%; width: 100%",
    );
    expect(text(acc.querySelector(".ov-check-count")!)).toBe("0 of 3 · 3 not checked");
  });

  it("names a launching site the status line counts at a level the bar does not", () => {
    const base = snapshot({ sites: [healthy({ id: "z", name: "Zed" })] });
    const golf = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            ...base,
            sites: [
              ...base.sites!,
              healthy({
                id: "recG",
                name: "Golf",
                status: "launching",
                securityVulnsCritical: 1,
                securityAutoFixAttempts: 99,
                lastSecurityAuditAt: FRESH,
                securityAdvisories: [],
              }),
            ],
            digest: { "vuln:recG": { metric: 1, firstFlaggedAt: "2026-10-25" } },
          }),
          NOW,
        ),
      ),
    );
    const notes = golf.querySelectorAll(".ov-health .ov-tier-counts").map(text);
    expect(notes).toContain("plus 1 launching site at Attention");
    // The note's term is the one for its kind (review round 4, tests minor 6).
    const note = golf
      .querySelectorAll(".ov-health .ov-tier-counts")
      .find((e) => text(e).startsWith("plus"))!;
    expect(note.querySelectorAll("[data-term]").map((e) => e.getAttribute("data-term"))).toEqual([
      "Launching sites",
    ]);
  });

  it("a note that carries both kinds marks each clause with its own term (review round 4, correctness n1)", () => {
    const v = overviewFromSnapshot(snapshot({ sites: [healthy({ id: "z", name: "Zed" })] }), NOW);
    v.health.launching = [
      { level: "attention", count: 1, kind: "launching" },
      { level: "watch", count: 2, kind: "other" },
    ];
    const note = parse(pageHtml(v))
      .querySelectorAll(".ov-health .ov-tier-counts")
      .find((e) => text(e).startsWith("plus"))!;
    expect(text(note)).toBe(
      "plus 1 launching site at Attention and 2 sites not marked maintained at Watch",
    );
    expect(note.querySelectorAll("[data-term]").map((e) => e.getAttribute("data-term"))).toEqual([
      "Launching sites",
      "Sites not marked maintained",
    ]);
  });

  it("the broken fixture: the panels name no site, though the strip names the broken one", () => {
    expect(text(DOC.querySelector("section.ov-status")!)).toContain("Bravo");
    const panels = DOC.querySelectorAll(".ov-first")
      .map((e) => e.toString())
      .join("");
    expect(panels).not.toContain("Bravo");
  });

  it("an unmeasured tile's number carries the unknown class, a measured one does not", () => {
    const none = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({ sites: snapshot().sites, submissions: null, nights: null, reports: null }),
          NOW,
        ),
      ),
    );
    expect(none.querySelectorAll(".ov-tile .ov-num.unknown").length).toBe(8);
    // On the page fixture, exactly the numbers that are words (not digits) carry the class.
    const nums = DOC.querySelectorAll(".ov-tile .ov-num");
    const words = nums.filter((n) => !/^\d+$/.test(text(n)));
    expect(words.length).toBeGreaterThan(0);
    expect(nums.filter((n) => n.classList.contains("unknown")).length).toBe(words.length);
  });
});

describe("every data-term on the overview is a How-we-count term (review round 2, F)", () => {
  // The T6 check was deleted with the overview's How-we-count block; this restores it. A
  // term on / with no entry in HOW_WE_COUNT is a label a visitor cannot look up.
  const unknownTerms = (html: string): string[] => {
    const known = new Set(HOW_WE_COUNT.map((h) => h.term));
    const terms = parse(html)
      .querySelectorAll("[data-term]")
      .map((el) => el.getAttribute("data-term")!);
    return [...new Set(terms)].filter((t) => !known.has(t));
  };

  it("every data-term rendered on / has an entry in HOW_WE_COUNT", () => {
    expect(unknownTerms(HTML)).toEqual([]);
  });

  it("is an instrument that can fail: a made-up data-term on / is reported", () => {
    // Control: one term on the page changed to a made-up one.
    const changed = HTML.replace('data-term="Trends"', 'data-term="Made up term"');
    expect(changed).not.toBe(HTML);
    expect(unknownTerms(changed)).toEqual(["Made up term"]);
  });
});

describe("the first screen's page structure (review round 2, G and H)", () => {
  // Comments are cut first: a rule's selector would otherwise carry the comment above it.
  const cssText = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const cssRule = (sel: string) =>
    [...cssText.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";
  const rowOf = (doc: HTMLElement, name: string) =>
    doc.querySelectorAll(".ov-check").find((r) => text(r).startsWith(name))!;

  it("a broken-only day is not all OK: no counts inside the bar, the line under it shown (G)", () => {
    // SNAP is two OK and one broken: the all-OK style must not apply.
    expect(DOC.querySelector(".ov-tier-inside")).toBeNull();
    expect(DOC.querySelector(".ov-tier-counts")!.classList.contains("visually-hidden")).toBe(false);
  });

  it("names one maintained site in the singular (G)", () => {
    const one = parse(
      pageHtml(overviewFromSnapshot(snapshot({ sites: [healthy({ id: "z", name: "Zed" })] }), NOW)),
    );
    expect(text(one.querySelector("#ov-health")!)).toBe("Fleet health · 1 site");
  });

  it("the grey not-checked part starts where the pass fill ends, and its width is the rest (H)", () => {
    const five = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            sites: [
              healthy({ id: "a", name: "A" }),
              healthy({ id: "b", name: "B" }),
              healthy({ id: "c", name: "C" }),
              healthy({ id: "d", name: "D" }),
              healthy({ id: "e", name: "E", formE2eOk: null, formE2eCheckedAt: null }),
            ],
          }),
          NOW,
        ),
      ),
    );
    const form = rowOf(five, "Contact form");
    expect(form.querySelector(".ov-check-fill")!.getAttribute("style")).toBe("width: 80%");
    expect(form.querySelector(".ov-check-unknown")!.getAttribute("style")).toBe(
      "left: 80%; width: 20%",
    );
  });

  it("every aria-labelledby on the overview names an element that exists (H)", () => {
    const ids = DOC.querySelectorAll("[aria-labelledby]").map((el) =>
      el.getAttribute("aria-labelledby")!,
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(DOC.querySelector(`#${id}`), id).not.toBeNull();
  });

  it("the tier bar and each check bar are positioned, so their parts stay inside them (H)", () => {
    expect(cssRule(".ov-tierbar")).toMatch(/position:\s*relative/);
    expect(cssRule(".ov-check-bar")).toMatch(/position:\s*relative/);
  });
});

describe("the first screen's layout and tones, pinned in the stylesheet (review round 2, I)", () => {
  // Comments are cut first, so a selector never carries the comment above it.
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleOf = (sel: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";

  it("gives a watch or attention segment a floor of 1.25rem, so one site in 40 keeps its shape (review round 4, a11y minor 1)", () => {
    expect(ruleOf(".ov-seg:not(.ok)")).toMatch(/min-width:\s*1\.25rem/);
    expect(ruleOf(".ov-seg")).toMatch(/min-width:\s*0/);
  });

  it("keeps a phone's check bars wide: the count goes under the bar below 30rem (I, phone)", () => {
    // The phone block's own declaration, not only its opening selector (review round 3, F).
    expect(css).toMatch(
      /@media \(max-width: 30rem\)\s*\{\s*\.ov-checks-list\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(ruleOf(".ov-checks-list")).toMatch(
      /grid-template-columns:\s*minmax\(6rem, 8\.5rem\) minmax\(4rem, 1fr\) fit-content\(9rem\)/,
    );
  });

  it("lays the Lighthouse medians two by two on a phone, all four in a row above 30rem (I, nit 8)", () => {
    expect(ruleOf(".ov-medians")).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(
      /@media \(min-width: 30rem\)\s*\{\s*\.ov-medians\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    );
  });

  it("tells watch and attention apart by shape as well as tone (I, tier segments)", () => {
    // Watch is hollow: the panel colour inside an outline.
    expect(ruleOf(".ov-seg.watch")).toMatch(/background:\s*var\(--surface\)/);
    expect(ruleOf(".ov-seg.watch")).toMatch(/box-shadow:\s*inset 0 0 0 3px var\(--ink-muted\)/);
    // Attention is solid inside a panel-coloured frame, so it never reads as OK's solid ink.
    expect(ruleOf(".ov-seg.attention")).toMatch(/background:\s*var\(--ink-dark\)/);
    expect(ruleOf(".ov-seg.attention")).toMatch(/box-shadow:\s*inset 0 0 0 3px var\(--surface\)/);
  });

  it("separates a dark pass fill from its not-checked part by a 2px gap (I, dark)", () => {
    expect(ruleOf(".ov-check-unknown")).toMatch(/box-shadow:\s*inset 2px 0 0 var\(--surface\)/);
  });

  it("gives the status strip the panel surface, and an ink bar when all is well (I, nit 7)", () => {
    expect(ruleOf(".ov-status")).toMatch(/background:\s*var\(--surface\)/);
    expect(ruleOf(".ov-status.ok")).toMatch(/border-left-color:\s*var\(--ink\)/);
  });

  it("lines an unmeasured tile's label up with its neighbours: the measured line box (I, nit 10)", () => {
    // Review round 2, B.2: the rule is shared with `.long`, so its selector is the pair.
    // Review round 3, B.5: the shared rule also keeps the figure's bottom edge (the alignment),
    // so dropping `align-items` cannot pass silently.
    const shared = ruleOf(".ov-num.unknown,\n.ov-num.long");
    expect(shared).toMatch(/min-height:\s*calc\(1\.9rem \* 1\.1\)/);
    expect(shared).toMatch(/display:\s*flex/);
    expect(shared).toMatch(/align-items:\s*flex-end/);
  });
});

describe("review round 3: the grey part covers all three unknown kinds (group C, tests M1)", () => {
  // A failed fresh form test, a fresh form with no result, and a stale pass: the grey
  // part is the sum of all three, so the whole track is grey (review round 3, tests M1).
  const trio = parse(
    pageHtml(
      overviewFromSnapshot(
        snapshot({
          sites: [
            healthy({ id: "recA", name: "Ann", formE2eOk: "fail", formE2eCheckedAt: FRESH }),
            healthy({ id: "recB", name: "Ben", formE2eOk: null, formE2eCheckedAt: FRESH }),
            healthy({ id: "recC", name: "Cal", formE2eOk: "pass", formE2eCheckedAt: STALE }),
          ],
        }),
        NOW,
      ),
    ),
  );
  const form = trio.querySelectorAll(".ov-check").find((r) => text(r).startsWith("Contact form"))!;

  it("the grey part spans the whole track when a test failed, no verdict and not checked", () => {
    expect(form.querySelector(".ov-check-unknown")!.getAttribute("style")).toBe(
      "left: 0%; width: 100%",
    );
    expect(text(form.querySelector(".ov-check-count")!)).toBe(
      "0 of 3 · 1 test failed, not yet a verdict · 1 no verdict · 1 not checked",
    );
  });
});

describe("review round 4: the grey part's condition, and the deploy verdict (group C, tests minors 2, 3)", () => {
  const rowIn = (doc: HTMLElement, name: string) =>
    doc.querySelectorAll(".ov-check").find((r) => text(r).startsWith(name))!;

  it("a fresh failed test and a fresh no-result, with no stale site, still grey the whole track", () => {
    const two = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            sites: [
              healthy({ id: "recA", name: "Ann", formE2eOk: "fail", formE2eCheckedAt: FRESH }),
              healthy({ id: "recB", name: "Ben", formE2eOk: null, formE2eCheckedAt: FRESH }),
            ],
          }),
          NOW,
        ),
      ),
    );
    const form = rowIn(two, "Contact form");
    expect(form.querySelector(".ov-check-unknown")!.getAttribute("style")).toBe(
      "left: 0%; width: 100%",
    );
    expect(form.querySelector(".ov-check-fill")).toBeNull();
  });

  it("a Live row with only a failing site draws neither a fill nor a grey part", () => {
    const failing = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({ sites: [healthy({ id: "z", name: "Zed", reachableOk: "fail" })] }),
          NOW,
        ),
      ),
    );
    const live = rowIn(failing, "Live");
    expect(live.querySelector(".ov-check-unknown")).toBeNull();
    expect(live.querySelector(".ov-check-fill")).toBeNull();
  });
});

describe("review round 3: no zero-width parts on a check bar (group D, tests minor 6)", () => {
  // Under forced colours a 0%-wide bordered span still draws a 4px mark, so a part with no
  // sites is not rendered at all (review round 3, correctness and tests minor 6).
  const healthyOnly = parse(
    pageHtml(overviewFromSnapshot(snapshot({ sites: [healthy({ id: "z", name: "Zed" })] }), NOW)),
  );
  const rowNamed = (doc: HTMLElement, name: string) =>
    doc.querySelectorAll(".ov-check").find((r) => text(r).startsWith(name))!;

  it("a row with no site passing has no fill span: the accessibility row of DOC", () => {
    const acc = DOC.querySelectorAll(".ov-check")[5]!;
    expect(text(acc)).toMatch(/^Accessibility 0 of 3/);
    expect(acc.querySelector(".ov-check-fill")).toBeNull();
    expect(acc.querySelector(".ov-check-unknown")).not.toBeNull();
  });

  it("a row with every site passing has no grey part", () => {
    const live = rowNamed(healthyOnly, "Live");
    expect(text(live)).toMatch(/^Live 1 of 1/);
    expect(live.querySelector(".ov-check-fill")!.getAttribute("style")).toBe("width: 100%");
    expect(live.querySelector(".ov-check-unknown")).toBeNull();
  });
});

describe("review round 3: the check list names its How-we-count term (group G)", () => {
  it("marks the check list with the term that defines the bars", () => {
    expect(DOC.querySelector(".ov-checks-list")!.getAttribute("data-term")).toBe(
      "Sites passing each check",
    );
  });
});

/** P1-87 PR 4: the Lately feed on the page, the third panel of the first screen. */
describe("the Lately feed on the page (P1-87 PR 4)", () => {
  it("is the third panel beside the first screen, headed Lately, with no All activity link", () => {
    expect(
      DOC.querySelectorAll(".ov-first > section").map((el) => el.getAttribute("class")),
    ).toEqual(["ov-health", "ov-happening", "ov-lately", "ov-cycle"]);
    expect(text(DOC.querySelector(".ov-lately > h2")!)).toBe("Lately");
    expect(HTML).not.toMatch(/All activity/i);
  });

  it("shows each line with its time as a datetime, and the site after a dot", () => {
    const lines = DOC.querySelectorAll(".ov-lately ol > li");
    expect(lines).toHaveLength(VIEW.lately.lines.length);
    expect(VIEW.lately.lines.length).toBeGreaterThan(0);
    const times = DOC.querySelectorAll(".ov-lately li time").map((t) => t.getAttribute("datetime"));
    expect(times).toEqual(VIEW.lately.lines.map((l) => l.atIso));
    // The comma is for a screen reader only: the page's text reads it as a visually hidden ", ".
    expect(text(lines[0]!)).toBe(
      `${VIEW.lately.lines[0]!.when} ${VIEW.lately.lines[0]!.text} · , ${VIEW.lately.lines[0]!.site}`,
    );
  });

  it("splits each stamp into its date and its time, each in a span, so the column wraps after the date", () => {
    const html = pageHtml(
      overviewFromSnapshot(
        snapshot({
          feedEvents: [
            event({ id: "d6", ts: "2026-10-21T19:00:00.000Z" }),
            event({ id: "d5", ts: "2026-10-22T19:00:00.000Z" }),
          ],
        }),
        NOW,
      ),
    );
    // Newest first: the Thursday line (five days old) leads, the Wednesday one (six) follows.
    const [undated, dated] = [...parse(html).querySelectorAll(".ov-lately li time")];
    expect([...dated!.children].map(text)).toEqual(["Wed Oct 21,", "12:00pm"]);
    expect(text(dated!)).toBe("Wed Oct 21, 12:00pm");
    expect([...undated!.children].map(text)).toEqual(["Thu", "12:00pm"]);
    expect(text(undated!)).toBe("Thu 12:00pm");
  });

  it("renders a nightly line as its time and text, with no site and no '· null'", () => {
    const html = pageHtml(overviewFromSnapshot(snapshot({ nights: [night("2026-10-26")] }), NOW));
    const first = parse(html).querySelector(".ov-lately ol > li")!;
    expect(text(first)).toBe("Mon 11:07pm Nightly run: 8 of 8 steps ran to the end");
    expect(html).not.toContain("· null");
  });

  it("shows the separator to a reader as a dot, and to a screen reader as a comma", () => {
    const sep = DOC.querySelector(".ov-lately li span[aria-hidden='true']")!;
    expect(sep.textContent).toBe(" · ");
    const comma = DOC.querySelector(".ov-lately li span.visually-hidden")!;
    expect(comma.textContent).toBe(", ");
  });

  it("spans both columns from 60rem to 75rem, and sits in its own column from 75rem", () => {
    const css = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(
      /@media \(min-width: 60rem\)\s*\{[^@]*\.ov-lately\s*\{\s*grid-column:\s*1 \/ -1;/,
    );
  });

  it("pins the panel's own rules: the feed does not stretch its row, and each line is ruled below", () => {
    const css = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.ov-lately\s*\{[^}]*align-self:\s*start/);
    // From 75rem the three first-screen panels align to their own heights, not one row's.
    expect(css).toMatch(
      /@media \(min-width: 75rem\)\s*\{[^@]*\.ov-first\s*\{[^}]*align-items:\s*start/,
    );
    // The time is a fixed column that wraps; its date and time spans never break inside.
    const timeRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel!.trim() === ".ov-lately time",
    )![2]!;
    expect(timeRule).toMatch(/flex:\s*0 0 6rem/);
    expect(timeRule).toMatch(/white-space:\s*normal/);
    expect(timeRule).not.toMatch(/nowrap/);
    expect(css).toMatch(/\.ov-lately time > span\s*\{[^}]*white-space:\s*nowrap/);
    const liRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel]) => sel!.trim() === ".ov-lately li",
    )![2]!;
    expect(liRule).toMatch(/border-bottom:\s*1px solid var\(--rule\)/);
    expect(liRule).not.toMatch(/border-top/);
  });

  it("makes no line from an event whose date does not parse, and the page holds no 'Invalid'", () => {
    const bad = overviewFromSnapshot(
      snapshot({ feedEvents: [event({ id: "bad", ts: "not a date" })] }),
      NOW,
    );
    const html = pageHtml(bad);
    expect(parse(html).querySelectorAll(".ov-lately ol > li")).toHaveLength(0);
    expect(html).not.toContain("Invalid");
  });

  it("says which sources could not be read, and never 'Nothing recorded' over them", () => {
    const failed = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({
            gaps: ["feed events"],
            feedEvents: [],
            reports: null,
            submissions: null,
            nights: null,
          }),
          NOW,
        ),
      ),
    );
    const panel = text(failed.querySelector(".ov-lately")!);
    expect(panel).toContain("Could not read events, reports, leads and the nightly just now.");
    expect(panel).not.toContain("Nothing recorded");
  });

  it("reads two failed sources as one sentence", () => {
    const html = pageHtml(overviewFromSnapshot({ ...SNAP, reports: null, submissions: null }, NOW));
    expect(text(parse(html).querySelector(".ov-lately")!)).toContain(
      "Could not read reports and leads just now.",
    );
  });

  it("says a failed read first, in ink, and still shows the lines that did read", () => {
    const html = pageHtml(overviewFromSnapshot({ ...SNAP, reports: null }, NOW));
    const panel = parse(html).querySelector(".ov-lately")!;
    const paragraph = [...panel.querySelectorAll("p")].find((p) =>
      text(p).includes("Could not read reports just now."),
    );
    expect(paragraph).toBeDefined();
    expect(paragraph!.hasAttribute("class")).toBe(false);
    // Heading, then the sentence, then the list: a failed read is said before the lines.
    expect([...panel.children].map((el) => el.tagName)).toEqual(["H2", "P", "OL"]);
    expect(panel.querySelectorAll("ol > li").length).toBeGreaterThan(0);
  });

  it("never says 'Nothing recorded' over a render with lines", () => {
    const html = pageHtml(overviewFromSnapshot(SNAP, NOW));
    const panel = text(parse(html).querySelector(".ov-lately")!);
    expect(parse(html).querySelectorAll(".ov-lately ol > li").length).toBeGreaterThan(0);
    expect(panel).not.toContain("Nothing recorded");
  });

  it("names a failed source by its sentinel, so the sentence is over the rendered view", () => {
    const US = sentinelize(overviewFromSnapshot({ ...SNAP, reports: null }, NOW));
    const UDOC = parse(pageHtml(US.view));
    expect(text(UDOC.querySelector(".ov-lately")!)).toContain(
      `Could not read ${US.at.get("lately.unreadable[a]")} just now.`,
    );
  });

  it("says nothing was recorded when the feed is empty", () => {
    const empty = parse(pageHtml(overviewFromSnapshot(snapshot(), NOW)));
    expect(text(empty.querySelector(".ov-lately")!)).toContain(
      "Nothing recorded in the last 7 days.",
    );
  });
});

/** P1-87 PR 5a: the nightly audit bar, the first screen's section under the three panels. */
describe("the nightly audit bar on the page (P1-87 PR 5a)", () => {
  const RUN_NOW = new Date("2026-10-27T07:30:00.000Z");
  // A run in progress: CMS check stamped at 11:10pm PT, so CMS sync or Security runs.
  const RUNNING = overviewFromSnapshot(
    snapshot({
      nights: [],
      // Two sites carry the CMS check's stamp: a step counts mid-run on two sites (P1-87
      // PR 5a, review round 1, Group B).
      sites: ["recA", "recB"].map((id) =>
        makeWebsiteRow({
          id,
          name: id === "recA" ? "Acme" : "Beta",
          status: "maintained",
          urlCheckedAt: null,
          prismicModelsCheckedAt: "2026-10-27T06:10:00.000Z",
        }),
      ),
    }),
    RUN_NOW,
  );
  const RDOC = parse(pageHtml(RUNNING));
  // A recorded night, with the CMS check's own stamp inside that run.
  const RECORDED = overviewFromSnapshot(
    snapshot({
      nights: [night("2026-10-26")],
      sites: [
        makeWebsiteRow({
          id: "recA",
          name: "Acme",
          status: "maintained",
          urlCheckedAt: null,
          prismicModelsCheckedAt: "2026-10-27T06:15:00.000Z",
        }),
      ],
    }),
    NOW,
  );
  const EDOC = parse(pageHtml(RECORDED));

  it("is a full-width section under the three panels, headed The nightly audit, with its line", () => {
    const sec = RDOC.querySelector(".ov-first > section.ov-cycle")!;
    expect(sec).not.toBeNull();
    expect(sec.getAttribute("aria-labelledby")).toBe("ov-cycle-h");
    expect(text(sec.querySelector("h2")!)).toBe("The nightly audit");
    expect(text(sec.querySelector("p.ov-cycle-line")!)).toBe(RUNNING.cycle.line);
    expect(RUNNING.cycle.line).toBe("Running since 11:07pm PT · now on CMS sync or Security");
  });

  it("draws nine segments in run order: eight steps, then the wait to the next run", () => {
    const items = RDOC.querySelectorAll(".ov-cycle-track > li");
    expect(items).toHaveLength(9);
    expect(items.slice(0, 8).map((li) => text(li.querySelector(".ov-cycle-name")!))).toEqual([
      "Backup",
      "CMS check",
      "CMS sync",
      "Security",
      "Site checks",
      "Build and tests",
      "Live forms",
      "Report drafts",
    ]);
    expect(items[8]!.getAttribute("class")).toBe("ov-cycle-seg wait");
    expect(text(items[8]!)).toContain("Next run");
    expect(text(items[8]!)).toContain("11:07pm PT");
  });

  it("stripes only the running bars, through one pattern on the page", () => {
    const running = RDOC.querySelectorAll(".ov-cycle-seg.running");
    expect(running.map((li) => text(li.querySelector(".ov-cycle-name")!))).toEqual([
      "CMS sync",
      "Security",
    ]);
    expect(RDOC.querySelectorAll(".ov-cycle pattern#ov-cycle-stripes")).toHaveLength(1);
    expect(RDOC.querySelectorAll('.ov-cycle rect[fill="url(#ov-cycle-stripes)"]')).toHaveLength(2);
    // A recorded night has nothing running, so it draws no stripes.
    expect(EDOC.querySelectorAll(".ov-cycle pattern")).toHaveLength(0);
    expect(EDOC.querySelectorAll(".ov-cycle-seg.running")).toHaveLength(0);
  });

  it("says each step's words to a screen reader, after its name", () => {
    const words = RDOC.querySelectorAll(".ov-cycle-track > li")
      .slice(0, 8)
      .map((li) => text(li.querySelector(".visually-hidden")!));
    expect(words).toEqual(RUNNING.cycle.steps.map((x) => `: ${x.words}`));
    expect(words[1]).toBe(": finished at 11:10pm PT");
    expect(words[2]).toBe(": running now, or the step beside it");
  });

  it("shows a step's time where it has one, and none where it does not", () => {
    const times = EDOC.querySelectorAll(".ov-cycle-track > li")
      .slice(0, 8)
      .map((li) => text(li.querySelector(".ov-cycle-time")!));
    expect(times).toEqual(RECORDED.cycle.steps.map((x) => x.time ?? ""));
    expect(times[1]).toBe("11:15pm");
    expect(times[0]).toBe("");
  });

  it("places the marker along the wait, and says when the next run starts", () => {
    const marker = EDOC.querySelector(".ov-cycle .ov-cycle-marker")!;
    expect(marker.getAttribute("style")).toMatch(/^left: 36\.2\d*%$/);
    // A running bar has no marker: the wait to the next run has not begun.
    expect(RDOC.querySelector(".ov-cycle .ov-cycle-marker")).toBeNull();
    expect(RDOC.querySelector(".ov-cycle-seg.running .ov-cycle-marker")).toBeNull();
  });

  it("is explained in How we count, under its own term", () => {
    const entry = HOW_WE_COUNT.find((h) => h.term === "The nightly audit bar");
    expect(entry).toBeDefined();
    expect(entry!.text).toContain("Backup, CMS sync and Report drafts leave no time");
    expect(entry!.text).toContain("every 2 minutes");
    // P1-87 PR 5a, review round 1, Group D: what a step needs mid-run, and when a page left open
    // checks again.
    expect(entry!.text).toContain("a single site re-tested by hand does not move the bar");
    expect(entry!.text).toContain("once the run's five hours are up or the next start has come");
    expect(
      RDOC.querySelector('section.ov-cycle[data-term="The nightly audit bar"]'),
    ).not.toBeNull();
  });

  // P1-87 PR 5a, review round 1, Group C: forced colours replace every bar's fill, so each
  // state is a border; a waiting bar is seen on the page; and each step's time is read once.
  it("gives every state its own border under forced colours, and a waiting bar a visible outline (review round 1, C)", () => {
    const raw = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const at = raw.indexOf("@media (forced-colors: active)");
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    let end = raw.indexOf("{", at);
    for (let i = end; i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const forced = raw.slice(at, end + 1);
    const block = (sel: string) =>
      [...forced.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";
    expect(block(".ov-cycle-bar")).toMatch(/box-sizing:\s*border-box/);
    expect(block(".ov-cycle-seg.done .ov-cycle-bar")).toMatch(/border-top:\s*0?\.625rem solid/);
    expect(block(".ov-cycle-seg.problem .ov-cycle-bar")).toMatch(/border:\s*2px dotted/);
    expect(block(".ov-cycle-seg.none .ov-cycle-bar")).toMatch(/border:\s*2px dashed/);
    expect(block(".ov-cycle-seg.waiting .ov-cycle-bar")).toMatch(/border:\s*1px solid/);
    // Round 2 (accessibility minor 1): the Next-run track is 3px double, so it differs from a
    // waiting step's 1px solid under forced colours.
    expect(block(".ov-cycle-seg.wait .ov-cycle-bar")).toMatch(/border:\s*3px double/);
    expect(block(".ov-cycle-marker")).toMatch(/border-left:\s*2px solid/);
    // Outside the forced block, a waiting bar keeps the band fill and an inset outline.
    const plain = raw.slice(0, at) + raw.slice(end + 1);
    const outlined = [...plain.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
      ([, sel, body]) =>
        sel!.trim() === ".ov-cycle-seg.waiting .ov-cycle-bar" &&
        /box-shadow:\s*inset 0 0 0 1px var\(--ink-muted\)/.test(body!),
    );
    expect(outlined).toBe(true);
  });

  // P1-87 PR 5a, review round 2 (accessibility minors 1 and 2): in light and dark alike, the
  // Next-run track is outlined like a waiting bar, and a none step is a dashed outline, so the
  // two differ by shape.
  it("outlines the Next-run track and dashes a none step's outline in light and dark (review round 2)", () => {
    const raw = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // The base rules alone: the forced-colours block is cut out first, and the wrapper of
    // the base none border (`@media not all and (forced-colors: active)`, P1-87 PR 5a round 3) is
    // taken off, so its rule still reads as a base rule.
    const plain = raw
      .replace(/@media \(forced-colors: active\)\s*\{[\s\S]*?\n\}/, "")
      .replace(/@media not all and \(forced-colors: active\)\s*\{/g, "");
    const bodies = (sel: string) =>
      [...plain.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter(([, s]) => s!.trim() === sel)
        .map(([, , body]) => body!);
    expect(bodies(".ov-cycle-seg.wait .ov-cycle-bar").join(" ")).toMatch(
      /box-shadow:\s*inset 0 0 0 1px var\(--ink-muted\)/,
    );
    expect(bodies(".ov-cycle-seg.none .ov-cycle-bar").join(" ")).toMatch(
      /border:\s*1px dashed var\(--ink-muted\)/,
    );
    expect(bodies(".ov-cycle-seg.none .ov-cycle-bar").join(" ")).not.toMatch(/box-shadow/);
  });

  // P1-87 PR 5a, review round 2 (accessibility nit): the words a screen reader hears have no
  // space before the colon, and the Next-run item has its ", " before the time. Pinned as the
  // rendered text of one step's list item, with the aria-hidden time left out.
  it("reads one step as 'Backup: ran to the end', and the Next-run item with a comma (review round 2)", () => {
    const li = EDOC.querySelectorAll(".ov-cycle-track > li")[0]!;
    const spoken = li.childNodes
      .filter((n) => n.nodeType !== 1 || (n as HTMLElement).getAttribute("aria-hidden") !== "true")
      .map((n) => n.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    expect(spoken).toBe("Backup: ran to the end");
    const next = EDOC.querySelector(".ov-cycle-track > li.wait")!;
    expect(next.querySelector(".visually-hidden")!.textContent).toBe(",");
    expect(text(next).startsWith("Next run, 11:07pm PT")).toBe(true);
  });

  it("gives each step its own class: done, problem, none, running and waiting (review round 1, Group E)", () => {
    // A recorded night with a done step, a problem (Security failed), and a none (no CMS
    // check result).
    const n = night("2026-10-26");
    const recorded = overviewFromSnapshot(
      snapshot({
        nights: [
          {
            ...n,
            counts: {
              ...n.counts,
              steps: {
                ...n.counts.steps,
                "fleet-security.yml": { outcome: "completed", runId: 1, conclusion: "failure" },
                "fleet-prismic-drift.yml": null,
              },
            },
          },
        ],
        sites: [],
      }),
      new Date("2026-10-27T09:00:00.000Z"),
    );
    const classes = (view: OverviewView) =>
      parse(pageHtml(view))
        .querySelectorAll(".ov-cycle-track > li")
        .map((li) => li.getAttribute("class"));
    expect(classes(recorded)).toEqual([
      "ov-cycle-seg done",
      "ov-cycle-seg none",
      "ov-cycle-seg done",
      "ov-cycle-seg problem",
      "ov-cycle-seg done",
      "ov-cycle-seg done",
      "ov-cycle-seg done",
      "ov-cycle-seg done",
      "ov-cycle-seg wait",
    ]);
    // Mid-run, two sites stamp the CMS check: Backup and CMS check are done, CMS sync and
    // Security are running, and the rest wait.
    expect(classes(RUNNING)).toEqual([
      "ov-cycle-seg done",
      "ov-cycle-seg done",
      "ov-cycle-seg running",
      "ov-cycle-seg running",
      "ov-cycle-seg waiting",
      "ov-cycle-seg waiting",
      "ov-cycle-seg waiting",
      "ov-cycle-seg waiting",
      "ov-cycle-seg wait",
    ]);
  });

  it("reads each step's time once: the visible time is hidden, and the next run's time stays readable", () => {
    const steps = RDOC.querySelectorAll(".ov-cycle-track > li:not(.wait) .ov-cycle-time");
    expect(steps).toHaveLength(8);
    for (const t of steps) expect(t.getAttribute("aria-hidden")).toBe("true");
    const next = RDOC.querySelector(".ov-cycle-seg.wait .ov-cycle-time")!;
    expect(next.getAttribute("aria-hidden") ?? null).toBeNull();
    expect(text(next.querySelector(".ov-cycle-when")!)).toBe(RUNNING.cycle.next.startsAt);
  });

  it("keeps its own rules in the stylesheet: no animation, no gradient, and full width", () => {
    const css = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    expect(css).toMatch(/\.ov-health,\s*\.ov-happening,\s*\.ov-lately,\s*\.ov-cycle\s*\{/);
    expect(css).toMatch(/\.ov-cycle\s*\{[^}]*grid-column:\s*1 \/ -1/);
    const own = rules.filter(([, sel]) => sel!.includes("ov-cycle"));
    expect(own.length).toBeGreaterThan(5);
    for (const [, , body] of own) {
      expect(body).not.toMatch(/transition|animation|gradient/);
    }
    expect(css).not.toMatch(/@keyframes\s+ov-cycle/);
  });
});

/** P1-87 PR 7a: the two traffic tiles on the page, from a newest night with the probe's block. */
describe("P1-87 PR 7a: the traffic tiles on the page", () => {
  const PNIGHT = "2026-10-26";
  const PV = overviewFromSnapshot(
    snapshot({
      nights: [night(PNIGHT, { traffic: { value: trafficBlock(PNIGHT) } as never })],
    }),
    NOW,
  );
  const PD = parse(pageHtml(PV));

  it("the first two tiles read the sketch's lines, as measured numbers", () => {
    const tiles = PD.querySelectorAll(".ov-tile");
    const [visits, search] = [tiles[0]!, tiles[1]!];
    expect(text(visits.querySelector(".ov-num")!)).toBe("1,674");
    expect(visits.querySelector(".ov-num")!.classList.contains("unknown")).toBe(false);
    expect(text(visits.querySelector(".ov-label")!)).toBe("engaged visits, last 30 days");
    expect(text(visits.querySelector(".ov-context")!)).toBe(
      "up 9% on the 30 days before · 16 sites",
    );
    expect(text(search.querySelector(".ov-num")!)).toBe("12,521");
    expect(text(search.querySelector(".ov-label")!)).toBe("times shown in Google, 28 days");
    expect(text(search.querySelector(".ov-context")!)).toBe("623 clicks through · 16 sites");
  });

  it("an unmeasured traffic tile says its words in the unknown class, never 0", () => {
    const none = parse(pageHtml(overviewFromSnapshot(snapshot({ nights: [night(PNIGHT)] }), NOW)));
    const first = none.querySelectorAll(".ov-tile")[0]!;
    expect(text(first.querySelector(".ov-num")!)).toBe("not yet collected");
    expect(first.querySelector(".ov-num")!.classList.contains("unknown")).toBe(true);
  });

  it("over the sentinel render: each traffic leaf is on the page, and no digit is typed in", () => {
    const ST = sentinelize(PV);
    const doc = parse(pageHtml(ST.view));
    const shown = new Set(shownNumbers(doc));
    const words = doc.text;
    let checked = 0;
    for (const [path, v] of ST.at) {
      if (!/^numbers\[[ab]\]\.(value|label|context)$/.test(path)) continue;
      checked++;
      const on = v.startsWith("⟦") ? words.includes(v) : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBe(6);
    const allowed = sentinelDigits(ST.at);
    expect(boundNumbers(doc, PV.reports.checks.length).filter((d) => !allowed.has(d))).toEqual([]);
  });
});

// P1-87 PR 7a, review round 2 (B.3, B.4): which figures carry the `long` class. A figure over
// seven characters (eight with the commas) gets it, so "1,234,567" (nine) does and "123,456"
// (seven) does not; an unmeasured tile never does, even when its words are long.
describe("a long figure carries the long class (review round 2, B.3, B.4)", () => {
  /** The overview with its first tile's figure set to `value`, measured or not. */
  const firstFigure = (value: string, measured = true) => {
    const view = {
      ...VIEW,
      numbers: VIEW.numbers.map((n, i) => (i === 0 ? { ...n, value, measured } : n)),
    };
    return parse(pageHtml(view)).querySelector(".ov-tile .ov-num")!;
  };

  it.each(["1,234,567", "12,345,678"])("%s is long", (value) => {
    expect(firstFigure(value).classList.contains("long")).toBe(true);
  });

  it("123,456 is not long: seven characters is the most a figure holds at its size", () => {
    expect(firstFigure("123,456").classList.contains("long")).toBe(false);
  });

  it("an unmeasured tile is never long, even with words longer than a figure", () => {
    const words = firstFigure("no count for last night", false);
    expect(words.classList.contains("unknown")).toBe(true);
    expect(words.classList.contains("long")).toBe(false);
  });
});

// P1-87 PR 7a, review round 3 (B.1, B.2, B.5): a long figure's size is clamped between the body
// text (1rem) and round 1's 1.4rem, with 1.4rem before the clamp for a browser without container
// units; a long figure breaks only at the `<wbr>` after each comma, never mid-group; a short or
// unmeasured figure has none.
describe("a long figure is sized, and breaks only after a comma (review round 3, B.1, B.2, B.5)", () => {
  const firstFigure = (value: string, measured = true) => {
    const view = {
      ...VIEW,
      numbers: VIEW.numbers.map((n, i) => (i === 0 ? { ...n, value, measured } : n)),
    };
    return parse(pageHtml(view)).querySelector(".ov-tile .ov-num")!;
  };

  it.each(["1,234,567", "12,345,678"])(
    "%s renders a <wbr> after each comma and no other",
    (value) => {
      const figure = firstFigure(value);
      expect(figure.textContent).toBe(value);
      expect(figure.querySelectorAll("wbr")).toHaveLength(value.split(",").length - 1);
      // The pieces sit in one span, the flex item the text wraps inside (review round 4, major 1).
      // P1-87 PR 8a, item 4: that item is `.ov-num-final`, which holds the model's figure, and the
      // empty `.ov-num-count` (the count-up's digits) is its sibling.
      const final = figure.querySelector(".ov-num-final")!;
      expect(final.children).toHaveLength(1);
      expect(final.children[0]!.tagName).toBe("SPAN");
      expect(final.innerHTML).toBe(
        `<span>${value.replace(/,/g, ",<wbr>").replace(/<wbr>$/, "")}</span>`,
      );
    },
  );

  it("123,456 (short) and an unmeasured figure render no <wbr>", () => {
    expect(firstFigure("123,456").querySelectorAll("wbr")).toHaveLength(0);
    expect(firstFigure("no count for last night", false).querySelectorAll("wbr")).toHaveLength(0);
  });

  // Comments are cut first, so a selector never carries the comment above it.
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleOf = (sel: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, s]) => s!.trim() === sel)?.[2] ?? "";

  it("sizes a long figure between 1rem and 1.4rem, with 1.4rem first as the fallback, and no nowrap", () => {
    const long = ruleOf(".ov-num.long");
    expect(long).toMatch(
      /font-size:\s*1\.4rem;\s*font-size:\s*clamp\(1rem,\s*16\.5cqi,\s*1\.4rem\)/,
    );
    expect(long).not.toMatch(/white-space/);
    expect(ruleOf(".ov-tile")).toMatch(/container-type:\s*inline-size/);
  });
});

/**
 * P1-87 PR 7b: the three traffic charts on the page, over a 31-night axis. The search charts
 * hatch their last three days (the lag band); the visits chart's last day is drawn in outline.
 */
describe("P1-87 PR 7b: the traffic charts on the page", () => {
  const N = "2026-10-26";
  const nights = Array.from({ length: 32 }, (_, i) => {
    const d = new Date(Date.parse(`${N}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    return night(d, i === 0 ? { traffic: { value: trafficBlock(N) } as never } : {});
  });
  const VIEW = overviewFromSnapshot({ ...SNAP, nights }, NOW);
  const DOC7 = parse(pageHtml(VIEW));
  const section = DOC7.querySelector('section[aria-labelledby="ov-trends"]')!;
  const figs = section.querySelectorAll("figure.ov-trend");

  it("draws seven figures, and the search charts alone carry a lag band", () => {
    expect(figs).toHaveLength(7);
    for (const [i, f] of figs.entries()) {
      expect(f.querySelectorAll("svg.ov-chart rect.ov-lag"), `figure ${i}`).toHaveLength(
        i === 5 || i === 6 ? 1 : 0,
      );
    }
  });

  it("each lag band is drawn where the geometry puts it, hatched, every coordinate (PR 7b review round 1, tests major 1)", () => {
    // Its own fixture has the lag bands: the earlier "marks the geometry gives" test has no
    // traffic block, so it would pass with no band at all.
    for (const [i, f] of figs.entries()) {
      const g = trendGeometry(VIEW.trends.charts![i]!);
      const bands = f
        .querySelectorAll("svg.ov-chart rect.ov-lag")
        .map((r) => ["x", "y", "width", "height", "fill"].map((n) => r.getAttribute(n)));
      expect(bands, `figure ${i}`).toEqual(
        g.lag.map((l) => [
          String(l.x),
          String(g.top),
          String(l.width),
          String(g.baseline - g.top),
          "url(#ov-lag-hatch)",
        ]),
      );
    }
  });

  it("one hatch pattern on the page, one partial column, and the visits table's day header", () => {
    expect(section.querySelectorAll("pattern#ov-lag-hatch")).toHaveLength(1);
    expect(DOC7.querySelectorAll("path.ov-bar.partial")).toHaveLength(1);
    const head = figs[4]!.querySelectorAll(".ov-trend-table thead th").map(text);
    expect(head[0]).toBe("Day");
  });

  it("the partial column is drawn in outline: a muted stroke, dashed, so its shape differs from a solid column", () => {
    const css = readFileSync(
      new URL("../../src/lib/overview/overview.css", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    // Every rule for the partial column, in source order. A later rule overrides an earlier
    // one, so the value drawn is the last one for each property (PR 7b review round 2, T1).
    const bodies = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, sel]) => sel!.trim() === ".ov-bar.partial")
      .map(([, , body]) => body!);
    expect(bodies.length).toBeGreaterThan(0);
    const drawn = (prop: string) =>
      bodies
        .flatMap((b) =>
          [...b.matchAll(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+)`, "g"))].map((m) =>
            m[1]!.trim(),
          ),
        )
        .at(-1);
    expect(drawn("stroke")).toBe("var(--ink-muted)");
    expect(Number(drawn("stroke-width"))).toBeGreaterThan(0);
    const dash = (drawn("stroke-dasharray") ?? "").split(/\s+/).map(Number);
    expect(dash).toHaveLength(2);
    expect(dash.every((n) => n > 0)).toBe(true);
  });

  it("the visits table's last row says the column is still being counted", () => {
    const rows = figs[4]!.querySelectorAll(".ov-trend-table tbody tr");
    expect(rows.at(-1)!.querySelectorAll("th, td").map(text).join(" ")).toBe(
      "Oct 26 55, still being counted",
    );
  });

  it("the traffic leaves are on the page as sentinels, and no digit is typed in", () => {
    const ST = sentinelize(VIEW);
    const doc = parse(pageHtml(ST.view));
    const words = pageText(doc);
    const shown = new Set(shownNumbers(doc));
    // Arrays are keyed by letter, so charts 4, 5 and 6 (visits, times shown, clicks) are
    // [e], [f] and [g]. The count keeps this loop from passing on no leaves at all, as it
    // did when it read "charts.4".
    let checked = 0;
    for (const [path, v] of ST.at) {
      if (
        !path.startsWith("trends.charts[e]") &&
        !path.startsWith("trends.charts[f]") &&
        !path.startsWith("trends.charts[g]")
      )
        continue;
      if (path.endsWith(".term")) continue;
      checked++;
      const on = v.startsWith("⟦")
        ? words.includes(v)
        : TICK_PATH.test(path)
          ? words.includes(tickLabel(Number(v)))
          : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(20);
    const allowed = sentinelDigits(ST.at);
    expect(boundNumbers(doc, VIEW.reports.checks.length).filter((d) => !allowed.has(d))).toEqual(
      [],
    );
  });
});

/** P1-87 PR 7b item 1: a six-digit high draws as "600k", so it fits left of the plot at 390px. */
describe("P1-87 PR 7b item 1: a 600000 high is drawn as 600k and 300k", () => {
  const N = "2026-10-26";
  const nights = Array.from({ length: 32 }, (_, i) => {
    const d = new Date(Date.parse(`${N}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    if (i !== 0) return night(d);
    const block = trafficBlock(N) as {
      search: {
        value: {
          impressions: number;
          daily: Array<{ date: string; clicks: number; impressions: number }>;
        };
      };
    };
    const search = block.search.value;
    const daily = search.daily.map((x) => ({ ...x }));
    // Oct 1 is inside the 28 search days, so the impressions chart's largest day is 500000.
    // The window total moves by the same amount: the reader checks the days against it.
    const oct1 = daily.find((x) => x.date === "2026-10-01")!;
    const impressions = search.impressions + (500000 - oct1.impressions);
    oct1.impressions = 500000;
    return night(d, {
      traffic: {
        value: { ...block, search: { value: { ...search, impressions, daily } } },
      } as never,
    });
  });
  const VIEW = overviewFromSnapshot({ ...SNAP, nights }, NOW);
  const DOC = parse(pageHtml(VIEW));
  const figs = DOC.querySelectorAll('section[aria-labelledby="ov-trends"] figure.ov-trend');

  it("the impressions chart's high is 600000, and its first two y ticks read 600k and 300k", () => {
    expect(VIEW.trends.charts![5]!.high).toBe(600000);
    const ticks = figs[5]!.querySelectorAll("svg.ov-chart text.ov-tick").map(text);
    expect(ticks.slice(0, 2)).toEqual(["600k", "300k"]);
  });
});

describe("the site ticker on the overview (P1-87 PR 5b)", () => {
  // The ticker is the first screen's fourth block: one row of every maintained site.
  const section = (doc: HTMLElement) => doc.querySelector("section.ov-ticker")!;
  const lists = (doc: HTMLElement) => section(doc).querySelectorAll("ul.ov-ticker-list");
  const real = (doc: HTMLElement) => lists(doc).find((l) => !l.classList.contains("copy"))!;
  const copy = (doc: HTMLElement) => lists(doc).find((l) => l.classList.contains("copy"))!;

  it("has a heading, a pause button that is not pressed, and one row per site", () => {
    const sec = section(DOC);
    expect(text(sec.querySelector("h2")!)).toBe("Every site");
    const btn = sec.querySelector("button.ov-ticker-pause")!;
    expect(text(btn)).toBe("Pause the ticker");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(real(DOC).querySelectorAll("li")).toHaveLength(VIEW.ticker.length);
    expect(VIEW.ticker.length).toBe(3);
  });

  it("gives the copy that loops the row aria-hidden and inert", () => {
    expect(copy(DOC).getAttribute("aria-hidden")).toBe("true");
    expect(copy(DOC).hasAttribute("inert")).toBe(true);
    expect(real(DOC).hasAttribute("aria-hidden")).toBe(false);
    expect(copy(DOC).querySelectorAll("li")).toHaveLength(VIEW.ticker.length);
  });

  it("shows each site's tier word and fact, the broken site first", () => {
    const rows = real(DOC)
      .querySelectorAll("li")
      .map((li) => text(li));
    expect(rows[0]).toContain("Bravo");
    expect(rows[0]).toContain("Broken");
    expect(rows[0]).toContain(VIEW.ticker[0]!.fact);
    expect(real(DOC).querySelectorAll("li .pill").map(text)).toEqual(
      VIEW.ticker.map((t) => t.tierWord),
    );
  });

  it("names a site with no link without an anchor", () => {
    const view: OverviewView = {
      ...VIEW,
      ticker: [{ key: "x", name: "Nolink", tier: "ok", tierWord: "OK", fact: "f", href: null }],
    };
    const doc = parse(pageHtml(view));
    const li = real(doc).querySelector("li")!;
    expect(li.querySelector("a")).toBeNull();
    expect(text(li)).toContain("Nolink");
  });

  it("gives the OK pill the healthy class and a Broken pill the broken class", () => {
    const view: OverviewView = {
      ...VIEW,
      ticker: [
        { key: "a", name: "Okay", tier: "ok", tierWord: "OK", fact: "f", href: null },
        { key: "b", name: "Badly", tier: "broken", tierWord: "Broken", fact: "f", href: null },
      ],
    };
    const doc = parse(pageHtml(view));
    expect(
      real(doc)
        .querySelectorAll("li .pill")
        .map((p) => p.getAttribute("class")),
    ).toEqual(["pill healthy", "pill broken"]);
  });

  it("says so when no site is in our care", () => {
    const doc = parse(pageHtml({ ...VIEW, ticker: [] }));
    expect(text(section(doc))).toContain("No sites in our care yet.");
    expect(section(doc).querySelector("button")).toBeNull();
    expect(lists(doc)).toHaveLength(0);
  });

  it("is a How-we-count term", () => {
    expect(section(DOC).getAttribute("data-term")).toBe("Every site (the ticker)");
    const entry = HOW_WE_COUNT.find((h) => h.term === "Every site (the ticker)");
    expect(entry).toBeDefined();
    // r2 C: the entry says the row stands still as a list while a visitor moves through it by keyboard.
    expect(entry!.text).toContain(
      "While you move through it with the keyboard it stands still as a list.",
    );
  });

  it("renders its sentinels: every leaf of the ticker is on the page", () => {
    // The moving list only: the loop's copy must not supply a leaf the real list dropped.
    const shown = text(real(SDOC));
    for (const [path, v] of S.at) {
      if (!path.startsWith("ticker[")) continue;
      if (/\.(key|href|tier)$/.test(path)) continue;
      expect.soft(shown.includes(v), `${path} (${v}) is in the ticker`).toBe(true);
    }
  });
});

describe("the ticker's styles and speed (P1-87 PR 5b review r1 D)", () => {
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  /** The declarations of the reduced-motion block, which holds the still layout. */
  const reduced = (() => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    return "";
  })();

  /** The declarations of the forced-colours block, which holds the forced-colours rules. */
  const forced = (() => {
    const at = css.indexOf("@media (forced-colors: active)");
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    return "";
  })();

  it("keeps the pressed pause button's border 3px under forced colours, where its ink fill is gone (r2 C)", () => {
    const pressed = forced.match(/\.ov-ticker-pause\[aria-pressed="true"\]\s*\{([^}]*)\}/);
    expect(pressed).not.toBeNull();
    expect(pressed![1]).toMatch(/border-width:\s*3px/);
  });

  it("gives the pressed pause button 2px less padding on each side, so its outer size stays put (r3 D)", () => {
    const pressed = forced.match(/\.ov-ticker-pause\[aria-pressed="true"\]\s*\{([^}]*)\}/);
    expect(pressed).not.toBeNull();
    // max(0px, …) clamps a font under 10px, where the calc() would go negative (r4 nit); it changes
    // nothing at normal sizes.
    expect(pressed![1]).toMatch(
      /padding:\s*max\(0px,\s*calc\(0\.2em - 2px\)\)\s+max\(0px,\s*calc\(0\.7em - 2px\)\)/,
    );
  });

  it("shows the pause button pressed: an ink fill with on-ink text", () => {
    // Two rules name the pressed button now: this fill, and the forced-colours border (r2 C).
    // The fill is the one that carries a background.
    const pressed = [
      ...css.matchAll(/(?<=^|\})\s*\.ov-ticker-pause\[aria-pressed="true"\]\s*\{([^}]*)\}/g),
    ].find((m) => /background:/.test(m[1]!));
    expect(pressed).toBeDefined();
    expect(pressed![1]).toMatch(/background:\s*var\(--ink\)/);
    expect(pressed![1]).toMatch(/color:\s*var\(--on-ink\)/);
  });

  it("lays the still entries one per line under reduced motion", () => {
    const list = reduced.match(/(?<=^|\})\s*\.ov-ticker-list\s*\{([^}]*)\}/);
    expect(list).not.toBeNull();
    expect(list![1]).toMatch(/flex-direction:\s*column/);
    // Entries stand apart: a rem between them (r2 C). The focus block keeps the same values.
    expect(list![1]).toMatch(/gap:\s*1rem/);
  });

  it("gives each entry's own lines 0.25rem between them under reduced motion (r2 C)", () => {
    const li = reduced.match(/(?<=^|\})\s*\.ov-ticker-list li\s*\{([^}]*)\}/);
    expect(li).not.toBeNull();
    expect(li![1]).toMatch(/row-gap:\s*0\.25rem/);
  });

  it("lays the still entries one per line while a focus is inside the window", () => {
    // Held by the component (data-still) from a keyboard focus, with the no-script fallback
    // keyed on :focus-visible, not on any focus: r2 A, r4 A.
    const list = css.match(
      /\.ov-ticker-window\[data-still\] \.ov-ticker-list,\s*\.ov-ticker-window:not\(\[data-js\]\):has\(:focus-visible\) \.ov-ticker-list\s*\{([^}]*)\}/,
    );
    expect(list).not.toBeNull();
    expect(list![1]).toMatch(/flex-direction:\s*column/);
    expect(list![1]).toMatch(/gap:\s*1rem/);
  });

  it("gives each entry's own lines 0.25rem between them while a focus is inside the window (r2 C)", () => {
    const li = css.match(
      /\.ov-ticker-window\[data-still\] \.ov-ticker-list li,\s*\.ov-ticker-window:not\(\[data-js\]\):has\(:focus-visible\) \.ov-ticker-list li\s*\{([^}]*)\}/,
    );
    expect(li).not.toBeNull();
    expect(li![1]).toMatch(/row-gap:\s*0\.25rem/);
  });

  it("sets the row's speed by its text, with a floor of 20 seconds", () => {
    const entry = (i: number) => ({
      key: `k${i}`,
      name: "A",
      tier: "ok" as const,
      tierWord: "OK" as const,
      fact: "f".repeat(37),
      href: null,
    });
    const view: OverviewView = { ...VIEW, ticker: [entry(1), entry(2), entry(3)] };
    const doc = parse(pageHtml(view));
    expect(doc.querySelector("div.ov-ticker-run")!.getAttribute("style")).toContain(
      "--ov-ticker-s: 20s",
    );
  });

  // r2 E (R2-6): the page takes its speed from tickerSeconds, not from its own count. Three
  // entries of unequal length give 120 + 40 + 80 = 240 characters, so 36 seconds: a count, or
  // any per-entry formula that ignores the text, would not give 36.
  it("takes its speed from the ticker's text: three entries of unequal length give 36s", () => {
    const entry = (i: number, fact: number) => ({
      key: `k${i}`,
      name: "A",
      tier: "ok" as const,
      tierWord: "OK" as const,
      fact: "f".repeat(fact),
      href: null,
    });
    const view: OverviewView = {
      ...VIEW,
      ticker: [entry(1, 117), entry(2, 37), entry(3, 77)],
    };
    const doc = parse(pageHtml(view));
    expect(doc.querySelector("div.ov-ticker-run")!.getAttribute("style")).toContain(
      "--ov-ticker-s: 36s",
    );
  });
});

describe("the overview renders with an unreadable deploy date (P1-87 PR 5b)", () => {
  // r2 E nit: every bad date renders the page, not only "garbage".
  it.each(["garbage", "", "2026-13-45", "0", "12", "2026-02-30T12:00:00Z", "2026-13-01T12:00:00Z"])(
    "renders the page, and the ticker says no deploy is recorded, for a deploy date of %j",
    (bad) => {
      const s = snapshot({
        sites: [healthy({ id: "recK", name: "Kiln", pScore: null, lastDeployAt: bad })],
      });
      const doc = parse(pageHtml(overviewFromSnapshot(s, NOW)));
      const rows = doc.querySelectorAll("ul.ov-ticker-list:not(.copy) > li");
      expect(rows).toHaveLength(1);
      expect(text(rows[0]!)).toContain("no speed score or deploy recorded yet");
    },
  );
});

/** The media block whose query is `query`, as the bodies between its braces, in order. */
function mediaBodies(css: string, query: string): string[] {
  const out: string[] = [];
  for (let at = css.indexOf(query); at !== -1; at = css.indexOf(query, at + 1)) {
    let depth = 0;
    const open = css.indexOf("{", at);
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        out.push(css.slice(open + 1, i));
        break;
      }
    }
  }
  return out;
}

/** P1-87 PR 8a, item 3: the health bars fill on load, in check order (server render and CSS). */
describe("the overview's motion, on the server render (P1-87 PR 8a, item 3)", () => {
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const doc = parse(pageHtml(VIEW));
  const list = doc.querySelector(".ov-checks-list")!;
  const rows = list.querySelectorAll("li.ov-check");

  it("marks the list as the intro and gives each bar its index, in check order", () => {
    expect(list.getAttribute("data-intro")).toBe("");
    expect(list.getAttribute("style")).toContain(`--bar-ms: ${BAR_MS}ms`);
    expect(list.getAttribute("style")).toContain(`--bar-stagger: ${BAR_STAGGER_MS}ms`);
    expect(rows.map((li) => li.querySelector(".ov-check-name")!.text.trim())).toEqual([
      ...HEALTH_CHECK_NAMES,
    ]);
    expect(
      rows.map((li) => Number(/--i:\s*(\d+)/.exec(li.getAttribute("style") ?? "")?.[1])),
    ).toEqual(HEALTH_CHECK_NAMES.map((_, i) => i));
  });

  it("draws each fill at its model share of the bar, so the no-script end state is the model's", () => {
    rows.forEach((li, i) => {
      const c = VIEW.health.checks[i]!;
      const fill = li.querySelector(".ov-check-fill");
      if (c.pass === 0) {
        expect(fill).toBeNull();
        return;
      }
      const w = Number(/width:\s*([\d.]+)%/.exec(fill!.getAttribute("style") ?? "")?.[1]);
      expect(w).toBeCloseTo((100 * c.pass) / c.total, 9);
    });
  });

  it("keeps the bars' animation inside the no-preference query (the floor: reduced motion has none)", () => {
    const [motion] = mediaBodies(css, "@media (prefers-reduced-motion: no-preference)").filter(
      (b) => b.includes("ov-bar-fill"),
    );
    expect(motion, "a no-preference block holds the bar animation").toBeDefined();
    expect(motion).toMatch(/@keyframes ov-bar-fill\s*\{/);
    expect(motion).toMatch(
      /\.ov-checks-list\[data-intro\] \.ov-check-fill\s*\{[^}]*animation:\s*ov-bar-fill/,
    );
    expect(motion).toMatch(
      /\.ov-checks-list\[data-intro\] \.ov-check-unknown\s*\{[^}]*animation:\s*ov-bar-fill/,
    );
    // Control: outside the query, the animation is not declared at all.
    expect(css.replace(motion!, "")).not.toMatch(/animation:\s*ov-bar-fill/);
  });

  it("does not mark the first render's page as motion-ready (the script sets it on mount)", () => {
    expect(doc.querySelector(".ov-first")!.getAttribute("data-motion-ready")).toBeUndefined();
  });
});

/** P1-87 PR 8a, item 4: the count-up and the sparklines' draw-in (server render and CSS). */
describe("the number tiles' motion, on the server render (P1-87 PR 8a, item 4)", () => {
  const css = readFileSync(new URL("../../src/lib/overview/overview.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Prettier wraps long selectors over lines: the rules are matched on one line.
    .replace(/\s+/g, " ");
  const doc = parse(pageHtml(VIEW));
  const tiles = doc.querySelectorAll(".ov-tiles > .ov-tile");
  const numOf = (t: HTMLElement) => t.querySelector(".ov-num")!;

  it("gives every tile a visually hidden copy of the model's value, and hides the counting digits", () => {
    expect(tiles.length).toBe(VIEW.numbers.length);
    tiles.forEach((t, i) => {
      const hidden = t.querySelector(":scope > .visually-hidden");
      expect(hidden, `tile ${i} has its copy`).not.toBeNull();
      expect(text(hidden!)).toBe(VIEW.numbers[i]!.value);
      expect(numOf(t).getAttribute("aria-hidden")).toBe("true");
      expect(
        numOf(t).querySelector(".ov-num-final"),
        `tile ${i} keeps the model's text`,
      ).not.toBeNull();
      expect(numOf(t).querySelector(".ov-num-count")!.textContent).toBe("");
    });
  });

  it("keeps each figure's text the model's string, and marks only the measured countable ones", () => {
    tiles.forEach((t, i) => {
      const n = VIEW.numbers[i]!;
      expect(text(numOf(t)), n.key).toBe(n.value);
      const countable = n.measured && /^(\d+|\d{1,3}(,\d{3})+)$/.test(n.value);
      expect(numOf(t).hasAttribute("data-countable"), n.key).toBe(countable);
    });
    expect(tiles.filter((t) => numOf(t).hasAttribute("data-countable")).length).toBeGreaterThan(1);
  });

  it("starts the tiles' intro on a full load, and sets each sparkline's draw length to the constant", () => {
    const grid = doc.querySelector(".ov-tiles")!;
    expect(grid.getAttribute("data-intro")).toBe("");
    expect(grid.getAttribute("style")).toContain(`--spark-ms: ${SPARK_MS}ms`);
  });

  it("gives every sparkline polyline a path length of 1, so its dash runs the whole line", () => {
    // The checks tile draws its sparkline only over a run of nights: a fourteen-night fixture.
    const fourteen = Array.from({ length: 14 }, (_, i) =>
      night(
        new Date(Date.parse("2026-10-13T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10),
        {
          coverage: { value: { a: { value: i + 1 } } },
        },
      ),
    ).reverse();
    const sparkDoc = parse(pageHtml(overviewFromSnapshot(snapshot({ nights: fourteen }), NOW)));
    const lines = sparkDoc.querySelectorAll(".ov-spark polyline");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.getAttribute("pathLength")).toBe("1");
  });

  it("keeps the count and the draw-in inside the no-preference query (the floor: reduced motion has none)", () => {
    const motion = mediaBodies(css, "@media (prefers-reduced-motion: no-preference)").join("\n");
    expect(motion).toMatch(
      /\.ov-num\[data-counting\] \.ov-num-final\s*\{[^}]*visibility:\s*hidden/,
    );
    expect(motion).toMatch(
      /\.ov-tiles\[data-intro\] \.ov-spark polyline\s*\{[^}]*animation:\s*ov-spark-draw/,
    );
    expect(motion).toMatch(/@keyframes ov-spark-draw\s*\{/);
    expect(motion).toMatch(
      /html\.motion-intro \.ov-tiles\[data-intro\] \.ov-num\[data-countable\]/,
    );
    expect(motion).toMatch(/@keyframes ov-failsafe\s*\{/);
    let outside = css;
    for (const block of mediaBodies(css, "@media (prefers-reduced-motion: no-preference)"))
      outside = outside.replace(block, "");
    expect(outside).not.toMatch(/ov-spark-draw|ov-failsafe|data-counting|ov-spark-dot/);
  });
});

/** P1-87 PR 8a, item 7: a new feed line slides in on a refresh (server render and CSS). */
describe("the Lately feed's motion, on the server render (P1-87 PR 8a, item 7)", () => {
  const css = readFileSync(new URL("../../src/lib/overview/overview.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

  it("marks no line new on the first render, and gives the list the feed's duration", () => {
    const doc = parse(pageHtml(VIEW));
    expect(doc.querySelectorAll(".ov-lately li[data-new]")).toHaveLength(0);
    expect(doc.querySelector(".ov-lately ol")!.getAttribute("style")).toContain(
      `--feed-ms: ${FEED_MS}ms`,
    );
  });

  it("keeps the slide-in inside the no-preference query (the floor: reduced motion has none)", () => {
    const motion = mediaBodies(css, "@media (prefers-reduced-motion: no-preference)").join("\n");
    expect(motion).toMatch(/\.ov-lately li\[data-new\]\s*\{[^}]*animation:\s*ov-feed-in/);
    expect(motion).toMatch(/@keyframes ov-feed-in\s*\{/);
    let outside = css;
    for (const block of mediaBodies(css, "@media (prefers-reduced-motion: no-preference)"))
      outside = outside.replace(block, "");
    expect(outside).not.toMatch(/ov-feed-in|data-new/);
  });
});

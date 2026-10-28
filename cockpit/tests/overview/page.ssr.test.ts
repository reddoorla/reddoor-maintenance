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
  trendGeometry,
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
  it("has the eight sections, each under its h2", () => {
    expect(DOC.querySelectorAll("h2").map(text)).toEqual([
      "Status",
      "Is every site live?",
      "Leads",
      "Client reports",
      "What runs every night",
      "Upkeep",
      "How changes ship",
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
      p.startsWith("status.counts.") ||
      p === "status.line" ||
      p === "status.cls" ||
      p === "leads.thisMonth.submissions" ||
      p === "reports.sent.testSends" ||
      /\.(siteId|key|url|href|term|tier|atIso)$/.test(p);
    let checked = 0;
    for (const [path, v] of S.at) {
      if (unrendered(path)) continue;
      checked++;
      const on = v.startsWith("⟦") ? words.includes(v) : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(120);
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

  it("each Live-table cell reads its own field", () => {
    const rows = SDOC.querySelectorAll(".ov-live tbody tr");
    expect(rows.length).toBe(SV.live.length);
    rows.forEach((tr, i) => {
      const p = `live[${letters(i)}]`;
      const cell = (label: string) => text(tr.querySelector(`td[data-label="${label}"]`)!);
      expect(text(tr.querySelector("th")!)).toBe(sent(`${p}.siteName`));
      expect(cell("Live")).toBe(`${sent(`${p}.live.text`)}, checked ${sent(`${p}.live.at`)}`);
      expect(cell("Certificate")).toBe(sent(`${p}.domain.text`));
      expect(cell("Deploy")).toBe(sent(`${p}.deploy.text`));
      expect(cell("Forms")).toBe(`${sent(`${p}.forms.text`)}; ${sent(`${p}.lastLead`)}`);
      expect(cell("Level")).toBe(sent(`${p}.level.text`));
    });
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

  it("the reports section reads each field: checks, medians, sends, due and waiting", () => {
    const dts = SDOC.querySelectorAll(".ov-checks dt").map(text);
    const dds = SDOC.querySelectorAll(".ov-checks dd").map(text);
    expect(dts).toEqual(
      SV.reports.checks.map((_, i) => sent(`reports.checks[${letters(i)}].name`)),
    );
    expect(dds).toEqual(
      SV.reports.checks.map((_, i) => sent(`reports.checks[${letters(i)}].proof`)),
    );
    expect(one('p[data-term="Reports sent"]')).toBe(
      `${sent("reports.sent.real")} reports sent to clients: ${sent("reports.sent.approvedFirst")} approved by one of us before sending, and ${sent("reports.sent.aroundGate")} without that yes.`,
    );
    const lh = one('p[data-term="Lighthouse"]');
    SV.reports.lighthouse.forEach((_, i) =>
      expect(lh).toContain(
        `${sent(`reports.lighthouse[${letters(i)}].label`)} ${sent(`reports.lighthouse[${letters(i)}].median`)}`,
      ),
    );
    expect(lh).toContain(`, from audits as old as ${sent("reports.lighthouseAsOf")}.`);
    const rows = SDOC.querySelectorAll(".ov-due tbody tr");
    expect(rows.length).toBe(SV.reports.perSite.length);
    rows.forEach((tr, i) => {
      const p = `reports.perSite[${letters(i)}]`;
      expect(text(tr.querySelector("th")!)).toBe(sent(`${p}.siteName`));
      expect(text(tr.querySelector('td[data-label="Next due"]')!)).toBe(sent(`${p}.nextDue`));
      expect(text(tr.querySelector('td[data-label="Waiting"]')!)).toBe(sent(`${p}.waiting`));
    });
  });

  it("the nightly section reads its times, scale, reliability and each step's slots", () => {
    const span = (term: string) =>
      one(`section[aria-labelledby="ov-nightly"] span[data-term="${term}"]`);
    expect(span("Times")).toBe(
      `The nightly starts at ${sent("nightly.startsAt")}. Approved reports send at ${sent("nightly.sendsAt")}.`,
    );
    expect(span("Scale")).toBe(`Scale: ${sent("nightly.scale")}.`);
    expect(span("Runs completed")).toBe(`Runs completed: ${sent("nightly.reliability")}.`);
    const steps = SDOC.querySelectorAll(".ov-steps li");
    expect(steps.length).toBe(SV.nightly.steps.length);
    steps.forEach((li, i) => {
      const p = `nightly.steps[${letters(i)}]`;
      expect(text(li.querySelector(".ov-step-name")!)).toBe(sent(`${p}.label`));
      expect(text(li.querySelector(".muted")!)).toBe(
        `${sent("nightly.nightOf")}: ${sent(`${p}.outcome`)}. Last finished: ${sent(`${p}.lastFinished`)}. Reached: ${sent(`${p}.sites`)}.`,
      );
    });
  });

  it("the upkeep lines, the open vulnerabilities and the changes merged read their own fields", () => {
    const li = (term: string) =>
      one(`section[aria-labelledby="ov-upkeep"] li[data-term="${term}"]`);
    expect(li("Dependency updates merged")).toBe(
      `Dependency updates merged (opened by Renovate, our update bot): ${sent("upkeep.automerged")}.`,
    );
    expect(li("Sites cleared of vulnerabilities")).toBe(
      `Sites cleared of every critical or high vulnerability: ${sent("upkeep.vulnsCleared")}.`,
    );
    expect(li("Major-version upgrades waiting")).toBe(
      `Major-version upgrades waiting: ${sent("upkeep.depsBehind")}.`,
    );
    expect(SDOC.querySelectorAll('ul[data-term="Open now"] li').map(text)).toEqual(
      SV.upkeep.open.map(
        (_, i) =>
          `${sent(`upkeep.open[${letters(i)}].siteName`)} ${sent(`upkeep.open[${letters(i)}].text`)}.`,
      ),
    );
    expect(one('p[data-term="PRs merged"]')).toBe(
      `PRs merged into the maintenance stack (the code that runs these checks and sends the reports): ${sent("prsMerged")}.`,
    );
    expect(one('.ov-how p[data-term="Nights counted"]')).toBe(
      `The nightly has written ${sent("nightsCollected")} of counts so far.`,
    );
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

  it("a failed form test is in the unknown style, and says it is not yet a verdict (O1)", () => {
    const doc = parse(
      pageHtml(
        overviewFromSnapshot(
          snapshot({ sites: [healthy({ id: "recA", name: "Acme", formE2eOk: "fail" })] }),
          NOW,
        ),
      ),
    );
    const td = doc.querySelector('.ov-live td[data-label="Forms"]')!;
    expect(td.getAttribute("class")).toBe("unknown");
    expect(text(td)).toBe(
      "Test failed, but the test itself is being fixed, so this is not yet a verdict; no real lead yet",
    );
    expect(text(doc.querySelector('.ov-live td[data-label="Level"]')!)).toBe("OK");
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

describe("review round 4: emphasis, the none-open sentence, and the shipping copy", () => {
  it("a failed cell is bold, and the status band is the Broken one (T4)", () => {
    const bravo = DOC.querySelectorAll(".ov-live tbody tr").find((tr) =>
      text(tr).startsWith("Bravo"),
    )!;
    expect(bravo.querySelector('td[data-label="Live"]')!.getAttribute("class")).toBe("bad");
    const acme = DOC.querySelectorAll(".ov-live tbody tr").find((tr) =>
      text(tr).startsWith("Acme"),
    )!;
    expect(acme.querySelector('td[data-label="Live"]')!.getAttribute("class")).toBe("ok");
    expect(DOC.querySelector("section.ov-status")!.classList.contains("broken")).toBe(true);
    // Control: a quiet page's band is not.
    const quiet = parse(pageHtml(overviewFromSnapshot(snapshot(), NOW)));
    expect(quiet.querySelector("section.ov-status")!.classList.contains("ok")).toBe(true);
  });

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

  it("glosses a pull request, and says who promotes staging (O9, O10)", () => {
    const ship = text(DOC.querySelector('section[aria-labelledby="ov-ship"]')!);
    expect(ship).toContain("each as a pull request (PR)");
    expect(ship).toContain("when one of us promotes staging");
    expect(ship).not.toContain("when you promote");
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
  const allowed = new Set(S.at.values());
  const n = SV.reports.checks.length;
  const stray = (html: string) => boundNumbers(parse(html), n).filter((d) => !allowed.has(d));

  it("every digit run outside How we count's definitions is a sentinel", () => {
    expect(boundNumbers(SDOC, n).length).toBeGreaterThan(20);
    expect(stray(pageHtml(SV))).toEqual([]);
  });

  it("is an instrument that can fail: a number typed into an existing element is caught", () => {
    const html = pageHtml(SV);
    expect(html).toContain("Runs completed: ");
    expect(stray(html.replace("Runs completed: ", "Runs completed: 30 nights, "))).toEqual(["30"]);
    // The page's own fixed values typed elsewhere are caught too.
    expect(
      stray(html.replace("Runs completed: ", `Runs completed: ${n} steps, 100 runs, `)),
    ).toEqual([String(n), "100"]);
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

  it("draws four charts, each an image with a name and a description", () => {
    expect(TVIEW.trends.charts).toHaveLength(4);
    const figs = section.querySelectorAll("figure.ov-trend");
    expect(figs.map((f) => text(f.querySelector("figcaption")!))).toEqual(
      TVIEW.trends.charts!.map((c) => c.title),
    );
    for (const [i, f] of figs.entries()) {
      const svg = f.querySelector("svg.ov-chart")!;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-labelledby")).toBe(`ov-trend-${i} ov-trend-${i}-desc`);
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
            `${label} ${c.series.map((s) => s.points[k]!.value ?? s.points[k]!.note).join(" ")}`,
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
      expect(attrs("circle.ov-dot", ["cx", "cy"])).toEqual(
        g.dots.map((d) => [String(d.x), String(d.y)]),
      );
      expect(attrs("rect.ov-earlier", ["x", "width", "height"])).toEqual(
        g.earlier.map((e) => [String(e.x), String(e.width), String(g.baseline - g.top)]),
      );
      expect(attrs("line.ov-break", ["x1", "x2"])).toEqual(
        g.breaks.map((x) => [String(x), String(x)]),
      );
    }
    // The fixture reaches every kind of mark.
    const all = TVIEW.trends.charts!.map((c) => trendGeometry(c));
    for (const k of ["bars", "lines", "dots", "earlier", "breaks"] as const)
      expect(
        all.some((g) => g[k].length > 0),
        k,
      ).toBe(true);
    expect(TVIEW.trends.charts![0]!.series).toHaveLength(2);
  });

  it("every hover target names its night", () => {
    const fig = section.querySelectorAll("figure.ov-trend")[0]!;
    const titles = fig.querySelectorAll("rect.ov-hit title").map(text);
    expect(titles).toHaveLength(17);
    expect(titles).toContain("Oct 20: no count that night");
  });

  it("every number in the section came from the view, and has its How-we-count line", () => {
    const allowed = new Set([...(JSON.stringify({ TVIEW, HOW_WE_COUNT }).match(/\d+/g) ?? [])]);
    expect(shownNumbers(TDOC).filter((d) => !allowed.has(d))).toEqual([]);
    const terms = new Set(TDOC.querySelectorAll(".ov-how dt").map(text));
    for (const e of TDOC.querySelectorAll("[data-term]"))
      expect(terms).toContain(e.getAttribute("data-term"));
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
      const on = v.startsWith("⟦") ? words.includes(v) : shown.has(v);
      expect.soft(on, `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(150);
    const allowed = new Set(ST.at.values());
    const n = ST.view.reports.checks.length;
    expect(boundNumbers(doc, n).filter((d) => !allowed.has(d))).toEqual([]);
  });
});

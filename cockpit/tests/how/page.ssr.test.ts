import { describe, it, expect } from "vitest";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { parse, TextNode, type HTMLElement, type Node } from "node-html-parser";
import Layout from "../../src/routes/+layout.svelte";
import HowPage from "../../src/routes/how/+page.svelte";
import { load as howLoad } from "../../src/routes/how/+page.js";
import { howFromSnapshot, ladder, type HowView } from "../../src/lib/how/view.js";
import { HOW_WE_COUNT, LADDER_LINES, NIGHTLY_STEPS } from "../../src/lib/overview/view.js";
import { NAV_ITEMS } from "../../src/lib/nav.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { withoutComments } from "../legacy/render.js";
import { NOW, FRESH, healthy, night, report, snapshot } from "../overview/fixtures.js";

/**
 * P1-87 PR 1: "How this works", rendered inside the real layout from a real view,
 * as a visitor receives it (workspace plans/2026-11-16-p1-87-overview-reorg/plan.md,
 * list item 5). The overview's model pins the numbers; these pin that this page
 * shows them in its five chapters, types none of its own, and defines each.
 */

const SNAP = snapshot({
  sites: [
    healthy({ id: "recA", name: "Acme", pScore: 91, rScore: 97, bpScore: 88, seoScore: 99 }),
    healthy({ id: "recB", name: "Bravo" }),
  ],
  submissions: [
    ...Array.from({ length: 4 }, (_, i) =>
      makeSubmissionRow({
        id: `n${i}`,
        siteId: "recA",
        status: "read",
        notifyStatus: "sent",
        submittedAt: "2026-10-10T12:00:00.000Z",
      }),
    ),
    makeSubmissionRow({ id: "a1", siteId: "recB", status: "new", submittedAt: FRESH }),
    ...["s1", "s2", "s3"].map((id) =>
      makeSubmissionRow({
        id,
        siteId: "recA",
        status: "spam_auto",
        submittedAt: "2026-07-02T12:00:00.000Z",
      }),
    ),
  ],
  reports: [report({ id: "sent1" }), report({ id: "sent2", approvedAt: null })],
  nights: [night("2026-10-26"), night("2026-10-25", { prsMerged: { value: 590 } })],
});

function pageHtml(view: HowView, email: string | null = null): string {
  const inner = render(HowPage, { props: { data: { view } } });
  const children = createRawSnippet(() => ({ render: () => inner.body }));
  const outer = render(Layout, { props: { data: { email, path: "/how" }, children } });
  return withoutComments(`<!doctype html><html><head>${outer.head}${inner.head}</head>
<body><div style="display: contents">${outer.body}</div></body></html>`);
}

const VIEW = howFromSnapshot(SNAP, NOW);
const HTML = pageHtml(VIEW);
const DOC = parse(HTML);
const text = (el: HTMLElement) => el.textContent.replace(/\s+/g, " ").trim();
const one = (doc: HTMLElement, sel: string): string => {
  const el = doc.querySelector(sel);
  if (el === null) throw new Error(`no element ${sel}`);
  return text(el);
};

describe("the page sits beside the overview in the nav", () => {
  it("the nav reads Overview · How this works · Triage · Sites · Inbox · Audits", () => {
    expect(NAV_ITEMS.map((n) => [n.label, n.href])).toEqual([
      ["Overview", "/"],
      ["How this works", "/how"],
      ["Triage", "/triage"],
      ["Sites", "/fleet"],
      ["Inbox", "/submissions"],
      ["Audits", "/audits"],
    ]);
  });

  it("lights How this works, and only it, on /how", () => {
    const current = DOC.querySelectorAll('nav a[aria-current="page"]').map(text);
    expect(current).toEqual(["How this works"]);
  });

  it("a store failure reaches the page's own load as its error", async () => {
    let thrown: unknown;
    try {
      await (howLoad as (e: unknown) => unknown)({
        parent: async () => ({
          snapshot: null,
          failure: { status: 500, message: "Turso env missing" },
          clockOffsetMs: 0,
        }),
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status?: number }).status).toBe(500);
  });
});

describe("five chapters, each with its diagram", () => {
  it("has the five chapters in the story's order", () => {
    expect(DOC.querySelectorAll(".how-kicker").map(text)).toEqual([
      "Every night",
      "When something is wrong",
      "A lead's journey",
      "The client report",
      "How changes ship",
    ]);
    expect(DOC.querySelectorAll("section.how-chapter")).toHaveLength(5);
    for (const s of DOC.querySelectorAll("section.how-chapter"))
      expect(s.querySelector("ol, ul"), text(s.querySelector("h2")!)).not.toBeNull();
  });

  it("chapter 1 draws every nightly step, in run order, with last night's outcome", () => {
    const steps = DOC.querySelectorAll(".how-steps li");
    expect(steps.map((li) => text(li.querySelector("strong")!))).toEqual(
      NIGHTLY_STEPS.map((s) => s.short),
    );
    for (const [i, li] of steps.entries())
      expect(text(li)).toContain(`${VIEW.nightly.nightOf}: ${VIEW.nightly.steps[i]!.outcome}`);
    expect(VIEW.nightly.steps[0]!.outcome).toBe("ran to the end");
  });

  it("chapter 2 shows the ladder's four levels, mildest first, in the overview's words", () => {
    const levels = DOC.querySelectorAll(".how-ladder li");
    expect(levels.map((l) => l.getAttribute("class"))).toEqual([
      "ok",
      "watch",
      "attention",
      "broken",
    ]);
    for (const l of levels) {
      // The text is the line's own, capitalised to stand alone in its box.
      const line = `${text(l.querySelector("strong")!)}: ${text(l.querySelector("span")!)}`;
      expect(LADDER_LINES.map((x) => x.toLowerCase())).toContain(line.toLowerCase());
      expect(text(l.querySelector("span")!)).toMatch(/^[A-Z]/);
    }
  });

  it("the ladder fails loudly if a level's line goes missing", () => {
    const saved = [...LADDER_LINES];
    (LADDER_LINES as string[]).splice(1, 1);
    try {
      expect(() => ladder()).toThrow(/no ladder line/);
    } finally {
      (LADDER_LINES as string[]).splice(0, LADDER_LINES.length, ...saved);
    }
  });

  it("chapter 3 follows a lead with the real counts, and names no lead", () => {
    const flow = DOC.querySelectorAll(
      "#how-lead ~ .how-flow li, section:has(#how-lead) .how-flow li",
    );
    const words = flow.map(text).join(" | ");
    expect(words).toContain(`Spam screened ${VIEW.leads.allTime!.screened} set aside`);
    expect(words).toContain(`Kept as real ${VIEW.leads.allTime!.accepted} leads`);
    expect(words).toContain(`The client is emailed ${VIEW.leads.allTime!.notified} delivered`);
    expect(words).toContain(`Bots stopped ${VIEW.leads.stoppedAllTime} never stored`);
    expect(VIEW.leads.allTime).toMatchObject({ screened: 3, accepted: 5, notified: 4 });
    expect(VIEW.leads.stoppedAllTime).toBe("248");
  });

  it("chapter 4 lists every check a report carries, with the step that proves it", () => {
    const names = DOC.querySelectorAll(".how-checks dt").map(text);
    expect(names).toEqual(VIEW.reports.checks.map((c) => c.name));
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(one(DOC, "section:has(#how-report)")).toContain(
      `${VIEW.reports.sent!.approvedFirst} of ${VIEW.reports.sent!.real} approved before sending`,
    );
    expect(VIEW.reports.sent).toMatchObject({ real: 2, approvedFirst: 1 });
  });

  it("chapter 5 says how many PRs merged, from the nightly counts", () => {
    expect(one(DOC, "section:has(#how-ship)")).toContain(`: ${VIEW.prsMerged}.`);
    expect(VIEW.prsMerged).toMatch(/^10 over/);
  });
});

describe("How we count", () => {
  it("defines every term the overview defines, in its order", () => {
    expect(DOC.querySelectorAll(".how-count dt").map(text)).toEqual(
      HOW_WE_COUNT.map((h) => h.term),
    );
  });

  it("every label the page marks as a count has its line", () => {
    const terms = new Set(HOW_WE_COUNT.map((h) => h.term));
    const marked = DOC.querySelectorAll("[data-term]").map((e) => e.getAttribute("data-term")!);
    expect(marked.length).toBeGreaterThan(8);
    expect(marked.filter((t) => !terms.has(t))).toEqual([]);
  });
});

/**
 * No count typed into the page: every number in the view is replaced by its own
 * sentinel (80001 and up) and every string by a marked one, so a digit run on the
 * page that is not a sentinel was typed into the template, and a sentinel that is
 * missing was dropped.
 */
function sentinelize(view: HowView): { view: HowView; at: Map<string, string> } {
  const at = new Map<string, string>();
  let next = 80001;
  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "number") {
      const n = String(next++);
      at.set(path, n);
      return Number(n);
    }
    if (typeof v === "string") {
      const m = `⟦${path}⟧`;
      at.set(path, m);
      return m;
    }
    if (Array.isArray(v))
      return v.map((x, i) => walk(x, `${path}[${String.fromCharCode(97 + i)}]`));
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x, path ? `${path}.${k}` : k)]),
      );
    return v;
  };
  return { view: walk(view, "") as HowView, at };
}

/** Digit runs in text and attributes below the header, outside How we count's
 *  definitions, which are the explanation, not counts. */
function digits(doc: HTMLElement): string[] {
  const runs: string[] = [];
  const walk = (n: Node) => {
    if (n instanceof TextNode) runs.push(n.text);
    else {
      const el = n as HTMLElement;
      if (el.classList?.contains("how-count")) return;
      if (el.attributes) runs.push(...Object.values(el.attributes));
      for (const c of n.childNodes) walk(c);
    }
  };
  for (const el of doc.querySelectorAll("h1, .how-lede, section, details")) walk(el);
  return runs.join(" | ").match(/\d+/g) ?? [];
}

const S = sentinelize(VIEW);
const SHTML = pageHtml(S.view);
const SDOC = parse(SHTML);
const checksShown = String(S.view.reports.checks.length);

describe("no count is typed into the page (the sentinel render)", () => {
  const allowed = new Set([...S.at.values(), checksShown]);
  const stray = (html: string) => digits(parse(html)).filter((d) => !allowed.has(d));

  it("every digit run on the page is a sentinel", () => {
    expect(digits(SDOC).length).toBeGreaterThan(5);
    expect(stray(SHTML)).toEqual([]);
  });

  it("every leaf the page is meant to show is on it", () => {
    const words = SDOC.querySelectorAll("h1, .how-lede, section").map(text).join(" ");
    // The ladder's tier is its class; the leads' per-site rows, this month and the
    // biggest share belong to the overview; the steps' last-finished and reach are
    // the overview's table, not this diagram.
    const unrendered = (p: string) =>
      /^ladder\[[a-z]\]\.tier$/.test(p) ||
      p.startsWith("leads.perSite") ||
      p.startsWith("leads.thisMonth") ||
      p.startsWith("leads.biggest") ||
      p === "leads.stoppedThisMonth" ||
      p === "leads.allTime.byHand" ||
      /^nightly\.steps\[[a-z]\]\.(lastFinished|sites)$/.test(p) ||
      p === "reports.sent.aroundGate" ||
      p === "reports.sent.testSends";
    let checked = 0;
    for (const [path, v] of S.at) {
      if (unrendered(path)) continue;
      checked++;
      expect.soft(words.includes(v), `${path} (${v}) is on the page`).toBe(true);
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("is an instrument that can fail: a typed number is caught", () => {
    expect(SHTML).toContain("Runs completed");
    expect(stray(SHTML.replace("<h1>How this works", "<h1>How this works in 21 nights"))).toEqual([
      "21",
    ]);
  });
});

describe("everyone signed in sees the same page", () => {
  it("only the header differs between the operator, Erik and Tim", () => {
    const below = (html: string) => html.slice(html.indexOf("</header>"));
    const op = pageHtml(VIEW, "op@reddoor.example");
    const erik = pageHtml(VIEW, "erik@reddoor.example");
    expect(below(erik)).toBe(below(op));
    expect(op).not.toBe(erik);
  });
});

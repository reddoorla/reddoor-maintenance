import { describe, it, expect, vi, afterEach } from "vitest";
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
 * shows them in its five chapters, each under its own label, types none of its
 * own, and names no lead.
 */

/** The newest night: every step ran to the end but the smoke step, which failed,
 *  so a step paired with another step's result shows. */
const NEWEST = night("2026-10-26");
NEWEST.counts.steps = {
  ...NEWEST.counts.steps,
  "fleet-smoke.yml": { outcome: "completed", runId: 1, conclusion: "failure" },
};

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
  nights: [NEWEST, night("2026-10-25", { prsMerged: { value: 590 } })],
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
  it("has the five chapters in the story's order, each kicker inside its heading group", () => {
    expect(DOC.querySelectorAll("hgroup > .how-kicker").map(text)).toEqual([
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

  it("chapter 1 draws every nightly step, in run order, with that step's own result from the newest night", () => {
    expect(VIEW.nightly.nightOf).toBe("Night of Oct 26");
    const steps = DOC.querySelectorAll(".how-steps li");
    expect(steps.map((li) => text(li.querySelector("strong")!))).toEqual(
      NIGHTLY_STEPS.map((s) => s.short),
    );
    expect(steps.map((li) => text(li.querySelector(".how-step-what")!))).toEqual(
      NIGHTLY_STEPS.map((s) => s.label),
    );
    expect(steps.map((li) => text(li.querySelector(".how-step-last")!))).toEqual(
      NIGHTLY_STEPS.map((s) =>
        s.file === "fleet-smoke.yml"
          ? "Night of Oct 26: failed"
          : "Night of Oct 26: ran to the end",
      ),
    );
  });

  it("chapter 1 labels its scale and runs completed, so a missing value still says what it is", () => {
    const figures = one(DOC, ".how-figures");
    expect(figures).toBe(
      `Scale: ${VIEW.nightly.scale}. Runs completed: ${VIEW.nightly.reliability}.`,
    );
    expect(VIEW.nightly.reliability).toBe(
      "15 of 16 nightly steps ran to the end over the last 2 nights",
    );
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
      // The box's level (its colour) is the level it names.
      expect(l.getAttribute("class")).toBe(text(l.querySelector("strong")!).toLowerCase());
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

  it("chapter 3 follows a lead with the real counts", () => {
    const flow = DOC.querySelectorAll("section:has(#how-lead) .how-flow li").map(text);
    expect(flow).toEqual([
      "A visitor submits a form on a client's site",
      "Bots stopped 248 never stored, as of Oct 26",
      "Spam screened 3 set aside",
      "Kept as real 5 leads, signups and RSVPs",
      "The client is emailed 4 emailed",
    ]);
    expect(one(DOC, 'section:has(#how-lead) p[data-term="Submissions"]')).toMatch(
      /^8 submissions in all since /,
    );
    // What happens when an email fails is said as it is: no retry is claimed.
    expect(one(DOC, "section:has(#how-lead) .how-branch")).not.toMatch(/retr/i);
  });

  it("names no lead: no name, email or message from any submission is on the page", () => {
    const leads = SNAP.submissions!;
    expect(leads.length).toBeGreaterThan(0);
    for (const r of leads)
      for (const field of [r.name, r.email, r.message])
        if (field) expect(HTML, field).not.toContain(field);
    // The control: the fixture's rows do carry these details.
    expect(leads[0]!.email).toBe("jane@example.com");
  });

  it("chapter 4 lists every check a report carries, with the step that proves it", () => {
    const names = DOC.querySelectorAll(".how-checks dt").map(text);
    expect(names).toEqual(VIEW.reports.checks.map((c) => c.name));
    expect(names.length).toBeGreaterThanOrEqual(6);
    // Each check sits beside its own proof, read from the report's own step numbers.
    const pairs = DOC.querySelectorAll(".how-checks dt").map((dt) => [
      text(dt),
      text(dt.nextElementSibling!),
    ]);
    expect(Object.fromEntries(pairs)).toMatchObject({
      "Security Updates": expect.stringMatching(/^Step 4 lists known vulnerabilities/),
      "Google Indexed": expect.stringMatching(/^Step 8 asks Google Search Console/),
      "CMS Checked":
        "Step 5 checks the CMS answers; step 2 checks its content models match the site's code.",
    });
    expect(one(DOC, 'p[data-term="Checks per report"]')).toContain(
      `carries ${names.length} checks`,
    );
    expect(one(DOC, 'section:has(#how-report) [data-term="Reports sent"]')).toBe(
      "Read by one of us 1 of 2 approved before sending",
    );
  });

  it("chapter 4's count of checks follows the model, not a typed number", () => {
    const three = {
      ...VIEW,
      reports: { ...VIEW.reports, checks: VIEW.reports.checks.slice(0, 3) },
    };
    const doc = parse(pageHtml(three));
    expect(doc.querySelectorAll(".how-checks dt")).toHaveLength(3);
    const sentence = one(doc, 'p[data-term="Checks per report"]');
    expect(sentence).toContain("carries 3 checks");
    // Its only number is the count: no step count typed beside it, in digits or words.
    expect(sentence.match(/\d+/g)).toEqual(["3"]);
    expect(sentence.match(NUMBER_WORDS)).toBeNull();
  });

  it("chapter 5 says how many PRs merged, from the nightly counts", () => {
    expect(one(DOC, 'section:has(#how-ship) [data-term="PRs merged"]')).toContain(
      `: ${VIEW.prsMerged}.`,
    );
    expect(VIEW.prsMerged).toMatch(/^10 over/);
  });
});

describe("when a read failed, no count is shown in its place", () => {
  const FAILED: HowView = {
    ...VIEW,
    leads: { ...VIEW.leads, allTime: null, stoppedAllTime: "not readable", stoppedAsOf: null },
    reports: { ...VIEW.reports, sent: null },
  };
  const doc = parse(pageHtml(FAILED));

  it("the lead's journey says it could not be read, and shows no number", () => {
    const lead = one(doc, "section:has(#how-lead)");
    expect(lead).toContain("The submissions could not be read just now.");
    expect(lead).toContain("Bots stopped not readable");
    expect(lead).not.toContain("never stored");
    expect(lead).not.toMatch(/\d/);
  });

  it("the report's flow says it could not be read, and shows no number", () => {
    const flow = one(doc, "section:has(#how-report) .how-flow");
    expect(flow).toContain("the reports could not be read just now");
    expect(flow).not.toMatch(/\d/);
  });

  it("a stopped count not yet collected reads as such, without 'never stored'", () => {
    const d = parse(
      pageHtml({ ...VIEW, leads: { ...VIEW.leads, stoppedAllTime: "not yet collected" } }),
    );
    expect(one(d, 'section:has(#how-lead) [data-term="Stopped before storage"]')).toBe(
      "Bots stopped not yet collected",
    );
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
 * The sentinel render: every number in the view is replaced by its own sentinel
 * (80001 and up) and every string by a marked one. A digit run on the page that is
 * not a sentinel was typed into the template; a sentinel under the wrong label was
 * bound to the wrong field.
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

/** Everything below the shell's header, less How we count's definitions (the
 *  explanation, not counts) and the one count the page derives itself (how many
 *  checks, held by its own test above). */
function shown(doc: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: HTMLElement) => {
    if (el.tagName === "HEADER" || el.tagName === "STYLE") return;
    if (el.tagName === "DD" && el.closest(".how-count") !== null) return;
    if (el.getAttribute?.("data-term") === "Checks per report" && el.tagName === "P") return;
    out.push(el);
    for (const c of el.childNodes) if (!(c instanceof TextNode)) walk(c as HTMLElement);
  };
  walk(doc.querySelector("body")!);
  return out;
}

function digits(doc: HTMLElement): string[] {
  const runs: string[] = [];
  for (const el of shown(doc)) {
    runs.push(...Object.values(el.attributes ?? {}));
    for (const c of el.childNodes) if (c instanceof TextNode) runs.push(c.text);
  }
  // A Svelte scoped-style class ("svelte-w04uvf") is a build hash, not a count.
  return (
    runs
      .join(" | ")
      .replace(/svelte-[a-z0-9]+/g, "")
      .match(/\d+/g) ?? []
  );
}

const NUMBER_WORDS =
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|dozen|hundred|thousand)\b/gi;
function numberWords(doc: HTMLElement): string[] {
  return (
    shown(doc)
      .flatMap((el) => el.childNodes.filter((c) => c instanceof TextNode).map((c) => c.text))
      .join(" ")
      .match(NUMBER_WORDS) ?? []
  );
}

/** The label a sentinel sits under: the nearest `data-term` above its text. */
function termOf(doc: HTMLElement, sentinel: string): string | null {
  let found: string | null | undefined;
  const walk = (n: Node) => {
    if (found !== undefined) return;
    if (n instanceof TextNode) {
      if (n.text.includes(sentinel))
        found =
          (n.parentNode as HTMLElement).closest("[data-term]")?.getAttribute("data-term") ?? null;
    } else for (const c of n.childNodes) walk(c);
  };
  walk(doc.querySelector("body")!);
  if (found === undefined) throw new Error(`${sentinel} is not on the page`);
  return found;
}

const S = sentinelize(VIEW);
const SHTML = pageHtml(S.view);
const SDOC = parse(SHTML);
const sent = (path: string): string => {
  const v = S.at.get(path);
  if (v === undefined) throw new Error(`no sentinel at ${path}`);
  return v;
};

describe("no count is typed into the page (the sentinel render)", () => {
  const allowed = new Set(S.at.values());
  const stray = (html: string) => digits(parse(html)).filter((d) => !allowed.has(d));

  it("every digit run below the header is a sentinel", () => {
    expect(digits(SDOC).length).toBeGreaterThan(5);
    expect(stray(SHTML)).toEqual([]);
  });

  it("no count is typed in words either", () => {
    expect(numberWords(SDOC)).toEqual([]);
  });

  it("every leaf the page is meant to show is on it", () => {
    const words = text(SDOC.querySelector("body")!);
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

  it("each count sits under its own How-we-count label", () => {
    const expected: Array<[string, string]> = [
      ["nightly.startsAt", "Times"],
      ["nightly.sendsAt", "Times"],
      ["nightly.scale", "Scale"],
      ["nightly.reliability", "Runs completed"],
      ["nightly.steps[a].outcome", "Steps"],
      ["upkeep.automerged", "Dependency updates merged"],
      ["upkeep.vulnsCleared", "Sites cleared of vulnerabilities"],
      ["leads.stoppedAllTime", "Stopped before storage"],
      ["leads.allTime.screened", "Screened as spam"],
      ["leads.allTime.accepted", "Accepted as real"],
      ["leads.allTime.notified", "Client notified"],
      ["leads.allTime.submissions", "Submissions"],
      ["reports.sent.approvedFirst", "Reports sent"],
      ["reports.sent.real", "Reports sent"],
      ["reports.lighthouse[a].median", "Lighthouse"],
      ["prsMerged", "PRs merged"],
    ];
    expect(expected.map(([p]) => [p, termOf(SDOC, sent(p))])).toEqual(expected);
  });

  it("each Lighthouse score sits beside its own area's name", () => {
    const line = one(SDOC, 'p[data-term="Lighthouse"]');
    for (const [i] of VIEW.reports.lighthouse.entries()) {
      const k = String.fromCharCode(97 + i);
      expect(line).toContain(
        `${sent(`reports.lighthouse[${k}].label`)} ${sent(`reports.lighthouse[${k}].median`)}`,
      );
    }
  });

  it("is an instrument that can fail: a typed number, in digits or words, is caught", () => {
    expect(stray(SHTML.replace("<h1>How this works", "<h1>How this works in 21 nights"))).toEqual([
      "21",
    ]);
    expect(
      stray(SHTML.replace("</details>", "</details><p>Trusted by 40 client sites.</p>")),
    ).toEqual(["40"]);
    expect(
      stray(SHTML.replace("<summary>How we count", "<summary>How we count: 14 terms")),
    ).toEqual(["14"]);
    expect(numberWords(parse(SHTML.replace("before it lands", "over about three rounds")))).toEqual(
      ["three"],
    );
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

describe("the page's load and its singulars", () => {
  afterEach(() => vi.useRealTimers());

  it("the load builds the view on the server's clock: the snapshot's offset applied", async () => {
    // This machine's clock runs three days ahead of the server's.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW.getTime() + 259_200_000));
    const out = (await (howLoad as (e: unknown) => unknown)({
      parent: async () => ({ snapshot: SNAP, failure: null, clockOffsetMs: -259_200_000 }),
    })) as { view: HowView };
    expect(out.view).toEqual(howFromSnapshot(SNAP, NOW));
    // The control: on this machine's own clock the view differs.
    expect(out.view).not.toEqual(howFromSnapshot(SNAP, new Date(NOW.getTime() + 259_200_000)));
  });

  it("one submission reads in the singular", () => {
    const view = howFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({ id: "x", siteId: "recA", status: "new", submittedAt: FRESH }),
        ],
        nights: [NEWEST],
      }),
      NOW,
    );
    const doc = parse(pageHtml(view));
    expect(one(doc, 'p[data-term="Submissions"]')).toMatch(/^1 submission in all since /);
  });
});

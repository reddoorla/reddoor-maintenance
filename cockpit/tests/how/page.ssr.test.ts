import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
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
    healthy({
      id: "recA",
      name: "Acme",
      pScore: 91,
      rScore: 97,
      bpScore: 88,
      seoScore: 99,
      lastLighthouseAuditAt: "2026-10-20T06:30:00.000Z",
    }),
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
  nights: [
    NEWEST,
    night("2026-10-25", {
      prsMerged: { value: 590 },
      events: { value: { pr_automerged: 90, vuln_cleared: 7 } },
    }),
  ],
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

describe("the nightly facts the overview no longer shows (review round 2, E)", () => {
  it("How we count says how many nights the nightly has written, beside the steps", () => {
    expect(one(DOC, 'details [data-term="Nights counted"]')).toBe(
      "The nightly has written 2 nights of counts so far.",
    );
  });

  it("chapter 5 keeps the PR gloss and who promotes a change, each pinned once", () => {
    expect(DOC.text).toContain("Each change lands as its own pull request (PR)");
    expect(DOC.text).toContain("when one of us promotes it");
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
    // The names as written, each with its own step's file: a swap or a typo shows.
    expect(
      Object.fromEntries(
        NIGHTLY_STEPS.map((s, i) => [s.file, text(steps[i]!.querySelector(".how-step-name")!)]),
      ),
    ).toEqual({
      "fleet-db-backup.yml": "Backup",
      "fleet-prismic-drift.yml": "CMS check",
      "fleet-prismic-sync.yml": "CMS sync",
      "fleet-security.yml": "Security",
      "fleet-lighthouse.yml": "Site checks",
      "fleet-smoke.yml": "Build and tests",
      "fleet-form-e2e.yml": "Live forms",
      "daily-reports.yml": "Report drafts",
    });
    expect(steps.map((li) => text(li.querySelector(".how-step-what")!))).toEqual(
      NIGHTLY_STEPS.map((s) => s.label),
    );
    // Each step's outcome, when it last finished and what it reached (review round 2, E:
    // these moved here from the overview, where no other page now shows them). The
    // smoke step is the one that failed on the newest night.
    expect(steps.map((li) => text(li.querySelector(".how-step-last")!))).toEqual([
      "Night of Oct 26: ran to the end. Last finished: in the run that started Oct 26, 11:07pm PT (ran to the end). Reached: the whole database, every site's records in one copy.",
      "Night of Oct 26: ran to the end. Last finished: no site stamped yet. Reached: not yet collected.",
      "Night of Oct 26: ran to the end. Last finished: in the run that started Oct 26, 11:07pm PT (ran to the end). Reached: sites on Prismic, with a pull request only where something changed.",
      "Night of Oct 26: ran to the end. Last finished: Oct 26, 11:30pm PT. Reached: 2 sites that night.",
      "Night of Oct 26: ran to the end. Last finished: Oct 26, 11:30pm PT. Reached: 2 sites that night.",
      "Night of Oct 26: failed. Last finished: no site stamped yet. Reached: not yet collected.",
      "Night of Oct 26: ran to the end. Last finished: Oct 26, 11:30pm PT. Reached: 1 site that night.",
      "Night of Oct 26: ran to the end. Last finished: in the run that started Oct 26, 11:07pm PT (ran to the end). Reached: sites with a report due.",
    ]);
  });

  it("chapter 1 numbers its steps in the markup, as the report's proofs cite them", () => {
    // In the text, not drawn by CSS: a screen reader hears "5" before "Site checks",
    // which "Step 5 reads the latest production deploy" depends on.
    expect(DOC.querySelectorAll(".how-steps li .how-step-n").map(text)).toEqual(
      NIGHTLY_STEPS.map((_, i) => String(i + 1)),
    );
    expect(text(DOC.querySelectorAll(".how-steps li strong")[4]!)).toBe("5 · Site checks");
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
    // The four levels are the list's own items: each level's sites are a nested list (item 10).
    const levels = DOC.querySelectorAll(".how-ladder > li");
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
      `carries up to ${names.length} checks`,
    );
    expect(one(DOC, 'section:has(#how-report) [data-term="Reports sent"]')).toBe(
      "Approved by one of us 1 of 2 approved before sending; 1 went without that yes",
    );
  });

  it("chapter 4 says nothing went without a yes when every report was approved first", () => {
    const all = {
      ...VIEW,
      reports: {
        ...VIEW.reports,
        sent: { real: 2, approvedFirst: 2, aroundGate: 0, testSends: 0 },
      },
    };
    expect(one(parse(pageHtml(all)), 'section:has(#how-report) [data-term="Reports sent"]')).toBe(
      "Approved by one of us 2 of 2 approved before sending",
    );
  });

  it("chapter 4's Lighthouse line keeps each area apart", () => {
    expect(one(DOC, 'p[data-term="Lighthouse"]')).toMatch(
      /^Google's Lighthouse audit, the middle score across our sites: Performance 91 · Accessibility 97 · Best practices 88 · SEO 99/,
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
    expect(sentence).toContain("carries up to 3 checks");
    // Its only number is the count: no step count typed beside it, in digits or words.
    expect(sentence.match(/\d+/g)).toEqual(["3"]);
    expect(sentence.match(NUMBER_WORDS)).toBeNull();
  });

  it("chapter 2 says which fixes wait for the weekly update, and which do not", () => {
    const para = one(DOC, "section:has(#how-wrong) > p");
    expect(para).toContain("in a package the site uses directly");
    expect(para).toContain("waits for the weekly lock-file update");
  });

  it("chapter 4's last box says a sent report carries traffic and search results only where we have them", () => {
    expect(one(DOC, "section:has(#how-report) .how-flow li.how-end")).toBe(
      "Sent to the client with traffic and search results where we have them",
    );
  });

  it("chapter 5 says the count includes the update bot's own merges", () => {
    const para = one(DOC, "section:has(#how-ship) > p");
    expect(para).toContain("once tested; the changes we write are also reviewed.");
    expect(para).toContain("The count includes the update bot's own merges.");
  });

  it("chapter 5 says how many PRs merged, from the nightly counts", () => {
    expect(one(DOC, 'section:has(#how-ship) [data-term="PRs merged"]')).toContain(
      `: ${VIEW.prsMerged}.`,
    );
    expect(VIEW.prsMerged).toMatch(/^10 over/);
  });
});

describe("the fixture's values, pinned as literals", () => {
  // Read once from this fixture's own run, then typed here: a view that swaps two
  // fields, or drops one, no longer agrees with the literal it was checked against.
  it("chapter 1's times and scale", () => {
    expect(VIEW.nightly.startsAt).toBe("11:07pm PT");
    expect(VIEW.nightly.sendsAt).toBe("9:07am PT");
    expect(VIEW.nightly.scale).toBe(
      "3 kinds of check ran on the night of Oct 26, reaching up to 2 sites",
    );
    expect(one(DOC, 'span[data-term="Times"]')).toBe(
      "The run starts at 11:07pm PT, and reports a person has approved go out at 9:07am PT.",
    );
  });

  it("chapter 2's two upkeep counts are distinct, each under its own label", () => {
    expect(VIEW.upkeep.automerged).toBe("10 over the last night");
    expect(VIEW.upkeep.vulnsCleared).toBe("3 over the last night");
    expect(one(DOC, 'span[data-term="Dependency updates merged"]')).toBe(
      "Dependency updates merged: 10 over the last night.",
    );
    expect(one(DOC, 'span[data-term="Sites cleared of vulnerabilities"]')).toBe(
      "Sites cleared of every critical or high vulnerability: 3 over the last night.",
    );
  });

  it("chapter 4's Lighthouse line, in full, with the date of its oldest audit", () => {
    expect(VIEW.reports.lighthouseAsOf).toBe("Oct 19");
    expect(one(DOC, 'p[data-term="Lighthouse"]')).toBe(
      "Google's Lighthouse audit, the middle score across our sites: Performance 91 · Accessibility 97 · Best practices 88 · SEO 99, from audits as old as Oct 19.",
    );
  });
});

describe("a date that is absent takes its 'as of' with it", () => {
  const doc = parse(
    pageHtml({
      ...VIEW,
      leads: { ...VIEW.leads, stoppedAsOf: null },
      reports: { ...VIEW.reports, lighthouseAsOf: null },
    }),
  );
  const body = text(doc.querySelector("body")!);

  it("the stopped count reads without a date", () => {
    expect(one(doc, 'section:has(#how-lead) [data-term="Stopped before storage"]')).toBe(
      "Bots stopped 248 never stored",
    );
  });

  it("the Lighthouse line reads without an audit date", () => {
    expect(one(doc, 'p[data-term="Lighthouse"]')).toBe(
      "Google's Lighthouse audit, the middle score across our sites: Performance 91 · Accessibility 97 · Best practices 88 · SEO 99.",
    );
  });

  it("no 'as of' or 'as old as' is left dangling on the page", () => {
    expect(body).not.toMatch(/as of\s*[.,]/);
    expect(body).not.toMatch(/as of\s*$/);
    expect(body).not.toContain("as old as");
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

describe("the page's frame", () => {
  it("a healthy read shows no 'could not be read' notice", () => {
    const body = text(DOC.querySelector("body")!);
    expect(body).not.toContain("The submissions could not be read just now");
    expect(body).not.toContain("the reports could not be read just now");
  });

  it("names itself in the tab", () => {
    expect(one(DOC, "title")).toBe("Reddoor maintenance — how this works");
  });

  it("each chapter is labelled by its own heading", () => {
    for (const s of DOC.querySelectorAll("section.how-chapter")) {
      const id = s.getAttribute("aria-labelledby")!;
      expect(s.querySelector(`h2#${id}`), id).not.toBeNull();
    }
  });

  it("each flow ends in its filled box, and only there", () => {
    const flows = DOC.querySelectorAll(".how-flow");
    expect(flows).toHaveLength(3);
    for (const f of flows) {
      const items = f.querySelectorAll(":scope > li");
      expect(items.map((li) => li.classList.contains("how-end"))).toEqual(
        items.map((_, i) => i === items.length - 1),
      );
    }
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
      // The overview's leads tile reads these (numbersView, round 1); the page never does.
      p.startsWith("leads.leadsSent") ||
      p.startsWith("leads.biggest") ||
      p === "leads.stoppedThisMonth" ||
      p === "leads.allTime.byHand" ||
      /^nightly\.steps\[[a-z]\]\.(lastFinished|sites)$/.test(p) ||
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

  it("the run's start and send times are each in their own place", () => {
    expect(one(SDOC, '[data-term="Times"]')).toBe(
      `The run starts at ${sent("nightly.startsAt")}, and reports a person has approved go out at ${sent("nightly.sendsAt")}.`,
    );
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

// P1-87 PR 1, review round 6: a screen reader drops the aria-hidden nodes, so the
// real spaces must sit outside them, or "1 · Backup" is read as "1Backup".
describe("the separators are hidden, and the words keep their spaces", () => {
  const withoutHidden = (): HTMLElement => {
    const doc = parse(HTML);
    for (const n of doc.querySelectorAll('[aria-hidden="true"]')) n.remove();
    return doc;
  };

  it("the first step reads 'Backup' after its number, with a space, once the hidden dot is gone", () => {
    expect(text(withoutHidden().querySelectorAll(".how-steps li strong")[0]!)).toBe("1 Backup");
  });

  it("the Lighthouse line reads each label, a space, then its score, once the hidden dots are gone", () => {
    expect(one(withoutHidden(), 'p[data-term="Lighthouse"]')).toContain(
      "Performance 91 Accessibility 97 Best practices 88 SEO 99",
    );
  });

  it("each step's separator is hidden and holds a dot, not an empty span", () => {
    const hidden = DOC.querySelectorAll('.how-steps li strong [aria-hidden="true"]');
    expect(hidden).toHaveLength(NIGHTLY_STEPS.length);
    for (const h of hidden) expect(text(h)).toBe("·");
  });

  it("the Lighthouse separators are hidden: one fewer than the scores, none empty", () => {
    const scores = VIEW.reports.lighthouse.length;
    const hidden = DOC.querySelectorAll('p[data-term="Lighthouse"] [aria-hidden="true"]');
    expect(scores).toBe(4);
    expect(hidden).toHaveLength(scores - 1);
    for (const h of hidden) expect(text(h)).toBe("·");
  });
});

describe("How we count's Lately entry (P1-87 PR 4, review round 3 D)", () => {
  it("says the night is one line naming up to two steps that did not run to the end, and that a line from six Pacific calendar days back is dated", () => {
    const terms = DOC.querySelectorAll("details dl dt").map(text);
    const entry = DOC.querySelectorAll("details dl dd")[terms.indexOf("Lately")]!;
    expect(terms).toContain("Lately");
    expect(text(entry)).toContain("naming up to two steps that did not run to the end");
    expect(text(entry)).toContain("from six Pacific calendar days back carries its date");
  });

  // #2194: the rule deploysToShow applies, said where the feed's rules are.
  it("says a deploy is listed only when no dependency update merged on its site in the hour before it", () => {
    const terms = DOC.querySelectorAll("details dl dt").map(text);
    const entry = DOC.querySelectorAll("details dl dd")[terms.indexOf("Lately")]!;
    expect(text(entry)).toContain(
      "a deploy is listed only when no dependency update merged on its site in the hour before it",
    );
  });
});

describe("PR 8c item 8: the night fills in as you scroll (server render)", () => {
  it("the server renders every step lit, so no script and no reduced motion show the end state", () => {
    const steps = DOC.querySelectorAll(".how-steps li");
    expect(steps.length).toBe(NIGHTLY_STEPS.length);
    expect(steps.map((li) => li.getAttribute("data-lit"))).toEqual(NIGHTLY_STEPS.map(() => "true"));
  });

  it("the server render carries no script marker, so the browser tests wait for the script", () => {
    expect(DOC.querySelector('[data-js="true"]')).toBeNull();
  });

  it("every step's result is in the DOM, whatever its light", () => {
    const steps = DOC.querySelectorAll(".how-steps li");
    expect(steps.every((li) => text(li.querySelector(".how-step-last")!).length > 0)).toBe(true);
  });
});

describe("PR 8c item 9: a lead's journey (server render)", () => {
  const LEAD = () => DOC.querySelector("section:has(#how-lead)")!;

  it("the dot is aria-hidden, carries no text, and is hidden in the server render", () => {
    const dot = LEAD().querySelector(".how-dot")!;
    expect(dot, "the dot exists").not.toBeNull();
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(text(dot)).toBe("");
    expect(dot.hasAttribute("hidden")).toBe(true);
  });

  it("Replay is a type=button hidden in the server render, so no script shows no Replay", () => {
    const replay = LEAD().querySelector("button.how-replay")!;
    expect(replay, "the Replay button exists").not.toBeNull();
    expect(replay.getAttribute("type")).toBe("button");
    // Round 1 fold: the visible word; the accessible name says what it replays (aria-label).
    expect(text(replay)).toBe("Replay");
    expect(replay.getAttribute("aria-label")).toBe("Replay the lead's journey");
    expect(replay.hasAttribute("hidden")).toBe(true);
  });

  it("the branch is a disclosure button, open in the server render, naming the branch", () => {
    const toggle = LEAD().querySelector("button.how-branch-toggle")!;
    expect(toggle, "the branch toggle exists").not.toBeNull();
    expect(toggle.getAttribute("type")).toBe("button");
    expect(text(toggle)).toBe("If an email to the client fails");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("the branch's button controls a region that holds the existing sentence, word for word", () => {
    const toggle = LEAD().querySelector("button.how-branch-toggle")!;
    const id = toggle.getAttribute("aria-controls");
    expect(id, "aria-controls names an id").toBeTruthy();
    const region = DOC.querySelector(`#${id}`)!;
    expect(region, "the controlled region exists").not.toBeNull();
    expect(region.hasAttribute("hidden")).toBe(false);
    expect(text(region)).toBe(
      "If an email to the client fails, the lead is still kept in our own inbox, and repeated bounces raise an alarm for us.",
    );
  });

  it("the aria-expanded of the branch agrees with whether its region is open", () => {
    const toggle = LEAD().querySelector("button.how-branch-toggle")!;
    const region = DOC.querySelector(`#${toggle.getAttribute("aria-controls")}`)!;
    expect(toggle.getAttribute("aria-expanded") === "true").toBe(!region.hasAttribute("hidden"));
  });

  it("the lead flow's server render is not marked as scripted, so the browser tests wait for the script", () => {
    expect(LEAD().querySelector('[data-js="true"]')).toBeNull();
  });
});

describe("PR 8c item 10: the ladder's levels open", () => {
  it("each level's name is a disclosure button that controls its panel", () => {
    const buttons = DOC.querySelectorAll(".how-ladder li button");
    expect(buttons).toHaveLength(4);
    for (const b of buttons) {
      expect(b.getAttribute("type")).toBe("button");
      const panel = DOC.getElementById(b.getAttribute("aria-controls") ?? "");
      expect(panel).not.toBeNull();
    }
  });

  it("without script every panel is open, so no visitor loses its sites or the nights line", () => {
    expect(DOC.querySelectorAll(".how-ladder li button")).toHaveLength(4);
    for (const b of DOC.querySelectorAll(".how-ladder li button")) {
      expect(b.getAttribute("aria-expanded")).toBe("true");
      const panel = DOC.getElementById(b.getAttribute("aria-controls")!)!;
      expect(panel.hasAttribute("hidden")).toBe(false);
    }
  });

  it("the OK level names its sites as no open items; a level with none says so", () => {
    const panelOf = (tier: string) =>
      DOC.getElementById(
        DOC.querySelector(`.how-ladder li.${tier} button`)!.getAttribute("aria-controls")!,
      )!;
    const ok = text(panelOf("ok"));
    expect(ok).toContain("Acme");
    expect(ok).toContain("no open items");
    expect(ok).not.toContain("every check passing");
    expect(text(panelOf("broken"))).toContain("None today");
    expect(text(panelOf("broken"))).toMatch(/[Nn]ights/);
  });
});

describe("PR 8c round 1 G: the dot under forced colours", () => {
  it("how.css draws the dot with a border under forced-colors: active, and no colour keyword", () => {
    const css = readFileSync(
      new URL("../../src/lib/how/how.css", import.meta.url).pathname,
      "utf8",
    );
    const forced = css.match(/@media \(forced-colors: active\)\s*\{\s*\.how-dot\s*\{([^}]*)\}/);
    expect(forced, "a forced-colours rule for .how-dot").not.toBeNull();
    expect(forced![1]).toMatch(/border:\s*0\.375rem solid\s*;/);
    expect(forced![1]).not.toMatch(/#|rgb|canvas|buttontext|currentcolor/i);
  });
});

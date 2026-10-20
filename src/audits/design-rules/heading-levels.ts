/// <reference lib="dom" />
import type { Browser } from "@playwright/test";
import { settle, withPage } from "./load.js";
import type { DesignRule, RuleFinding, RuleOutcome } from "./types.js";

// R9 in docs/design-review-rules-2026-09.md, part (a), the outline: each page
// has exactly one level-1 heading and no skipped levels, with `aria-level`
// taken into account. The fleet a11y audit filters out axe's best-practice
// `page-has-heading-one` and `heading-order` (src/audits/a11y.ts uses wcag
// tags only), which is why these went unseen.
//
// The outline is the one assistive technology reads, at 1440×900 and 390×844
// (a phone layout can swap headings): every `h1`–`h6` and `[role=heading]`
// in document order, open shadow roots included, that is not hidden from it
// (display:none, visibility:hidden, `hidden`, inside aria-hidden="true") and
// has not had its semantics removed (`role="presentation"` or `"none"`). The
// level is a valid `aria-level` if there is one, else the tag's (2 for a bare
// role=heading, the ARIA default). A level skips when it is more than one
// deeper than the heading before it; going back up is never a skip.
//
// Not covered: part (b), that a heading whose level changed keeps its visual
// size, which needs two builds; and empty headings, which are R15's.

export type OutlineHeading = { target: string; level: number; text: string };

export type OutlineSample = { headings: OutlineHeading[] };

/**
 * Runs IN THE PAGE through `page.evaluate`, under revealBelowFold's rules:
 * self-contained, no import, no module-scope identifier, no named inner
 * function.
 */
export function sampleOutline(): OutlineSample {
  const headings: OutlineHeading[] = [];
  const stack: Element[] = [document.documentElement];
  const order: Element[] = [];
  // Document order, entering open shadow roots where they sit.
  while (stack.length > 0) {
    const el = stack.pop()!;
    order.push(el);
    const children = Array.from(el.shadowRoot ? el.shadowRoot.children : el.children);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  for (const el of order) {
    const tag = /^H([1-6])$/.exec(el.tagName);
    const role = (el.getAttribute("role") ?? "").trim().toLowerCase();
    if (role === "presentation" || role === "none") continue;
    if (!tag && role !== "heading") continue;
    let hidden = false;
    for (let node: Element | null = el; node;) {
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        node.hasAttribute("hidden") ||
        node.getAttribute("aria-hidden") === "true"
      ) {
        hidden = true;
        break;
      }
      node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host || null);
    }
    if (hidden || getComputedStyle(el).visibility !== "visible") continue;
    const aria = Number.parseInt(el.getAttribute("aria-level") ?? "", 10);
    const level = Number.isInteger(aria) && aria >= 1 ? aria : tag ? Number(tag[1]) : 2;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < 6) {
      const t = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${t}#${CSS.escape(node.id)}`);
        break;
      }
      let part = t;
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length > 0) part += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node === document.body) break;
      if (parent) node = parent;
      else {
        const host: Element | null = (node.getRootNode() as ShadowRoot).host ?? null;
        if (host) parts.unshift("::shadow");
        node = host;
      }
    }
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    headings.push({
      target: parts.join(" > ").replace(/ > ::shadow > /g, " ::shadow "),
      level,
      text,
    });
  }
  return { headings };
}

const quote = (text: string): string => `"${text.length > 50 ? `${text.slice(0, 47)}…` : text}"`;

/** One width's outline. */
export type OutlineRun = { width: number; outline: OutlineSample };

/**
 * R9's verdict. PURE. Per width: exactly one level-1 heading, and no heading
 * more than one level deeper than the one before it. A finding seen at both
 * widths is reported once, with the widths.
 */
export function summarizeOutline(url: string, runs: OutlineRun[]): RuleOutcome {
  const base = { rule: "R9" as const, url };
  if (runs.length === 0) {
    return { ...base, status: "unmeasured", findings: [], note: "no outline was read" };
  }
  const seen = new Map<string, { target: string; problem: string; widths: number[] }>();
  const add = (width: number, target: string, problem: string) => {
    const key = `${target}\u0000${problem}`;
    const f = seen.get(key) ?? { target, problem, widths: [] };
    f.widths.push(width);
    seen.set(key, f);
  };
  for (const { width, outline } of runs) {
    const h = outline.headings;
    const ones = h.filter((x) => x.level === 1);
    if (ones.length === 0) add(width, "(page)", "has no level-1 heading");
    for (const extra of ones.slice(1)) {
      add(width, extra.target, `is a second level-1 heading, ${quote(extra.text)}`);
    }
    for (let i = 1; i < h.length; i++) {
      const prev = h[i - 1]!;
      const cur = h[i]!;
      if (cur.level > prev.level + 1) {
        add(
          width,
          cur.target,
          `is level ${cur.level} after level ${prev.level} (${quote(prev.text)}), skipping level ${prev.level + 1}`,
        );
      }
    }
  }
  const findings: RuleFinding[] = [...seen.values()].map((f) => ({
    target: f.target,
    problem: `${f.problem} (at ${f.widths.join(" and ")}px)`,
  }));
  const counts = runs.map((r) => `${r.outline.headings.length} at ${r.width}px`).join(", ");
  return {
    ...base,
    status: findings.length === 0 ? "pass" : "fail",
    findings,
    note: `headings in the outline: ${counts}; ${findings.length} finding(s)`,
  };
}

export const OUTLINE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Read the outline of `url` at each width, after load and a settle. */
export async function checkHeadingLevels(browser: Browser, url: string): Promise<RuleOutcome> {
  const runs: OutlineRun[] = [];
  for (const viewport of OUTLINE_VIEWPORTS) {
    runs.push({
      width: viewport.width,
      outline: await withPage(browser, { viewport }, url, async (page) => {
        await settle(page);
        return page.evaluate(sampleOutline);
      }),
    });
  }
  return summarizeOutline(url, runs);
}

export const headingLevelsRule: DesignRule = {
  id: "R9",
  title: "One level-1 heading, and no skipped levels",
  check: (browser, url) => checkHeadingLevels(browser, url),
};

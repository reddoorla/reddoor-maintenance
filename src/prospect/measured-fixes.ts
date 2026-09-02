/**
 * Fixes that CODE writes from what the audit measured.
 *
 * The fix list used to be entirely model-written, and it argued outcomes the
 * visibility section disowns ("has no service page to cite") while the one
 * measured defect on the same page never reached it. These are findings: each
 * one comes from a check that ran, names its count, and says what a visitor or
 * a crawler can or cannot do on the site today. None of them predicts what an
 * answer engine will do — nothing here can, and the report says so.
 *
 * Order is the recommendation: a robots.txt block first (nothing else can
 * help for a crawler that is refused), then goal requirements (the reason the
 * site exists), then what a visitor hits (phone, broken links, images), then
 * what a crawler hits (headings, canonicals).
 *
 * Every input is nullable, and null means the stage did not run. A stage that
 * did not run produces no fix — our missing measurement is never their defect.
 */
import type { Fix, ChecksResult } from "./types.js";
import type { GoalFit } from "./goals.js";

export type MeasuredInput = {
  goalFit: GoalFit | null;
  checks: Pick<
    ChecksResult,
    "headings" | "meta" | "schema" | "crawlerAccessMeasured" | "crawlerAccess"
  > | null;
  /** consistency.phones, narrowed to what this needs. Null when the stage did
   *  not run. `linked` is OPTIONAL on the stored row: absent means "not
   *  measured", and only an explicit false is a plain-text number. */
  phones: { normalized: string; linked?: boolean }[] | null;
  brokenLinks: number | null;
  brokenImages: number | null;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function measuredFixes(input: MeasuredInput): Fix[] {
  const out: Fix[] = [];
  const c = input.checks;

  if (c && c.crawlerAccessMeasured && c.crawlerAccess.blockedAi.length > 0) {
    const names = c.crawlerAccess.blockedAi.join(", ");
    out.push({
      title: `Let ${names} read your site`,
      why: `Your robots.txt turns away ${names}. A crawler that is refused cannot read a page, so nothing else in this report can help for it until this changes.`,
      impact: "high",
      effort: "low",
      tier: "crawl",
      addresses: null,
      origin: "measured",
    });
  }

  for (const r of input.goalFit?.requirements ?? []) {
    if (r.status !== "missing") continue;
    out.push({
      title: r.label.charAt(0).toUpperCase() + r.label.slice(1),
      why: r.why,
      impact: "high",
      effort: r.scope === "quick" ? "low" : r.scope === "content" ? "medium" : "high",
      tier: r.scope === "quick" ? "technical" : "content",
      addresses: r.key,
      origin: "measured",
    });
  }

  const plain = (input.phones ?? []).filter((p) => p.linked === false).length;
  if (plain > 0) {
    out.push({
      title: "Make your phone number tappable",
      why: `${plural(plain, "number is", "numbers are")} written as plain text. On a phone that is something a visitor has to memorise and retype; as a link it is one tap, and it is the moment they were most likely to call.`,
      impact: "medium",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }

  if (input.brokenLinks !== null && input.brokenLinks > 0) {
    out.push({
      title: `Repair ${plural(input.brokenLinks, "broken link", "broken links")}`,
      why: "A visitor who follows one lands on an error page, and a crawler that follows one stops there.",
      impact: "medium",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }
  if (input.brokenImages !== null && input.brokenImages > 0) {
    out.push({
      title: `Replace ${plural(input.brokenImages, "broken image", "broken images")}`,
      why: "It shows as an empty box or a missing-image icon on the page a visitor is reading.",
      impact: "low",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }

  if (c) {
    if (c.headings.pagesWithoutH1 > 0) {
      out.push({
        title: `Give ${plural(c.headings.pagesWithoutH1, "page", "pages")} a top heading`,
        why: `${c.headings.pagesWithoutH1} of ${c.meta.pageCount} pages have no top-level heading, so a reader or a crawler arriving on them is not told what the page is about.`,
        impact: "medium",
        effort: "low",
        tier: "technical",
        addresses: null,
        origin: "measured",
      });
    }
    if (c.meta.missingCanonical > 0) {
      out.push({
        title: "Tell search engines which address is the real one for each page",
        why: `${c.meta.missingCanonical} of ${c.meta.pageCount} pages do not declare a canonical address. When the same page is reachable at more than one address, a search engine has to guess which one to keep.`,
        impact: "medium",
        effort: "low",
        tier: "technical",
        addresses: null,
        origin: "measured",
      });
    }
  }

  return out;
}

import { describe, it, expect } from "vitest";
import Page from "../../src/routes/audits/+page.svelte";
import { renderProspectAuditsPageHtml } from "../../../src/dashboard/prospect-audits-render.js";
import type { ProspectAuditListItem } from "../../../src/db/prospect-audits.js";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { canonical, bodyOf, renderPage } from "../_helpers/parity.js";
import { AUDITS, NOW, item } from "./fixtures.js";

/**
 * /audits, ported (#582). The page is frozen (operator, 2026-10-20), so the
 * port must render exactly what renderProspectAuditsPageHtml did. Dropped: the
 * old page's own "← Fleet home" link and auth fragment, which the shell now
 * renders.
 */

const OLD_ONLY = ["a.home", 'div[style^="float:right"]'];

/** The old page with its one intended difference: Run audit is server-rendered
 *  disabled until the submit handler is attached (review round 1), so a submit
 *  before hydration cannot fall back to a native GET carrying the prospect URL. */
const withDisabledRun = (html: string) =>
  html.replace(
    '<button type="submit">Run audit</button>',
    '<button type="submit" disabled>Run audit</button>',
  );

const CASES: Array<[string, ProspectAuditListItem[]]> = [
  ["no audits", []],
  ["every audit state and edge", AUDITS],
  ["one complete audit", [item()]],
];

describe("/audits parity with renderProspectAuditsPageHtml", () => {
  for (const [name, audits] of CASES) {
    it(name, () => {
      const before = canonical(
        withDisabledRun(
          bodyOf(
            renderProspectAuditsPageHtml({ audits, now: NOW, operatorEmail: "op@example.com" }),
          ),
        ),
        OLD_ONLY,
      );
      const after = canonical(renderPage(Page, { data: auditsPageView(audits, NOW) }));
      expect(after).toEqual(before);
      expect(after).toMatchSnapshot();
    });
  }

  it("the instrument sees a changed status label", () => {
    const before = canonical(
      withDisabledRun(bodyOf(renderProspectAuditsPageHtml({ audits: AUDITS, now: NOW }))),
      OLD_ONLY,
    );
    const after = canonical(
      renderPage(Page, { data: auditsPageView(AUDITS, NOW) }).replace(
        ">Did not finish<",
        ">Unfinished<",
      ),
    );
    expect(after).not.toEqual(before);
  });
});

import { describe, it, expect } from "vitest";
import Page from "../../src/routes/audits/+page.svelte";
import type { ProspectAuditListItem } from "../../../src/db/prospect-audits.js";
import { auditsPageView } from "../../src/lib/audits/view.js";
import { canonical, renderPage } from "../_helpers/parity.js";
import { AUDITS, NOW, item } from "./fixtures.js";

/**
 * Since the cutover (#582) the old renderer is gone. Each case's markup is
 * pinned by a snapshot written while parity with the old renderer held (commit
 * "freeze each page's canonical markup as a snapshot, verified by parity"), so
 * each snapshot is what the old page rendered. Keep these test names: the
 * snapshots are keyed on them.
 */
const CASES: Array<[string, ProspectAuditListItem[]]> = [
  ["no audits", []],
  ["every audit state and edge", AUDITS],
  ["one complete audit", [item()]],
];

describe("/audits parity with renderProspectAuditsPageHtml", () => {
  for (const [name, audits] of CASES) {
    it(name, () => {
      const after = canonical(renderPage(Page, { data: auditsPageView(audits, NOW) }));
      expect(after).toMatchSnapshot();
    });
  }
});

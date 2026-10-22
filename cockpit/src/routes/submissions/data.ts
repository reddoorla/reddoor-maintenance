import type { SubmissionsPageModel } from "../../../../src/dashboard/submissions-page.js";
import { buildSubmissionRowView, type SubmissionRowView } from "../../lib/submission/view.js";
import { spamFacets, type SpamFacet } from "./view.js";

/** What the `/submissions` page component is handed: the page model with each
 *  row cut to what the list itself shows, one row view per row, and the spam
 *  facets already tallied. Since the snapshot (maintenance, cockpit one snapshot)
 *  this is derived in the browser, which holds the full rows; the component still
 *  receives only these props. */
export type SubmissionsPageData = {
  model: Omit<SubmissionsPageModel, "rows" | "facetReasons"> & {
    rows: Array<Pick<SubmissionsPageModel["rows"][number], "id" | "slug" | "siteName">>;
  };
  /** By row id: the row component `/s/:slug` uses too, every string decided here. */
  rowViews: Record<string, SubmissionRowView>;
  facets: SpamFacet[];
};

export function buildSubmissionsPageData(
  model: SubmissionsPageModel,
  now: Date = new Date(),
): SubmissionsPageData {
  const { rows, facetReasons: _facetReasons, ...rest } = model;
  return {
    model: { ...rest, rows: rows.map(({ id, slug, siteName }) => ({ id, slug, siteName })) },
    rowViews: Object.fromEntries(rows.map((r) => [r.id, buildSubmissionRowView(r, now)])),
    facets: spamFacets(model),
  };
}

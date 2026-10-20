import type { SubmissionsPageModel } from "../../../../src/dashboard/submissions-page.js";
import { buildSubmissionRowView, type SubmissionRowView } from "../../lib/submission/view.js";

export type SubmissionsPageData = {
  model: SubmissionsPageModel;
  /** One row view per `model.rows` entry, by id: the row component that
   *  `/s/:slug` uses too, with every derived string decided on the server. */
  rowViews: Record<string, SubmissionRowView>;
};

export function buildSubmissionsPageData(model: SubmissionsPageModel): SubmissionsPageData {
  return {
    model,
    rowViews: Object.fromEntries(model.rows.map((r) => [r.id, buildSubmissionRowView(r)])),
  };
}

import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { submissionsPageFromSnapshot } from "../../../../src/dashboard/snapshot-views.js";
import { fromSnapshot } from "../../lib/snapshot.js";
import { buildSubmissionsPageData } from "./data.js";

export const load: PageLoad = ({ parent, url }) =>
  fromSnapshot("submissions", parent, (snapshot, now) => {
    const loaded = submissionsPageFromSnapshot(snapshot, url.searchParams);
    if (loaded.kind === "no-site") error(404, `No site found for slug '${loaded.slug}'.`);
    return buildSubmissionsPageData(loaded.model, now);
  });

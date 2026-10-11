import type { Config } from "@netlify/functions";
import { fireWorkflow, NIGHTLY_CONDUCTOR_WORKFLOW } from "../../src/dashboard/nightly-clock.js";

export const config: Config = {
  schedule: "7 6 * * *",
};

const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

export default async (): Promise<Response> => {
  const r = await fireWorkflow({
    token: process.env.GH_TOKEN,
    repo: CENTRAL_REPO,
    workflow: NIGHTLY_CONDUCTOR_WORKFLOW,
  });
  if (!r.ok) {
    console.error(`[nightly-clock] could not dispatch ${NIGHTLY_CONDUCTOR_WORKFLOW}: ${r.error}`);
    return new Response(JSON.stringify(r), { status: 502 });
  }
  console.log(`[nightly-clock] dispatched ${NIGHTLY_CONDUCTOR_WORKFLOW}`);
  return new Response(JSON.stringify(r), { status: 200 });
};

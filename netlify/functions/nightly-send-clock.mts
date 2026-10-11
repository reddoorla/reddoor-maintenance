import type { Config } from "@netlify/functions";
import { fireWorkflow, SEND_INPUTS, SEND_WORKFLOW } from "../../src/dashboard/nightly-clock.js";

export const config: Config = {
  schedule: "7 16 * * *",
};

const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

export default async (): Promise<Response> => {
  const r = await fireWorkflow({
    token: process.env.GH_TOKEN,
    repo: CENTRAL_REPO,
    workflow: SEND_WORKFLOW,
    inputs: { ...SEND_INPUTS },
  });
  if (!r.ok) {
    console.error(`[nightly-send-clock] could not dispatch ${SEND_WORKFLOW}: ${r.error}`);
    return new Response(JSON.stringify(r), { status: 502 });
  }
  console.log(`[nightly-send-clock] dispatched ${SEND_WORKFLOW} mode=send`);
  return new Response(JSON.stringify(r), { status: 200 });
};

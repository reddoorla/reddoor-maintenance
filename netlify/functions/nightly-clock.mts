import type { Config } from "@netlify/functions";
import { fireNightlyConductor } from "../../src/dashboard/nightly-clock.js";

export const config: Config = {
  schedule: "7 6 * * *",
};

const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

export default async (): Promise<Response> => {
  const r = await fireNightlyConductor({ token: process.env.GH_TOKEN, repo: CENTRAL_REPO });
  if (!r.ok) {
    console.error(`[nightly-clock] could not dispatch fleet-nightly: ${r.error}`);
    return new Response(JSON.stringify(r), { status: 502 });
  }
  console.log("[nightly-clock] dispatched fleet-nightly");
  return new Response(JSON.stringify(r), { status: 200 });
};

import { makeGitHubRest } from "../github/gh-rest.js";

export const NIGHTLY_CONDUCTOR_WORKFLOW = "fleet-nightly.yml";

export async function fireNightlyConductor(deps: {
  token: string | undefined;
  repo: string;
  fetch?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = deps.token?.trim();
  if (!token) return { ok: false, error: "GH_TOKEN is not configured" };
  try {
    const gh = makeGitHubRest(deps.fetch ? { token, fetch: deps.fetch } : { token });
    const ref = await gh.defaultBranch(deps.repo);
    await gh.dispatchWorkflow(deps.repo, NIGHTLY_CONDUCTOR_WORKFLOW, ref);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

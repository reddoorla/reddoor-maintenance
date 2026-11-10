import type { VideoClass } from "./key.js";

export type EncodeJob = { url: string; class: VideoClass; key: string };
export const DISPATCH_EVENT = "video-encode";

/** owner/name, the only shape of repo the pipeline will address. */
export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;

/** POST https://api.github.com/repos/${repo}/dispatches. Resolves on 204; throws otherwise. `repo` must match /^[\w.-]+\/[\w.-]+$/ or it throws before fetching. */
export async function dispatchEncode(
  job: EncodeJob,
  opts: { repo: string; token: string; fetch: typeof fetch },
): Promise<void> {
  if (!REPO_NAME.test(opts.repo))
    throw new Error(`dispatch ${job.key}: bad repo ${JSON.stringify(opts.repo)}`);
  const res = await opts.fetch(`https://api.github.com/repos/${opts.repo}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: job }),
  });
  if (res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`dispatch ${job.key}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

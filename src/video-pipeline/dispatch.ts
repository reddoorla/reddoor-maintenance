import type { VideoClass } from "./key.js";

export type EncodeJob = { url: string; class: VideoClass; key: string };
/** The workflow the relay runs for each video. Its inputs are `url`, `class` and `key`. */
export const DISPATCH_WORKFLOW = "video-encode.yml";

/** owner/name, the only shape of repo the pipeline will address. */
export const REPO_NAME = /^[\w.-]+\/[\w.-]+$/;
/** A workflow file name under .github/workflows, e.g. video-encode.yml. */
const WORKFLOW_NAME = /^[\w.-]+\.ya?ml$/;
/** A git ref: a branch or tag name made of word characters, dots, slashes and hyphens, with no `..`. */
const REF_NAME = /^[\w./-]+$/;

/**
 * POST https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches, on `ref`.
 * This uses the workflow-dispatch API, which needs only Actions: write and cannot touch code. The
 * repository_dispatch route needs Contents: write, which can push to the public site repo. Resolves on any 2xx
 * (GitHub answers 204); throws otherwise. `repo`, `workflow` and `ref` are validated before any fetch and throw if they fail.
 */
export async function dispatchEncode(
  job: EncodeJob,
  opts: {
    repo: string;
    token: string;
    fetch: typeof fetch;
    workflow?: string | undefined;
    ref?: string | undefined;
  },
): Promise<void> {
  const workflow = opts.workflow ?? DISPATCH_WORKFLOW;
  const ref = opts.ref ?? "main";
  if (!REPO_NAME.test(opts.repo))
    throw new Error(`dispatch ${job.key}: bad repo ${JSON.stringify(opts.repo)}`);
  if (!WORKFLOW_NAME.test(workflow))
    throw new Error(`dispatch ${job.key}: bad workflow ${JSON.stringify(workflow)}`);
  if (!REF_NAME.test(ref) || ref.includes(".."))
    throw new Error(`dispatch ${job.key}: bad ref ${JSON.stringify(ref)}`);
  const res = await opts.fetch(
    `https://api.github.com/repos/${opts.repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${opts.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: { url: job.url, class: job.class, key: job.key },
      }),
    },
  );
  if (res.status < 200 || res.status > 299) {
    const text = await res.text().catch(() => "");
    throw new Error(`dispatch ${job.key}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

import { assertUrlSegment } from "./gh.js";

/**
 * A `fetch`-based GitHub client covering the two operations the dashboard's
 * request-path Renovate trigger needs: resolve a repo's default branch and fire
 * a `workflow_dispatch`.
 *
 * Why not reuse `makeGitHub` (in gh.ts)? That client shells out to the `gh` CLI
 * (`spawn("gh", …)`), which is the right tool inside GitHub Actions / a dev box
 * but is ABSENT in the Netlify Functions (AWS Lambda) runtime where this code
 * runs — so every `gh` call there throws `ENOENT`. The button's first live
 * dispatch surfaced exactly that as a 502. The Lambda runtime has a global
 * `fetch`, so we talk to the REST API directly.
 *
 * Mirrors the relevant subset of the `GitHub` interface so the `.mts` handler's
 * dispatch adapter is a drop-in swap. `fetch` is injectable for tests.
 */
/** A subset of a GitHub Actions workflow run, mapped to camelCase. */
export type WorkflowRun = {
  id: number;
  status: string; // "queued" | "in_progress" | "completed" | "requested" | "waiting" | ...
  conclusion: string | null; // "success" | "failure" | "cancelled" | "timed_out" | ... | null
  createdAt: string; // ISO
  htmlUrl: string;
};

export type GitHubRest = {
  defaultBranch: (repo: string) => Promise<string>;
  /** Fire a `workflow_dispatch` for `<workflow>` (a filename like `renovate.yml`)
   *  on `ref`. Needs the token's `actions:write` scope; a non-2xx (404 no such
   *  workflow / 403 missing scope) surfaces as a thrown error carrying the status. */
  dispatchWorkflow: (repo: string, workflow: string, ref: string) => Promise<void>;
  /** List a workflow's runs, newest first, created on/after `opts.since` (ISO).
   *  Used to re-find the run a prior `workflow_dispatch` started (dispatch returns
   *  204 with no id). Non-2xx surfaces as a thrown error carrying the status. */
  listWorkflowRuns: (
    repo: string,
    workflow: string,
    opts: { since: string; event?: string; perPage?: number },
  ) => Promise<WorkflowRun[]>;
};

const GITHUB_API = "https://api.github.com";

/** Split + validate an `owner/repo`, mirroring the shape check in gh.ts's methods. */
function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`expected "owner/repo", got ${JSON.stringify(repo)}`);
  }
  return { owner, name };
}

/** Best-effort response body for an error message; capped so a huge body can't bloat logs. */
async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

export function makeGitHubRest(deps: { token: string; fetch?: typeof fetch }): GitHubRest {
  const doFetch = deps.fetch ?? fetch;
  // GitHub requires a User-Agent; the rest are the documented JSON-API headers.
  const baseHeaders: Record<string, string> = {
    authorization: `Bearer ${deps.token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "reddoor-maintenance-dashboard",
  };

  return {
    async defaultBranch(repo) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      const res = await doFetch(`${GITHUB_API}/repos/${owner}/${name}`, { headers: baseHeaders });
      if (!res.ok) {
        throw new Error(
          `GitHub GET repos/${owner}/${name} failed (${res.status}): ${await bodyText(res)}`,
        );
      }
      let body: { default_branch?: string };
      try {
        body = (await res.json()) as { default_branch?: string };
      } catch {
        throw new Error(`GitHub repos/${owner}/${name}: 200 with a non-JSON body`);
      }
      if (!body.default_branch) {
        throw new Error(`GitHub repos/${owner}/${name}: response had no default_branch`);
      }
      return body.default_branch;
    },

    async dispatchWorkflow(repo, workflow, ref) {
      const { owner, name } = splitRepo(repo);
      // Every segment interpolates into the API path — guard them all (defense in
      // depth), matching gh.ts's dispatchWorkflow. `ref` is repo-sourced.
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      assertUrlSegment("path", workflow);
      assertUrlSegment("branch", ref);
      const res = await doFetch(
        `${GITHUB_API}/repos/${owner}/${name}/actions/workflows/${workflow}/dispatches`,
        {
          method: "POST",
          headers: { ...baseHeaders, "content-type": "application/json" },
          body: JSON.stringify({ ref }),
        },
      );
      // 204 No Content on success.
      if (!res.ok) {
        throw new Error(
          `GitHub workflow_dispatch ${owner}/${name}/${workflow} failed (${res.status}): ${await bodyText(res)}`,
        );
      }
    },

    async listWorkflowRuns(repo, workflow, opts) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      assertUrlSegment("path", workflow);
      const qs = new URLSearchParams({
        created: `>=${opts.since}`,
        per_page: String(opts.perPage ?? 1),
      });
      if (opts.event) qs.set("event", opts.event);
      const res = await doFetch(
        `${GITHUB_API}/repos/${owner}/${name}/actions/workflows/${workflow}/runs?${qs.toString()}`,
        { headers: baseHeaders },
      );
      if (!res.ok) {
        throw new Error(
          `GitHub GET runs ${owner}/${name}/${workflow} failed (${res.status}): ${await bodyText(res)}`,
        );
      }
      let body: { workflow_runs?: Array<Record<string, unknown>> };
      try {
        body = (await res.json()) as { workflow_runs?: Array<Record<string, unknown>> };
      } catch {
        throw new Error(`GitHub runs ${owner}/${name}/${workflow}: 200 with a non-JSON body`);
      }
      return (
        (body.workflow_runs ?? [])
          .map((r) => ({
            id: Number(r.id),
            status: String(r.status ?? ""),
            conclusion: (r.conclusion as string | null) ?? null,
            createdAt: String(r.created_at ?? ""),
            htmlUrl: String(r.html_url ?? ""),
          }))
          // Fail-soft like the other fields: a record with a missing/garbage id
          // (Number(...) → NaN) is dropped rather than propagated.
          .filter((r) => Number.isFinite(r.id))
      );
    },
  };
}

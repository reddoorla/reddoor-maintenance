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

/** One GitHub Dependabot alert, mapped to the fields the security audit needs. */
export type DependabotAlert = {
  /** The vulnerable package name (`dependency.package.name`). */
  package: string;
  /** GitHub's raw severity vocabulary: "low" | "medium" | "high" | "critical". The audit layer
   *  maps "medium" → the app's "moderate"; the rest pass through. */
  severity: string;
  /** Human advisory summary (`security_advisory.summary`). */
  summary: string;
  /** CVE id from the advisory's `cve_id`, as a 0- or 1-element array. Empty for GHSA-only
   *  advisories (no CVE assigned) — those have no inline identifier here, but `url` still links
   *  to the GHSA advisory page. (The GitHub `identifiers[]` array is intentionally not surfaced.) */
  cves: string[];
  /** Link to the alert (`html_url`), or null. */
  url: string | null;
  /** Dependency graph scope, or null when GitHub doesn't classify it. "development" marks a
   *  build-time-only dependency (lower live-exploit surface for a static site). */
  scope: "runtime" | "development" | null;
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
  /** The name of the in-progress step of a run's in-progress job, or null if none
   *  is currently running (between steps / completed). Used to show a coarse "phase"
   *  in the refresh spinner. Non-2xx throws (callers treat it best-effort). */
  currentRunStep: (repo: string, runId: number) => Promise<string | null>;
  /** List a repo's Dependabot alerts, following pagination. `opts.state` defaults to "open".
   *  Needs the token's Dependabot-alerts read permission (fine-grained PAT) or `repo`/
   *  `security_events` (classic PAT); a non-2xx (403 missing scope / 404 alerts disabled)
   *  throws carrying the status so the caller can fall back. */
  listDependabotAlerts: (
    repo: string,
    opts?: { state?: "open" | "dismissed" | "fixed" | "auto_dismissed" },
  ) => Promise<DependabotAlert[]>;
};

const GITHUB_API = "https://api.github.com";

/** Per-request timeout for the Dependabot fetch. It runs inside the nightly fleet sweep at
 *  `--concurrency 1`, so a hung connection (half-open TCP / accept-but-no-response) would otherwise
 *  stall the whole sweep — `fetch` has no default overall timeout. With this signal a hang rejects
 *  with an AbortError, which the audit's try/catch converts to the pnpm-audit fallback. */
const DEPENDABOT_FETCH_TIMEOUT_MS = 15_000;

/** Extract the `rel="next"` URL from a GitHub `Link` header, or null when absent. GitHub's
 *  Dependabot-alerts endpoint paginates ONLY by opaque `after` cursor exposed via this header —
 *  there is no numeric `page` param (it is silently ignored) — so following rel="next" is the only
 *  correct way to advance pages. */
function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1] ?? null;
  }
  return null;
}

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

/** Map one raw Dependabot-alert object to {@link DependabotAlert}, or null if it carries no
 *  usable package name (fail-soft — a malformed alert is dropped rather than propagated). */
function mapDependabotAlert(raw: Record<string, unknown>): DependabotAlert | null {
  const dependency = (raw["dependency"] ?? {}) as Record<string, unknown>;
  const pkg = (dependency["package"] ?? {}) as Record<string, unknown>;
  const packageName = typeof pkg["name"] === "string" ? (pkg["name"] as string) : null;
  if (!packageName) return null;

  const adv = (raw["security_advisory"] ?? {}) as Record<string, unknown>;
  const cveId = typeof adv["cve_id"] === "string" ? (adv["cve_id"] as string) : null;
  const rawScope = dependency["scope"];
  return {
    package: packageName,
    severity: typeof adv["severity"] === "string" ? (adv["severity"] as string) : "",
    summary: typeof adv["summary"] === "string" ? (adv["summary"] as string) : "",
    cves: cveId ? [cveId] : [],
    url: typeof raw["html_url"] === "string" ? (raw["html_url"] as string) : null,
    scope: rawScope === "runtime" || rawScope === "development" ? rawScope : null,
  };
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

    async currentRunStep(repo, runId) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      if (!Number.isInteger(runId) || runId < 0) {
        throw new Error(`currentRunStep: expected a non-negative integer runId, got ${runId}`);
      }
      const res = await doFetch(`${GITHUB_API}/repos/${owner}/${name}/actions/runs/${runId}/jobs`, {
        headers: baseHeaders,
      });
      if (!res.ok) {
        throw new Error(
          `GitHub GET run ${owner}/${name}/${runId} jobs failed (${res.status}): ${await bodyText(res)}`,
        );
      }
      let body: {
        jobs?: Array<{ status?: string; steps?: Array<{ name?: string; status?: string }> }>;
      };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new Error(`GitHub run ${owner}/${name}/${runId} jobs: 200 with a non-JSON body`);
      }
      const jobs = body.jobs ?? [];
      // Prefer the in-progress job; fall back to the first job (single-job workflows).
      const job = jobs.find((j) => j.status === "in_progress") ?? jobs[0];
      const step = (job?.steps ?? []).find((s) => s.status === "in_progress");
      return step?.name ?? null;
    },

    async listDependabotAlerts(repo, opts) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      const state = opts?.state ?? "open";
      const out: DependabotAlert[] = [];
      // Follow the Link rel="next" cursor (NOT a numeric `page` param — that is silently ignored
      // and would re-fetch page 1 forever, duplicating counts). The iteration cap is a runaway
      // backstop. Each request carries an abort timeout so a hung connection rejects (→ the
      // caller's try/catch → pnpm fallback) instead of stalling the whole sequential fleet sweep.
      let url: string | null =
        `${GITHUB_API}/repos/${owner}/${name}/dependabot/alerts?` +
        new URLSearchParams({ state, per_page: "100" }).toString();
      for (let i = 0; i < 100 && url; i++) {
        const res = await doFetch(url, {
          headers: baseHeaders,
          signal: AbortSignal.timeout(DEPENDABOT_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(
            `GitHub GET dependabot/alerts ${owner}/${name} failed (${res.status}): ${await bodyText(res)}`,
          );
        }
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new Error(`GitHub dependabot/alerts ${owner}/${name}: 200 with a non-JSON body`);
        }
        // The alerts endpoint returns a bare array; anything else means we're done.
        if (!Array.isArray(body)) break;
        for (const raw of body as Array<Record<string, unknown>>) {
          const mapped = mapDependabotAlert(raw);
          if (mapped) out.push(mapped);
        }
        url = nextLink(res.headers.get("link"));
      }
      return out;
    },
  };
}

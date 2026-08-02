import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";
import type { ExistingRuleset, RulesetPayload } from "./rulesets.js";

/** Aggregate CI state of a PR's head commit, normalized from GitHub's rollup. */
export type CiState = "passing" | "failing" | "pending" | "none";

/** GitHub's computed mergeability of a PR. `UNKNOWN` is transient — GitHub is
 *  still computing it (e.g. right after a push) — so it should be read as "not
 *  known to conflict", never as conflicting. */
export type PrMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/** A minimal open-PR summary with its head-commit CI rollup state + mergeability. */
export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  headRef: string;
  ciState: CiState;
  mergeable: PrMergeable;
};

/**
 * Reject a value before it's interpolated into a `gh api` URL path. The
 * `owner/repo` split methods already validate shape; this is the defense-in-depth
 * guard for the `branch` and file-`path` segments. An unexpected value (`..`, a
 * leading `/`, whitespace, or a URL-structural char like `?#%` or a backslash)
 * could otherwise retarget the endpoint (escape the intended path, smuggle a
 * query string, or traverse). Conservative by design — legit branch names like
 * `maint/self-updating-x` and paths like `.github/workflows/ci.yml` pass.
 *
 * Both branch refs (`maint/self-updating-x`) and file paths
 * (`.github/workflows/ci.yml`) legitimately contain `/`, so a single slash is
 * allowed; what's rejected is `..`, a leading `/`, whitespace, or a
 * URL-structural char (`?`, `#`, `%`, backslash) that could escape or retarget
 * the endpoint.
 */
export function assertUrlSegment(kind: "branch" | "path", value: string): void {
  const structural = /[\s?#%\\]|\.\./;
  if (value.length === 0 || value.startsWith("/") || structural.test(value)) {
    throw new Error(
      `unsafe ${kind} for gh api path (illegal characters or traversal): ${JSON.stringify(value)}`,
    );
  }
}

/** Map GitHub's `statusCheckRollup.state` enum to our normalized CiState. */
function mapRollupState(state: string | null | undefined): CiState {
  switch (state) {
    case "SUCCESS":
      return "passing";
    case "FAILURE":
    case "ERROR":
      return "failing";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return "none"; // null/undefined = no checks reported
  }
}

/** Coerce GitHub's `mergeable` enum to our PrMergeable. Anything unexpected
 *  (including the literal `UNKNOWN` GitHub returns while still computing) maps to
 *  `UNKNOWN` — i.e. "not known to conflict". Only an explicit `CONFLICTING` is. */
function mapMergeable(state: string | null | undefined): PrMergeable {
  return state === "MERGEABLE" || state === "CONFLICTING" ? state : "UNKNOWN";
}

export type GitHub = {
  openPullRequest: (
    repo: string,
    pr: { head: string; base: string; title: string; body: string },
  ) => Promise<{ url: string }>;
  /** Turn GitHub's platform auto-merge ON for a repo. Retained as the documented
   *  ROLLBACK path — the fleet drives repos to auto-merge OFF (see
   *  {@link disableRepoAutoMerge} and `recipes/self-updating`). */
  enableRepoAutoMerge: (repo: string) => Promise<void>;
  /** Turn GitHub's platform auto-merge OFF for a repo. This is the fleet default:
   *  platform auto-merge is a per-PR flag anyone with write access can arm, and it
   *  merges unattended outside Renovate's `packageRules`. Renovate merges from
   *  inside its own run instead. */
  disableRepoAutoMerge: (repo: string) => Promise<void>;
  protectBranch: (repo: string, branch: string, requiredChecks: string[]) => Promise<void>;
  setRepoSecret: (repo: string, name: string, value: string) => Promise<void>;
  repoExists: (repo: string) => Promise<boolean>;
  defaultBranch: (repo: string) => Promise<string>;
  filesOnBranch: (repo: string, branch: string, paths: string[]) => Promise<string[]>;
  /** The raw contents of `path` on `branch`, or null when the file is absent (404).
   *  Lets a caller detect a present-but-STALE file (content drift), where
   *  `filesOnBranch` only sees existence. */
  fileContentsOnBranch: (repo: string, branch: string, path: string) => Promise<string | null>;
  branchProtectionContexts: (repo: string, branch: string) => Promise<string[]>;
  secretExists: (repo: string, name: string) => Promise<boolean>;
  autoMergeEnabled: (repo: string) => Promise<boolean>;
  findOpenSelfUpdatingPR: (repo: string) => Promise<string | null>;
  /** All open PRs on a repo with each head commit's normalized CI rollup state. */
  openPullRequests: (repo: string) => Promise<PullRequestSummary[]>;
  /** The default branch's latest-commit date + normalized CI rollup, one query. */
  defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
  /** Renovate PRs (head `renovate/*`) merged at/after `sinceIso`. Used to record
   *  `pr_automerged` fleet events. gh-shell (Actions only). */
  mergedRenovatePullRequests: (
    repo: string,
    sinceIso: string,
  ) => Promise<Array<{ number: number; title: string; url: string; mergedAt: string }>>;
  /** Fire a `workflow_dispatch` for `<workflow>` (a filename like `renovate.yml`)
   *  on `ref`. Requires the token's `actions:write` scope; a 404 (no such
   *  workflow) or 403 (missing scope) surfaces as a thrown error. */
  dispatchWorkflow: (repo: string, workflow: string, ref: string) => Promise<void>;
  /** REPO-sourced rulesets only (`includes_parents=false`): org-level rulesets
   *  aren't ours to manage (and don't exist on the Free plan). */
  listRepoRulesets: (repo: string) => Promise<Array<{ id: number; name: string }>>;
  getRuleset: (repo: string, id: number) => Promise<ExistingRuleset>;
  createRuleset: (repo: string, payload: RulesetPayload) => Promise<void>;
  /** The update verb is PUT — `PATCH repos/{repo}/rulesets/{id}` returns 404
   *  (verified live 2026-08-01), so a PATCH-based update would silently no-op
   *  on every drifted repo while the recipe reported success. */
  updateRuleset: (repo: string, id: number, payload: RulesetPayload) => Promise<void>;
  /** True iff a check-run named `context` exists on `ref`'s HEAD commit. The
   *  evidence gate for requiring a status check: with an empty bypass list, a
   *  required context that never fires makes the repo permanently unmergeable
   *  by everyone — so a context must be OBSERVED before it is required.
   *  False-negatives (fresh repo, API hiccup) safely degrade to "don't require
   *  yet"; false-positives are impossible (we name-match real runs). */
  checkContextObserved: (repo: string, ref: string, context: string) => Promise<boolean>;
  /** "public" | "private" (| "internal" on GHEC). Rulesets on private repos
   *  need a paid plan, so callers gate on this rather than attempting. */
  repoVisibility: (repo: string) => Promise<string>;
  /** Every repo in the org (paginated) — the anti-hand-typed-list enumerator.
   *  Sweeps driven by a hand-maintained or Airtable-scoped list have already
   *  produced two false "all clear"s; enumerate from the API instead. */
  listOrgRepos: (
    org: string,
  ) => Promise<Array<{ name: string; visibility: string; archived: boolean }>>;
};

export function makeGitHub(deps: { token: string; spawn?: SpawnFn }): GitHub {
  const spawn = deps.spawn ?? defaultSpawn;
  const env = { ...process.env, GH_TOKEN: deps.token };

  async function gh(args: string[]): Promise<string> {
    const r = await spawn("gh", args, { env, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`gh ${args[0]} failed (code ${r.code}): ${r.stderr.trim()}`);
    return r.stdout;
  }

  /** `gh api` with a JSON request body. Ruleset payloads have nested arrays/
   *  objects that `-f`/`-F` field flags cannot express, and the spawn wrapper
   *  has no stdin — so the body rides a private temp file via `--input`. */
  async function ghJson(method: "POST" | "PUT", path: string, body: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "gh-json-"));
    const file = join(dir, "body.json");
    try {
      await writeFile(file, JSON.stringify(body), "utf-8");
      return await gh(["api", "-X", method, path, "--input", file]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    async openPullRequest(repo, pr) {
      const out = await gh([
        "pr",
        "create",
        "--repo",
        repo,
        "--head",
        pr.head,
        "--base",
        pr.base,
        "--title",
        pr.title,
        "--body",
        pr.body,
      ]);
      return { url: out.trim() };
    },
    async enableRepoAutoMerge(repo) {
      await gh(["api", "-X", "PATCH", `repos/${repo}`, "-F", "allow_auto_merge=true"]);
    },
    async disableRepoAutoMerge(repo) {
      await gh(["api", "-X", "PATCH", `repos/${repo}`, "-F", "allow_auto_merge=false"]);
    },
    async protectBranch(repo, branch, requiredChecks) {
      assertUrlSegment("branch", branch);
      const args = [
        "api",
        "-X",
        "PUT",
        `repos/${repo}/branches/${branch}/protection`,
        "-H",
        "Accept: application/vnd.github+json",
        "-F",
        "required_status_checks[strict]=true",
        ...requiredChecks.flatMap((c) => ["-f", `required_status_checks[contexts][]=${c}`]),
        "-F",
        "enforce_admins=true",
        "-F",
        "required_pull_request_reviews=null",
        "-F",
        "restrictions=null",
      ];
      await gh(args);
    },
    async setRepoSecret(repo, name, value) {
      await gh(["secret", "set", name, "--repo", repo, "--body", value]);
    },
    async repoExists(repo) {
      const r = await spawn("gh", ["api", `repos/${repo}`], { env, timeoutMs: 60_000 });
      return r.code === 0;
    },
    async defaultBranch(repo) {
      const out = await gh(["api", `repos/${repo}`, "--jq", ".default_branch"]);
      return out.trim();
    },
    // filesOnBranch and branchProtectionContexts call `spawn` directly (not the
    // throwing `gh()` helper) because a 404 is an expected, meaningful answer —
    // "file/protection absent" — not an error. The remaining readers use `gh()`
    // since a non-200 there is a genuine failure (e.g. missing token scope).
    async filesOnBranch(repo, branch, paths) {
      assertUrlSegment("branch", branch);
      const present: string[] = [];
      for (const p of paths) {
        assertUrlSegment("path", p);
        const r = await spawn("gh", [`api`, `repos/${repo}/contents/${p}?ref=${branch}`], {
          env,
          timeoutMs: 60_000,
        });
        if (r.code === 0) present.push(p);
      }
      return present;
    },
    async fileContentsOnBranch(repo, branch, path) {
      // Same spawn-directly rationale as filesOnBranch: a 404 (file absent) is an
      // expected answer (null), not an error. The `raw` media type returns the file
      // bytes verbatim (no base64 envelope) so the result compares directly against a
      // canonical template.
      assertUrlSegment("branch", branch);
      assertUrlSegment("path", path);
      const r = await spawn(
        "gh",
        [
          "api",
          `repos/${repo}/contents/${path}?ref=${branch}`,
          "-H",
          "Accept: application/vnd.github.raw",
        ],
        { env, timeoutMs: 60_000 },
      );
      if (r.code !== 0) return null; // 404 = file absent on this branch
      return r.stdout;
    },
    async branchProtectionContexts(repo, branch) {
      assertUrlSegment("branch", branch);
      const r = await spawn(
        "gh",
        [
          "api",
          `repos/${repo}/branches/${branch}/protection`,
          "--jq",
          ".required_status_checks.contexts[]?",
        ],
        { env, timeoutMs: 60_000 },
      );
      if (r.code !== 0) return []; // 404 = no protection configured
      return r.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    },
    async secretExists(repo, name) {
      // per_page=100: the REST default of 30 would false-negative on a repo with >30 secrets,
      // wrongly reporting an existing secret absent (→ a needless overwrite).
      const out = await gh([
        "api",
        `repos/${repo}/actions/secrets?per_page=100`,
        "--jq",
        ".secrets[].name",
      ]);
      return out
        .split("\n")
        .map((l) => l.trim())
        .includes(name);
    },
    async autoMergeEnabled(repo) {
      const out = await gh(["api", `repos/${repo}`, "--jq", ".allow_auto_merge"]);
      return out.trim() === "true";
    },
    async findOpenSelfUpdatingPR(repo) {
      // per_page=100: with the REST default of 30, a repo with >30 open PRs (plausible under
      // Renovate) could page past the existing self-updating PR and open a duplicate.
      const out = await gh([
        "api",
        `repos/${repo}/pulls?state=open&per_page=100`,
        "--jq",
        '.[] | select(.head.ref | startswith("maint/self-updating-")) | .html_url',
      ]);
      const first = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      return first ?? null;
    },
    async openPullRequests(repo) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`openPullRequests: expected "owner/repo", got "${repo}"`);
      }
      const query =
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
        "pullRequests(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:DESC}){nodes{number title url headRefName mergeable " +
        "commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}";
      const out = await gh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
      ]);
      const parsed = JSON.parse(out) as {
        data?: {
          repository?: {
            pullRequests?: {
              nodes?: Array<{
                number: number;
                title: string;
                url: string;
                headRefName: string;
                mergeable?: string;
                commits?: {
                  nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } } }>;
                };
              }>;
            };
          };
        };
      };
      const nodes = parsed.data?.repository?.pullRequests?.nodes ?? [];
      return nodes.map((n) => ({
        number: n.number,
        title: n.title,
        url: n.url,
        headRef: n.headRefName,
        ciState: mapRollupState(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
        mergeable: mapMergeable(n.mergeable),
      }));
    },
    async defaultBranchStatus(repo) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`defaultBranchStatus: expected "owner/repo", got "${repo}"`);
      }
      const query =
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
        "defaultBranchRef{target{... on Commit{committedDate statusCheckRollup{state}}}}}}";
      const out = await gh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
      ]);
      const parsed = JSON.parse(out) as {
        data?: {
          repository?: {
            defaultBranchRef?: {
              target?: { committedDate?: string; statusCheckRollup?: { state?: string } | null };
            } | null;
          };
        };
      };
      const target = parsed.data?.repository?.defaultBranchRef?.target;
      return {
        ciState: mapRollupState(target?.statusCheckRollup?.state),
        lastCommitAt: target?.committedDate ?? null,
      };
    },
    async mergedRenovatePullRequests(repo, sinceIso) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`mergedRenovatePullRequests: expected "owner/repo", got "${repo}"`);
      }
      // per_page=50: comfortably covers a week of Renovate merges on one repo. The
      // list endpoint returns merged_at + head.ref, so the filter is local.
      const out = await gh([
        "api",
        `repos/${owner}/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
      ]);
      const arr = JSON.parse(out) as Array<{
        number: number;
        title: string;
        html_url: string;
        merged_at: string | null;
        head?: { ref?: string };
      }>;
      return arr
        .filter(
          (p) =>
            p.merged_at !== null &&
            p.merged_at >= sinceIso && // ISO8601 UTC strings sort lexicographically
            (p.head?.ref ?? "").startsWith("renovate/"),
        )
        .map((p) => ({
          number: p.number,
          title: p.title,
          url: p.html_url,
          mergedAt: p.merged_at as string,
        }));
    },
    async dispatchWorkflow(repo, workflow, ref) {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        throw new Error(`dispatchWorkflow: expected "owner/repo", got "${repo}"`);
      }
      // Every segment interpolates into the API path, so guard them all like the
      // other write methods do (defense in depth). `owner`/`name` are the most
      // operator-controlled (typed into Airtable's "Git repo"); `workflow` is a
      // constant today; `ref` is repo-sourced. A junk value like `repo?x=1` would
      // otherwise smuggle a query string past the bare two-part shape check.
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      assertUrlSegment("path", workflow);
      assertUrlSegment("branch", ref);
      await gh([
        "api",
        "-X",
        "POST",
        `repos/${owner}/${name}/actions/workflows/${workflow}/dispatches`,
        "-f",
        `ref=${ref}`,
      ]);
    },
    async listRepoRulesets(repo) {
      // includes_parents=false: only rulesets SOURCED on this repo are ours to
      // heal; an org-level ruleset (paid plans) must never be PUT from here.
      const out = await gh([
        "api",
        `repos/${repo}/rulesets?per_page=100&includes_parents=false`,
        "--jq",
        '.[] | "\\(.id)\\t\\(.name)"',
      ]);
      return out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          const tab = l.indexOf("\t");
          return { id: Number(l.slice(0, tab)), name: l.slice(tab + 1) };
        });
    },
    async getRuleset(repo, id) {
      const out = await gh(["api", `repos/${repo}/rulesets/${Math.trunc(id)}`]);
      return JSON.parse(out) as ExistingRuleset;
    },
    async createRuleset(repo, payload) {
      await ghJson("POST", `repos/${repo}/rulesets`, payload);
    },
    async updateRuleset(repo, id, payload) {
      // PUT, not PATCH: PATCH on this endpoint 404s (verified live 2026-08-01),
      // which a naive implementation would surface as "update failed" at best —
      // or, with a lenient error path, as a silent no-op reported as healed.
      await ghJson("PUT", `repos/${repo}/rulesets/${Math.trunc(id)}`, payload);
    },
    async checkContextObserved(repo, ref, context) {
      assertUrlSegment("branch", ref);
      // spawn-direct (not the throwing gh()): a 404/409 — empty repo, no commits
      // on the ref yet — is an expected answer meaning "no evidence", not an
      // error. Any failure degrades to false, i.e. "don't require the check
      // yet", which is the safe direction (see checkContextObserved's contract).
      const r = await spawn(
        "gh",
        [
          "api",
          `repos/${repo}/commits/${ref}/check-runs?per_page=100`,
          "--jq",
          ".check_runs[].name",
        ],
        { env, timeoutMs: 60_000 },
      );
      if (r.code !== 0) return false;
      return r.stdout
        .split("\n")
        .map((l) => l.trim())
        .includes(context);
    },
    async repoVisibility(repo) {
      const out = await gh(["api", `repos/${repo}`, "--jq", ".visibility"]);
      return out.trim();
    },
    async listOrgRepos(org) {
      assertUrlSegment("path", org);
      // --paginate: the org is >27 repos and the default page of 30 is exactly
      // the trap that produced the 2026-07-31 false "queue is empty".
      const out = await gh([
        "api",
        "--paginate",
        `orgs/${org}/repos?per_page=100`,
        "--jq",
        '.[] | "\\(.name)\\t\\(.visibility)\\t\\(.archived)"',
      ]);
      return out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          const [name = "", visibility = "", archived = ""] = l.split("\t");
          return { name, visibility, archived: archived === "true" };
        });
    },
  };
}

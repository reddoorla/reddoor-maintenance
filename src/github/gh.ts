import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";

/** Aggregate CI state of a PR's head commit, normalized from GitHub's rollup. */
export type CiState = "passing" | "failing" | "pending" | "none";

/** A minimal open-PR summary with its head-commit CI rollup state. */
export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  headRef: string;
  ciState: CiState;
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
function assertUrlSegment(kind: "branch" | "path", value: string): void {
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

export type GitHub = {
  openPullRequest: (
    repo: string,
    pr: { head: string; base: string; title: string; body: string },
  ) => Promise<{ url: string }>;
  enableRepoAutoMerge: (repo: string) => Promise<void>;
  protectBranch: (repo: string, branch: string, requiredChecks: string[]) => Promise<void>;
  setRepoSecret: (repo: string, name: string, value: string) => Promise<void>;
  repoExists: (repo: string) => Promise<boolean>;
  defaultBranch: (repo: string) => Promise<string>;
  filesOnBranch: (repo: string, branch: string, paths: string[]) => Promise<string[]>;
  branchProtectionContexts: (repo: string, branch: string) => Promise<string[]>;
  secretExists: (repo: string, name: string) => Promise<boolean>;
  autoMergeEnabled: (repo: string) => Promise<boolean>;
  findOpenSelfUpdatingPR: (repo: string) => Promise<string | null>;
  /** All open PRs on a repo with each head commit's normalized CI rollup state. */
  openPullRequests: (repo: string) => Promise<PullRequestSummary[]>;
  /** The default branch's latest-commit date + normalized CI rollup, one query. */
  defaultBranchStatus: (repo: string) => Promise<{ ciState: CiState; lastCommitAt: string | null }>;
};

export function makeGitHub(deps: { token: string; spawn?: SpawnFn }): GitHub {
  const spawn = deps.spawn ?? defaultSpawn;
  const env = { ...process.env, GH_TOKEN: deps.token };

  async function gh(args: string[]): Promise<string> {
    const r = await spawn("gh", args, { env, timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`gh ${args[0]} failed (code ${r.code}): ${r.stderr.trim()}`);
    return r.stdout;
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
      const out = await gh(["api", `repos/${repo}/actions/secrets`, "--jq", ".secrets[].name"]);
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
      const out = await gh([
        "api",
        `repos/${repo}/pulls?state=open`,
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
        "pullRequests(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:DESC}){nodes{number title url headRefName " +
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
  };
}

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
   *  produced two false "all clear"s; enumerate from the API instead.
   *  secretScanning/pushProtection come from the same listing (no extra call);
   *  "unavailable" means the token couldn't read security_and_analysis (needs
   *  admin/security read) — callers must treat that as unverified, not fine. */
  listOrgRepos: (org: string) => Promise<
    Array<{
      name: string;
      visibility: string;
      archived: boolean;
      secretScanning: string;
      pushProtection: string;
    }>
  >;
  /** Liveness of one workflow file: registered? state? when did it last
   *  SUCCEED? Success, not mere existence of a run: a dead credential or
   *  broken config still CREATES a run on every cron tick that fails in
   *  seconds, keeping created_at perpetually fresh — counting those as alive
   *  is exactly the silent-stop blindness this probe exists to catch.
   *  A clean 404 is the answer `{present: false}` — any OTHER failure throws,
   *  because "couldn't check" must never read as "healthy" downstream. */
  workflowHealth: (repo: string, filename: string) => Promise<WorkflowHealth>;
  /** Renovate's own Dependency Dashboard issue, which is the only place it
   *  reports branches it has DECIDED TO STOP MANAGING. workflowHealth answers
   *  "did Renovate run?"; this answers "was it allowed to do anything?" — a
   *  distinction that cost the fleet 9 repos of frozen updates (see
   *  renovateBlockedGaps). Absent dashboard is the answer `{present:false}`,
   *  not an error: `dependencyDashboard` is a config a repo may disable. */
  dependencyDashboard: (repo: string) => Promise<DependencyDashboard>;
  /** Tip commit of one branch, or `null` if the branch is gone — which is the
   *  answer, not an error: a dashboard naming a deleted branch is simply one
   *  Renovate has not rewritten yet. */
  branchTip: (repo: string, branch: string) => Promise<BranchTip | null>;
};

export type WorkflowHealth =
  { present: false } | { present: true; state: string; lastSuccessAt: string | null };

export type DependencyDashboard =
  { present: false } | { present: true; blockedBranches: string[]; unknownSections: string[] };

/** Tip commit of a branch. `authorIsMachine` answers "does any human own this
 *  branch?" — see renovateBlockedGaps for why that decides whether a blocked
 *  branch is an orphan or a human's in-flight work. */
export type BranchTip = { authorIsMachine: boolean; committedAt: string };

/** The section headings Renovate is known to emit, normalised to lowercase.
 *  Sourced from lib/workers/repository/dependency-dashboard.ts at both live
 *  majors — the wording moved once already (see BLOCKED_SECTION_RE), so the
 *  legacy spellings stay in the set. Anything OUTSIDE this set means our
 *  vocabulary has drifted from Renovate's and the blocked check can no longer
 *  be trusted; parseUnknownSections reports it rather than reading silence as
 *  health. */
const KNOWN_DASHBOARD_SECTIONS = new Set([
  // 43+
  "pending approval",
  "group size not met",
  "awaiting schedule",
  "rate-limited",
  "errored",
  "pr creation approval required",
  "pr edited (blocked)",
  "pending status checks",
  "pending branch automerge",
  "other branches",
  "open",
  "pr closed (blocked)",
  "repository problems",
  "config migration needed",
  "config migration needed (blocked)",
  "deprecations / replacements",
  "abandoned dependencies",
  "vulnerabilities",
  "detected dependencies",
  // <=42, kept so an older self-hosted Renovate does not read as drift
  "edited/blocked",
  "ignored or blocked",
]);

/** Both spellings of the "I have stopped managing these branches" heading.
 *  Renovate renamed it `Edited/Blocked` -> `PR Edited (Blocked)` in 43.0.0,
 *  and the fleet takes its Renovate major from whatever renovatebot/github-action
 *  bakes in — so an ordinary action bump moves it. Matching only the current
 *  wording would make this surface silently blind on the next rename. */
const BLOCKED_SECTION_RE = /^#{1,2}\s+(?:PR Edited \(Blocked\)|Edited\/Blocked)\s*$/i;

/** `##` (or the `# ---` join separator) opens a new section; `###` does NOT.
 *  Renovate emits `### <category>` subheadings INSIDE a section when
 *  dependencyDashboardCategory is set, and treating those as boundaries would
 *  truncate the blocked list to nothing. */
const SECTION_HEADING_RE = /^#{1,2}\s+(.*?)\s*$/;

/**
 * Pull the branches Renovate has given up on out of a Dependency Dashboard
 * body. They live under the blocked heading — "The following updates have been
 * manually edited so Renovate will no longer make changes." — each as a
 * `<!-- rebase-branch=NAME -->` marker.
 *
 * Section-scoped on purpose: `rebase-branch=` markers also appear under "Open"
 * (where they mean "tick to rebase", i.e. perfectly healthy — 11 fleet repos
 * carry them today), so a whole-body grep would report those repos as blocked.
 * `PR Closed (Blocked)` is deliberately NOT read: it is Renovate's ledger of
 * operator instructions it has honoured (closing a Renovate PR is the
 * documented ignore idiom) and it uses `recreate-branch=`, not `rebase-branch=`.
 */
export function parseBlockedBranches(body: string): string[] {
  const found: string[] = [];
  let inBlocked = false;
  for (const line of body.split("\n")) {
    if (SECTION_HEADING_RE.test(line)) {
      inBlocked = BLOCKED_SECTION_RE.test(line);
      continue;
    }
    if (!inBlocked) continue;
    const marker = line.match(/rebase-branch=([^\s>]+)/);
    if (marker?.[1]) found.push(marker[1]);
  }
  return [...new Set(found)];
}

/**
 * Section headings in a dashboard body that Renovate is not known to emit.
 * `parseBlockedBranches` returning `[]` is ambiguous — it means both "nothing
 * is blocked" and "I did not understand this dashboard" — and this is what
 * separates them, so a heading rename cannot turn the whole fleet green in
 * silence. Same doctrine as workflowHealth: "couldn't check" must never read
 * as "healthy" downstream.
 */
export function parseUnknownSections(body: string): string[] {
  const unknown: string[] = [];
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.*?)\s*$/);
    const title = heading?.[1];
    if (!title) continue;
    if (!KNOWN_DASHBOARD_SECTIONS.has(title.toLowerCase())) unknown.push(title);
  }
  return [...new Set(unknown)];
}

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
        .filter((l) => l.includes("\t")) // a tab-less line has no id/name split — never fabricate a NaN row from it
        .map((l) => {
          const tab = l.indexOf("\t");
          return { id: Number(l.slice(0, tab)), name: l.slice(tab + 1) };
        })
        .filter((r) => Number.isSafeInteger(r.id));
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
        '.[] | "\\(.name)\\t\\(.visibility)\\t\\(.archived)\\t\\(.security_and_analysis.secret_scanning.status // "unavailable")\\t\\(.security_and_analysis.secret_scanning_push_protection.status // "unavailable")"',
      ]);
      return out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          const [name = "", visibility = "", archived = "", ss = "", pp = ""] = l.split("\t");
          return {
            name,
            visibility,
            archived: archived === "true",
            secretScanning: ss || "unavailable",
            pushProtection: pp || "unavailable",
          };
        });
    },
    async workflowHealth(repo, filename) {
      // spawn-direct for the workflow GET: 404 (file not registered as a
      // workflow) is an expected ANSWER, not an error. Everything else throws —
      // per the contract, an unreadable workflow must surface as unverified.
      const wf = await spawn(
        "gh",
        ["api", `repos/${repo}/actions/workflows/${filename}`, "--jq", ".state"],
        { env, timeoutMs: 60_000 },
      );
      if (wf.code !== 0) {
        if (/HTTP 404/.test(wf.stderr)) return { present: false };
        throw new Error(`workflowHealth(${repo}/${filename}) failed: ${wf.stderr.trim()}`);
      }
      // status=success: filter to runs that actually CONCLUDED success. Without
      // it, a schedule whose every run fails (revoked App key, broken config)
      // reads as hours-fresh forever while zero updates flow.
      const runs = await gh([
        "api",
        `repos/${repo}/actions/workflows/${filename}/runs?status=success&per_page=1`,
        "--jq",
        '.workflow_runs[0].created_at // ""',
      ]);
      return { present: true, state: wf.stdout.trim(), lastSuccessAt: runs.trim() || null };
    },
    async dependencyDashboard(repo) {
      // Every open Dependency Dashboard, not just the first: the App-identity
      // migration left several repos holding TWO (alamo-anatomy had #3 and
      // #39), and the stale one is not always the one carrying the blocked
      // section. `select(.pull_request | not)` because /issues returns PRs too.
      //
      // --paginate is load-bearing, not defensive: /issues returns issues AND
      // PRs newest-first, the dashboard is created at onboarding and so is
      // typically the OLDEST open issue in the repo, and the title filter runs
      // client-side in jq AFTER the page cut. Without it, a repo with 100 open
      // items newer than its dashboard reads as {present:false} — which this
      // surface deliberately treats as not-a-gap, i.e. a blocked repo would
      // report clean. (Verified against renovatebot/renovate itself, whose
      // dashboard is issue #2958 from 2018 and carries a live blocked section.)
      const out = await gh([
        "api",
        "--paginate",
        `repos/${repo}/issues?state=open&per_page=100`,
        "--jq",
        '[.[] | select(.pull_request | not) | select(.title == "Dependency Dashboard") | (.body // "")] | join("\\n# ---\\n")',
      ]);
      const body = out.trim();
      if (body.length === 0) return { present: false };
      return {
        present: true,
        blockedBranches: parseBlockedBranches(body),
        unknownSections: parseUnknownSections(body),
      };
    },
    async branchTip(repo, branch) {
      // Raw, not percent-encoded: the ref segment legitimately contains `/`
      // (`renovate/all-minor-patch`) and GitHub resolves it as a ref only when
      // the slash is literal. assertUrlSegment is what keeps that safe.
      assertUrlSegment("branch", branch);
      let out: string;
      try {
        out = await gh([
          "api",
          `repos/${repo}/commits/${branch}`,
          "--jq",
          // .author is the GitHub ACCOUNT (null when the commit email matches
          // none), .commit.author is the raw git identity, which always exists.
          '{type: (.author.type // ""), login: (.author.login // ""), email: .commit.author.email, name: .commit.author.name, date: .commit.committer.date}',
        ]);
      } catch (e) {
        if (/HTTP 404/.test(e instanceof Error ? e.message : String(e))) return null;
        throw e;
      }
      const raw = JSON.parse(out) as {
        type: string;
        login: string;
        email: string;
        name: string;
        date: string;
      };
      return { authorIsMachine: isMachineAuthor(raw), committedAt: raw.date };
    },
  };
}

/**
 * Does this commit have a human behind it? Deliberately NOT just
 * `.author.type === "Bot"`: the identity whose orphaned branches froze nine
 * repos in August 2026 was `renovate-bot`, a PAT-driven machine account that
 * GitHub reports as type `User`. A rule keyed on the Bot type would have
 * missed the exact incident this audit exists to catch, so the known machine
 * logins are matched by name too.
 *
 * A miss here costs latency, never blindness — renovateBlockedGaps still
 * reports any blocked branch once it goes stale, whoever authored it.
 */
export function isMachineAuthor(commit: {
  type: string;
  login: string;
  email: string;
  name: string;
}): boolean {
  if (commit.type === "Bot") return true;
  return [commit.login, commit.email, commit.name].some((f) =>
    /(\[bot\]|^renovate-bot$|^renovate-bot@)/i.test(f ?? ""),
  );
}

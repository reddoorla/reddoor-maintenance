import { defaultSpawn, type SpawnFn } from "../audits/util/spawn.js";

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
      const present: string[] = [];
      for (const p of paths) {
        const r = await spawn("gh", [`api`, `repos/${repo}/contents/${p}?ref=${branch}`], {
          env,
          timeoutMs: 60_000,
        });
        if (r.code === 0) present.push(p);
      }
      return present;
    },
    async branchProtectionContexts(repo, branch) {
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
  };
}

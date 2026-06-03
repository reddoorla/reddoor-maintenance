import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { templatesByName } from "../sync-configs/templates.js";
import { getRemoteUrl, parseOwnerRepo, push as gitPush } from "../../util/git.js";
import { readGitHubConfig } from "../../github/config.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";

const SELF_UPDATING_CONFIGS = ["ci", "renovate-action", "renovate-config"] as const;

export type SelfUpdatingDeps = {
  github?: GitHub;
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  renovateToken?: string;
};

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function resolveRepo(site: Site): Promise<string | null> {
  if (site.gitRepo) return site.gitRepo;
  try {
    return parseOwnerRepo(await getRemoteUrl(site.path));
  } catch {
    return null;
  }
}

export async function selfUpdating(site: Site, deps: SelfUpdatingDeps = {}): Promise<RecipeResult> {
  const templates = templatesByName([...SELF_UPDATING_CONFIGS]);

  return withRecipe<{ repo: string; renovateToken: string }>({
    name: "self-updating",
    site,
    plan: async () => {
      const repo = await resolveRepo(site);
      if (!repo) {
        return {
          kind: "failed",
          notes: "no Git repo (set Airtable 'Git repo' or add an origin remote)",
        };
      }

      const cfg = readGitHubConfig();
      const renovateToken = deps.renovateToken ?? cfg?.renovateToken;
      if (!deps.github && !cfg) return { kind: "failed", notes: "GITHUB_TOKEN not set" };
      if (!renovateToken) return { kind: "failed", notes: "no RENOVATE_TOKEN available" };

      let drift = false;
      for (const t of templates) {
        if ((await readMaybe(join(site.path, t.path))) !== t.contents) drift = true;
      }
      if (!drift) return { kind: "noop", notes: "self-updating files already in place" };
      return { kind: "apply", plan: { repo, renovateToken } };
    },
    apply: async (planned, { commit, branch, cwd }) => {
      for (const t of templates) {
        const dest = join(cwd, t.path);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, t.contents, "utf-8");
      }
      await commit("ci: enable self-updating (CI + Renovate auto-merge)");

      const push = deps.pushBranch ?? gitPush;
      await push(cwd, branch);

      const github = deps.github ?? makeGitHub({ token: readGitHubConfig()!.token });
      const base = await github.defaultBranch(planned.repo).catch(() => "main");
      const pr = await github.openPullRequest(planned.repo, {
        head: branch,
        base,
        title: "Enable self-updating (CI + Renovate)",
        body: "Adds the unified CI gate, nightly Renovate, and auto-merge for patch/minor updates.",
      });
      await github.enableRepoAutoMerge(planned.repo);
      await github.protectBranch(planned.repo, base, ["ci"]);
      await github.setRepoSecret(planned.repo, "RENOVATE_TOKEN", planned.renovateToken);

      return { kind: "ok", notes: `self-updating enabled — PR ${pr.url}` };
    },
  });
}

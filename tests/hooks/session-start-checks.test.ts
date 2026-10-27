import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The SessionStart checks hook, end to end against REAL git repositories. Each fixture is
 * a bare `origin`, a main checkout `repo` on `main`, a second clone `pusher` that lands
 * commits on origin, and a worktree under `repo/.claude/worktrees/` that is the hook's
 * `cwd` — the shape a worker session actually runs in. `repo` then FETCHES, so its
 * `origin/main` moves while its HEAD does not: behind as of the last fetch, exactly the
 * state the hook reads. Nothing is mocked.
 *
 * The memory-index cases point CLAUDE_PROJECTS_DIR at a temp directory, which every run
 * here sets, so the operator's real index can never leak into a verdict.
 */

const HOOK = fileURLToPath(
  new URL("../../scripts/hooks/session-start-checks.mjs", import.meta.url),
);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: GIT_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });

interface Fixture {
  repo: string;
  worktree: string;
}

async function commitFiles(cwd: string, files: Record<string, string>, message: string) {
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), body);
  }
  // -f: a user-level git ignore file (git reads ~/.config/git/ignore even with
  // GIT_CONFIG_GLOBAL=/dev/null) can list `.claude/`, which silently dropped the settings
  // file from the first version of this fixture — and only the FAIL control noticed.
  git(cwd, "add", "-f", "--", ...Object.keys(files));
  git(cwd, "-c", "commit.gpgsign=false", "commit", "-m", message);
}

/** origin + main checkout + worktree; `landed` is committed on origin AFTER the checkout,
 *  then fetched — never pulled. */
async function fixture(name: string, landed?: Record<string, string>): Promise<Fixture> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), `ss-checks-${name}-`)));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  git(root, "init", "--bare", "-b", "main", "origin.git");
  git(root, "init", "-b", "main", "repo");
  await commitFiles(
    repo,
    { "README.md": "seed\n", ".claude/settings.json": "{}\n", "docs/notes.md": "one\n" },
    "seed",
  );
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-u", "origin", "main");

  const worktree = join(repo, ".claude", "worktrees", "wt");
  git(repo, "worktree", "add", "-b", "feat/wt", worktree, "origin/main");

  if (landed) {
    git(root, "clone", "-b", "main", origin, "pusher");
    await commitFiles(join(root, "pusher"), landed, "landed on main");
    git(join(root, "pusher"), "push", "origin", "main");
    git(repo, "fetch", "origin");
  }
  return { repo, worktree };
}

function runHook(
  stdin: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (c: string) => (stdout += c));
    child.stderr.on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const input = (cwd: string, source = "startup") =>
  JSON.stringify({
    session_id: "sess-x",
    transcript_path: "/dev/null",
    cwd,
    hook_event_name: "SessionStart",
    source,
  });

function payload(stdout: string) {
  const out = JSON.parse(stdout) as {
    systemMessage?: string;
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
  expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
  expect(out.systemMessage).toBe(out.hookSpecificOutput?.additionalContext);
  return out.hookSpecificOutput?.additionalContext ?? "";
}

const projectDirName = (p: string) => p.replace(/[^A-Za-z0-9]/g, "-");

let settingsBehind: Fixture;
let docsBehind: Fixture;
let upToDate: Fixture;
let emptyProjects: string;

beforeAll(async () => {
  [settingsBehind, docsBehind, upToDate] = await Promise.all([
    fixture("settings", {
      ".claude/settings.json": '{"hooks":{}}\n',
      "docs/notes.md": "two\n",
    }),
    fixture("docs", { "docs/notes.md": "two\n", "src/a.ts": "export {};\n" }),
    fixture("uptodate"),
  ]);
  emptyProjects = realpathSync(await mkdtemp(join(tmpdir(), "ss-checks-projects-")));
  // Matched to testTimeout, as in subagent-stop-guard.test.ts: ~30 git subprocesses on a
  // loaded machine can overrun the 10 s hookTimeout default.
}, 120_000);

describe("SessionStart checks: a stale main checkout", () => {
  it("FAIL control: behind origin/main with a .claude/settings.json change warns, naming only config paths", async () => {
    // the fixture is what it claims: HEAD is behind the fetched origin/main by one commit
    expect(git(settingsBehind.repo, "rev-list", "--count", "HEAD..origin/main").trim()).toBe("1");

    const { code, stdout, stderr } = await runHook(input(settingsBehind.worktree), {
      CLAUDE_PROJECTS_DIR: emptyProjects,
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const text = payload(stdout);
    expect(text).toContain(
      `STALE MAIN CHECKOUT: ${settingsBehind.repo} is 1 commit behind origin/main as of the last fetch`,
    );
    expect(text).toContain("  - .claude/settings.json");
    expect(text).not.toContain("docs/notes.md");
    expect(text).toContain("until the operator pulls");
    expect(text).not.toContain("MEMORY INDEX");
  });

  it("PASS control: behind on docs and src only is silent", async () => {
    expect(git(docsBehind.repo, "rev-list", "--count", "HEAD..origin/main").trim()).toBe("1");
    const { code, stdout, stderr } = await runHook(input(docsBehind.worktree), {
      CLAUDE_PROJECTS_DIR: emptyProjects,
    });
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("up to date with origin/main is silent, from the worktree and from the main checkout", async () => {
    for (const cwd of [upToDate.worktree, upToDate.repo]) {
      const { code, stdout, stderr } = await runHook(input(cwd, "resume"), {
        CLAUDE_PROJECTS_DIR: emptyProjects,
      });
      expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });
});

describe("SessionStart checks: the memory index", () => {
  async function projectsWithIndex(body: string): Promise<string> {
    const projects = realpathSync(await mkdtemp(join(tmpdir(), "ss-checks-mem-")));
    const dir = join(projects, projectDirName(upToDate.repo), "memory");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "MEMORY.md"), body);
    return projects;
  }

  const lines = (n: number, width = 20) =>
    Array.from({ length: n }, (_, i) => `- entry ${String(i).padStart(width, "x")}`).join("\n") +
    "\n";

  it("FAIL control: over 160 lines warns with both numbers and the limit", async () => {
    const projects = await projectsWithIndex(lines(170));
    const { code, stdout, stderr } = await runHook(input(upToDate.worktree), {
      CLAUDE_PROJECTS_DIR: projects,
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    const text = payload(stdout);
    expect(text).toMatch(
      /MEMORY INDEX NEAR ITS LOAD LIMIT: .*MEMORY\.md is 170 lines \/ [\d,]+ bytes\./,
    );
    expect(text).toContain("first 200 lines or 25,000 bytes");
    expect(text).toContain("silently not loaded");
    expect(text).not.toContain("STALE MAIN CHECKOUT");
  });

  it("FAIL control: few lines but over 20,000 bytes also warns", async () => {
    const projects = await projectsWithIndex(lines(40, 600));
    const { stdout } = await runHook(input(upToDate.worktree), { CLAUDE_PROJECTS_DIR: projects });
    expect(payload(stdout)).toMatch(/is 40 lines \/ 2\d,\d{3} bytes\./);
  });

  it("PASS control: under both thresholds, or no index at all, is silent", async () => {
    for (const projects of [await projectsWithIndex(lines(150)), emptyProjects]) {
      const { code, stdout, stderr } = await runHook(input(upToDate.worktree), {
        CLAUDE_PROJECTS_DIR: projects,
      });
      expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
    }
  });
});

describe("SessionStart checks: never in the way", () => {
  it("a cwd outside any git repo is silent and exits 0", async () => {
    const plain = realpathSync(await mkdtemp(join(tmpdir(), "ss-checks-plain-")));
    const { code, stdout, stderr } = await runHook(input(plain), {
      CLAUDE_PROJECTS_DIR: emptyProjects,
    });
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("stdin that is not JSON prints nothing on stdout and exits 0", async () => {
    const { code, stdout } = await runHook("not json", { CLAUDE_PROJECTS_DIR: emptyProjects });
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });
});

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultSyncDeps,
  forPull,
  gitAuthArgs,
  makeSyncGitHub,
  siteProcessEnv,
  prismicSync,
  SYNC_AUTHOR,
  SYNC_BRANCH,
  type OpenPr,
  type PrismicSyncDeps,
  type SyncGitHub,
} from "../../src/cli/commands/prismic-sync.js";
import type { PrismicModelsDeps } from "../../src/cli/commands/prismic-models.js";
import type { RemoteEntry } from "../../src/prismic/models/types.js";

const run = promisify(execFile);

let tmp: string;
let origin: string;
let seedDir: string;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "prismic-sync-")));
  origin = join(tmp, "origin.git");
  seedDir = join(tmp, "seed");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const git = async (args: string[], cwd: string): Promise<string> =>
  (await run("git", args, { cwd })).stdout.trim();

const PAGE = { id: "page", label: "Page", repeatable: true, json: { Main: {} } };
const HERO = {
  id: "hero",
  type: "SharedSlice",
  name: "Hero",
  variations: [{ id: "default", name: "Default", primary: { title: { type: "Text" } } }],
};

type Files = Record<string, unknown>;

/** A bare origin whose `main` holds `files`. Non-fast-forward pushes are
 *  refused there, so a force-push anywhere in the sync fails the test. */
async function makeOrigin(files: Files, migrated = true): Promise<void> {
  await git(["init", "--quiet", "--bare", "--initial-branch=main", origin], tmp);
  await git(["config", "receive.denyNonFastForwards", "true"], origin);
  await git(["init", "--quiet", "--initial-branch=main", seedDir], tmp);
  const config = { repositoryName: "fixture", libraries: ["./src/lib/slices"] };
  const all: Files = {
    [migrated ? "prismic.config.json" : "slicemachine.config.json"]: config,
    ".gitignore": "node_modules\n",
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    await mkdir(dirname(join(seedDir, rel)), { recursive: true });
    await writeFile(
      join(seedDir, rel),
      typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n",
      "utf-8",
    );
  }
  await commitAll(seedDir, "seed");
  await git(["remote", "add", "origin", origin], seedDir);
  await git(["push", "--quiet", "origin", "main"], seedDir);
}

async function commitAll(dir: string, msg: string): Promise<void> {
  await git(["add", "-A"], dir);
  await git(
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", msg],
    dir,
  );
}

const STANDARD: Files = {
  "customtypes/page/index.json": PAGE,
  "src/lib/slices/Hero/model.json": HERO,
};

type FakePr = OpenPr & {
  head: string;
  base: string;
  title: string;
  body: string;
  open: boolean;
  closedAt?: string;
};

function fakeGitHub(): SyncGitHub & { prs: FakePr[]; comments: string[] } {
  const prs: FakePr[] = [];
  const comments: string[] = [];
  return {
    prs,
    comments,
    findOpenPr: async (_repo, head, base) => {
      const open = prs.filter((p) => p.open && p.head === head && p.base === base);
      return open[0] ? { number: open[0].number, url: open[0].url } : null;
    },
    createPr: async (_repo, pr) => {
      const n = prs.length + 1;
      const created = { ...pr, number: n, url: `https://github.test/pr/${n}`, open: true };
      prs.push(created);
      return { number: n, url: created.url };
    },
    updatePr: async (_repo, number, pr) => {
      const p = prs.find((x) => x.number === number);
      if (!p) throw new Error("no such PR");
      p.title = pr.title;
      p.body = pr.body;
    },
    closePr: async (_repo, number, comment) => {
      const p = prs.find((x) => x.number === number);
      if (!p) throw new Error("no such PR");
      comments.push(comment);
      p.open = false;
      p.closedAt = (await branchHead()) ?? "";
    },
    isArchived: async () => false,
    closedUnmergedPrs: async (_repo, head, base) =>
      prs
        .filter((p) => !p.open && p.head === head && p.base === base)
        .map((p) => ({ number: p.number, url: p.url, headSha: p.closedAt ?? "" })),
  };
}

type Harness = {
  deps: PrismicSyncDeps;
  github: ReturnType<typeof fakeGitHub>;
  setRemote: (models: RemoteEntry[]) => void;
  codegen: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
};

const asRemote = (page: object, hero: object): RemoteEntry[] => [
  { kind: "customtype", id: "page", model: page as RemoteEntry["model"] },
  { kind: "slice", id: "hero", model: hero as RemoteEntry["model"] },
];

function harness(opts: { secret?: string } = {}): Harness {
  let remote: RemoteEntry[] = asRemote(PAGE, HERO);
  const github = fakeGitHub();
  const codegen = vi.fn(async (root: string) => {
    const page = JSON.parse(await readFile(join(root, "customtypes/page/index.json"), "utf-8"));
    await writeFile(join(root, "prismicio-types.d.ts"), `// label: ${page.label}\n`, "utf-8");
    await writeFile(join(root, "src/lib/slices/index.ts"), `// ${page.label}\n`, "utf-8");
  });
  const install = vi.fn(async () => {});
  const models: PrismicModelsDeps = {
    remoteModels: async () => remote,
    sendModel: async () => {
      throw new Error("the sync must never write to Prismic");
    },
    env: { PRISMIC_TOKEN_FIXTURE: "t" },
    spawn: async () => {
      throw new Error("no process may be spawned by the model writes here");
    },
    openVerdictSink: async () => {
      throw new Error("the sync writes no verdicts");
    },
  };
  const deps: PrismicSyncDeps = {
    models,
    resolveSites: async () => [{ name: "Fixture", path: "", gitRepo: "reddoorla/fixture" }],
    git: async (args, cwd, env) =>
      new Promise((resolve) => {
        execFile(
          "git",
          [...args],
          { cwd, env: { ...process.env, ...env } },
          (err, stdout, stderr) =>
            resolve({
              code: err ? ((err as { code?: number }).code ?? 1) : 0,
              stdout: String(stdout),
              stderr: String(stderr),
            }),
        );
      }),
    github: () => github,
    cloneUrl: () => origin,
    redact: (t) => (opts.secret ? t.split(opts.secret).join("***") : t),
    install,
    codegen,
    format: async () => true,
  };
  return { deps, github, setRemote: (m) => (remote = m), codegen, install };
}

const fleet = (h: Harness, openPrs = true) =>
  prismicSync(undefined, { fleet: "turso", workdir: join(tmp, "work"), openPrs }, h.deps);

const branchHead = async (): Promise<string | null> => {
  const out = await git(["ls-remote", "--heads", origin, SYNC_BRANCH], tmp);
  return out === "" ? null : out.split(/\s+/)[0]!;
};

const showOnBranch = async (rel: string): Promise<string> =>
  git(["show", `${SYNC_BRANCH}:${rel}`], origin);

describe("prismic-sync --fleet", () => {
  it("negative control: a site in sync gets no branch and no PR", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    const res = await fleet(h);
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/^in-sync\s+Fixture/m);
    expect(res.output).toContain("PRISMIC_SYNC_SUMMARY sites=1 opened=0");
    expect(await branchHead()).toBeNull();
    expect(h.github.prs).toEqual([]);
    expect(h.install).not.toHaveBeenCalled();
  });

  it("positive control: a Prismic-side edit produces exactly one PR carrying it", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.code).toBe(0);
    expect(res.output).toContain("opened=1");
    expect(h.github.prs).toHaveLength(1);
    const pr = h.github.prs[0]!;
    expect(pr).toMatchObject({ head: SYNC_BRANCH, base: "main", open: true });
    expect(pr.body).toContain("`customtype page` → `customtypes/page/index.json`");
    expect(pr.body).toContain("~ (model) label");
    expect(pr.body).toMatch(/close this PR/);
    expect(JSON.parse(await showOnBranch("customtypes/page/index.json")).label).toBe(
      "Landing page",
    );
    const author = await git(["log", "-1", "--format=%an <%ae>", SYNC_BRANCH], origin);
    expect(author).toBe(`${SYNC_AUTHOR.name} <${SYNC_AUTHOR.email}>`);
  });

  it("words each line of the PR body for the pull, not the push", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, json: { Main: {}, SEO: {} } }, HERO));
    await fleet(h);
    const body = h.github.prs[0]!.body;
    expect(body).toContain("- tab SEO (only in Prismic: this PR adds it)");
    expect(body).not.toContain("pushing DELETES");
  });

  it("a second night with the same difference updates nothing and opens no second PR", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    const first = await branchHead();
    const res = await fleet(h);
    expect(res.output).toMatch(/^unchanged\s+Fixture/m);
    expect(h.github.prs).toHaveLength(1);
    expect(await branchHead()).toBe(first);
  });

  it("a new Prismic edit the next night fast-forwards the branch and updates the one PR", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    const first = (await branchHead())!;
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, { ...HERO, name: "Big hero" }));
    const res = await fleet(h);
    expect(res.output).toMatch(/^updated\s+Fixture/m);
    expect(h.github.prs).toHaveLength(1);
    expect(h.github.prs[0]!.body).toContain("`slice hero`");
    const second = (await branchHead())!;
    expect(second).not.toBe(first);
    await git(["merge-base", "--is-ancestor", first, second], origin);
    expect(JSON.parse(await showOnBranch("src/lib/slices/Hero/model.json")).name).toBe("Big hero");
  });

  it("rebuilds on a default branch that moved, keeping both as parents", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    const first = (await branchHead())!;
    await writeFile(join(seedDir, "README.md"), "moved\n", "utf-8");
    await commitAll(seedDir, "move main");
    await git(["push", "--quiet", "origin", "main"], seedDir);
    const main = await git(["rev-parse", "main"], origin);
    const res = await fleet(h);
    expect(res.output).toMatch(/^updated\s+Fixture/m);
    const parents = (await git(["log", "-1", "--format=%P", SYNC_BRANCH], origin)).split(" ");
    expect(parents).toEqual([first, main]);
    expect(await showOnBranch("README.md")).toBe("moved");
  });

  it("closes the open PR once Prismic and the repo agree again", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    h.setRemote(asRemote(PAGE, HERO));
    const res = await fleet(h);
    expect(res.output).toMatch(/^closed\s+Fixture/m);
    expect(h.github.prs[0]!.open).toBe(false);
    expect(h.github.comments).toHaveLength(1);
  });

  it("never deletes a model that exists only in the repo, and names it", async () => {
    const extra = { ...HERO, id: "quote", name: "Quote" };
    await makeOrigin({ ...STANDARD, "src/lib/slices/Quote/model.json": extra });
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    expect(JSON.parse(await showOnBranch("src/lib/slices/Quote/model.json")).id).toBe("quote");
    expect(h.github.prs[0]!.body).toContain("`slice quote` (`src/lib/slices/Quote/model.json`)");
  });

  it("adopts a model that exists only in Prismic", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    const banner = { ...HERO, id: "banner", name: "Banner" };
    h.setRemote([...asRemote(PAGE, HERO), { kind: "slice", id: "banner", model: banner }]);
    await fleet(h);
    expect(JSON.parse(await showOnBranch("src/lib/slices/Banner/model.json")).id).toBe("banner");
    expect(h.github.prs[0]!.body).toContain("`slice banner` → `src/lib/slices/Banner/model.json`");
  });

  it("regenerates the generated files on a migrated site and commits them", async () => {
    await makeOrigin({ ...STANDARD, "prismicio-types.d.ts": "// label: Page\n" });
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    expect(h.codegen).toHaveBeenCalledTimes(1);
    expect(await showOnBranch("prismicio-types.d.ts")).toBe("// label: Landing page");
  });

  it("does not run codegen on a Slice Machine site, and says so in the PR", async () => {
    await makeOrigin(STANDARD, false);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    expect(h.codegen).not.toHaveBeenCalled();
    expect(h.github.prs[0]!.body).toMatch(/were \*\*not\*\* regenerated/);
  });

  it("commits nothing when a model is refused", async () => {
    const squatter = { ...HERO, id: "not_banner" };
    await makeOrigin({ ...STANDARD, "src/lib/slices/Banner/model.json": squatter });
    const h = harness();
    const banner = { ...HERO, id: "banner", name: "Banner" };
    h.setRemote([
      { kind: "customtype", id: "page", model: { ...PAGE, label: "Landing page" } },
      { kind: "slice", id: "hero", model: HERO },
      { kind: "slice", id: "not_banner", model: squatter },
      { kind: "slice", id: "banner", model: banner },
    ]);
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/^failed\s+Fixture — 1 model\(s\) refused/m);
    expect(await branchHead()).toBeNull();
    expect(h.github.prs).toEqual([]);
  });

  it("commits nothing when anything other than models and generated files changed", async () => {
    await makeOrigin({ ...STANDARD, "package.json": "{}\n" });
    const h = harness();
    h.install.mockImplementation(async (root: string) => {
      await writeFile(join(root, "package.json"), '{"changed":true}\n', "utf-8");
    });
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toContain("files it does not own changed");
    expect(res.output).toContain("package.json");
    expect(await branchHead()).toBeNull();
  });

  it("leaves the branch alone once a human has committed to it", async () => {
    await makeOrigin(STANDARD, false);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    const work = join(tmp, "human");
    await git(["clone", "--quiet", "--branch", SYNC_BRANCH, origin, work], tmp);
    await writeFile(join(work, "src/prismicio-types.d.ts"), "// regenerated by hand\n", "utf-8");
    await commitAll(work, "regenerate types");
    await git(["push", "--quiet", "origin", SYNC_BRANCH], work);
    const human = (await branchHead())!;
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, { ...HERO, name: "Big hero" }));
    const res = await fleet(h);
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/^held\s+Fixture — prismic-sync carries commits .*t@example\.com/m);
    expect(await branchHead()).toBe(human);
    expect(h.github.prs[0]!.body).not.toContain("`slice hero`");
  });

  it("does not reopen a sync PR a human closed at the same commit", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    await h.github.closePr("reddoorla/fixture", 1, "repo is ahead");
    const res = await fleet(h);
    expect(res.output).toMatch(/^declined\s+Fixture/m);
    expect(h.github.prs).toHaveLength(1);
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, { ...HERO, name: "Big hero" }));
    const third = await fleet(h);
    expect(third.output).toMatch(/^opened\s+Fixture/m);
    expect(h.github.prs).toHaveLength(2);
  });

  it("does not rewrite the PR's title or body when the branch did not move", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    await fleet(h);
    h.github.prs[0]!.body = "edited by a human";
    await fleet(h);
    expect(h.github.prs[0]!.body).toBe("edited by a human");
  });

  it("is not fooled by another branch whose name ends in prismic-sync", async () => {
    await makeOrigin(STANDARD);
    await git(["push", "--quiet", "origin", "main:refs/heads/fix/prismic-sync"], seedDir);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.output).toMatch(/^opened\s+Fixture/m);
  });

  it("accepts the regenerated slice index under a library spelled with a trailing slash", async () => {
    await makeOrigin(STANDARD);
    await writeFile(
      join(seedDir, "prismic.config.json"),
      JSON.stringify({ repositoryName: "fixture", libraries: ["./src/lib/slices/"] }),
      "utf-8",
    );
    await commitAll(seedDir, "slash");
    await git(["push", "--quiet", "origin", "main"], seedDir);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.output).toMatch(/^opened\s+Fixture/m);
    expect(await showOnBranch("src/lib/slices/index.ts")).toBe("// Landing page");
  });

  it("skips an archived repo before cloning it", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.github.isArchived = async () => true;
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/^skipped\s+Fixture — reddoorla\/fixture is archived/m);
    expect(await branchHead()).toBeNull();
  });

  it("refuses a site whose own tools changed .git/config", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.install.mockImplementation(async (root: string) => {
      await git(["config", "core.hooksPath", "/tmp/evil"], root);
    });
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/changed \.git\/config/);
    expect(await branchHead()).toBeNull();
  });

  it("without --open-prs reports what it would do and touches no remote", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    const github = vi.fn(() => h.github);
    h.deps.github = github;
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await fleet(h, false);
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/^would-open\s+Fixture/m);
    expect(github).not.toHaveBeenCalled();
    expect(await branchHead()).toBeNull();
  });

  it("reds a run whose inventory resolved no sites", async () => {
    const h = harness();
    h.deps.resolveSites = async () => [];
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toContain("resolved no sites");
  });

  it("refuses the generic token in fleet mode", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.deps.models.env = { PRISMIC_WRITE_TOKEN: "t" };
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/^failed\s+Fixture — no write token/m);
  });

  it("redacts the token from a failure that quotes it", async () => {
    const h = harness({ secret: "s3cret" });
    h.deps.git = async (args) => ({
      code: 128,
      stdout: "",
      stderr: `fatal: could not read from https://x-access-token:s3cret@github.com (${args[0]})`,
    });
    const res = await fleet(h);
    expect(res.code).toBe(1);
    expect(res.output).toContain("x-access-token:***@github.com");
    expect(res.output).not.toContain("s3cret");
  });
});

describe("prismic-sync, one working tree", () => {
  it("refreshes a changed model in place and pushes nothing", async () => {
    await makeOrigin(STANDARD);
    const h = harness();
    h.setRemote(asRemote({ ...PAGE, label: "Landing page" }, HERO));
    const res = await prismicSync(seedDir, {}, h.deps);
    expect(res.code).toBe(0);
    expect(res.output).toContain("refreshed customtype page  -> customtypes/page/index.json");
    const page = JSON.parse(await readFile(join(seedDir, "customtypes/page/index.json"), "utf-8"));
    expect(page.label).toBe("Landing page");
    expect(await branchHead()).toBeNull();
  });

  it("refuses --open-prs without --fleet", async () => {
    const res = await prismicSync(undefined, { openPrs: true }, harness().deps);
    expect(res.code).toBe(2);
  });
});

describe("makeSyncGitHub", () => {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("finds the open PR by owner:branch and base", async () => {
    const calls: string[] = [];
    const gh = makeSyncGitHub("tok", async (url) => {
      calls.push(String(url));
      return ok([{ number: 7, html_url: "https://x/7" }]);
    });
    expect(await gh.findOpenPr("reddoorla/site", SYNC_BRANCH, "main")).toEqual({
      number: 7,
      url: "https://x/7",
    });
    expect(calls[0]).toBe(
      "https://api.github.com/repos/reddoorla/site/pulls?state=open&head=reddoorla%3Aprismic-sync&base=main&per_page=10",
    );
  });

  it("refuses two open sync PRs rather than picking one", async () => {
    const gh = makeSyncGitHub("tok", async () =>
      ok([
        { number: 1, html_url: "a" },
        { number: 2, html_url: "b" },
      ]),
    );
    await expect(gh.findOpenPr("reddoorla/site", SYNC_BRANCH, "main")).rejects.toThrow(/2 open/);
  });

  it("throws on a non-2xx answer", async () => {
    const gh = makeSyncGitHub("tok", async () => new Response("nope", { status: 403 }));
    await expect(gh.findOpenPr("reddoorla/site", SYNC_BRANCH, "main")).rejects.toThrow(/403/);
  });
});

describe("credentials stay out of the site's reach", () => {
  it("removes every credential from the environment a site's own code runs in", () => {
    const env = siteProcessEnv({
      PATH: "/bin",
      HOME: "/h",
      GH_TOKEN: "a",
      GITHUB_TOKEN: "b",
      PRISMIC_TOKEN_HEDLOC: "c",
      PRISMIC_WRITE_TOKEN: "d",
      TURSO_AUTH_TOKEN: "e",
      ACTIONS_RUNTIME_TOKEN: "f",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("never puts the token in a clone URL, and redacts it and its header", () => {
    const deps = defaultSyncDeps({ GH_TOKEN: "tok123" });
    expect(deps.cloneUrl("reddoorla/site")).toBe("https://github.com/reddoorla/site.git");
    const header = gitAuthArgs("tok123")[1]!;
    expect(header).not.toContain("tok123");
    expect(deps.redact(`x tok123 y ${header} z`)).toBe("x *** y *** z");
  });

  it("passes the token to git per command, never through config on disk", async () => {
    await makeOrigin(STANDARD);
    const deps = defaultSyncDeps({ GH_TOKEN: "tok123" });
    const dest = join(tmp, "clone");
    const r = await deps.git(["clone", "--quiet", origin, dest], tmp);
    expect(r.code).toBe(0);
    const config = await readFile(join(dest, ".git", "config"), "utf-8");
    expect(config).not.toContain("extraheader");
    expect(config).not.toContain(Buffer.from("x-access-token:tok123").toString("base64"));
  });
});

describe("forPull", () => {
  it("rewords push-direction suffixes into what the PR does", () => {
    expect(forPull("- tab SEO (only in Prismic — pushing DELETES it)")).toBe(
      "- tab SEO (only in Prismic: this PR adds it)",
    );
    expect(forPull("+ variation wide (new)")).toBe(
      "+ variation wide (only in the repo: this PR removes it)",
    );
    expect(forPull("+ Main.title")).toBe("+ Main.title (only in the repo: this PR removes it)");
    expect(forPull("~ (model) label")).toBe("~ (model) label");
  });
});

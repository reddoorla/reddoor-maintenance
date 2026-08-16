import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prismicCi, type PrismicCiDeps } from "../../src/recipes/prismic-ci/index.js";
import { MIN_CLI_VERSION } from "../../src/recipes/prismic-ci/cli-version.js";
import {
  PRISMIC_CI_WORKFLOW,
  REUSABLE_WORKFLOW,
  REUSABLE_WORKFLOW_PIN,
  SECRET,
  UNRESOLVED_PIN_SHA,
  WORKFLOW_PATH,
  isPinResolved,
  prismicCiWorkflow,
  type ReusableWorkflowPin,
} from "../../src/recipes/prismic-ci/template.js";
import { withoutComments, workflowUses } from "../build/_helpers/workflow-source.js";
import type { PullRequestSummary } from "../../src/github/gh.js";

/** A pin that LOOKS exactly like a real one, so template assertions exercise the
 *  shipped renderer rather than a special case. Deliberately not the shipped pin:
 *  these tests keep passing whatever `REUSABLE_WORKFLOW_PIN` currently says, and
 *  they keep MEANING the same thing — which the two tests that read the shipped
 *  constant directly did not. */
const PIN: ReusableWorkflowPin = {
  sha: "0123456789abcdef0123456789abcdef01234567",
  tag: "v1.4.0",
};
const RENDERED = prismicCiWorkflow(PIN);

/** The unresolved pin as the SHIPPED PLACEHOLDER rather than an ad-hoc string:
 *  what the refusal has to hold for is the exact value production carries
 *  between one `reddoorla/.github` release and the next. */
const UNRESOLVED_PIN: ReusableWorkflowPin = { sha: UNRESOLVED_PIN_SHA, tag: "v1.4.0" };

const REUSABLE_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../workflows/reusable/prismic-models.yml",
);

let dir: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function gitInit(): void {
  git(["init", "-q"]);
  git(["config", "user.email", "test@reddoor.local"]);
  git(["config", "user.name", "reddoor-test"]);
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return;
}

async function seedRepo(): Promise<void> {
  gitInit();
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "espada" }));
  git(["add", "package.json"]);
  git(["commit", "-qm", "init"]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-ci-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const site = () => ({ path: dir, name: "Espada", gitRepo: "reddoorla/espada" });

/** A pnpm v9 lockfile pinning @reddoorla/maintenance, with the peer suffix real
 *  fleet lockfiles carry. Every delivering site needs one, because the recipe
 *  refuses a repo whose installed CLI it cannot vouch for — see `cli-version.ts`. */
function lockfilePinning(version: string): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      '@reddoorla/maintenance':",
    "        specifier: ^0.83.0",
    `        version: ${version}(svelte@5.56.4)(typescript@5.9.3)`,
    "",
  ].join("\n");
}

/** @param cliVersion what the site's lockfile resolves; omit for a current one.
 *  `null` writes NO lockfile, for the "cannot establish" branch. */
async function prismicSite(cliVersion: string | null = MIN_CLI_VERSION): Promise<void> {
  await seedRepo();
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "espada" }),
  );
  git(["add", "slicemachine.config.json"]);
  if (cliVersion !== null) {
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfilePinning(cliVersion));
    git(["add", "pnpm-lock.yaml"]);
  }
  git(["commit", "-qm", "prismic"]);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** The fake fleet: an in-memory GitHub whose open-PR list actually GROWS when
 *  the recipe opens one, so a second run sees the first run's PR. Without that,
 *  an "idempotent" test proves only that the fake forgot. */
function deps(over: Partial<PrismicCiDeps> = {}): {
  d: PrismicCiDeps;
  prs: PullRequestSummary[];
  pushed: string[];
} {
  const prs: PullRequestSummary[] = [];
  const pushed: string[] = [];
  const d: PrismicCiDeps = {
    github: {
      defaultBranch: vi.fn(async () => "main"),
      secretExists: vi.fn(async () => true),
      fileContentsOnBranch: vi.fn(async () => null),
      openPullRequests: vi.fn(async () => [...prs]),
      openPullRequest: vi.fn(async (_repo: string, pr: { head: string }) => {
        const url = `https://github.com/reddoorla/espada/pull/${prs.length + 9}`;
        prs.push({
          number: prs.length + 9,
          title: "Deliver Prismic model changes from merged PRs",
          url,
          headRef: pr.head,
          ciState: "none",
          mergeable: "UNKNOWN",
        });
        return { url };
      }),
    },
    pushBranch: vi.fn(async (_cwd: string, branch: string) => {
      pushed.push(branch);
    }),
    // Default: the site HAS its own prettier and it is a no-op on our template.
    resolvePrettier: vi.fn(async () => "/site/node_modules/.bin/prettier"),
    spawn: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    pin: PIN,
    ...over,
  };
  return { d, prs, pushed };
}

// ---------------------------------------------------------------------------
// The caller workflow itself.
// ---------------------------------------------------------------------------
describe("prismicCiWorkflow", () => {
  it("pins the reusable workflow to a 40-hex commit, with its tag alongside", () => {
    expect(RENDERED).toMatch(
      new RegExp(
        `uses: ${REUSABLE_WORKFLOW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@[0-9a-f]{40} # v1\\.4\\.0`,
      ),
    );
  });

  it("passes every secret the reusable workflow declares, under that exact name", async () => {
    const reusable = await readFile(REUSABLE_SOURCE, "utf-8");
    // Declared secrets = the keys under `on: workflow_call: secrets:`. Read from
    // the reusable workflow rather than restated here, because the failure this
    // catches is the two files DRIFTING: a caller that passes a name the callee
    // never declared supplies nothing, and the callee's `required: true` secret
    // arrives empty at a step that writes to a live client's Prismic repo.
    const lines = withoutComments(reusable).split("\n");
    const at = lines.findIndex((l) => /^\s{4}secrets:\s*$/.test(l));
    expect(at).toBeGreaterThan(-1);
    const declared: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (line.trim() === "") continue;
      const m = /^\s{6}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
      if (!m) break;
      declared.push(m[1]!);
    }
    expect(declared).toEqual([SECRET]);
    for (const name of declared) {
      expect(withoutComments(RENDERED)).toContain(`${name}: \${{ secrets.${name} }}`);
    }
  });

  it("triggers on model paths only, on pull_request and on push", () => {
    const live = withoutComments(RENDERED);
    expect(live).toContain("pull_request:");
    expect(live).toContain("push:");
    expect((live.match(/- "customtypes\/\*\*"/g) ?? []).length).toBe(2);
    expect((live.match(/- "src\/lib\/slices\/\*\*\/model\.json"/g) ?? []).length).toBe(2);
  });

  it("filters the push trigger to main — the caller's half of the apply gate", () => {
    // ABSENCE ASSERTION. The reusable workflow's apply job guards
    // `github.ref == 'refs/heads/main'` and its own comment calls the caller's
    // filter the other half. Comments are stripped first so prose about branch
    // filtering cannot satisfy this.
    const live = withoutComments(RENDERED);
    const push = live.slice(live.indexOf("  push:"));
    expect(push).toContain("branches: [main]");
  });

  it("grants the reusable workflow's jobs the permissions they need, and no more", () => {
    const live = withoutComments(RENDERED);
    expect(live).toContain("contents: read");
    expect(live).toContain("pull-requests: write");
    expect(live).not.toContain("contents: write");
  });

  it("runs nothing itself — it only delegates", () => {
    // ABSENCE ASSERTION: no `run:` step, so `--apply` cannot appear here on any
    // trigger. The only thing that can write to Prismic lives in the reviewed
    // reusable workflow.
    const live = withoutComments(RENDERED);
    expect(live).not.toContain("run:");
    expect(live).not.toContain("--apply");
  });

  it("keeps the unresolved placeholder unmistakable — never SHA-shaped", () => {
    // The whole reason the placeholder is spelled in prose. A 40-hex-shaped
    // placeholder is indistinguishable from a real commit in review, and it is
    // `isPinResolved` — a pure shape check — that decides whether 15 client
    // repos get a workflow. This is also what makes `UNRESOLVED_PIN` a fixture
    // worth injecting rather than an arbitrary bad string.
    expect(UNRESOLVED_PIN_SHA).not.toMatch(/^[0-9a-f]{40}$/);
    expect(isPinResolved(UNRESOLVED_PIN)).toBe(false);
  });

  it("ships either a resolved pin or a pin the recipe refuses to use", () => {
    // THE TRIPWIRE ON THE SHIPPED CONSTANT — the one assertion in this file that
    // is deliberately about `REUSABLE_WORKFLOW_PIN` itself. Both directions of
    // the refusal are tested by injection elsewhere in this file and in
    // tests/cli/prismic-ci-command.test.ts; what is left for here is the thing
    // injection can never see: what the shipped workflow would actually install.
    //
    // It reads the rendered `uses:` REF rather than grepping the file, because
    // the resolved branch of the old version of this test ("the text contains
    // some 40-hex string followed by ` #`") was satisfied by any 40-hex anywhere
    // — including one that had nothing to do with the pin the recipe gated on.
    // What it forbids: a floating `@v1.4.0` or `@main` ref (a retagged release
    // then runs arbitrary code holding a live client's Prismic write token), a
    // ref that is not the pin the gate inspected, and a missing tag comment
    // (which is what a human, and Renovate's github-actions manager, read).
    const uses = workflowUses(PRISMIC_CI_WORKFLOW);
    expect(uses).toEqual([`${REUSABLE_WORKFLOW}@${REUSABLE_WORKFLOW_PIN.sha}`]);

    if (isPinResolved(REUSABLE_WORKFLOW_PIN)) {
      expect(REUSABLE_WORKFLOW_PIN.sha).toMatch(/^[0-9a-f]{40}$/);
      // The tag comment, carrying the SHIPPED tag — not merely "a comment".
      expect(PRISMIC_CI_WORKFLOW).toContain(
        `@${REUSABLE_WORKFLOW_PIN.sha} # ${REUSABLE_WORKFLOW_PIN.tag}`,
      );
    } else {
      expect(PRISMIC_CI_WORKFLOW).not.toMatch(/@[0-9a-f]{40}/);
      expect(PRISMIC_CI_WORKFLOW).not.toMatch(/@(main|master|v[0-9])/);
    }
  });
});

// ---------------------------------------------------------------------------
// The recipe.
// ---------------------------------------------------------------------------
describe("prismicCi", () => {
  it("fails, without touching GitHub, when the site has no repo identity", async () => {
    const { d } = deps();
    const r = await prismicCi({ path: dir, name: "Espada" }, d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/git repo/i);
    expect(d.github!.secretExists).not.toHaveBeenCalled();
  });

  it("fails on a malformed repo identity rather than letting it reach gh", async () => {
    const { d } = deps();
    const r = await prismicCi({ path: dir, name: "Espada", gitRepo: "--flag" }, d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/owner\/repo/);
    expect(d.github!.secretExists).not.toHaveBeenCalled();
  });

  it("noops on a repo with no Prismic config", async () => {
    await seedRepo();
    const { d } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("noop");
    expect(r.notes).toMatch(/not a Prismic site/i);
  });

  it("fails — never noops — when the Prismic config is present but unreadable", async () => {
    // Absent vs unreadable. "I could not read slicemachine.config.json" must not
    // take the "this repo has no Prismic" branch, or a live site drops out of the
    // rollout with the rollout reporting success.
    await seedRepo();
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    const { d } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/slicemachine\.config\.json/);
    expect(d.github!.secretExists).not.toHaveBeenCalled();
  });

  it("refuses to write anything while the reusable-workflow pin is unresolved", async () => {
    await prismicSite();
    const { d, pushed } = deps({ pin: UNRESOLVED_PIN });
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/pin/i);
    // Named, so the operator's next move is legible from the summary line alone.
    expect(r.notes).toContain(UNRESOLVED_PIN.sha);
    expect(await exists(join(dir, WORKFLOW_PATH))).toBe(false);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
    // The pin is checked before the first network call — 15 pointless round
    // trips are not worth spending to learn what a shape check already knows.
    expect(d.github!.secretExists).not.toHaveBeenCalled();
    expect(d.github!.defaultBranch).not.toHaveBeenCalled();
  });

  it("with a RESOLVED pin, writes a workflow pinned to that 40-hex commit, tag alongside", async () => {
    // THE MIRROR of the refusal above, and the half that never had a test. A
    // guard that refuses in BOTH pin states is indistinguishable from a recipe
    // that cannot deliver at all, and the suite as it stood passed for either —
    // it only ever ran the refusal, because the shipped pin was unresolved.
    //
    // The assertion is on the COMMITTED bytes, not on the template: what lands
    // in a client repo is the whole point, and everything between the gate and
    // the commit (prettier, the write, the commit) can drop it.
    expect(isPinResolved(PIN)).toBe(true); // the premise, stated
    await prismicSite();
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    const written = git(["show", `${pushed[0]}:${WORKFLOW_PATH}`]);
    expect(written).toContain(`@${PIN.sha} # ${PIN.tag}`);
    expect(workflowUses(written)).toEqual([`${REUSABLE_WORKFLOW}@${PIN.sha}`]);
    expect(PIN.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(d.github!.openPullRequest).toHaveBeenCalledTimes(1);
  });

  // THE VERSION GATE. The reusable workflow runs the SITE's own installed bin
  // (`pnpm install --frozen-lockfile`, then `reddoor-maint`), so a caller
  // installed next to a binary without `prismic-models` fails on the first model
  // PR — in a client repo, with an error naming an unknown command rather than a
  // rollout that ran too early. Measured before this gate existed: npm's latest
  // was 0.82.0 and the fleet's lockfiles pinned as far back as 0.69.0, so a
  // rollout that day would have broken all twelve.
  it("refuses a site whose lockfile pins a CLI without the command, naming both versions", async () => {
    await prismicSite("0.82.0");
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toContain("0.82.0");
    expect(r.notes).toContain(MIN_CLI_VERSION);
    expect(r.notes).toMatch(/bump the dependency/i);
    // Nothing written, and not one network call spent to learn what a local file
    // already said.
    expect(await exists(join(dir, WORKFLOW_PATH))).toBe(false);
    expect(pushed).toEqual([]);
    expect(d.github!.secretExists).not.toHaveBeenCalled();
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  // "I could not establish the version" REFUSES rather than proceeding. The
  // asymmetry is the point: waiting costs a re-run, being wrong costs broken CI
  // on someone else's repository. It must also not be mistaken for the
  // too-old branch — different wording, so the operator's next move differs.
  it("refuses, distinctly, when it cannot establish the version at all", async () => {
    await prismicSite(null); // no pnpm-lock.yaml
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/cannot establish/i);
    expect(r.notes).toMatch(/no pnpm-lock\.yaml/i);
    expect(r.notes).not.toMatch(/bump the dependency/i);
    expect(pushed).toEqual([]);
    expect(d.github!.secretExists).not.toHaveBeenCalled();
  });

  it("delivers to a site whose lockfile is newer than the minimum", async () => {
    await prismicSite("1.2.3");
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    expect(pushed).toHaveLength(1);
  });

  it("refuses, and names the secret, when the repo does not have PRISMIC_WRITE_TOKEN", async () => {
    // A workflow whose secret is absent goes red on its first model PR. Landing
    // 15 of those turns a rollout into 15 red repos.
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.secretExists = vi.fn(async () => false);
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toContain(SECRET);
    expect(r.notes).toMatch(/gh secret set/);
    expect(await exists(join(dir, WORKFLOW_PATH))).toBe(false);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("distinguishes 'the secret is absent' from 'I could not find out'", async () => {
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.secretExists = vi.fn(async () => {
      throw new Error("HTTP 403: Resource not accessible by integration");
    });
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/could not determine/i);
    expect(r.notes).toContain("403");
    // and NOT the wording used for a definitively-absent secret
    expect(r.notes).not.toMatch(/gh secret set/);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("does not guess 'main' when the default branch cannot be read", async () => {
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.defaultBranch = vi.fn(async () => {
      throw new Error("HTTP 502");
    });
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/default branch/i);
    expect(await exists(join(dir, WORKFLOW_PATH))).toBe(false);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("refuses on a repo whose default branch is not main — the apply job could never fire", async () => {
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.defaultBranch = vi.fn(async () => "master");
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/master/);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("noops when the workflow is already current on the default branch", async () => {
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.fileContentsOnBranch = vi.fn(async () => RENDERED);
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("noop");
    expect(r.notes).toMatch(/already/i);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("noops when a rollout PR is already open, naming it", async () => {
    await prismicSite();
    const { d, pushed } = deps();
    d.github!.openPullRequests = vi.fn(async () => [
      {
        number: 4,
        title: "Deliver Prismic model changes from merged PRs",
        url: "https://github.com/reddoorla/espada/pull/4",
        headRef: "maint/prismic-ci-20260813T000000000Z",
        ciState: "none" as const,
        mergeable: "UNKNOWN" as const,
      },
    ]);
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("noop");
    expect(r.notes).toContain("https://github.com/reddoorla/espada/pull/4");
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("fails when the working tree is not clean, before creating a branch", async () => {
    await prismicSite();
    await writeFile(join(dir, "stray.txt"), "operator work in progress");
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("failed");
    expect(r.notes).toMatch(/working tree/i);
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });

  it("writes the workflow, commits, pushes, opens a PR, and returns the operator's branch", async () => {
    await prismicSite();
    const before = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    expect(r.commits.length).toBe(1);
    expect(pushed.length).toBe(1);
    expect(pushed[0]).toMatch(/^maint\/prismic-ci-/);
    expect(r.notes).toContain("https://github.com/reddoorla/espada/pull/9");
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(before);
    // The file is on the PUSHED branch, not on the operator's.
    expect(git(["show", `${pushed[0]}:${WORKFLOW_PATH}`])).toBe(RENDERED);
    expect(await exists(join(dir, WORKFLOW_PATH))).toBe(false);
  });

  it("opens exactly ONE PR when run twice against the same repo", async () => {
    // Idempotency, against a fake whose PR list actually grows.
    await prismicSite();
    const { d, prs, pushed } = deps();
    const first = await prismicCi(site(), d);
    expect(first.status).toBe("applied");
    const second = await prismicCi(site(), d);
    expect(second.status).toBe("noop");
    expect(prs.length).toBe(1);
    expect(pushed.length).toBe(1);
    expect(d.github!.openPullRequest).toHaveBeenCalledTimes(1);
  });

  it("formats with the target repo's OWN prettier, by absolute path — never `pnpm exec`", async () => {
    // `pnpm exec prettier` in a client checkout runs a full `pnpm install` there
    // first, then falls through to the CALLING repo's prettier and exits 0.
    await prismicSite();
    const { d } = deps();
    await prismicCi(site(), d);
    expect(d.spawn).toHaveBeenCalledWith(
      "/site/node_modules/.bin/prettier",
      ["--write", WORKFLOW_PATH],
      { cwd: dir, timeoutMs: 60_000 },
    );
    const [cmd] = (d.spawn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(cmd).not.toBe("pnpm");
  });

  it("commits unformatted, with a flag, when the target repo has no prettier of its own", async () => {
    await prismicSite();
    const { d } = deps({ resolvePrettier: vi.fn(async () => null) });
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    expect(r.notes).toMatch(/prettier/i);
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it("flags a site whose prettier rewrote the template, because re-runs will not match", async () => {
    await prismicSite();
    const { d } = deps({
      spawn: vi.fn(async () => {
        await writeFile(join(dir, WORKFLOW_PATH), RENDERED.replace(/"/g, "'"), "utf-8");
        return { code: 0, stdout: "", stderr: "" };
      }),
    });
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    expect(r.notes).toMatch(/reformatted/i);
  });

  it("noops without pushing when the workflow is already in the checkout verbatim", async () => {
    await prismicSite();
    await mkdir(join(dir, ".github/workflows"), { recursive: true });
    await writeFile(join(dir, WORKFLOW_PATH), RENDERED, "utf-8");
    git(["add", "-A"]);
    git(["commit", "-qm", "workflow"]);
    const { d, pushed } = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("noop");
    expect(pushed).toEqual([]);
    expect(d.github!.openPullRequest).not.toHaveBeenCalled();
  });
});

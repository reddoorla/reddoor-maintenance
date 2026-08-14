import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { forComment, DEFAULT_COMMENT_LIMIT } from "../../src/cli/commands/prismic-models.js";
import {
  stepRunScript,
  stepEnv,
  workflowUses,
  withoutComments,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../workflows/reusable/prismic-models.yml",
);

/** GitHub rejects an issue/PR comment body over this many characters. Not one of
 *  our constants — it is the platform's, so it is written here rather than
 *  imported, and `DEFAULT_COMMENT_LIMIT` is what the CLI reserves out of it. */
const GITHUB_COMMENT_LIMIT = 65_536;

const POST_STEP = "Post the model delta as a PR comment";

/**
 * THE HIGHEST-CONSEQUENCE FILE IN THIS PROJECT.
 *
 * One line of it writes to a live client's Prismic repository. The safety property
 * is the split — `pull_request` gets `--dry` and a comment, `push` to main gets
 * `--apply` — and the split is only as good as the conditions that select it, so
 * this file asserts on those conditions rather than on the fact that both strings
 * appear somewhere in the YAML.
 *
 * The other half is the comment, because the comment IS the review gate. GitHub
 * caps a comment at 65,536 characters TOTAL, wrapper included. A report truncated
 * to exactly the cap overflows once wrapped, GitHub answers 422, and NO COMMENT IS
 * POSTED AT ALL — the review gate removed entirely, on a PR that changes models on
 * a live client's site, in the direction where the check can still go green. So the
 * wrapper is not estimated here: the workflow's own comment-building step is
 * EXECUTED against a maximally-long report and the resulting bytes are counted.
 */

let wf: string;

beforeAll(async () => {
  wf = await readFile(WORKFLOW, "utf-8");
});

/** The `jobs:` entry with this name, up to the next job at the same indent. */
function job(name: string): string {
  const lines = wf.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^ {2}${name}:\\s*$`).test(l));
  if (start === -1) throw new Error(`no job named ${JSON.stringify(name)}`);
  const out = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    // The next job (two-space indent) or the next top-level key ends this one.
    if (/^ {2}\S/.test(lines[i]!) || /^\S/.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

/** A job's `if:` condition, with comments already excluded by construction. */
function jobCondition(name: string): string {
  const m = /^\s{4}if:\s*(.+)$/m.exec(job(name));
  if (!m) throw new Error(`job ${JSON.stringify(name)} has no top-level \`if:\``);
  return m[1]!.trim();
}

describe("reusable prismic-models — the dry/apply split is structural", () => {
  it("is callable only by another workflow", () => {
    expect(/^on:\n\s+workflow_call:/m.test(wf)).toBe(true);
    // A `push`/`pull_request` trigger of its own would make this file run in
    // reddoorla/.github itself, against a repo that is not a site.
    expect(/^\s{2}(push|pull_request|schedule):/m.test(wf)).toBe(false);
  });

  // TWO JOBS, not two steps. Job-level permissions cannot be conditional, so a
  // single job would hand `pull-requests: write` to the apply path and hand the PR
  // path a job that contains the `--apply` invocation. Split, each path is
  // incapable of the other's action rather than merely instructed not to take it.
  //
  // Asserted against the COMMENT-STRIPPED job. The first version of this test used
  // the raw text and failed on the dry job's own comment explaining that `--apply`
  // is not passed there — the same way the plan's draft test failed on the nightly's
  // header. An absence assertion over prose is an assertion about prose.
  it("puts --dry and --apply in separate jobs", () => {
    const dry = withoutComments(job("dry"));
    const apply = withoutComments(job("apply"));
    expect(dry).toContain("--comment-file");
    expect(dry).not.toContain("--apply");
    expect(apply).toContain("--apply");
    expect(apply).not.toContain("--comment-file");
  });

  it("runs the dry path only on a pull request", () => {
    expect(jobCondition("dry")).toBe("github.event_name == 'pull_request'");
  });

  // THE LINE THAT WRITES TO A LIVE CLIENT'S PRISMIC REPOSITORY.
  //
  // `github.event_name == 'push'` alone is NOT enough, and a draft of this file had
  // exactly that. A caller whose `on: push:` carries no branch filter — or that
  // pushes a tag — would then apply a feature branch's models to production, with
  // no PR and therefore no review gate anywhere in the sequence. The ref is checked
  // here as well as by the caller's trigger, because only one of those two lives in
  // this repository.
  it("runs the apply path only on a push to main", () => {
    const cond = jobCondition("apply");
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("github.ref == 'refs/heads/main'");
    expect(cond).toContain("&&");
  });

  it("gives each job only the permissions its own path needs", () => {
    // The PR path comments; it pushes no code and needs no write to contents.
    expect(job("dry")).toMatch(/permissions:\n\s+contents: read\n\s+pull-requests: write/);
    // The apply path writes to PRISMIC, not to GitHub. Nothing in it should be
    // able to comment, label, or push.
    expect(job("apply")).toMatch(/permissions:\n\s+contents: read\n/);
    expect(job("apply")).not.toContain("pull-requests: write");
    expect(job("apply")).not.toContain("contents: write");
  });

  // Two merges landing together would run two `--apply` pushes at one Prismic
  // repository. Not cancelled: a skipped apply is a merge whose models never
  // reached Prismic, with a green check saying they did.
  it("serialises the apply path and never cancels a queued one", () => {
    expect(job("apply")).toContain("concurrency:");
    expect(job("apply")).toContain("cancel-in-progress: false");
  });
});

describe("reusable prismic-models — the write token", () => {
  // Named for the env var the CLI actually reads, and for the secret already
  // distributed to each site repo. A workflow-local alias would add a rename with
  // no benefit and would stop `secrets: inherit` from working at the call site.
  it("takes the token as a secret named for the variable the CLI reads", () => {
    expect(withoutComments(wf)).toMatch(
      /^\s{4}secrets:\n\s{6}PRISMIC_WRITE_TOKEN:\n\s+required: true/m,
    );
  });

  // A secret that arrives as an INPUT is a secret GitHub does not mask in the log.
  it("never accepts the token as an input", () => {
    const inputs = /^\s{4}inputs:\n((?:\s{6,}.*\n)+)/m.exec(withoutComments(wf))?.[1] ?? "";
    expect(inputs).not.toBe("");
    expect(inputs.toLowerCase()).not.toContain("token");
  });

  it("hands the token to both paths through the environment, never on the argv", () => {
    for (const j of ["dry", "apply"]) {
      expect(job(j)).toMatch(/PRISMIC_WRITE_TOKEN: \$\{\{ secrets\.PRISMIC_WRITE_TOKEN \}\}/);
    }
    expect(wf).not.toMatch(/--token/);
  });
});

/**
 * Run the comment-building step in a sandbox and return the bytes it would post.
 *
 * `gh` is stubbed to a recorder, so nothing reaches GitHub; the body it was handed
 * is read back off disk. This is a measurement, not an inspection — whatever the
 * step does to the report (a heading, a fence, a footer, a `<details>` block) is
 * counted because it happened, not because someone remembered to update a number.
 */
async function buildComment(report: string | null): Promise<{ body: string | null; code: number }> {
  const dir = await mkdtemp(join(tmpdir(), "prismic-comment-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexit 0\n`, "utf-8");
  await chmod(join(bin, "gh"), 0o755);
  if (report !== null) await writeFile(join(dir, "prismic-models.txt"), report, "utf-8");

  const script = stepRunScript(wf, POST_STEP);
  let code = 0;
  try {
    await execFileAsync("bash", ["-e", "-c", script], {
      cwd: dir,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, PR_NUMBER: "123" },
    });
  } catch (e) {
    code = (e as { code?: number }).code ?? 1;
  }
  const body = await readFile(join(dir, "comment.md"), "utf-8").catch(() => null);
  return { body, code };
}

describe("reusable prismic-models — the comment can never overflow GitHub's cap", () => {
  it("posts a comment that fits, for the longest report the CLI can produce", async () => {
    // `forComment` truncates to its own budget, so this is the largest body the
    // command will ever write — the first-ever push to an empty Prismic repository
    // is the realistic trigger, not an edge case.
    const longest = forComment("x".repeat(500_000));
    expect(longest.length).toBeLessThanOrEqual(DEFAULT_COMMENT_LIMIT);

    const { body } = await buildComment(longest);
    expect(body).not.toBeNull();
    expect(body!.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
  });

  // The number the CLI holds back for whatever wraps the report. Measured from the
  // step itself so the two halves of one budget cannot drift apart: if someone adds
  // a `<details>` block, a site heading or a footer here, this is what notices.
  it("keeps its wrapper inside the headroom the CLI reserved", async () => {
    const report = "R".repeat(1_000);
    const { body } = await buildComment(report);
    expect(body).not.toBeNull();
    const wrapper = body!.length - report.length;
    expect(wrapper).toBeGreaterThan(0);
    expect(wrapper).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT - DEFAULT_COMMENT_LIMIT);
  });

  it("closes its code fence even when the report has no trailing newline", async () => {
    const { body } = await buildComment("no newline at the end of this report");
    expect(body).not.toBeNull();
    const fences = body!.split("\n").filter((l) => /^`{3,}/.test(l));
    expect(fences.length).toBe(2);
    expect(body!.trimEnd().endsWith(fences[1]!)).toBe(true);
  });

  // A model id or a field placeholder comes from a client's own config and can
  // contain anything, a ``` fence included. A three-backtick wrapper would be
  // closed by it, and the rest of the report — the DESTRUCTIVE lines among it —
  // would render as prose with its structure gone.
  it("survives a report containing a code fence of its own", async () => {
    const { body } = await buildComment("CHANGED slice hero\n```\nnot the end\n```\nmore");
    expect(body).not.toBeNull();
    expect(body!).toContain("more");
    const opener = body!.split("\n").find((l) => /^`{3,}/.test(l))!;
    expect(opener.replace(/[^`]/g, "").length).toBeGreaterThan(3);
  });

  // "I could not read the report" must not render as "there was no drift". If the
  // CLI died before writing its file, a stale file from a re-used workspace — or no
  // file at all — must not become a comment that reads like a clean run.
  it("fails loudly rather than posting an empty comment when the report is missing", async () => {
    const { body, code } = await buildComment(null);
    expect(code).not.toBe(0);
    // Asserted unconditionally. `if (body !== null) expect(...)` — the shape this
    // replaced — passes for a step that wrote no comment at all, which is the very
    // outcome it was meant to rule out.
    expect(body).not.toBeNull();
    expect(body!).toContain("NO REPORT");
    expect(body!).not.toMatch(/^\s*$/);
  });
});

describe("reusable prismic-models — the comment is posted whatever the check found", () => {
  // THE COMMENT IS THE REVIEW ARTIFACT, so it must survive the check failing. A
  // dry run exits non-zero on a dead token, an unreadable Prismic repository or an
  // inconsistent report — exactly the PRs where "no comment appeared" is worst —
  // and the CLI writes the comment file on those paths on purpose so that this
  // step has something to post.
  it("posts on the failure paths too", () => {
    const dry = job("dry");
    const post = dry.slice(dry.indexOf(`- name: ${POST_STEP}`));
    expect(post).toMatch(/if:\s*always\(\)/);
  });

  it("runs the delta step before the step that posts it", () => {
    const dry = job("dry");
    expect(dry.indexOf("--comment-file")).toBeLessThan(dry.indexOf(`- name: ${POST_STEP}`));
  });
});

describe("reusable prismic-models — supply chain and shape", () => {
  it("pins every action to a commit digest, not a mutable tag", () => {
    const uses = workflowUses(wf);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  it("bounds both jobs so a hung run cannot sit on a client's CI", () => {
    for (const j of ["dry", "apply"]) expect(job(j)).toMatch(/timeout-minutes: \d+/);
  });

  it("keeps the PR number out of the run block, where it cannot be shell-injected", () => {
    const env = stepEnv(wf, POST_STEP);
    expect(Object.keys(env)).toContain("PR_NUMBER");
    expect(stepRunScript(wf, POST_STEP)).not.toContain("${{");
  });
});

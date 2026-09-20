import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  runProtectionAuditCommand,
  type ProtectionAuditDeps,
} from "../../src/cli/commands/protection-audit.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import { stepRunScript, withoutComments, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * THE DELIVERY LAYER THAT LOST AN ALARM.
 *
 * Every nightly in this repo files ONE deduped tracking issue and closes it on
 * recovery, and both halves found that issue with a bare
 * `gh issue list --state open` — which is a 30-ROW PAGE. That is the same
 * default-page trap already named and fixed one file over, in
 * `src/github/gh.ts`: "the default page of 30 is exactly the trap that produced
 * the 2026-07-31 false 'queue is empty'". It was fixed there and applied
 * nowhere else.
 *
 * It has since fired for real, on a date. #652 ("Fleet protection coverage
 * gap") was filed 2026-09-01 and commented daily to 09-09. On 2026-09-10 the
 * repo was past 30 open issues, the dedupe query came back empty, and the sweep
 * filed #754 under a byte-identical title. The close loop reads the same
 * truncated page, so from that morning #652 was unreachable by both halves and
 * could never be closed by the machine. It was closed by hand on 2026-09-14.
 *
 * So this file does not grep the YAML for `--limit`. It EXTRACTS the steps'
 * shell and EXECUTES it against a stubbed `gh` holding 40 open issues, because
 * the number of open issues is the whole bug and only a corpus bigger than a
 * page can express it.
 *
 * Two orderings, and the order they are written in is the point: the tracking
 * title at POSITION 2 first — a case the broken query also passes, so a green
 * there proves the harness can see a hit at all — and only then the same
 * harness with the title at position 35. A gate that has only ever been seen to
 * fail is an untested assertion, not an instrument.
 */

const SECURITY_WF = "fleet-security.yml";
const DEDUPE_STEP = "Open/update the protection-gap tracking issue";
const CLOSE_STEP = "Close the protection-gap issue on a clean sweep";
const TRACKING_TITLE = "Fleet protection coverage gap";

type Issue = { number: number; title: string; body: string };

/**
 * A `gh` that models the ONE behaviour this test is about: `issue list` returns
 * a PAGE, 30 rows by default, `--limit` sets the page size, and `--search`
 * narrows server-side BEFORE the page is taken. `--jq` is handed to the real
 * `jq` rather than pattern-matched, so the workflow's own jq expression is the
 * thing under test — rewrite it wrongly and this file fails.
 */
const GH_STUB = `
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [group, sub, ...rest] = process.argv.slice(2);
const issues = JSON.parse(readFileSync(process.env.GH_STUB_CORPUS, "utf-8"));
const flag = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
const jq = (expr, json) => execFileSync("jq", ["-r", expr], { input: json, encoding: "utf-8" });

if (group === "issue" && sub === "list") {
  // gh's documented default page size. The bug, in one number.
  const limit = Number(flag("--limit") ?? 30);
  const search = flag("--search");
  let rows = issues;
  if (search) {
    const phrase = /in:title\\s+"([^"]*)"/.exec(search)?.[1] ?? "";
    // GitHub phrase search matches titles CONTAINING the words, not equal to
    // them — which is exactly why the workflow keeps its jq .title== filter.
    rows = rows.filter((r) => r.title.toLowerCase().includes(phrase.toLowerCase()));
  }
  rows = rows.slice(0, limit);
  const fields = (flag("--json") ?? "number,title").split(",");
  const json = JSON.stringify(rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]]))));
  const expr = flag("--jq");
  process.stdout.write(expr ? jq(expr, json) : json);
  process.exit(0);
}

if (group === "issue" && sub === "view") {
  const found = issues.find((r) => r.number === Number(rest[0]));
  if (!found) { process.stderr.write("no such issue\\n"); process.exit(1); }
  const fields = (flag("--json") ?? "body").split(",");
  const json = JSON.stringify(Object.fromEntries(fields.map((f) => [f, found[f]])));
  const expr = flag("--jq");
  process.stdout.write(expr ? jq(expr, json) : json);
  process.exit(0);
}

// Mutations announce themselves so the test asserts on what the step DID.
if (group === "issue" && sub === "create") { console.log("STUB_CREATE " + flag("--title")); process.exit(0); }
if (group === "issue" && sub === "comment") { console.log("STUB_COMMENT #" + rest[0]); process.exit(0); }
if (group === "issue" && sub === "close") { console.log("STUB_CLOSE #" + rest[0]); process.exit(0); }

process.stderr.write("gh stub: unhandled " + process.argv.slice(2).join(" ") + "\\n");
process.exit(1);
`;

/** 40 open issues, newest first, with the tracking title at `position` (1-based).
 *  Filler titles share no word-run with the tracking title, so a title search
 *  narrows to exactly the planted rows. */
function corpusWithTrackingAt(position: number, body: string): Issue[] {
  return Array.from({ length: 40 }, (_, i) => {
    const n = i + 1;
    return n === position
      ? { number: 900 + n, title: TRACKING_TITLE, body }
      : { number: 900 + n, title: `Renovate: bump some-dependency-${n} to v${n}`, body: "" };
  });
}

/** The body shape the open/update half actually writes: a fenced block of the
 *  audit's own GAP lines. Built from the same strings the audit emits. */
function gapIssueBody(gapLines: string[]): string {
  return [
    "The nightly protection-coverage sweep found public repo(s) below the fleet posture floor:",
    "",
    "```",
    ...gapLines,
    "```",
    "",
    "_Auto-filed; auto-closes on the next clean sweep._",
  ].join("\n");
}

const SEC_ON = { secretScanning: "enabled", pushProtection: "enabled" };
const FRESH = () => new Date().toISOString();

/**
 * A REAL `protection-audit` run, so the sweep output this test feeds the
 * workflow is produced by the command's own formatter. Hand-typing
 * `COVERED <repo> — …` here would let the line format drift out from under the
 * workflow's grep with this file still green — the failure mode the fleet-smoke
 * gate test calls out by name.
 */
async function sweepOutput(
  repos: Array<{ name: string; visibility?: string }>,
): Promise<{ output: string; code: number }> {
  const deps: ProtectionAuditDeps = {
    listOrgRepos: async () =>
      repos.map((r) => ({
        name: r.name,
        visibility: r.visibility ?? "public",
        archived: false,
        ...SEC_ON,
      })),
    listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
    getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
    workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH() }),
    dependencyDashboard: async () => ({ present: true, blockedBranches: [], unknownSections: [] }),
    openSecretAlerts: async () => 0,
    renovateMergeWindow: async () => ({ merges: [], truncated: false }),
    repoTextFile: async () => null,
    listWorkflowPaths: async () => [],
    branchTip: async () => null,
  };
  return runProtectionAuditCommand({ org: "reddoorla" }, deps);
}

/**
 * Execute one step's `run:` block the way Actions would.
 *
 * `bash -e` matches Actions' `bash -e {0}`. `${{ … }}` expressions are
 * substituted first because Actions interpolates them before bash ever sees the
 * script. RUNNER_TEMP points at a per-test scratch dir so the sweep-output file
 * these steps read is not a shared `/tmp` path two runs could stomp on.
 */
async function runStep(opts: {
  step: string;
  corpus: Issue[];
  sweep?: string;
  workflowFile?: string;
}): Promise<{ code: number; out: string }> {
  const wf = await readFile(opts.workflowFile ?? workflowPath(SECURITY_WF), "utf-8");
  const script = stepRunScript(wf, opts.step).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");

  const dir = await mkdtemp(join(tmpdir(), "tracking-issue-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "corpus.json"), JSON.stringify(opts.corpus), "utf-8");
  await writeFile(join(dir, "gh-stub.mjs"), GH_STUB, "utf-8");
  await writeFile(join(dir, "protection.out"), opts.sweep ?? "", "utf-8");
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexec node "${join(dir, "gh-stub.mjs")}" "$@"\n`);
  await chmod(join(bin, "gh"), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: dir,
    GH_STUB_CORPUS: join(dir, "corpus.json"),
  };
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", script], { cwd: dir, env });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("tracking-issue dedupe — the query must not go blind past one page", () => {
  const body = gapIssueBody(["GAP     reddoorla/29-navy — secret scanning disabled"]);

  // POSITIVE CONTROL, and it is first on purpose. This case passes on the
  // BROKEN query too. If it ever goes red the harness is the suspect, and every
  // verdict below it is worthless.
  it("finds the tracking issue when it is the 2nd of 40 open issues", async () => {
    const r = await runStep({ step: DEDUPE_STEP, corpus: corpusWithTrackingAt(2, body) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("commented on existing #902");
    expect(r.out).not.toContain("STUB_CREATE");
  });

  // THE REGRESSION THIS FILE EXISTS FOR. Identical corpus, identical title,
  // identical everything — only the row's position differs, and position is not
  // something the alarm gets to have an opinion about. On the unbounded query
  // this files a duplicate; that is #754 being born on 2026-09-10.
  it("finds the SAME issue at position 35, past the 30-row default page", async () => {
    const r = await runStep({ step: DEDUPE_STEP, corpus: corpusWithTrackingAt(35, body) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("commented on existing #935");
    expect(r.out).not.toContain("STUB_CREATE");
  });

  it("files a new issue when no open issue carries the title", async () => {
    const corpus = corpusWithTrackingAt(35, body).map((i) =>
      i.title === TRACKING_TITLE ? { ...i, title: "Something else entirely" } : i,
    );
    const r = await runStep({ step: DEDUPE_STEP, corpus });
    expect(r.out).toContain(`STUB_CREATE ${TRACKING_TITLE}`);
    expect(r.out).not.toContain("STUB_COMMENT");
  });
});

describe("protection-gap close loop — gated on the body's gap set, not the title", () => {
  const NAVY = "reddoorla/29-navy";
  const VIDA = "reddoorla/vida-legacy-foundation";
  const gapBody = (repos: string[]) =>
    gapIssueBody(repos.map((r) => `GAP     ${r} — secret scanning disabled`));

  /** One same-title issue at position 35, so every case here also exercises the
   *  bounded query rather than quietly testing a first-page hit. */
  const oneIssue = (body: string) => corpusWithTrackingAt(35, body);

  // POSITIVE CONTROL. The everyday path: the sweep verified the repo the issue
  // named, so the issue closes. Written and seen green before any of the
  // refusals below are believed.
  it("closes the issue when this sweep verified every repo its body named", async () => {
    const sweep = await sweepOutput([{ name: "29-navy" }]);
    expect(sweep.code).toBe(0);
    expect(sweep.output).toContain("PROTECTION_AUDIT gaps=0 ");
    const r = await runStep({
      step: CLOSE_STEP,
      corpus: oneIssue(gapBody([NAVY])),
      sweep: sweep.output,
    });
    expect(r.out).toContain("STUB_CLOSE #935");
    expect(r.out).toContain("closed #935");
  });

  // THE FALSE GREEN THE WIDENED QUERY WOULD OTHERWISE BUY. gaps=0 is true and
  // the title matches, but this run never looked at the repo the issue names —
  // it went private, so the sweep SKIPPED it. "I could not verify X" must never
  // produce the same result as "X is fine".
  it("refuses to close an issue naming a repo this sweep never verified", async () => {
    const sweep = await sweepOutput([
      { name: "vida-legacy-foundation" },
      { name: "29-navy", visibility: "private" },
    ]);
    expect(sweep.output).toContain("PROTECTION_AUDIT gaps=0 ");
    const r = await runStep({
      step: CLOSE_STEP,
      corpus: oneIssue(gapBody([NAVY])),
      sweep: sweep.output,
    });
    expect(r.out).not.toContain("STUB_CLOSE");
    expect(r.out).toContain("did not verify");
    expect(r.out).toContain(NAVY);
  });

  // #652 and #754, exactly: two open issues, identical title, DIFFERENT gap
  // sets. A clean sweep of one of them must not carry the other out with it.
  it("closes only the same-title issue whose own gap set this sweep verified", async () => {
    const sweep = await sweepOutput([
      { name: "vida-legacy-foundation" },
      { name: "29-navy", visibility: "private" },
    ]);
    const corpus = corpusWithTrackingAt(35, gapBody([VIDA]));
    corpus[1] = { number: 902, title: TRACKING_TITLE, body: gapBody([NAVY]) };
    const r = await runStep({ step: CLOSE_STEP, corpus, sweep: sweep.output });
    expect(r.out).toContain("STUB_CLOSE #935");
    expect(r.out).not.toContain("STUB_CLOSE #902");
    expect(r.out).toContain("did not verify");
  });

  // A body this step cannot read is not a body it verified. Without this, a
  // hand-filed issue borrowing the title, or any future change to the body
  // shape, closes on a vacuous "every repo it named is covered".
  it("refuses to close an issue whose body carries no GAP line at all", async () => {
    const sweep = await sweepOutput([{ name: "29-navy" }]);
    const r = await runStep({
      step: CLOSE_STEP,
      corpus: oneIssue("Filed by hand: protection looks off on something."),
      sweep: sweep.output,
    });
    expect(r.out).not.toContain("STUB_CLOSE");
    expect(r.out).toContain("no GAP line");
  });

  // The pre-existing guard has to survive the new one being bolted on: a run
  // that exits 0 without auditing prints no gaps=0 line and closes nothing.
  it("still closes nothing when the run printed no verified clean sweep", async () => {
    const r = await runStep({
      step: CLOSE_STEP,
      corpus: oneIssue(gapBody([NAVY])),
      sweep: "protection-audit skipped: no GH_TOKEN (fleet read) configured.\n",
    });
    expect(r.out).not.toContain("STUB_CLOSE");
    expect(r.out).toContain("not closing anything");
  });
});

describe("no tracking-issue query anywhere in .github/workflows is unbounded", () => {
  // The executing tests above cover ONE workflow. This one is the cheap sweep
  // that stops the other eight regressing behind it — and it reads the
  // comment-stripped source, so a `# --limit` note in prose can neither satisfy
  // it nor hide a bare query.
  it("every `gh issue list` carries both a page bound and a title search", async () => {
    const dir = workflowPath(".");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yml"));
    const sites: string[] = [];
    for (const f of files) {
      const src = withoutComments(await readFile(join(dir, f), "utf-8"));
      // Each call site is one `gh issue list …` through to its closing `--jq …`.
      for (const m of src.matchAll(/gh issue list[\s\S]*?--jq [^\n]*\n/g)) {
        sites.push(`${f}: ${m[0].replace(/\s+/g, " ").trim()}`);
      }
    }
    expect(sites.length).toBe(26);
    expect(sites.filter((s) => !s.includes("--limit "))).toEqual([]);
    expect(sites.filter((s) => !s.includes("--search "))).toEqual([]);
  });
});

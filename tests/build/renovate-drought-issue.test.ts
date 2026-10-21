import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  runProtectionAuditCommand,
  type ProtectionAuditDeps,
} from "../../src/cli/commands/protection-audit.js";
import type { RenovateMergeWindow } from "../../src/github/gh.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import { stepRunScript, workflowPath, workflowSteps } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * #1606: A RENOVATE DROUGHT REACHED NO ONE.
 *
 * The protection audit measures when a feature-update Renovate PR last LANDED
 * on each repo (renovateOutcome) and prints `RENOVATE_OUTCOME drought=N …` on
 * its own prefix, so a drought never holds the posture issue. Until #1606 no
 * workflow, report or cockpit read that line: the 2026-10-21 negative-control
 * sweep fed it the 09-14 freeze shape (security and lockfile PRs merging, the
 * last feature merge 34 days ago) and got `drought=4 delivering=0` beside
 * `PROTECTION_AUDIT gaps=0`, exit 0, a green log.
 *
 * fleet-security now reads the line in three steps: one sets a step output, one
 * opens or updates a "Renovate drought: <repos>" issue, and one closes it. This
 * file runs those steps' own shell, extracted byte for byte, against a stub
 * `gh`. Every sweep it feeds them comes from the real `protection-audit`
 * command, so the lines the steps grep are the lines the product prints.
 */

const WF = "fleet-security.yml";
const READ_STEP = "Read the Renovate outcome";
const OPEN_STEP = "Open/update the Renovate drought tracking issue";
const CLOSE_STEP = "Close the Renovate drought issue once every repo delivers";
const POSTURE_CLOSE_STEP = "Close the protection-gap issue on a clean sweep";
const POSTURE_TITLE = "Fleet protection coverage gap";

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** The 09-14 freeze shape, as the sweep README's fleet-security section ran it:
 *  security and lockfile Renovate PRs keep merging, and the last FEATURE merge
 *  is 34 days old. Newest first, as the merge window returns it. */
const FROZEN: RenovateMergeWindow = {
  merges: [
    { headRef: "renovate/npm-vite-vulnerability", mergedAt: daysAgo(2) },
    { headRef: "renovate/lock-file-maintenance", mergedAt: daysAgo(5) },
    { headRef: "renovate/all-minor-patch", mergedAt: daysAgo(34) },
  ],
  truncated: false,
};
/** A repo whose grouped channel merged five days ago. */
const HEALTHY: RenovateMergeWindow = {
  merges: [{ headRef: "renovate/all-minor-patch", mergedAt: daysAgo(5) }],
  truncated: false,
};
/** A repo that has never merged a feature update: UNMEASURED, never a drought. */
const NEVER: RenovateMergeWindow = { merges: [], truncated: false };

type Repo = {
  name: string;
  window: RenovateMergeWindow;
  visibility?: string;
  /** The posture probe throws for this repo before its merge window is read. */
  probeThrows?: boolean;
};

/** A REAL `protection-audit` run over repos whose posture is clean, so the only
 *  thing that varies between fixtures is the Renovate merge window. */
async function sweep(repos: Repo[]): Promise<{ output: string; code: number }> {
  const byName = new Map(repos.map((r) => [`reddoorla/${r.name}`, r.window]));
  const deps: ProtectionAuditDeps = {
    listOrgRepos: async () =>
      repos.map((r) => ({
        name: r.name,
        visibility: r.visibility ?? "public",
        archived: false,
        secretScanning: "enabled",
        pushProtection: "enabled",
      })),
    listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
    getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
    workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: daysAgo(0) }),
    dependencyDashboard: async (repo) => {
      if (repos.some((r) => r.probeThrows && `reddoorla/${r.name}` === repo)) {
        throw new Error("HTTP 502");
      }
      return { present: true, blockedBranches: [], unknownSections: [] };
    },
    openSecretAlerts: async () => 0,
    renovateMergeWindow: async (repo) => byName.get(repo) ?? NEVER,
    repoTextFile: async () => null,
    listWorkflowPaths: async () => [],
    branchTip: async () => null,
    defaultBranch: async () => "main",
    branchRequiredChecks: async () => null,
  };
  return runProtectionAuditCommand({ org: "reddoorla" }, deps);
}

type Issue = { number: number; title: string; body: string };

/** A `gh` that pages `issue list` like the real one (30 rows by default,
 *  `--search` narrows first), hands `--jq` to the real `jq`, and logs every
 *  mutation with its arguments so a test can read the title and body sent. */
const GH_STUB = `
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [group, sub, ...rest] = process.argv.slice(2);
const issues = JSON.parse(readFileSync(process.env.GH_STUB_CORPUS, "utf-8"));
const flag = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
const jq = (expr, json) => execFileSync("jq", ["-r", expr], { input: json, encoding: "utf-8" });

if (group === "issue" && sub === "list") {
  const limit = Number(flag("--limit") ?? 30);
  const search = flag("--search");
  let rows = issues;
  if (search) {
    const phrase = /in:title\\s+"([^"]*)"/.exec(search)?.[1] ?? "";
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
  if (process.env.GH_FAIL_VIEW) { process.stderr.write("HTTP 502\\n"); process.exit(1); }
  const found = issues.find((r) => r.number === Number(rest[0]));
  if (!found) { process.stderr.write("no such issue\\n"); process.exit(1); }
  const fields = (flag("--json") ?? "body").split(",");
  const json = JSON.stringify(Object.fromEntries(fields.map((f) => [f, found[f]])));
  const expr = flag("--jq");
  process.stdout.write(expr ? jq(expr, json) : json);
  process.exit(0);
}
if (group === "issue" && ["create", "edit", "comment", "close"].includes(sub)) {
  appendFileSync(process.env.GH_STUB_LOG, JSON.stringify({ sub, args: rest }) + "\\n");
  process.exit(0);
}
process.stderr.write("gh stub: unhandled " + process.argv.slice(2).join(" ") + "\\n");
process.exit(1);
`;

type Call = { sub: string; args: string[]; flag: (n: string) => string | undefined };

async function runStep(opts: {
  step: string;
  sweep: string;
  corpus?: Issue[];
  env?: Record<string, string>;
}): Promise<{ code: number; out: string; calls: Call[]; outputs: Record<string, string> }> {
  const wf = await readFile(workflowPath(WF), "utf-8");
  const script = stepRunScript(wf, opts.step).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");
  const dir = await mkdtemp(join(tmpdir(), "renovate-drought-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "corpus.json"), JSON.stringify(opts.corpus ?? []), "utf-8");
  await writeFile(join(dir, "gh-stub.mjs"), GH_STUB, "utf-8");
  await writeFile(join(dir, "protection.out"), opts.sweep, "utf-8");
  await writeFile(join(dir, "gh.log"), "", "utf-8");
  await writeFile(join(dir, "github-output"), "", "utf-8");
  await writeFile(join(bin, "gh"), `#!/bin/sh\nexec node "${join(dir, "gh-stub.mjs")}" "$@"\n`);
  await chmod(join(bin, "gh"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: join(dir, "github-output"),
    GH_STUB_CORPUS: join(dir, "corpus.json"),
    GH_STUB_LOG: join(dir, "gh.log"),
    ...opts.env,
  };
  let code = 0;
  let out: string;
  try {
    const r = await execFileAsync("bash", ["-e", "-c", script], { cwd: dir, env });
    out = r.stdout + r.stderr;
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    code = err.code ?? 1;
    out = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const calls = (await readFile(join(dir, "gh.log"), "utf-8"))
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const { sub, args } = JSON.parse(l) as { sub: string; args: string[] };
      const flag = (n: string) => {
        const i = args.indexOf(n);
        return i === -1 ? undefined : args[i + 1];
      };
      return { sub, args, flag };
    });
  const outputs = Object.fromEntries(
    (await readFile(join(dir, "github-output"), "utf-8"))
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { code, out, calls, outputs };
}

/** 40 open issues with the given ones planted at the front of the list's back
 *  half, so every lookup here goes past gh's 30-row default page. */
function corpus(planted: Issue[]): Issue[] {
  const filler: Issue[] = Array.from({ length: 40 }, (_, i) => ({
    number: 900 + i + 1,
    title: `Bump some-dependency-${i + 1} to v${i + 1}`,
    body: "",
  }));
  return [...filler.slice(0, 34), ...planted, ...filler.slice(34)];
}

/** The body the open step writes, captured from a real open-step run. */
async function openedBody(repos: Repo[]): Promise<string> {
  const s = await sweep(repos);
  const r = await runStep({ step: OPEN_STEP, sweep: s.output });
  const create = r.calls.find((c) => c.sub === "create");
  if (!create) throw new Error(`the open step created nothing:\n${r.out}`);
  return create.flag("--body")!;
}

describe("the instrument: a delivering fleet reads clean (positive control first)", () => {
  it("a fleet whose grouped channel merged 5 days ago prints drought=0 unmeasured=0 and a DELIVER line per repo", async () => {
    const s = await sweep([
      { name: "espada", window: HEALTHY },
      { name: "revogen", window: HEALTHY },
    ]);
    expect(s.code).toBe(0);
    expect(s.output).toContain("RENOVATE_OUTCOME drought=0 delivering=2 unmeasured=0 ");
    expect(s.output).toMatch(/^DELIVER reddoorla\/espada — /m);
    expect(s.output).toMatch(/^DELIVER reddoorla\/revogen — /m);
  });

  it("the read step says drought=no on that fleet", async () => {
    const s = await sweep([{ name: "espada", window: HEALTHY }]);
    const r = await runStep({ step: READ_STEP, sweep: s.output });
    expect(r.code).toBe(0);
    expect(r.outputs.drought).toBe("no");
  });
});

describe("a drought opens its own issue", () => {
  it("the 34-day freeze shape: posture clean and exit 0, but the read step says drought=yes", async () => {
    const s = await sweep([
      { name: "espada", window: FROZEN },
      { name: "revogen", window: HEALTHY },
    ]);
    // What the 2026-10-21 sweep saw: a green, clean posture run.
    expect(s.code).toBe(0);
    expect(s.output).toContain("PROTECTION_AUDIT gaps=0 ");
    expect(s.output).toContain("RENOVATE_OUTCOME drought=1 delivering=1 unmeasured=0 ");
    // Only the repo that delivered says so; the dry one never prints DELIVER.
    expect(s.output).toMatch(/^DELIVER reddoorla\/revogen — /m);
    expect(s.output).not.toMatch(/^DELIVER reddoorla\/espada/m);
    const r = await runStep({ step: READ_STEP, sweep: s.output });
    expect(r.code).toBe(0);
    expect(r.outputs.drought).toBe("yes");
  });

  it("files 'Renovate drought: espada' with the audit's own line in the body", async () => {
    const s = await sweep([
      { name: "espada", window: FROZEN },
      { name: "revogen", window: HEALTHY },
    ]);
    const r = await runStep({ step: OPEN_STEP, sweep: s.output });
    const creates = r.calls.filter((c) => c.sub === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0]!.flag("--title")).toBe("Renovate drought: espada");
    const body = creates[0]!.flag("--body")!;
    expect(body).toMatch(/^WARN {4}reddoorla\/espada — no feature update has LANDED in 34d/m);
    expect(body).not.toContain("revogen");
    expect(body).toContain("`RENOVATE_OUTCOME drought=1 delivering=1 unmeasured=0 threshold=21d`");
    expect(body).toContain("Run: ");
  });

  it("an UNMEASURED-only fleet opens nothing: only a drought alarms (the operator, 2026-10-21)", async () => {
    const s = await sweep([
      { name: "williamson-homes", window: NEVER },
      { name: "revogen", window: HEALTHY },
    ]);
    expect(s.output).toContain("RENOVATE_OUTCOME drought=0 delivering=1 unmeasured=1 ");
    const read = await runStep({ step: READ_STEP, sweep: s.output });
    expect(read.outputs.drought).toBe("no");
  });

  it("the fleet's known-good 2026-08-10 snapshot opens nothing", async () => {
    // The PASS control pinned in tests/audits/renovate-outcome.test.ts.
    const read = await runStep({
      step: READ_STEP,
      sweep: "RENOVATE_OUTCOME drought=0 delivering=20 unmeasured=6 threshold=21d\n",
    });
    expect(read.outputs.drought).toBe("no");
  });

  it("lists UNMEASURED repos beside a drought, in the body only, never in the title", async () => {
    const s = await sweep([
      { name: "espada", window: FROZEN },
      { name: "williamson-homes", window: NEVER },
    ]);
    const r = await runStep({ step: OPEN_STEP, sweep: s.output });
    const create = r.calls.find((c) => c.sub === "create")!;
    expect(create.flag("--title")).toBe("Renovate drought: espada");
    const body = create.flag("--body")!;
    const [dry, rest] = body.split("Not measured tonight");
    expect(dry).toMatch(/^WARN {4}reddoorla\/espada — no feature update has LANDED/m);
    expect(dry).not.toContain("williamson-homes");
    expect(rest).toMatch(/^WARN {4}reddoorla\/williamson-homes — renovate outcome UNMEASURED/m);
  });

  it("a repo whose probe threw stays on the line as UNMEASURED, and still holds an issue that named it", async () => {
    const issue: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const s = await sweep([
      { name: "espada", window: FROZEN, probeThrows: true },
      { name: "revogen", window: HEALTHY },
    ]);
    expect(s.output).toMatch(/^GAP {5}reddoorla\/espada — probe failed: HTTP 502/m);
    expect(s.output).toContain("RENOVATE_OUTCOME drought=0 delivering=1 unmeasured=1 ");
    expect(s.output).toMatch(/^WARN {4}reddoorla\/espada — renovate outcome UNMEASURED/m);
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([issue]) });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
    expect(r.out).toContain("did not see deliver: reddoorla/espada");
  });

  it("finds an existing issue titled exactly 'Renovate drought' and files no duplicate", async () => {
    const s = await sweep([{ name: "espada", window: FROZEN }]);
    const bare: Issue = { number: 950, title: "Renovate drought", body: "see run output" };
    const r = await runStep({ step: OPEN_STEP, sweep: s.output, corpus: corpus([bare]) });
    expect(r.calls.filter((c) => c.sub === "create")).toEqual([]);
    expect(r.calls.find((c) => c.sub === "edit")?.args[0]).toBe("950");
  });

  it("updates the existing issue past the first page: retitles it to tonight's repos, rewrites the body, comments", async () => {
    const s = await sweep([
      { name: "espada", window: FROZEN },
      { name: "revogen", window: FROZEN },
    ]);
    const old: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const r = await runStep({ step: OPEN_STEP, sweep: s.output, corpus: corpus([old]) });
    expect(r.calls.filter((c) => c.sub === "create")).toEqual([]);
    const edit = r.calls.find((c) => c.sub === "edit")!;
    expect(edit.args[0]).toBe("950");
    expect(edit.flag("--title")).toBe("Renovate drought: espada, revogen");
    expect(edit.flag("--body")).toMatch(/^WARN {4}reddoorla\/revogen — /m);
    expect(r.calls.filter((c) => c.sub === "comment").map((c) => c.args[0])).toEqual(["950"]);
  });

  it("keeps a long repo list's title inside GitHub's limit and says how many it left out", async () => {
    const repos = Array.from({ length: 25 }, (_, i) => ({
      name: `a-fairly-long-client-site-${i + 1}`,
      window: FROZEN,
    }));
    const s = await sweep(repos);
    const r = await runStep({ step: OPEN_STEP, sweep: s.output });
    const title = r.calls.find((c) => c.sub === "create")!.flag("--title")!;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title).toMatch(/^Renovate drought: a-fairly-long-client-site-1, /);
    const shown = title.replace(/ \(\+\d+ more\)$/, "").split(", ").length;
    expect(title).toMatch(new RegExp(` \\(\\+${25 - shown} more\\)$`));
  });

  it("lists names in the audit's order and stops at the first that does not fit", async () => {
    const repos = [
      { name: "alpha", window: FROZEN },
      { name: "b".repeat(170), window: FROZEN },
      { name: "gamma", window: FROZEN },
    ];
    const s = await sweep(repos);
    const r = await runStep({ step: OPEN_STEP, sweep: s.output });
    expect(r.calls.find((c) => c.sub === "create")!.flag("--title")).toBe(
      "Renovate drought: alpha (+2 more)",
    );
  });

  it("an output with no drought line keeps the existing body and only comments", async () => {
    const old: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const r = await runStep({
      step: OPEN_STEP,
      sweep: "RENOVATE_OUTCOME drought=1 delivering=0 unmeasured=0 threshold=21d\n",
      corpus: corpus([old]),
    });
    expect(r.calls.filter((c) => c.sub === "edit")).toEqual([]);
    expect(r.calls.filter((c) => c.sub === "comment").map((c) => c.args[0])).toEqual(["950"]);
  });
});

describe("the drought never holds the posture issue (the separation stays)", () => {
  it("a drought-only sweep is posture-clean, so the posture issue still closes", async () => {
    const s = await sweep([{ name: "espada", window: FROZEN }]);
    expect(s.code).toBe(0);
    const posture: Issue = {
      number: 951,
      title: POSTURE_TITLE,
      body: "```\nGAP     reddoorla/espada — no repo rulesets at all\n```\n",
    };
    const r = await runStep({
      step: POSTURE_CLOSE_STEP,
      sweep: s.output,
      corpus: corpus([posture]),
    });
    expect(r.out).toContain("closed #951");
  });

  it("the drought issue's title and body share nothing the posture steps match", async () => {
    const body = await openedBody([{ name: "espada", window: FROZEN }]);
    expect(body).not.toMatch(/^GAP/m);
    expect("Renovate drought: espada").not.toContain(POSTURE_TITLE);
  });
});

describe("the close step closes only on evidence", () => {
  const droughtIssue = async (n: number, repos: Repo[]): Promise<Issue> => ({
    number: n,
    title: `Renovate drought: ${repos.map((r) => r.name).join(", ")}`,
    body: await openedBody(repos),
  });

  it("closes when every repo the issue named delivers again (positive control)", async () => {
    const issue = await droughtIssue(950, [{ name: "espada", window: FROZEN }]);
    const s = await sweep([{ name: "espada", window: HEALTHY }]);
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([issue]) });
    expect(r.calls.filter((c) => c.sub === "close").map((c) => c.args[0])).toEqual(["950"]);
  });

  it("closes every open drought issue whose named repos all deliver, not just the first", async () => {
    const a = await droughtIssue(950, [{ name: "espada", window: FROZEN }]);
    const b = await droughtIssue(951, [{ name: "revogen", window: FROZEN }]);
    const s = await sweep([
      { name: "espada", window: HEALTHY },
      { name: "revogen", window: HEALTHY },
    ]);
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([a, b]) });
    expect(r.calls.filter((c) => c.sub === "close").map((c) => c.args[0])).toEqual(["950", "951"]);
  });

  it("refuses when a repo the issue named was not measured tonight (went private)", async () => {
    const issue = await droughtIssue(950, [{ name: "espada", window: FROZEN }]);
    // espada-cms delivers: a prefix match on its DELIVER line must not
    // vouch for espada.
    const s = await sweep([
      { name: "revogen", window: HEALTHY },
      { name: "espada-cms", window: HEALTHY },
      { name: "espada", window: HEALTHY, visibility: "private" },
    ]);
    expect(s.output).toContain("RENOVATE_OUTCOME drought=0 ");
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([issue]) });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
    expect(r.out).toContain("did not see deliver");
    expect(r.out).toContain("reddoorla/espada");
  });

  it("refuses an issue whose body names no dry repo", async () => {
    const s = await sweep([{ name: "espada", window: HEALTHY }]);
    const handFiled: Issue = { number: 950, title: "Renovate drought: espada", body: "by hand" };
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([handFiled]) });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
  });

  it("closes nothing when the audit printed no RENOVATE_OUTCOME line", async () => {
    const issue = await droughtIssue(950, [{ name: "espada", window: FROZEN }]);
    const r = await runStep({
      step: CLOSE_STEP,
      sweep: "protection-audit skipped: no GH_TOKEN (fleet read) configured.\n",
      corpus: corpus([issue]),
    });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
  });

  it("closes nothing while tonight's sweep still has a drought somewhere", async () => {
    const issue = await droughtIssue(950, [{ name: "espada", window: FROZEN }]);
    const s = await sweep([
      { name: "espada", window: HEALTHY },
      { name: "revogen", window: FROZEN },
    ]);
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([issue]) });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
  });

  it("closes while another repo is still UNMEASURED: unmeasured never holds the issue", async () => {
    const issue = await droughtIssue(950, [
      { name: "espada", window: FROZEN },
      { name: "williamson-homes", window: NEVER },
    ]);
    const s = await sweep([
      { name: "espada", window: HEALTHY },
      { name: "williamson-homes", window: NEVER },
    ]);
    expect(s.output).toContain("RENOVATE_OUTCOME drought=0 delivering=1 unmeasured=1 ");
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([issue]) });
    expect(r.calls.filter((c) => c.sub === "close").map((c) => c.args[0])).toEqual(["950"]);
  });

  it("a named repo that goes UNMEASURED on a night that still has a drought stays named, so it still holds", async () => {
    // Night 1: espada is dry, and the issue names it.
    const night1: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    // Night 2: espada's probe throws (UNMEASURED) and revogen is dry, so the
    // open step rewrites the body to tonight's drought.
    const s2 = await sweep([
      { name: "espada", window: FROZEN, probeThrows: true },
      { name: "revogen", window: FROZEN },
    ]);
    const r2 = await runStep({ step: OPEN_STEP, sweep: s2.output, corpus: corpus([night1]) });
    const edit = r2.calls.find((c) => c.sub === "edit")!;
    expect(edit.flag("--title")).toBe("Renovate drought: revogen, espada");
    const night2: Issue = { number: 950, title: edit.flag("--title")!, body: edit.flag("--body")! };
    expect(night2.body).toMatch(
      /^WARN {4}reddoorla\/espada — no feature update has LANDED since an earlier night/m,
    );
    // Night 3: revogen delivers, espada is still UNMEASURED. It never
    // delivered, so the issue stays open.
    const s3 = await sweep([
      { name: "espada", window: FROZEN, probeThrows: true },
      { name: "revogen", window: HEALTHY },
    ]);
    const r3 = await runStep({ step: CLOSE_STEP, sweep: s3.output, corpus: corpus([night2]) });
    expect(r3.calls.filter((c) => c.sub === "close")).toEqual([]);
    expect(r3.out).toContain("did not see deliver: reddoorla/espada");
  });

  it("keeps the body, warns and still comments when the existing body cannot be read", async () => {
    const night1: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const s2 = await sweep([
      { name: "espada", window: FROZEN, probeThrows: true },
      { name: "revogen", window: FROZEN },
    ]);
    const r2 = await runStep({
      step: OPEN_STEP,
      sweep: s2.output,
      corpus: corpus([night1]),
      env: { GH_FAIL_VIEW: "1" },
    });
    expect(r2.calls.filter((c) => c.sub === "edit")).toEqual([]);
    expect(r2.calls.filter((c) => c.sub === "comment").map((c) => c.args[0])).toEqual(["950"]);
    expect(r2.out).toContain("::warning::could not read the body of #950");
    // The kept body still names espada, so a night where revogen delivers
    // and espada is still unmeasured does not close it.
    const s3 = await sweep([
      { name: "espada", window: FROZEN, probeThrows: true },
      { name: "revogen", window: HEALTHY },
    ]);
    const r3 = await runStep({ step: CLOSE_STEP, sweep: s3.output, corpus: corpus([night1]) });
    expect(r3.calls.filter((c) => c.sub === "close")).toEqual([]);
  });

  it("a named repo that delivered is not carried into the rewritten body", async () => {
    const night1: Issue = {
      number: 950,
      title: "Renovate drought: espada",
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const s2 = await sweep([
      { name: "espada", window: HEALTHY },
      { name: "revogen", window: FROZEN },
    ]);
    const r2 = await runStep({ step: OPEN_STEP, sweep: s2.output, corpus: corpus([night1]) });
    const edit = r2.calls.find((c) => c.sub === "edit")!;
    expect(edit.flag("--title")).toBe("Renovate drought: revogen");
    expect(edit.flag("--body")).not.toContain("reddoorla/espada");
  });

  it("leaves other titles alone", async () => {
    const s = await sweep([{ name: "espada", window: HEALTHY }]);
    const other: Issue = {
      number: 952,
      title: POSTURE_TITLE,
      body: await openedBody([{ name: "espada", window: FROZEN }]),
    };
    const r = await runStep({ step: CLOSE_STEP, sweep: s.output, corpus: corpus([other]) });
    expect(r.calls.filter((c) => c.sub === "close")).toEqual([]);
  });
});

/** A step's real `if:`, evaluated for one value of the read step's output on
 *  main. Only `==`, `!=`, `&&`, `||` and quoted strings appear in these. */
async function firesOn(stepName: string, drought: string): Promise<boolean> {
  const wf = await readFile(workflowPath(WF), "utf-8");
  const step = workflowSteps(wf).find((s) => s.label === stepName);
  if (!step?.if) throw new Error(`no if: on ${stepName}`);
  const js = step.if
    .replace(/steps\.renovate-outcome\.outputs\.drought/g, JSON.stringify(drought))
    .replace(/github\.ref/g, JSON.stringify("refs/heads/main"))
    .replace(/'([^']*)'/g, (_, v: string) => JSON.stringify(v))
    .replace(/==/g, "===")
    .replace(/!===/g, "!==");
  if (!/^[\s"\w/=!&|()-]+$/.test(js)) throw new Error(`cannot evaluate: ${js}`);
  return Function(`return (${js});`)() as boolean;
}

describe("the read step without an outcome line", () => {
  it("only drought=yes fires the open step, and only drought=no fires the close step", async () => {
    for (const [value, open, close] of [
      ["yes", true, false],
      ["no", false, true],
      ["unknown", false, false],
      ["", false, false],
    ] as const) {
      expect([value, await firesOn(OPEN_STEP, value)]).toEqual([value, open]);
      expect([value, await firesOn(CLOSE_STEP, value)]).toEqual([value, close]);
    }
  });

  it("says drought=unknown and warns", async () => {
    const r = await runStep({
      step: READ_STEP,
      sweep: "protection-audit skipped: no GH_TOKEN (fleet read) configured.\n",
    });
    expect(r.code).toBe(0);
    expect(r.outputs.drought).toBe("unknown");
    expect(r.out).toContain("::warning::");
  });
});

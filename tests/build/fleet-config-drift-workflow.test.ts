import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import yaml from "js-yaml";

type Step = { name?: string; uses?: string; if?: string; with?: Record<string, unknown> };
type Workflow = {
  on: { schedule?: unknown; workflow_dispatch?: unknown };
  concurrency: unknown;
  permissions: unknown;
  jobs: { drift: { "timeout-minutes"?: number; steps: Step[] } };
};
import {
  stepEnv,
  stepRunScript,
  withoutComments,
  workflowPath,
  workflowUses,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const FILE = "fleet-config-drift.yml";
const CONTROL = "Positive control";
const SWEEP = "Sweep the fleet for config drift";
const OPEN = "Open/update the config-drift tracking issue";
const CLOSE = "Close the config-drift issue on a clean sweep";
const TITLE = "Fleet config drift";

let wf: string;

beforeAll(async () => {
  wf = await readFile(workflowPath(FILE), "utf-8");
});

type Result = { code: number; out: string; dir: string };

async function exec(
  script: string,
  opts: { cwd?: string; bin?: Record<string, string>; env?: Record<string, string>; dir?: string },
): Promise<Result> {
  const dir = opts.dir ?? (await mkdtemp(join(tmpdir(), "config-drift-wf-")));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  for (const [name, body] of Object.entries(opts.bin ?? {})) {
    await writeFile(join(bin, name), body, "utf-8");
    await chmod(join(bin, name), 0o755);
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: dir,
    GITHUB_OUTPUT: join(dir, "github_output"),
    ...opts.env,
  };
  await writeFile(env.GITHUB_OUTPUT, "", "utf-8");
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", script], {
      cwd: opts.cwd ?? dir,
      env,
    });
    return { code: 0, out: stdout + stderr, dir };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? ""), dir };
  }
}

const script = (step: string) => stepRunScript(wf, step).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");

const summary = (d: number, c: number, s: number) =>
  `SYNC_CONFIGS_DRIFT drifted=${d} clean=${c} skipped=${s} total=${d + c + s}`;

describe("fleet-config-drift — the shape of the job", () => {
  it("is weekly on Sunday off the hour, dispatchable, and never overlaps", () => {
    const doc = yaml.load(wf) as Workflow;
    expect(doc.on.schedule).toEqual([{ cron: "23 7 * * 0" }]);
    expect(doc.on).toHaveProperty("workflow_dispatch");
    expect(doc.concurrency).toEqual({ group: "fleet-config-drift", "cancel-in-progress": false });
    expect(doc.jobs.drift["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("holds exactly contents:read and issues:write, and no credential that can write to a client repo", () => {
    const doc = yaml.load(wf) as Workflow;
    expect(doc.permissions).toEqual({ contents: "read", issues: "write" });
    expect(workflowUses(wf).some((u) => u.startsWith("actions/create-github-app-token"))).toBe(
      false,
    );
    const checkout = doc.jobs.drift.steps.find((s) =>
      String(s.uses ?? "").startsWith("actions/checkout@"),
    );
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(withoutComments(wf)).not.toMatch(/secrets\.(?!TURSO_DATABASE_URL|TURSO_AUTH_TOKEN)/);
  });

  it("gives the Turso secrets to the sweep step only, and no GH_TOKEN there", () => {
    expect(Object.keys(stepEnv(wf, SWEEP)).sort()).toEqual([
      "TURSO_AUTH_TOKEN",
      "TURSO_DATABASE_URL",
    ]);
    const turso = withoutComments(wf).match(/secrets\.TURSO_/g) ?? [];
    expect(turso).toHaveLength(2);
  });

  it("sweeps the turso roster with --dry into a workdir under RUNNER_TEMP", () => {
    const run = withoutComments(stepRunScript(wf, SWEEP)).replace(/\\\n\s*/g, " ");
    const cmd = /node dist\/cli\/bin\.js sync-configs[^|]*/.exec(run)?.[0] ?? "";
    expect(cmd).toContain("--fleet turso");
    expect(cmd).toMatch(/(^|\s)--dry(\s|$)/);
    expect(cmd).toContain('--workdir "${RUNNER_TEMP:-/tmp}/fleet-config-drift"');
  });

  it("opens the finding issue only on drift, and only on main", () => {
    const doc = yaml.load(wf) as Workflow;
    const open = doc.jobs.drift.steps.find((s) => s.name === OPEN);
    const close = doc.jobs.drift.steps.find((s) => s.name === CLOSE);
    expect(open?.if).toBe(
      "steps.drift.outputs.drifted == 'yes' && github.ref == 'refs/heads/main'",
    );
    expect(close?.if).toBe(
      "steps.drift.outputs.drifted == 'no' && github.ref == 'refs/heads/main'",
    );
  });

  it("runs the positive control before the sweep", () => {
    const doc = yaml.load(wf) as Workflow;
    const names = doc.jobs.drift.steps.map((s) => s.name);
    expect(names.indexOf(CONTROL)).toBeGreaterThanOrEqual(0);
    expect(names.indexOf(CONTROL)).toBeLessThan(names.indexOf(SWEEP));
    expect(doc.jobs.drift.steps[names.indexOf(CONTROL)]?.if).toBeUndefined();
  });
});

describe("fleet-config-drift — the positive control", () => {
  const binPath = join(REPO_ROOT, "dist/cli/bin.js");

  it("passes against the real CLI and the real fixtures", async () => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
    const r = await exec(script(CONTROL), { cwd: REPO_ROOT });
    expect(r.out).not.toContain("::error::");
    expect(r.code).toBe(0);
    expect(r.out).toContain("positive control passed");
  });

  const cannedNode = (canned: Record<string, string>) => {
    const cases = Object.entries(canned)
      .map(([k, v]) => `  ${k}) printf '%s\\n' '${v.replace(/'/g, "'\\''")}' ;;`)
      .join("\n");
    return `#!/bin/bash\ncase "$(basename "$3")" in\n${cases}\nesac\nexit 0\n`;
  };
  const GOOD = {
    drift: `DRIFT drift eslint.config.js\nDRIFT drift .gitignore\n${summary(1, 0, 0)}`,
    clean: `no changes needed\n\nCLEAN clean\n${summary(0, 1, 0)}`,
    tracked: `DRIFT tracked .gitignore\n${summary(1, 0, 0)}`,
  };

  it("passes a stubbed CLI that reads all three fixtures correctly", async () => {
    const r = await exec(script(CONTROL), { cwd: REPO_ROOT, bin: { node: cannedNode(GOOD) } });
    expect(r.code).toBe(0);
  });

  for (const [name, canned] of [
    [
      "the drift fixture reads as no changes needed",
      { ...GOOD, drift: `no changes needed\n\nCLEAN drift\n${summary(0, 1, 0)}` },
    ],
    [
      "the clean fixture reads as drift",
      { ...GOOD, clean: `DRIFT clean .gitignore\n${summary(1, 0, 0)}` },
    ],
    [
      "the drift fixture's lines say CLEAN under a drift summary",
      { ...GOOD, drift: `DRIFT drift x\nCLEAN drift\n${summary(1, 0, 0)}` },
    ],
    [
      "the drift fixture has a drift summary and no DRIFT line",
      { ...GOOD, drift: summary(1, 0, 0) },
    ],
    [
      "the clean fixture's lines say DRIFT under a clean summary",
      { ...GOOD, clean: `CLEAN clean\nDRIFT clean x\n${summary(0, 1, 0)}` },
    ],
    [
      "the tracked-artifact fixture drifts on another file only",
      { ...GOOD, tracked: `DRIFT tracked eslint.config.js\n${summary(1, 0, 0)}` },
    ],
    [
      "the tracked-artifact fixture also says CLEAN",
      { ...GOOD, tracked: `DRIFT tracked .gitignore\nCLEAN tracked\n${summary(1, 0, 0)}` },
    ],
    [
      "the tracked-artifact fixture has no summary",
      { ...GOOD, tracked: "DRIFT tracked .gitignore" },
    ],
    [
      "the drift fixture's summary says clean under DRIFT lines",
      { ...GOOD, drift: `DRIFT drift eslint.config.js\n${summary(0, 1, 0)}` },
    ],
    [
      "the clean fixture's summary counts it as skipped",
      { ...GOOD, clean: `CLEAN clean\n${summary(0, 0, 1)}` },
    ],
    [
      "the clean fixture has a clean summary and no CLEAN line",
      { ...GOOD, clean: `no changes needed\n${summary(0, 1, 0)}` },
    ],
    [
      "the tracked-artifact fixture drifts on more than .gitignore",
      {
        ...GOOD,
        tracked: `DRIFT tracked eslint.config.js\nDRIFT tracked .gitignore\n${summary(1, 0, 0)}`,
      },
    ],
    [
      "the tracked-artifact fixture reads as clean",
      { ...GOOD, tracked: `CLEAN tracked\n${summary(0, 1, 0)}` },
    ],
    ["the CLI prints nothing", { drift: "", clean: "", tracked: "" }],
  ] as const) {
    it(`fails when ${name}`, async () => {
      const r = await exec(script(CONTROL), { cwd: REPO_ROOT, bin: { node: cannedNode(canned) } });
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("::error::");
    });
  }
});

describe("fleet-config-drift — the sweep gate", () => {
  async function sweep(stdout: string, exit = 0) {
    const dir = await mkdtemp(join(tmpdir(), "config-drift-sweep-"));
    await writeFile(join(dir, "canned.txt"), stdout, "utf-8");
    const node = `#!/bin/sh\nprintf '%s\\n' "$*" > "${join(dir, "args.txt")}"\ncat "${join(dir, "canned.txt")}"\nexit ${exit}\n`;
    const r = await exec(script(SWEEP), { dir, bin: { node } });
    const output = await readFile(join(dir, "github_output"), "utf-8");
    const args = existsSync(join(dir, "args.txt"))
      ? await readFile(join(dir, "args.txt"), "utf-8")
      : "";
    return { ...r, output, args };
  }

  it("passes a clean fleet and reports drifted=no", async () => {
    const lines = Array.from({ length: 14 }, (_, i) => `CLEAN reddoorla/site-${i}`).join("\n");
    const r = await sweep(`${lines}\n${summary(0, 14, 0)}\n`);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).not.toContain("::warning::");
    expect(r.output).toBe("drifted=no\n");
    expect(r.args).toMatch(/sync-configs --fleet turso --dry --workdir /);
  });

  it("stays green on drift and reports drifted=yes", async () => {
    const r = await sweep(`DRIFT reddoorla/a .gitignore\nCLEAN reddoorla/b\n${summary(1, 1, 0)}\n`);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.output).toBe("drifted=yes\n");
  });

  it("fails when the sweep exits non-zero", async () => {
    const r = await sweep(`${summary(0, 14, 0)}\n`, 1);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it("fails when there is no summary line", async () => {
    const r = await sweep("CLEAN reddoorla/a\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
    expect(r.output).toBe("");
  });

  it("fails when there is no output at all", async () => {
    const r = await sweep("");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it("fails when the roster resolved nothing (total=0)", async () => {
    const r = await sweep(`${summary(0, 0, 0)}\n`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("total=0");
    expect(r.output).toBe("");
  });

  it("warns but stays green on one skipped site, naming only that site", async () => {
    const r = await sweep(
      `DRIFT reddoorla/drifted .gitignore\nCLEAN reddoorla/fine\nSKIPPED reddoorla/gone git clone failed\n${summary(1, 12, 1)}\n`,
    );
    expect(r.code).toBe(0);
    const warning = r.out.split("\n").find((l) => l.startsWith("::warning::")) ?? "";
    expect(warning).toMatch(/: reddoorla\/gone\s*$/);
    expect(r.out).not.toContain("::error::");
  });

  it("stays green at exactly half skipped", async () => {
    const r = await sweep(`${summary(0, 7, 7)}\n`);
    expect(r.code).toBe(0);
    expect(r.out).toContain("::warning::");
  });

  it("fails when more than half the sites were skipped", async () => {
    const r = await sweep(`${summary(1, 5, 8)}\n`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });
});

type Issue = { number: number; title: string; body: string };

const GH = `#!/usr/bin/env node
const fs = require("node:fs");
const corpus = JSON.parse(fs.readFileSync(process.env.GH_CORPUS, "utf-8"));
const a = process.argv.slice(2);
const log = (s) => fs.appendFileSync(process.env.GH_LOG, s + "\\n");
if (a[0] === "issue" && a[1] === "list") {
  const phrase = /in:title "(.*)"/.exec(a[a.indexOf("--search") + 1])[1].toLowerCase();
  const hits = corpus
    .filter((i) => i.title.toLowerCase().includes(phrase))
    .map((i) => ({ number: i.number, title: i.title }));
  const jq = require("node:child_process").execFileSync("jq", ["-r", a[a.indexOf("--jq") + 1]], {
    input: JSON.stringify(hits),
  });
  process.stdout.write(jq);
  process.exit(0);
}
if (a[0] === "issue" && a[1] === "view") {
  process.stdout.write(corpus.find((i) => String(i.number) === a[2]).body + "\\n");
  process.exit(0);
}
if (a[0] === "issue" && a[1] === "close") { log("CLOSE #" + a[2]); process.exit(0); }
if (a[0] === "issue" && a[1] === "create") { log("CREATE " + a[a.indexOf("--body") + 1]); process.exit(0); }
if (a[0] === "issue" && a[1] === "edit") { log("EDIT #" + a[2]); process.exit(0); }
if (a[0] === "issue" && a[1] === "comment") { log("COMMENT #" + a[2]); process.exit(0); }
process.exit(1);
`;

async function issueStep(step: string, sweepOut: string, corpus: Issue[]) {
  const dir = await mkdtemp(join(tmpdir(), "config-drift-issue-"));
  await writeFile(join(dir, "config-drift.out"), sweepOut, "utf-8");
  await writeFile(join(dir, "corpus.json"), JSON.stringify(corpus), "utf-8");
  await writeFile(join(dir, "gh.log"), "", "utf-8");
  const r = await exec(script(step), {
    dir,
    bin: { gh: GH },
    env: { GH_CORPUS: join(dir, "corpus.json"), GH_LOG: join(dir, "gh.log") },
  });
  return { ...r, log: await readFile(join(dir, "gh.log"), "utf-8") };
}

const A = "reddoorla/gallerysonder";
const B = "reddoorla/erp-industrial";
const C = "reddoorla/revogen";

async function filedBody(sweepOut: string): Promise<string> {
  const r = await issueStep(OPEN, sweepOut, []);
  if (!r.log.startsWith("CREATE ")) throw new Error(`open step filed nothing:\n${r.out}`);
  return r.log.slice(r.log.indexOf("CREATE ") + 7).trimEnd();
}

describe("fleet-config-drift — the finding issue", () => {
  it("files every DRIFT and SKIPPED line and the run link", async () => {
    const body = await filedBody(
      `DRIFT ${A} .gitignore\nDRIFT ${A} eslint.config.js\nDRIFT ${B} netlify.toml\nSKIPPED ${C} git clone failed\nCLEAN reddoorla/espada\n${summary(2, 1, 1)}\n`,
    );
    expect(body).toContain(`DRIFT ${A} .gitignore`);
    expect(body).toContain(`DRIFT ${A} eslint.config.js`);
    expect(body).toContain(`DRIFT ${B} netlify.toml`);
    expect(body).toContain(`SKIPPED ${C} git clone failed`);
    expect(body).not.toContain("CLEAN reddoorla/espada");
    expect(body).toContain("Run: ");
  });

  it("closes an issue its own open step filed once every repo it named comes back CLEAN", async () => {
    const body = await filedBody(
      `DRIFT ${A} .gitignore\nSKIPPED ${C} clone failed\n${summary(1, 0, 1)}\n`,
    );
    const r = await issueStep(CLOSE, `CLEAN ${A}\nCLEAN ${C}\nCLEAN ${B}\n${summary(0, 3, 0)}\n`, [
      { number: 7, title: TITLE, body },
    ]);
    expect(r.log).toContain("CLOSE #7");
  });

  it("does not close while a repo the issue named was skipped this run", async () => {
    const body = await filedBody(`DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`);
    const r = await issueStep(
      CLOSE,
      `SKIPPED ${A} clone failed\nCLEAN ${B}\n${summary(0, 1, 1)}\n`,
      [{ number: 7, title: TITLE, body }],
    );
    expect(r.log).not.toContain("CLOSE");
    expect(r.out).toContain(A);
  });

  it("does not close while a repo the issue named as SKIPPED is still not CLEAN", async () => {
    const body = await filedBody(
      `DRIFT ${A} .gitignore\nSKIPPED ${C} clone failed\n${summary(1, 0, 1)}\n`,
    );
    const r = await issueStep(CLOSE, `CLEAN ${A}\n${summary(0, 1, 0)}\n`, [
      { number: 7, title: TITLE, body },
    ]);
    expect(r.log).not.toContain("CLOSE");
    expect(r.out).toContain(C);
  });

  it("does not close on drifted=0 alone when the named repos are absent from this run", async () => {
    const body = await filedBody(`DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`);
    const r = await issueStep(CLOSE, `CLEAN ${B}\n${summary(0, 1, 0)}\n`, [
      { number: 7, title: TITLE, body },
    ]);
    expect(r.log).not.toContain("CLOSE");
  });

  it("does not close without a drifted=0 summary, even when every named repo is CLEAN", async () => {
    const body = await filedBody(`DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`);
    for (const out of [`CLEAN ${A}\n`, `CLEAN ${A}\nDRIFT ${B} x\n${summary(1, 1, 0)}\n`, ""]) {
      const r = await issueStep(CLOSE, out, [{ number: 7, title: TITLE, body }]);
      expect(r.log).not.toContain("CLOSE");
    }
  });

  it("does not close an issue whose body names no repo", async () => {
    const r = await issueStep(CLOSE, `CLEAN ${A}\n${summary(0, 1, 0)}\n`, [
      { number: 7, title: TITLE, body: "Filed by hand: configs look off somewhere." },
    ]);
    expect(r.log).not.toContain("CLOSE");
  });

  it("never closes an issue whose title only contains the tracking title", async () => {
    const body = await filedBody(`DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`);
    const r = await issueStep(CLOSE, `CLEAN ${A}\n${summary(0, 1, 0)}\n`, [
      { number: 5, title: `${TITLE} - sonder follow-up`, body },
      { number: 7, title: TITLE, body },
    ]);
    expect(r.log.match(/CLOSE #\d+/g)).toEqual(["CLOSE #7"]);
  });

  it("does not count a CLEAN repo whose name only contains the named repo", async () => {
    const body = await filedBody(`DRIFT reddoorla/sonder .gitignore\n${summary(1, 0, 0)}\n`);
    const r = await issueStep(
      CLOSE,
      `SKIPPED reddoorla/sonder clone failed\nCLEAN reddoorla/sonder-landing\nCLEAN reddoorla/gallerysonder\n${summary(0, 2, 1)}\n`,
      [{ number: 7, title: TITLE, body }],
    );
    expect(r.log).not.toContain("CLOSE");
    expect(r.out).toMatch(/::warning::not closing #7.*reddoorla\/sonder/);
  });

  it("updates the exact-title issue, not one whose title only contains it", async () => {
    const out = `DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`;
    const near = await issueStep(OPEN, out, [
      { number: 5, title: `${TITLE} - sonder follow-up`, body: "hand-written" },
    ]);
    expect(near.log).toMatch(/^CREATE /);
    expect(near.log).not.toMatch(/EDIT|COMMENT/);
    const both = await issueStep(OPEN, out, [
      { number: 5, title: `${TITLE} - sonder follow-up`, body: "hand-written" },
      { number: 7, title: TITLE, body: "old" },
    ]);
    expect(both.log.match(/(EDIT|COMMENT|CREATE) ?#?\d*/g)).toEqual(["EDIT #7", "COMMENT #7"]);
  });

  it("closes only the same-title issue whose own repos this run verified", async () => {
    const verified = await filedBody(`DRIFT ${A} .gitignore\n${summary(1, 0, 0)}\n`);
    const other = await filedBody(`DRIFT ${B} .gitignore\n${summary(1, 0, 0)}\n`);
    const r = await issueStep(
      CLOSE,
      `CLEAN ${A}\nSKIPPED ${B} clone failed\n${summary(0, 1, 1)}\n`,
      [
        { number: 7, title: TITLE, body: verified },
        { number: 8, title: TITLE, body: other },
        { number: 9, title: "Something else", body: verified },
      ],
    );
    expect(r.log.match(/CLOSE #\d+/g)).toEqual(["CLOSE #7"]);
  });
});

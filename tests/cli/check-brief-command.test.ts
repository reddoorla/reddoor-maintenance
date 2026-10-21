import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCommand,
  envSet,
  isReadOnlyApiCall,
  parseBrief,
  runCheckBrief,
  tokenize,
  type CheckBriefDeps,
  type ExecResult,
} from "../../src/cli/commands/check-brief.js";
import { isReadOnlyApiCall as landPrsIsReadOnlyApiCall } from "../../scripts/land-prs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures/check-brief");
const fixture = (name: string) => join(fixtures, name);

/** An exec that must never be reached: a refused or built-in line runs nothing. */
const noExec: CheckBriefDeps["exec"] = async (file, args) => {
  throw new Error(`exec reached: ${file} ${args.join(" ")}`);
};

function fakeExec(result: ExecResult): {
  exec: CheckBriefDeps["exec"];
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push([file, ...args]);
      return result;
    },
  };
}

function writeBrief(dir: string, verify: string[], rest = ""): string {
  const path = join(dir, "brief.md");
  writeFileSync(
    path,
    `## Worker brief — test\n\n**Item.** test\n${rest}\n\n**Verify first.**\n\n${verify.join("\n")}\n\n**Start here.**\n\n- nothing\n`,
  );
  return path;
}

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "check-brief-"));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("check-brief: the recommendation's fixtures", () => {
  it("the 2026-10-06 P1-31 brief passes against the file it measured (6ea7c10)", async () => {
    const tree = join(scratch, "p1-31");
    mkdirSync(join(tree, "src/audits/util"), { recursive: true });
    copyFileSync(
      fixture("p1-31-tree/contrast-unmeasured.ts.txt"),
      join(tree, "src/audits/util/contrast-unmeasured.ts"),
    );
    // The real execFile: sed runs, no shell.
    const r = await runCheckBrief(fixture("p1-31.md"), { cwd: tree }, { env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["PASS", "PASS", "NOT RUN"]);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/2 PASS, 0 FAIL, 0 COULD NOT RUN, 1 NOT RUN/);
  });

  it("the same brief fails when the file has moved on (the instrument can say no)", async () => {
    const tree = join(scratch, "p1-31-moved");
    mkdirSync(join(tree, "src/audits/util"), { recursive: true });
    writeFileSync(join(tree, "src/audits/util/contrast-unmeasured.ts"), "// nothing here\n");
    const r = await runCheckBrief(fixture("p1-31.md"), { cwd: tree }, { env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["FAIL", "FAIL", "NOT RUN"]);
    expect(r.code).toBe(1);
  });

  it("the verbatim P1-31 brief has no line in check-brief form, and says so", async () => {
    const r = await runCheckBrief(fixture("p1-31-verbatim.md"), { cwd: scratch }, { exec: noExec });
    expect(r.results).toEqual([]);
    expect(r.output).toMatch(/no Verify-first line is in check-brief form/);
    expect(r.code).toBe(0);
  });

  it("Mantis: MANTIS_PRISMIC fails and its control MANTIS_LANDSCAPING_PRISMIC passes", async () => {
    const r = await runCheckBrief(
      fixture("mantis.md"),
      { cwd: scratch },
      { exec: noExec, env: { MANTIS_LANDSCAPING_PRISMIC: "tok-mantis-value" } },
    );
    expect(r.results.map((x) => x.status)).toEqual(["FAIL", "PASS"]);
    expect(r.code).toBe(1);
    expect(r.output).not.toContain("tok-mantis-value");
  });

  it("#1012: 'MarkUp unreachable' fails where the cloud carries the key", async () => {
    const r = await runCheckBrief(
      fixture("markup-1012.md"),
      { cwd: scratch },
      { exec: noExec, env: { MARKUP_API_KEY: "mk-value", DISCORD_BOT_KEY: "dk-value" } },
    );
    expect(r.results.map((x) => x.status)).toEqual(["FAIL", "PASS"]);
    expect(r.code).toBe(1);
  });

  it("williamson-homes#3: the secrets line is COULD NOT RUN behind the proxy's 403, not FAIL", async () => {
    // The proxy's real answer, measured 2026-10-21 against this path.
    const { exec, calls } = fakeExec({
      code: 1,
      stdout:
        '{"message":"Access to this GitHub Actions path is not permitted through this proxy."}',
      stderr:
        "gh: Access to this GitHub Actions path is not permitted through this proxy. (HTTP 403)",
    });
    const r = await runCheckBrief(fixture("williamson-3.md"), { cwd: scratch }, { exec, env: {} });
    expect(calls).toEqual([
      ["gh", "api", "repos/reddoorla/williamson-homes/actions/secrets", "--jq", ".total_count"],
    ]);
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN"]);
    expect(r.code).toBe(0);
    // ...and it is an absence claim with no control line under it.
    expect(r.output).toMatch(/absence claim.*no positive control/i);
  });

  it("a gh 404 is an answer, not COULD NOT RUN", async () => {
    const { exec } = fakeExec({ code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" });
    const path = writeBrief(scratch, [
      "- The file is there — `gh api repos/o/r/contents/x` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["FAIL"]);
  });
});

describe("check-brief: the allowlist (mutation 1)", () => {
  it.each([
    "gh api -X POST repos/o/r/issues",
    "gh api repos/o/r/issues -X POST",
    "gh api repos/o/r/issues --method GET",
    "gh api repos/o/r/issues --method=POST",
    "gh api repos/o/r/issues -f title=x",
    "gh api repos/o/r/issues -F title=x",
    "gh api repos/o/r/issues --input body.json",
    "gh api repos/o/r/issues --jq",
    "gh pr merge 12",
    "git push origin main",
    "git -C /tmp log",
    "git diff --output=/tmp/x",
    "sed -i s/a/b/ file",
    "sed -n 1w/tmp/x file",
    "rg --pre ./evil pattern",
    "tail -f log.txt",
    "rm -rf /tmp/x",
    "curl https://example.com",
    "node -e 1",
    "env-set lower-case-is-not-a-name",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd).ok).toBe(false);
  });

  it.each([
    "gh api repos/o/r/pulls/12",
    "gh api repos/o/r/pulls/12 --jq .state",
    "git log --oneline -3",
    "git grep -F 'impetus should come from a person'",
    "grep -c check-brief src/cli/bin.ts",
    "rg -n foo src",
    "ls src/cli/commands",
    "sed -n 86,93p src/x.ts",
    "test -f src/cli/commands/check-brief.ts",
    "env-set MANTIS_PRISMIC",
    "node --version",
  ])("allows %s", (cmd) => {
    expect(classifyCommand(cmd).ok).toBe(true);
  });

  it("a refused command is NOT RUN and never reaches exec", async () => {
    const path = writeBrief(scratch, [
      "- Nothing is written — `gh api -X POST repos/o/r/issues` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["NOT RUN"]);
    expect(r.code).toBe(0);
  });

  it("agrees with land-prs.mjs's isReadOnlyApiCall on every flag tail", () => {
    const tails: string[][] = [
      [],
      ["--jq", ".x"],
      ["--jq", ".x", "--jq", ".y"],
      ["--jq"],
      ["-X", "GET"],
      ["--method", "GET"],
      ["-f", "a=b"],
      ["-F", "a=b"],
      ["--input", "f"],
      ["--paginate"],
      ["--jq", ".x", "-f", "a=b"],
    ];
    for (const t of tails) expect(isReadOnlyApiCall(t)).toBe(landPrsIsReadOnlyApiCall(t));
  });
});

describe("check-brief: no shell (mutation 2)", () => {
  it("shell metacharacters outside quotes are refused, not interpreted", () => {
    for (const cmd of [
      "ls src | grep x",
      "ls src; rm x",
      "ls src && ls",
      "cat $HOME/x",
      "cat `whoami`",
      "ls > out",
      "ls src/*.ts",
      "cat ~/x",
    ]) {
      expect(classifyCommand(cmd).ok, cmd).toBe(false);
    }
  });

  it("quoted text reaches the program literally", async () => {
    const dir = join(scratch, "noshell");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "a literal $HOME; touch pwned\n");
    const path = writeBrief(dir, [
      "- The note is literal — `grep -c '$HOME; touch pwned' notes.txt` → exit 0, prints \"1\"",
    ]);
    const r = await runCheckBrief(path, { cwd: dir }, { env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["PASS"]);
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("tokenize keeps quoted spaces and unescapes double quotes", () => {
    expect(tokenize(`git grep -F "a \\"b\\" c" 'd e'`)).toEqual({
      ok: true,
      argv: ["git", "grep", "-F", 'a "b" c', "d e"],
    });
    expect(tokenize(`grep "x`).ok).toBe(false);
    expect(tokenize(`grep "$HOME"`).ok).toBe(false);
  });
});

describe("check-brief: env-set never prints the value (mutation 3)", () => {
  it("prints set or unset", () => {
    expect(envSet("A_KEY", { A_KEY: "s3cr3t-value" })).toEqual({ code: 0, stdout: "set" });
    expect(envSet("A_KEY", {})).toEqual({ code: 1, stdout: "unset" });
    expect(envSet("A_KEY", { A_KEY: "  " })).toEqual({ code: 1, stdout: "unset" });
  });

  it("the report never carries the value, pass or fail", async () => {
    const path = writeBrief(scratch, [
      "- The key is set — `env-set A_KEY` → exit 0",
      "- The key is unset — `env-set A_KEY` → exit 1",
    ]);
    const r = await runCheckBrief(
      path,
      { cwd: scratch },
      { exec: noExec, env: { A_KEY: "s3cr3t-value" } },
    );
    expect(r.results.map((x) => x.status)).toEqual(["PASS", "FAIL"]);
    expect(r.output).not.toContain("s3cr3t-value");
  });
});

describe("check-brief: no command output in the report (mutation 4)", () => {
  it.each([
    ["a failed command", { code: 1, stdout: "STDOUT-SENTINEL", stderr: "STDERR-SENTINEL" }, "FAIL"],
    [
      "a passing command",
      { code: 0, stdout: "STDOUT-SENTINEL", stderr: "STDERR-SENTINEL" },
      "PASS",
    ],
    [
      "a refused command",
      { code: 1, stdout: "STDOUT-SENTINEL", stderr: "STDERR-SENTINEL (HTTP 403)" },
      "COULD NOT RUN",
    ],
    [
      "a missing binary",
      { code: null, stdout: "STDOUT-SENTINEL", stderr: "STDERR-SENTINEL", error: "ENOENT" },
      "COULD NOT RUN",
    ],
  ] as const)("%s", async (_name, result, status) => {
    const { exec } = fakeExec(result as ExecResult);
    const path = writeBrief(scratch, ["- It runs — `gh api repos/o/r` → exit 0"]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual([status]);
    expect(r.output).not.toMatch(/SENTINEL/);
  });

  it("a wrong printed text fails without echoing what was printed", async () => {
    const { exec } = fakeExec({ code: 0, stdout: "STDOUT-SENTINEL", stderr: "" });
    const path = writeBrief(scratch, ['- It prints — `gh api repos/o/r` → exit 0, prints "open"']);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["FAIL"]);
    expect(r.output).not.toMatch(/SENTINEL/);
  });
});

describe("check-brief: warnings (mutation 5)", () => {
  it("an absence claim with no positive control is warned on", async () => {
    const path = writeBrief(scratch, ["- The flag is missing — `grep -c flag f.txt` → exit 1"]);
    const r = await runCheckBrief(
      path,
      { cwd: scratch },
      { exec: fakeExec({ code: 1, stdout: "0", stderr: "" }).exec, env: {} },
    );
    expect(r.warnings.join("\n")).toMatch(/absence claim.*no positive control/i);
  });

  it("an absence claim followed by a Control line is not warned on", async () => {
    const path = writeBrief(scratch, [
      "- The flag is missing — `grep -c flag f.txt` → exit 1",
      "- Control: a word that is there — `grep -c other f.txt` → exit 0",
    ]);
    const r = await runCheckBrief(
      path,
      { cwd: scratch },
      { exec: fakeExec({ code: 1, stdout: "0", stderr: "" }).exec, env: {} },
    );
    expect(r.warnings.join("\n")).not.toMatch(/no positive control/i);
  });

  it("an absence phrase in free text that no line covers is warned on", () => {
    const p = parseBrief(
      "**Item.** x\nThe secret `WILLIAMSON_HOMES_PRISMIC` is unset.\n\n**Verify first.**\n\n- Other — `ls` → exit 0\n",
    );
    expect(p.warnings.join("\n")).toMatch(/absence.*not covered/i);
  });

  it("identifier-shaped tokens no line covers are warned on, covered ones are not", () => {
    const p = parseBrief(
      [
        "**Item.** P1-1 · #1012",
        "Use `MANTIS_PRISMIC` and `FIGMA_PAT` on api.example.com with toolbar 4.1.10.",
        "",
        "**Verify first.**",
        "",
        "- The key — `env-set FIGMA_PAT` → exit 0",
        "",
        "**Start here.**",
      ].join("\n"),
    );
    const w = p.warnings.join("\n");
    for (const t of ["MANTIS_PRISMIC", "#1012", "api.example.com", "4.1.10"])
      expect(w).toContain(t);
    expect(w).not.toContain("FIGMA_PAT");
  });

  it("an [I] line naming an identifier is warned on", () => {
    const p = parseBrief("**Verify first.**\n\n- The token is `MANTIS_PRISMIC` [I]\n");
    expect(p.lines[0]?.kind).toBe("inferred");
    expect(p.warnings.join("\n")).toMatch(/\[I\].*MANTIS_PRISMIC/);
  });
});

describe("check-brief: parsing", () => {
  it("joins a line prettier wrapped, and reads exit and prints", () => {
    const p = parseBrief(
      '**Verify first.**\n\n- A claim that wraps —\n  `git log -1` → exit 0, prints "x \\"y\\""\n- Laptop only — `gh api repos/o/r/actions/secrets` → exit 0 [laptop]\n',
    );
    expect(p.lines).toEqual([
      {
        kind: "command",
        n: 1,
        claim: "A claim that wraps",
        command: "git log -1",
        exit: 0,
        prints: 'x "y"',
        laptop: false,
      },
      {
        kind: "command",
        n: 2,
        claim: "Laptop only",
        command: "gh api repos/o/r/actions/secrets",
        exit: 0,
        prints: undefined,
        laptop: true,
      },
    ]);
  });

  it("a [laptop] line is NOT RUN and never reaches exec", async () => {
    const path = writeBrief(scratch, [
      "- No secrets — `gh api repos/o/r/actions/secrets` → exit 0 [laptop]",
      "- Control: the repo answers — `gh api repos/o/r` → exit 0 [laptop]",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["NOT RUN", "NOT RUN"]);
  });

  it("a missing brief is a usage error", async () => {
    const r = await runCheckBrief(join(scratch, "nope.md"), { cwd: scratch }, { exec: noExec });
    expect(r.code).toBe(2);
  });
});

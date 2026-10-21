import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  childEnv,
  classifyCommand,
  containsToken,
  execResultFrom,
  refusedBy,
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
    "rg -F 'impetus should come from a person'",
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

// ── Review round 1 (2026-10-21): each case below reproduced a defect first. ──

describe("check-brief round 1: allowlist holes", () => {
  it.each([
    // GNU sed reads options after the script: -i rewrote the file, e ran a program.
    "sed -n 1p -i f.txt",
    "sed -n 1p -e 1etouch f.txt",
    "sed -n 1p",
    // --upload-pack names the program ls-remote runs; ls-remote is gone.
    "git ls-remote --upload-pack=./mk.sh .",
    "git ls-remote origin",
    // git and GNU tools take unambiguous prefixes and short bundles.
    "git grep --open=true x",
    "git grep -iO x",
    "git log --outp=/tmp/x -1",
    "git diff --ext",
    "git show --textconv HEAD",
    "tail --fol x",
    "tail -nf x",
    "rg -iz x",
    "rg --pre-g x y",
    "wc --files0-from=list",
    "npm run build",
    "npm install left-pad",
    // A secret, one guessed prefix at a time through `prints`.
    "cat /proc/self/environ",
    "cat /dev/stdin",
    "cat .env",
    "head -1 config/.env.production",
    "grep -c GH_TOKEN /root/.config/reddoor-maint/credentials.env",
    "git show HEAD:.env",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd).ok).toBe(false);
  });

  it("still allows a grep pattern that merely says secret", () => {
    expect(classifyCommand("rg -F 'secret scanning'").ok).toBe(true);
  });

  it("runs git with no optional locks and no config-driven programs", () => {
    const c = classifyCommand("git log --oneline -1");
    expect(c.ok && c.argv).toEqual([
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.pager=cat",
      "-c",
      "diff.external=",
      "-c",
      "log.showSignature=false",
      "log",
      "--oneline",
      "-1",
    ]);
  });

  it("the sed -i hole is closed end to end: the file is untouched", async () => {
    const dir = join(scratch, "sed-i");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f.txt"), "a\nb\nc\n");
    const path = writeBrief(dir, ["- First line — `sed -n 1p -i f.txt` → exit 0"]);
    const r = await runCheckBrief(path, { cwd: dir }, { env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["NOT RUN"]);
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("a\nb\nc\n");
  });

  it("a child gets a minimal env, and gh alone gets gh's token", () => {
    const env = { PATH: "/bin", HOME: "/h", GH_TOKEN: "t", MANTIS_PRISMIC: "secret-x" };
    expect(childEnv("git", env)).toEqual({ PATH: "/bin", HOME: "/h", GIT_NO_LAZY_FETCH: "1" });
    expect(childEnv("gh", env)).toEqual({ PATH: "/bin", HOME: "/h", GH_TOKEN: "t" });
  });

  it("the default exec passes that minimal env, so a child cannot see a secret", async () => {
    const dir = join(scratch, "env");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe.txt"), "x\n");
    // `node --version` is allowed; we check the env through a fake that records it.
    const seen: NodeJS.ProcessEnv[] = [];
    const path = writeBrief(dir, ["- Node runs — `node --version` → exit 0"]);
    await runCheckBrief(
      path,
      { cwd: dir },
      {
        env: { PATH: "/bin", MANTIS_PRISMIC: "secret-x" },
        exec: async (_f, _a, o) => {
          seen.push(o.env);
          return { code: 0, stdout: "v22", stderr: "" };
        },
      },
    );
    expect(seen).toEqual([{ PATH: "/bin" }]);
  });
});

describe("check-brief round 1: verdicts", () => {
  it("prints matches a whole token, so '0' is not found in '10'", () => {
    expect(containsToken("10\n", "0")).toBe(false);
    expect(containsToken("10 ten.txt\n", "0")).toBe(false);
    expect(containsToken("0\n", "0")).toBe(true);
    expect(containsToken("count: 0.\n", "0")).toBe(true);
    expect(containsToken("export function f(colour)", "export function f(")).toBe(true);
    expect(containsToken("MANTIS_PRISMIC_X", "MANTIS_PRISMIC")).toBe(false);
  });

  it("a false count fails end to end", async () => {
    const { exec } = fakeExec({ code: 0, stdout: "10\n", stderr: "" });
    const path = writeBrief(scratch, [
      '- No secrets yet — `gh api repos/o/r --jq .total_count` → exit 0, prints "0"',
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["FAIL"]);
  });

  it.each([
    "npm error code ECONNREFUSED",
    "npm error code ENOTFOUND",
    "npm error code EAI_AGAIN",
    "npm error code E403",
    "npm error 403 Forbidden - GET https://registry.npmjs.org/x",
    "gh: Access denied (HTTP 403)",
  ])("treats %s as a refusal", (stderr) => {
    expect(refusedBy(stderr)).not.toBeNull();
  });

  it("an unreachable registry cannot pass an absence claim", async () => {
    const { exec } = fakeExec({ code: 1, stdout: "", stderr: "npm error code ECONNREFUSED" });
    const path = writeBrief(scratch, [
      "- react was never published — `npm view react version` → exit 1",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN"]);
  });

  it("an absence PASS whose control did not pass is COULD NOT RUN", async () => {
    const path = writeBrief(scratch, [
      "- The key is missing — `env-set A_KEY` → exit 1",
      "- Control: a key that is there — `env-set B_KEY` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN", "FAIL"]);
    const ok = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: { B_KEY: "v" } });
    expect(ok.results.map((x) => x.status)).toEqual(["PASS", "PASS"]);
  });

  it("an absence claim followed by an unrelated line is warned on (surviving mutation K)", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- The flag is missing — `ls` → exit 1\n- Something else — `ls` → exit 0\n",
    );
    expect(p.warnings.join("\n")).toMatch(/line 1 is an absence claim with no positive control/);
  });
});

describe("check-brief round 1: lines are never dropped silently", () => {
  it("reads a numbered list", () => {
    const p = parseBrief(
      "**Verify first.**\n\n1. one lacks beta — `grep beta one.txt` → exit 1\n2. one has alpha — `grep alpha one.txt` → exit 0\n3. beta is gone [I]\n",
    );
    expect(p.lines.map((l) => l.kind)).toEqual(["command", "command", "inferred"]);
  });

  it("a fenced # comment does not end the section, and the fence is warned on", () => {
    const p = parseBrief(
      "**Verify first.**\n\n```sh\n# a comment\nls\n```\n\n- zeta — `grep zeta one.txt` → exit 0\n\n**Start here.**\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["zeta"]);
    expect(p.warnings.join("\n")).toMatch(/code block in Verify first is not read/);
  });

  it("reads every Verify-first section", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- a — `ls` → exit 0\n\n**Start here.**\n\n- x\n\n**Verify first.**\n\n- b — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["a", "b"]);
    expect(p.warnings.join("\n")).toMatch(/2 Verify-first sections/);
  });

  it("keeps the last claim of a brief with no final newline (surviving mutation G)", () => {
    const p = parseBrief("**Verify first.**\n\n- a — `ls` → exit 0\n- b — `ls` → exit 0");
    expect(p.lines.map((l) => l.claim)).toEqual(["a", "b"]);
  });

  it("a claim holding its own dash and code span still parses", () => {
    const p = parseBrief(
      '**Verify first.**\n\n- the token — `X` — is set — `cat one.txt` → exit 0, prints "alpha"\n',
    );
    expect(p.lines[0]).toMatchObject({
      kind: "command",
      claim: "the token — `X` — is set",
      command: "cat one.txt",
    });
  });

  it("a command tagged [I] is warned on", () => {
    const p = parseBrief("**Verify first.**\n\n- one has alpha — `cat one.txt` → exit 0 [I]\n");
    expect(p.lines[0]?.kind).toBe("inferred");
    expect(p.warnings.join("\n")).toMatch(/line 1 has a command but is tagged \[I\]/);
  });

  it("a leading [laptop] tag is honoured", async () => {
    const path = writeBrief(scratch, [
      "- [laptop] secrets — `gh api repos/o/r/actions/secrets` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["NOT RUN"]);
  });

  it("coverage is by whole token: MANTIS_PRISMIC_X does not cover MANTIS_PRISMIC", () => {
    const p = parseBrief(
      "**Item.** Use `MANTIS_PRISMIC`.\n\n**Verify first.**\n\n- Key — `env-set MANTIS_PRISMIC_X` → exit 0\n",
    );
    expect(p.warnings.join("\n")).toMatch(/env var named outside Verify first.*MANTIS_PRISMIC\b/);
  });

  it("an [I] line naming a two-part version is warned on", () => {
    const p = parseBrief("**Verify first.**\n\n- lightningcss 1.33 folds it [I]\n");
    expect(p.warnings.join("\n")).toMatch(/\[I\].*1\.33/);
  });
});

describe("check-brief round 1: paths and wiring", () => {
  it("a relative brief path resolves against the process cwd, not --cwd (surviving mutation F)", async () => {
    const r = await runCheckBrief(
      "mantis.md",
      { cwd: scratch },
      { exec: noExec, env: {}, processCwd: () => fixtures },
    );
    expect(r.code).toBe(1);
    expect(r.results).toHaveLength(2);
  });

  it("maps execFile's error to a result", () => {
    expect(execResultFrom(null, "o", "e")).toEqual({ code: 0, stdout: "o", stderr: "e" });
    expect(execResultFrom({ code: 3 }, "", "")).toEqual({ code: 3, stdout: "", stderr: "" });
    expect(execResultFrom({ code: "ENOENT" }, "", "").error).toBe("ENOENT");
    expect(execResultFrom({ killed: true, code: null }, "", "").error).toBe("TIMEOUT");
    expect(execResultFrom({ code: "EPERM" }, "", "").error).toBe("OTHER");
  });

  it("the built CLI passes --cwd through to the commands (bin.ts wiring)", () => {
    const binPath = resolve(here, "../../dist/cli/bin.js");
    if (!existsSync(binPath)) throw new Error("dist/cli/bin.js missing — run `pnpm build` first.");
    const tree = join(scratch, "cli-cwd");
    mkdirSync(tree, { recursive: true });
    writeFileSync(join(tree, "marker.txt"), "here\n");
    const brief = writeBrief(scratch, ["- The marker is there — `test -f marker.txt` → exit 0"]);
    const out = execFileSync(process.execPath, [binPath, "check-brief", brief, "--cwd", tree], {
      encoding: "utf8",
    });
    expect(out).toMatch(/\| 1 \| PASS \|/);
  });
});

// ── Review round 2 (2026-10-21): each case below reproduced a defect first. ──

describe("check-brief round 2: flag allowlists and confinement to --cwd", () => {
  it.each([
    // rg runs --hostname-bin to fill {host}.
    "rg --hyperlink-format=file://{host}{path} --hostname-bin=./x.sh a",
    // Outside --cwd, however it is spelled.
    "grep -q gho_ /root/.config/gh/hosts.yml",
    "cat /root/.ssh/config",
    "cat ../../proc/self/environ",
    "cat /./proc/1/environ",
    // Options outside each tool's grammar.
    "head -c 1 notes.txt",
    "grep -R TOKEN .",
    "grep -rq PRISMIC_TOKEN=ab .",
    "rg -uuu TOKEN",
    "rg -uu -c TOKEN= .",
    "rg --hidden TOKEN",
    "ls -R",
    "wc --files0-from=list",
    // git: programs from config, and reads outside the repo.
    "git cat-file --filters --path=a HEAD:b",
    "git log --show-signature",
    "git grep --no-index foo /root",
    "git diff --no-index a b",
    "git blame --contents=x f",
    "git grep -f /etc/passwd x",
    // npm and gh aimed at another host.
    "npm view x --registry=http://127.0.0.1:1",
    "npm view x --userconfig=a",
    "npm view",
    "gh api https://evil.example/x",
    "gh api //evil.example/x",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd, scratch).ok).toBe(false);
  });

  it.each([
    "grep -c x src/util/credentials.ts",
    "ls src/lib/server/secrets.ts",
    "grep -c MANTIS .env.example",
    "head -n 5 README.md",
    "head -5 README.md",
    "tail -n +3 README.md",
    "rg -c foo",
    "grep -cF foo -- -weird-name.txt",
    "npm view react version",
  ])("allows %s (a real brief would cite it)", (cmd) => {
    expect(classifyCommand(cmd, scratch).ok).toBe(true);
  });

  it("a symlink inside --cwd that points outside is refused", () => {
    const dir = join(scratch, "symlink");
    mkdirSync(dir, { recursive: true });
    const target = join(scratch, "outside.txt");
    writeFileSync(target, "x\n");
    try {
      symlinkSync(target, join(dir, "inside.txt"));
    } catch {
      // already there from an earlier run
    }
    expect(classifyCommand("cat inside.txt", dir).ok).toBe(false);
    expect(classifyCommand("cat outside.txt", scratch).ok).toBe(true);
  });
});

describe("check-brief round 2: verdicts", () => {
  it("a control chain resolves from the end: no absence keeps PASS over a failed control", async () => {
    const path = writeBrief(scratch, [
      "- FOO is absent — `env-set FOO` → exit 1",
      "- Control: BAR is not missing — `env-set BAR` → exit 0",
      "- Control: baz — `env-set BAZ` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: { BAR: "x" } });
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN", "COULD NOT RUN", "FAIL"]);
  });

  it("a [laptop] control downgrades its absence line too (surviving mutation M3)", async () => {
    const path = writeBrief(scratch, [
      "- FOO is absent — `env-set FOO` → exit 1",
      "- Control: the repo answers — `gh api repos/o/r` → exit 0 [laptop]",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN", "NOT RUN"]);
  });

  it("a local tool's stderr naming E403-notes.md is a FAIL, not a refusal", async () => {
    const path = writeBrief(scratch, ["- The notes are there — `ls E403-notes.md` → exit 0"]);
    const r = await runCheckBrief(path, { cwd: scratch }, { env: { PATH: process.env.PATH } });
    expect(r.results.map((x) => x.status)).toEqual(["FAIL"]);
    expect(r.code).toBe(1);
  });

  it("a passing gh run stays PASS whatever its stderr says (surviving mutation M4)", async () => {
    const { exec } = fakeExec({ code: 0, stdout: "ok", stderr: "warning: HTTP 403 once" });
    const path = writeBrief(scratch, ["- It answers — `gh api repos/o/r` → exit 0"]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["PASS"]);
  });

  it("'1.0' is not a token of 'v22.1.0', but '0' still ends a sentence", () => {
    expect(containsToken("v22.1.0\n", "1.0")).toBe(false);
    expect(containsToken("v22.1.0\n", "v22.1.0")).toBe(true);
    expect(containsToken("count: 0.\n", "0")).toBe(true);
  });

  it("'Positive control:' pairs like 'Control:' (surviving mutation M10)", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- The flag is missing — `ls` → exit 1\n- Positive control: a word — `ls` → exit 0\n",
    );
    expect(p.warnings.join("\n")).not.toMatch(/no positive control/);
  });
});

describe("check-brief round 2: sections and fences", () => {
  it("a template quoted in a fence is not a live section, and the prose after it is still checked", () => {
    const p = parseBrief(
      [
        "The template:",
        "",
        "```md",
        "**Verify first.**",
        "- x — `ls nope` → exit 0",
        "```",
        "",
        "**Start here.** FOO_BAR is missing from #12.",
      ].join("\n"),
    );
    expect(p.lines).toEqual([]);
    const w = p.warnings.join("\n");
    expect(w).toContain("FOO_BAR");
    expect(w).toContain("#12");
    expect(w).toMatch(/absence phrase not covered/);
  });

  it("an unclosed fence says that nothing after it was read", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- a — `ls` → exit 0\n\n```sh\nls\n\n**Start here.** MANTIS_PRISMIC is absent.\n- b — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["a"]);
    expect(p.warnings.join("\n")).toMatch(/code fence opened on line 5 never closes/);
  });

  it("'**Start here:**' ends the section like '**Start here.**'", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- a — `ls` → exit 0\n\n**Start here:**\n\nRun `x` — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["a"]);
  });

  it("a heading ends the section (surviving mutation M6)", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- a — `ls` → exit 0\n\n## Notes\n\nb — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["a"]);
  });

  it("reads a '1)' list (surviving mutation M5)", () => {
    const p = parseBrief("**Verify first.**\n\n1) a — `ls` → exit 0\n2) b — `ls` → exit 0\n");
    expect(p.lines.map((l) => l.claim)).toEqual(["a", "b"]);
  });

  it("a second lead-in line never joins the item before it (surviving mutation M7)", () => {
    const p = parseBrief(
      "**Verify first.**\n- a — `ls` → exit 0\n**Verify first.** b — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["a", "b"]);
  });
});

// ── Review round 3 (2026-10-21): each case below reproduced a defect first. ──

describe("check-brief round 3: git, jq, npm and secret names", () => {
  it.each([
    // git diff switches to --no-index by itself for a path outside the tree.
    "git diff /dev/null ../out/outside.txt",
    "git diff --stat /dev/null /etc/hostname",
    "git log -1 -- ../out",
    "git diff ../out:x a",
    // An ignored .env, with no secret name in the command.
    "git grep -q --untracked --no-exclude-standard TOKEN=abc1",
    "git grep --untracked TOKEN",
    // Options that read a file.
    "git ls-files -X /etc/hostname -o -i",
    "git ls-files -oiX x",
    "git blame --ignore-revs-file ../out/empty a.txt",
    "git blame --ignore-revs-file=../out/empty a.txt",
    "git blame -S revs a.txt",
    // gh's jq reads its environment.
    "gh api rate_limit --jq 'env | has(\"PATH\")'",
    "gh api rate_limit --jq '$ENV.GH_TOKEN | startswith(\"ghp_a\")'",
    "gh api rate_limit --jq 'input'",
    // npm specs that leave the registry.
    "npm view file:../x",
    "npm view git+ssh://git@host/x.git",
    "npm view github:u/r",
    "npm view https://host/x.tgz",
    // More secret names, and anything under .git.
    "cat credentials.env",
    "cat .envrc",
    "cat prod.env",
    "cat .dev.vars",
    "cat .pgpass",
    "cat service-account-prod.json",
    "grep -q email .git/config",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd, scratch).ok).toBe(false);
  });

  it.each([
    "git log --oneline -3 origin/main",
    "git rev-parse --abbrev-ref HEAD",
    "git merge-base --is-ancestor main HEAD",
    "git log --format=%h:%s -1",
    "git ls-files --error-unmatch src/cli/bin.ts",
    "git for-each-ref --format=%h refs/heads",
    "git status --porcelain",
    "git describe --tags --always",
    "rg -F 'impetus should come from a person'",
    "gh api repos/o/r/pulls/12 --jq '.state'",
    "gh api repos/o/r/pulls --jq '.[] | .number'",
    "npm view react version",
    "npm view @sveltejs/kit@^2 version",
    "grep -c x src/util/credentials.ts",
  ])("allows %s", (cmd) => {
    expect(classifyCommand(cmd, scratch).ok).toBe(true);
  });

  it("rg runs with the secret names excluded, so recursion never opens them", () => {
    const c = classifyCommand("rg -q KEY=xyz .", scratch);
    expect(c.ok && c.argv.join(" ")).toContain("--iglob !*.key");
    expect(c.ok && c.argv.slice(-2)).toEqual(["KEY=xyz", "."]);
  });

  it("rg's exclusions hold for real: an unignored deploy.key is not searched", async () => {
    const dir = join(scratch, "rg-key");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "deploy.key"), "KEY=xyz\n");
    writeFileSync(join(dir, "notes.txt"), "nothing\n");
    // The brief lives outside the searched tree: it holds the text too.
    const briefDir = join(scratch, "rg-key-brief");
    mkdirSync(briefDir, { recursive: true });
    const path = writeBrief(briefDir, ["- The key is findable — `rg -q KEY=xyz .` → exit 0"]);
    const r = await runCheckBrief(path, { cwd: dir }, { env: { PATH: process.env.PATH } });
    // rg exits 1 (no match) because deploy.key is excluded; 0 would be a leak.
    expect(r.results.map((x) => x.status)).toEqual([
      // COULD NOT RUN only where rg is not installed.
      expect.stringMatching(/^(FAIL|COULD NOT RUN)$/),
    ]);
  });

  it("a missing path under a symlink that points outside still resolves outside", () => {
    const dir = join(scratch, "symlink-missing");
    mkdirSync(dir, { recursive: true });
    try {
      symlinkSync(scratch, join(dir, "link"));
    } catch {
      // already there from an earlier run
    }
    expect(classifyCommand("cat link/not-there.txt", dir).ok).toBe(false);
  });

  it("git runs with lazy fetching off", () => {
    expect(childEnv("git", {}).GIT_NO_LAZY_FETCH).toBe("1");
  });
});

describe("check-brief round 3: parsing", () => {
  it("a bold word inside the section does not end it", () => {
    const p = parseBrief(
      "**Verify first.**\n- A — `ls` → exit 0\n**Note** — `ls` → exit 0\n- B is here — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["A", "**Note**", "B is here"]);
  });

  it("claims stranded after a section end are warned on", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- A — `ls` → exit 0\n\n**On the laptop:**\n\n- The deploy hook is gone — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["A"]);
    expect(p.warnings.join("\n")).toMatch(/1 line\(s\) outside Verify first look like claims/);
  });

  it("a three-backtick fence inside a four-backtick fence stays quoted", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- A — `ls` → exit 0\n\n````md\n```sh\n- inner — `ls` → exit 0\n```\n````\n\n- B — `ls` → exit 0\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["A", "B"]);
  });

  it("a ~~~ fence is closed only by ~~~ (surviving mutation M2)", () => {
    const p = parseBrief("Intro\n\n~~~\n```js\n~~~\n\n**Verify first.**\n\n- A — `ls` → exit 0\n");
    expect(p.lines.map((l) => l.claim)).toEqual(["A"]);
    expect(p.warnings.join("\n")).not.toMatch(/never closes/);
  });

  it("a claim directly followed by a fence does not swallow the text after it (surviving mutation M6)", () => {
    const p = parseBrief("**Verify first.**\n- A — `ls` → exit 0\n```\nquoted\n```\nstray words\n");
    expect(p.lines.map((l) => l.claim)).toEqual(["A"]);
  });

  it("a version printed with a leading v matches one written without it", () => {
    expect(containsToken("v22.1.0\n", "22.1.0")).toBe(true);
    expect(containsToken("rev22.1.0\n", "22.1.0")).toBe(false);
    expect(containsToken("v22.1.0\n", "1.0")).toBe(false);
  });
});

// ── Review round 4 (2026-10-21): each case below reproduced a defect first. ──

describe("check-brief round 4: git never opens a secret-shaped path", () => {
  // A tracked template filled in locally: uncommitted content, fake value.
  function repoWithFilledTemplate(name: string): string {
    const dir = join(scratch, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const git = (...a: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir });
    git("init", "-q");
    writeFileSync(join(dir, ".dev.vars"), "PLACEHOLDER=x\n");
    writeFileSync(join(dir, "notes.txt"), "visible words\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(dir, ".dev.vars"), "PLACEHOLDER=fakevalue123\n");
    return dir;
  }
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };

  it("git's content readers are refused, so a filled-in .dev.vars is never read", async () => {
    const dir = repoWithFilledTemplate("git-secret-grep");
    const briefDir = join(scratch, "git-secret-grep-brief");
    mkdirSync(briefDir, { recursive: true });
    const path = writeBrief(briefDir, [
      "- The guess matches — `git grep -q fakevalue1` → exit 0",
      "- The change matches — `git diff -Gfakevalue1 --quiet` → exit 1",
      "- Control: visible text matches — `rg -q visible notes.txt` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: dir }, { env });
    expect(r.results.map((x) => x.status)).toEqual([
      "NOT RUN",
      "NOT RUN",
      expect.stringMatching(/^(PASS|COULD NOT RUN)$/),
    ]);
    expect(r.results[0]?.why).toMatch(/not an allowed metadata subcommand/);
  });

  it.each([
    "cat .yarnrc.yml",
    "cat .pypirc",
    "cat cert.p12",
    "cat prod.tfvars",
    "cat .docker/config.json",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd, scratch).ok).toBe(false);
  });
});

describe("check-brief round 4: parsing", () => {
  it("a wrapped claim whose first line shows an example is not split (false PASS)", async () => {
    const path = writeBrief(scratch, [
      "- FOO_KEY is unset in the cloud, although `env-set FOO_KEY` → exit 0 held on",
      "  the laptop before #12 — `env-set FOO_KEY` → exit 1",
      "- Control: BAR_KEY is set — `env-set BAR_KEY` → exit 0",
    ]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.results.map((x) => x.status)).toEqual(["COULD NOT RUN", "FAIL"]);
  });

  it("~ inside a word is plain text; at the start of a word it needs a shell", () => {
    expect(classifyCommand("git log -1 HEAD~1", process.cwd()).ok).toBe(true);
    expect(classifyCommand("git rev-parse --verify HEAD~2", process.cwd()).ok).toBe(true);
    expect(classifyCommand("cat ~/x", process.cwd()).ok).toBe(false);
  });

  it("a fence closes only with the same character (~~~ is not closed by ```)", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- A — `ls` → exit 0\n\n~~~\n```\n- B — `ls docs` → exit 0\n~~~\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["A"]);
  });

  it("a fence line with text after it does not close (```bash inside ```)", () => {
    const p = parseBrief(
      "**Verify first.**\n\n- A — `ls` → exit 0\n\n```\n```bash\n- B — `ls docs` → exit 0\n```\n",
    );
    expect(p.lines.map((l) => l.claim)).toEqual(["A"]);
  });

  it("a fenced example outside the section is not a stray claim", () => {
    const p = parseBrief(
      "Example:\n\n```\n- X — `git log -1` → exit 0\n```\n\n**Verify first.**\n\n- A — `ls` → exit 0\n",
    );
    expect(p.warnings.join("\n")).not.toMatch(/outside Verify first look like claims/);
  });
});

// ── Review round 5 (2026-10-21): each case below reproduced a defect first. ──
// Five dirty rounds: these fixes go to the operator, not to a sixth round.

describe("check-brief round 5: uncommitted content stays unreadable", () => {
  function repo(name: string): { dir: string; git: (...a: string[]) => Buffer } {
    const dir = join(scratch, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const git = (...a: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: dir });
    git("init", "-q");
    return { dir, git };
  }
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  async function verdicts(dir: string, lines: string[]): Promise<string[]> {
    const briefDir = `${dir}-brief`;
    mkdirSync(briefDir, { recursive: true });
    const r = await runCheckBrief(writeBrief(briefDir, lines), { cwd: dir }, { env });
    return r.results.map((x) => x.status);
  }

  it.each([
    "git log --all -m -GAPI_KEY=FAKES --format=tformat:HIT",
    "git show stash@{0}^2",
    "git log -p -m refs/stash",
    "git log --reflog -p",
    "git log -g -p",
    "git log --glob=refs/* -p",
    "git cat-file --batch --batch-all-objects",
    "git cat-file --batch-check --batch-all-objects",
    "git ls-files -s",
    "git ls-files --stage",
  ])("refuses %s (stash, reflog, every object, staged blob ids)", (cmd) => {
    expect(classifyCommand(cmd, process.cwd()).ok).toBe(false);
  });

  it("an upper-case secret name is excluded from rg; git cannot read it at all", async () => {
    const { dir, git } = repo("r5-icase");
    writeFileSync(join(dir, "cert.PEM"), "X\n");
    writeFileSync(join(dir, "notes.txt"), "visible\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(dir, "cert.PEM"), "FAKEUPPER999\n");
    expect(
      await verdicts(dir, [
        "- grep finds it — `git grep -q FAKEUPPER999` → exit 0",
        "- rg finds it — `rg -q FAKEUPPER999 .` → exit 0",
        "- Control: visible text — `rg -q visible .` → exit 0",
      ]),
    ).toEqual([
      "NOT RUN",
      expect.stringMatching(/^(FAIL|COULD NOT RUN)$/),
      expect.stringMatching(/^(PASS|COULD NOT RUN)$/),
    ]);
  });

  it("ordinary files whose names resemble secret names stay readable", async () => {
    const { dir, git } = repo("r5-ordinary");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/credentials.ts"), "export const loadCredentials = 1;\n");
    writeFileSync(join(dir, ".env.example"), "RESEND_API_KEY=\n");
    writeFileSync(join(dir, "id_token.ts"), "export const idToken = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(dir, "src/credentials.ts"), "export const loadCredentials = 2;\n");
    expect(
      await verdicts(dir, [
        "- credentials.ts is searchable — `grep -c loadCredentials src/credentials.ts` → exit 0",
        "- the template is searchable — `grep -q RESEND_API_KEY .env.example` → exit 0",
        "- id_token.ts is searchable — `rg -q idToken` → exit 0",
        '- credentials.ts is modified — `git ls-files -m src/credentials.ts` → exit 0, prints "src/credentials.ts"',
      ]),
    ).toEqual(["PASS", "PASS", expect.stringMatching(/^(PASS|COULD NOT RUN)$/), "PASS"]);
  });

  it("rg with no path searches the cwd, not the closed stdin", async () => {
    const dir = join(scratch, "r5-rg-nopath");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "hello\n");
    expect(await verdicts(dir, ["- hello is there — `rg -q hello` → exit 0"])).toEqual([
      // COULD NOT RUN only where rg is not installed.
      expect.stringMatching(/^(PASS|COULD NOT RUN)$/),
    ]);
    const c = classifyCommand("rg -q hello", dir);
    expect(c.ok && c.argv.at(-1)).toBe(".");
  });

  it("a git path operand is resolved against --cwd, not the process cwd", () => {
    const dir = join(scratch, "r5-cwd");
    mkdirSync(join(dir, "only-here"), { recursive: true });
    expect(classifyCommand("git ls-files only-here", dir).ok).toBe(true);
    expect(classifyCommand("git ls-files ../outside", dir).ok).toBe(false);
  });
});

// ── Narrowing (the operator's answer to the round-5 stop, 2026-10-21) ──

describe("check-brief: git answers metadata questions only", () => {
  it.each([
    "git grep -q foo",
    "git grep -F 'impetus should come from a person'",
    "git diff --quiet",
    "git diff main..HEAD -- src",
    "git show HEAD:src/cli/bin.ts",
    "git cat-file -p HEAD",
    "git blame src/cli/bin.ts",
    "git ls-tree HEAD",
    "git log -p -1",
    "git log -1 -GAPI_KEY",
    "git log -1 -SAPI_KEY",
    "git log --patch -1",
    "git log --stat -1",
    "git log --all -1",
    "git log --format=%h stash",
    "git status --untracked-files=all",
    "git ls-files -s",
    "git ls-files --others --ignored",
    "git describe --dirty=x",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd, process.cwd()).ok).toBe(false);
  });

  it("a quoted position is checked with rg -F on the working tree, for real", async () => {
    const dir = join(scratch, "quoted-position");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "produce a diff or raw output, not an inference\n");
    const briefDir = join(scratch, "quoted-position-brief");
    mkdirSync(briefDir, { recursive: true });
    const r = await runCheckBrief(
      writeBrief(briefDir, [
        "- The operator wants raw output — `rg -F -q 'produce a diff or raw output' CLAUDE.md` → exit 0",
      ]),
      { cwd: dir },
      { env: { PATH: process.env.PATH } },
    );
    expect(r.results.map((x) => x.status)).toEqual([
      expect.stringMatching(/^(PASS|COULD NOT RUN)$/),
    ]);
  });
});

// ── Review round 6 (2026-10-21, the extra round the operator allowed) ──

describe("check-brief round 6: no option consumes the next word", () => {
  it.each([
    // A bare --pretty is a flag to git; the next word became an option.
    "git log -1 --pretty --output=/tmp/x",
    "git log --pretty --all --pretty -p",
    "git log -1 --format %H",
    "git describe --abbrev 7",
    "git status --untracked-files no",
    // %G runs the signature program.
    "git log -1 --format=%G?",
    "git log -1 --pretty=format:%GS",
    // A stash ref as an option's value.
    "git for-each-ref --contains=stash",
    "git for-each-ref --points-at=refs/stash",
    // A path with a colon is still a path (surviving mutation M3).
    "git ls-files ../x:y",
  ])("refuses %s", (cmd) => {
    expect(classifyCommand(cmd, process.cwd()).ok).toBe(false);
  });

  it.each([
    "git rev-parse --short HEAD",
    "git rev-parse --short=8 HEAD",
    "git for-each-ref --count=1 refs/heads",
    "git describe --abbrev=7 --always",
    "git status --untracked-files=no",
    "git log --format=%H -1",
  ])("allows %s (surviving mutation M4 for the =N forms)", (cmd) => {
    expect(classifyCommand(cmd, process.cwd()).ok).toBe(true);
  });

  it("the --pretty smuggle writes nothing, end to end", async () => {
    const out = join(scratch, "r6-pwned.txt");
    rmSync(out, { force: true });
    const briefDir = join(scratch, "r6-brief");
    mkdirSync(briefDir, { recursive: true });
    const r = await runCheckBrief(
      writeBrief(briefDir, [`- It logs — \`git log -1 --pretty --output=${out}\` → exit 0`]),
      { cwd: process.cwd() },
      { env: { PATH: process.env.PATH, HOME: process.env.HOME } },
    );
    expect(r.results.map((x) => x.status)).toEqual(["NOT RUN"]);
    expect(existsSync(out)).toBe(false);
  });
});

describe("check-brief round 6: CodeQL", () => {
  it("a claim holding \\| keeps the report table intact", async () => {
    const path = writeBrief(scratch, ["- a\\|b — `env-set A_KEY` → exit 1"]);
    const r = await runCheckBrief(path, { cwd: scratch }, { exec: noExec, env: {} });
    expect(r.output).toContain("| 1 | PASS | a\\\\\\|b |");
  });

  it("comments nested to survive one pass are still stripped", () => {
    const p = parseBrief(
      "**Item.** <!<!---->-- HIDDEN_TOKEN -->\n\n**Verify first.**\n\n- a — `ls` → exit 0\n",
    );
    expect(p.warnings.join("\n")).not.toContain("HIDDEN_TOKEN");
  });
});

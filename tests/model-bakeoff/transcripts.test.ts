import { describe, it, expect } from "vitest";
import {
  forbiddenCommand,
  readAgentTranscript,
} from "../../scripts/model-bakeoff/lib/transcripts.mjs";
import {
  REFEREE,
  mergeAgents,
  nextRound,
  verifyRan,
  type Collected,
} from "../../scripts/model-bakeoff/bakeoff.mjs";

const user = (text: string) => JSON.stringify({ message: { role: "user", content: text } });
const assistant = (id: string, content: unknown[], effort = "low", model = "claude-haiku-5-5") =>
  JSON.stringify({
    effort,
    message: {
      id,
      model,
      role: "assistant",
      content,
      usage: { input_tokens: 1, output_tokens: 2 },
    },
  });
const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command } });
const output = (input: unknown, id = "so") => ({
  type: "tool_use",
  id,
  name: "StructuredOutput",
  input,
});

describe("readAgentTranscript", () => {
  const text = [
    user("do the census\n\n(BAKEOFF-ARM: haiku-low-1)"),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m1", [bash("wc -l /x/scripts/*")]),
    assistant("m2", [output({ scripts: [] })]),
  ].join("\n");

  it("reads the arm, what ran, and the structured output, counting each message once", () => {
    const t = readAgentTranscript(text);
    expect(t.marker).toEqual({ kind: "arm", id: "haiku-low-1" });
    expect(t.structured).toEqual({ scripts: [] });
    expect(t.models).toEqual(["claude-haiku-5-5"]);
    expect(t.efforts).toEqual(["low"]);
    expect(t.requests).toBe(2);
    expect(t.repeats).toBe(1);
    expect(t.forbidden).toEqual([]);
  });

  it("takes the last structured output the harness accepted, not one it rejected", () => {
    const rejected = JSON.stringify({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "late", is_error: true, content: "bad" }],
      },
    });
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant("m1", [output({ ok: 1 }, "early")]),
        assistant("m2", [output({ ok: 0 }, "late")]),
        rejected,
      ].join("\n"),
    );
    expect(t.structured).toEqual({ ok: 1 });
  });

  it("reads only the trailing marker, and refuses a prompt that quotes another", () => {
    expect(readAgentTranscript(user("task\n\n(BAKEOFF-REFEREE: r2-1)")).marker).toEqual({
      kind: "referee",
      id: "r2-1",
    });
    const quoting = readAgentTranscript(
      user('items: ["(BAKEOFF-ARM: gold)"]\n\n(BAKEOFF-REFEREE: r1-1)'),
    );
    expect(quoting.marker).toBeNull();
    expect(quoting.markerError).toMatch(/2 markers/);
    expect(readAgentTranscript(user("(BAKEOFF-ARM: a) and then more text")).marker).toBeNull();
  });

  it("records every file write and every MCP tool use", () => {
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant("m1", [
          { type: "tool_use", name: "Write", input: { file_path: "/w/a/x.py" } },
          { type: "tool_use", name: "Edit", input: { file_path: "/tmp/y.py" } },
          { type: "tool_use", name: "mcp__github__issue_write", input: {} },
        ]),
      ].join("\n"),
    );
    expect(t.writes).toEqual(["/w/a/x.py", "/tmp/y.py"]);
    expect(t.otherTools).toEqual(["mcp__github__issue_write"]);
  });
});

describe("forbiddenCommand", () => {
  it.each([
    "gh issue create -t x",
    "cd /x && git push origin main",
    "git -C /repo push origin x",
    "git -c user.name=x commit -m y",
    "git --no-pager push",
    "/usr/bin/gh api -X POST repos/x",
    '"gh" issue create',
    "echo done; gh pr list",
    "GH_TOKEN=x gh api user",
    "curl -s -X POST https://api.github.com/x",
    "curl --request POST https://x",
    "curl -d a=1 https://x",
    "curl --data @f https://x",
    "git rm a.txt",
    "cd x\ngh api repos/a/b",
    "bash -c 'gh api x'",
    'sh -c "git push"',
    "eval 'git commit -m x'",
    "ls | xargs gh pr list",
    "time gh api x",
    "command gh api x",
    "git --git-dir /x commit -m y",
    "curl --json {} https://x",
    "curl -d@f https://x",
    "for r in a b; do gh api repos/reddoorla/$r -X DELETE; done",
    "if true; then gh api x; fi",
    "while read r; do gh pr view $r; done < f",
    "{ gh api x; }",
    "! gh api x",
    'sh -c "for r in a; do gh api $r; done"',
    "timeout -k 1 5 gh api x",
    "timeout -s KILL 5 gh x",
    "nice -n 5 gh api x",
    "sudo -u root gh x",
    "nohup gh api x",
    "stdbuf -oL gh api x",
    "xargs -n 1 gh x",
    "xargs -I{} gh issue close {}",
    "curl -X 'POST' https://x",
    'curl -X"POST" https://x',
    "curl -sd x=1 https://x",
    'a="$(gh api x)"',
    'x="$(gh api "repos/$r")"',
    'echo "`gh api x`"',
    'echo "x $(git push) y"',
    'n="$(curl -sX POST url)"',
    "sh <<EOF\ngh api\nEOF",
    "bash -s <<'EOF'\ngit push\nEOF",
    "cat <<'EOF' | sh\ngh api x\nEOF",
    'bash -e -c "gh x"',
    'bash -euo pipefail -c "gh api x"',
    "sh -c -- 'gh'",
    'bash --norc -c "gh"',
    "sh -c gh",
    "curl -sSX PUT url",
    "curl -sX POST url",
    "curl -X post url",
    "git pull",
    "git branch -D x",
    "git worktree add ../x",
    "git init x",
    "git config user.name x",
    "exec -a name gh",
    "2>/dev/null gh api",
    ">f gh",
    "gh>out",
    "env --chdir /x gh",
    "sudo --user bob gh",
    "curl -G -X POST https://api.github.com/x",
    "curl -X POST -G u",
    "curl --get -XPUT u",
    "curl -G --request DELETE u",
    "curl -G -T f u",
    "curl -G --upload-file f u",
    "curl -sGX POST u",
    "env -i git push",
    "xargs -r git rm",
    "sudo -E git push",
  ])("flags %s", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(true);
  });

  it.each([
    "grep -c 'gh api' /x/scripts/land-prs.mjs",
    "grep -rn 'git push' scripts",
    "grep -l gh *.mjs",
    "grep -c ' gh ' f",
    "wc -l /x/scripts/*",
    "git log --oneline -3",
    "git branch -a",
    "curl -s https://example.com",
    "grep -n curl scripts/* | cut -d: -f1 | sort -u",
    "grep -rn curl . | awk -F: '{print $1}'",
    "grep -c curl f | sort -t: -k2 -n",
    "curl -s u | grep -F x",
    "curl -s u; cut -d, -f1 f",
    "cat > /w/c.py <<'EOF'\nfor f in files:\n    gh = 'gh api' in open(f).read()\n# curl -d is a write\n    git add -p\nEOF\npython3 /w/c.py",
    "git log -S add",
    "git log --grep commit",
    "command -v node",
    "ls -la /x",
    "find . -name '*.yml' -exec grep -l secrets {} +",
    'node -e "console.log(1)"',
    'printf \'%s %s\\n\' "$f" "$(head -c2 "$f")"',
    'echo "$f $(grep -c x "$f")"',
    "curl -sXGET url",
    "curl -H -d url",
    "curl -o -T url",
    "curl -G -d q=1 url",
    'curl -G --data-urlencode "q=x" url',
    "curl -sG -d q=1 u",
    "which python3 node gh jq",
    'test -x "$(command -v gh)"',
    "command -v gh",
    "find . -name '*.mjs' | xargs -r grep -l gh",
    "ls # list; gh is not used here",
    "# find every `gh api` call\ngrep -rn 'gh api' scripts",
    "# count the (gh api) calls\ngrep -c 'gh api' f",
    "curl -Gs --data-urlencode q=1 u",
    "git tag --list",
    'git tag -l "v*"',
    "git tag --sort=-creatordate | head",
    "git stash list",
    "git apply --stat p.diff",
    "git checkout --help",
    "git config --get user.name",
    "git worktree list",
    "git branch -a",
    "cat <<\\EOF\nhello\ngh api\nEOF",
    "cat <<'EOF' > /w/n.txt\ngh api\nEOF",
    "grep -rn \"bash -c 'gh api'\" scripts",
    "echo \"eval 'git push'\"",
  ])("lets the read %s through", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(false);
  });
});

describe("verifyRan", () => {
  const ran = readAgentTranscript(
    [user("(BAKEOFF-ARM: a)"), assistant("m", [output({})], "xhigh", "claude-opus-5-5")].join("\n"),
  );

  it("reports a model or an effort the transcripts contradict", () => {
    expect(verifyRan({ id: "a", model: "opus", effort: "xhigh" }, ran)).toEqual([]);
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, ran)).toEqual([
      "a: asked for claude-haiku-5-5, transcripts show claude-opus-5-5",
      "a: asked for effort low, transcripts show xhigh",
    ]);
  });

  it("reports a run with no accepted output, a write outside its own dir, and MCP use", () => {
    const t = readAgentTranscript(
      [
        user("(BAKEOFF-ARM: a)"),
        assistant(
          "m",
          [
            { type: "tool_use", name: "Write", input: { file_path: "/run/work/a/ok.py" } },
            { type: "tool_use", name: "Write", input: { file_path: "/run/work/ab/x.py" } },
            { type: "tool_use", name: "mcp__github__push_files", input: {} },
          ],
          "low",
        ),
      ].join("\n"),
    );
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, t, "/run/work/a")).toEqual([
      "a: no accepted structured output",
      "a: used tools outside the allowlist: mcp__github__push_files",
      "a: wrote outside /run/work/a: /run/work/ab/x.py",
    ]);
  });

  it("holds the referee to its own model and effort", () => {
    const ref = readAgentTranscript(
      [
        user("(BAKEOFF-REFEREE: r1-1)"),
        assistant("m", [output({ rulings: [] })], "xhigh", "claude-sonnet-5-5"),
      ].join("\n"),
    );
    expect(verifyRan(REFEREE, ref)).toEqual([
      "referee:r1-1: asked for claude-opus-5-5, transcripts show claude-sonnet-5-5",
      "referee:r1-1: asked for effort high, transcripts show xhigh",
    ]);
  });
});

describe("forbiddenCommand on #1419's remaining forms", () => {
  it.each([
    "git remote add up https://x",
    "git remote set-url origin https://x",
    "git remote remove up",
    "git config --unset x.y",
    "git config --unset-all x.y",
    "git config --add x.y z",
    "git config --remove-section x",
    "git config set user.name x",
    "git config -f .gitmodules submodule.foo.path x",
    "git notes add -m x",
    "git notes --ref r add -m x",
    "git submodule update --init",
    "git submodule foreach 'git pull'",
    "git branch --no-color newb",
    "git branch --track newb origin/x",
    "git tag -a v1 -m x",
    "git tag -d v1",
    "git clean -fd",
    "git rm -r a",
    "echo 'git push' | sh",
    'printf "gh api x\\n" | bash -s',
    "echo gh api x |& sh",
    "sh <<< 'git push'",
    "cat <<EOF\n$(gh api x)\nEOF",
    "cat > /w/n.txt <<EOF\nnote: `git push`\nEOF",
    "cat <<EOF\nit's $(gh api x)\nEOF",
    "find . -exec gh api {} \\;",
    "find . -name x -execdir git push \\;",
    "find . -ok gh x ';'",
    "find . -exec sh -c 'gh api $1' _ {} +",
    "curl -X $M url",
    'curl -X "$method" url',
    "curl -sX$M url",
    "wget --post-data=x u",
    "wget --post-data x u",
    "wget -q --post-file=f u",
    "wget --method=POST u",
    "wget --method PUT u",
    "wget --method=$M u",
    "$(which gh) api x",
    '"$(command -v gh)" api x',
    "`which git` push",
    "git branch --sort=-committerdate b3",
    "git branch --format='%(refname:short)' newb",
    "git tag --sort=version:refname v9",
    "find . -name '*.md' -exec grep -q TODO {} \\; -exec git add {} \\;",
    "find . -exec grep -q x {} ';' -exec gh api {} ';'",
    "cat <<EOF | sed 's/\\./-/g'\n$(gh api x)\nEOF",
    "cat <<EOF > a.txt # note \\ here\n`gh api x`\nEOF",
    "sh <<<'git push'",
    'sh <<<"gh api x"',
    "(echo 'git push') | sh",
    "{ echo 'git push'; } | sh",
    "git submodule foreach git config --unset user.name",
    "git submodule foreach --recursive git config --unset-all a.b",
    "( echo gh api x; ) | sh",
    "{ { echo gh api x; }; } | sh",
    "{ echo gh api x; echo hi; } | sh",
    "(echo gh api x; echo hi) | sh",
    "echo gh api x 2>&1 | sh",
    "<<<'gh api x' bash",
    "if true; then { gh api x; }; fi",
    "f() { gh api x; }",
    "true&&{ gh api x;}",
  ])("flags %s", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(true);
  });

  it.each([
    "git tag --merged HEAD",
    "git tag --no-merged main",
    "git tag --no-contains abc",
    "git tag -n5 'v1.*'",
    "git tag -n 'v1.*'",
    "git tag -v v1.0",
    "git tag --verify v1.0",
    "git config -f .gitmodules submodule.foo.path",
    "git config --file .gitmodules submodule.foo.path",
    "git config --file=.gitmodules submodule.foo.path",
    "git config get user.name",
    "git config list",
    "git clean -n",
    "git clean -nd",
    "git clean -dn",
    "git clean --dry-run -x",
    "git rm --dry-run a",
    "git rm -rn a",
    "git add -n .",
    "git add --dry-run .",
    "git remote",
    "git remote -v",
    "git remote show origin",
    "git remote get-url origin",
    "git notes",
    "git notes list",
    "git notes --ref r show HEAD",
    "git submodule",
    "git submodule status",
    "git submodule summary",
    "git branch --list 'feat*'",
    "git branch --merged main",
    "git branch --contains abc",
    "git branch -r",
    "git branch -vv",
    "git branch --show-current",
    "echo 'git log' | sh",
    "echo hello | cat",
    "echo 'gh api' | grep gh",
    "echo 'gh api' || sh",
    "cat <<EOF\n$(date)\nEOF",
    "cat <<'EOF'\n$(gh api x)\nEOF",
    'cat <<"EOF"\n$(gh api x)\nEOF',
    "cat <<\\EOF\n$(gh api x)\nEOF",
    "find . -exec grep -l gh {} \\;",
    "find . -name '*.md' -execdir wc -l {} +",
    "find . -name gh -print",
    "curl -X GET url",
    "wget -q -O - https://example.com",
    "$(which node) -v",
    "which gh",
    "git submodule foreach 'git log -1'",
    "git remote prune --dry-run origin",
    "git remote prune -n origin",
    "git config --get-color color.diff.new blue",
    "git tag --sort=-creatordate",
    "echo ${HOME}",
    "(echo 'git log') | sh",
    "git branch --sort committerdate",
    "git branch --format '%(refname:short)'",
    "git tag --sort version:refname",
    "git tag --format '%(refname)'",
    "git submodule foreach git tag -l v1",
    "git submodule foreach git branch --list 'feat*'",
    "echo } gh api",
    "echo { gh api x }",
    "echo 'gh api x'; (echo hi) | sh",
    "echo x 2>&1 | grep gh",
    ") | sh",
    "} | bash",
  ])("lets the read %s through", (cmd) => {
    expect(forbiddenCommand(cmd)).toBe(false);
  });
});

describe("forbiddenCommand on pathological input", () => {
  it("stays linear on the shapes CodeQL flagged", () => {
    const started = performance.now();
    expect(forbiddenCommand("sh " + "-o -- ".repeat(20000))).toBe(false);
    expect(forbiddenCommand("sh -" + "-- -".repeat(20000))).toBe(false);
    expect(forbiddenCommand("$(which " + " ".repeat(40000) + "x")).toBe(false);
    expect(forbiddenCommand("find . " + "-exec ".repeat(20000))).toBe(false);
    expect(forbiddenCommand("echo x |".repeat(20000) + " sh")).toBe(false);
    expect(forbiddenCommand("cat <<EOF\n" + "$(".repeat(20000) + "\nEOF")).toBe(false);
    expect(forbiddenCommand(") | sh ".repeat(20000))).toBe(false);
    expect(forbiddenCommand("(".repeat(20000) + "echo x" + ") | sh".repeat(20000))).toBe(false);
    expect(forbiddenCommand("echo x; ".repeat(20000) + "echo gh api | sh")).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("collecting several rounds", () => {
  const ARGS = {
    dir: "/r/input",
    work: "/r/work",
    gold: { id: "gold", model: "opus", effort: "high" },
    arms: [{ id: "a", model: "haiku", effort: "low" }],
  };
  const prompt = (dir: string, work: string, marker: string) =>
    `Census of ${dir}.\nYour own scratch directory is ${work}. Create it.\n\n(${marker})`;
  const referee = (id: string, transcript: string, ruling: string, dir = ARGS.dir) =>
    ({
      ...readAgentTranscript(
        [
          user(prompt(dir, `/r/work/referee-${id}`, `BAKEOFF-REFEREE: ${id}`)),
          assistant("m", [output({ rulings: [{ id: ruling }] })], "high", "claude-opus-5-5"),
        ].join("\n"),
      ),
      transcript,
    }) as Collected;
  const arm = (id: string, transcript: string, dir = ARGS.dir) =>
    ({
      ...readAgentTranscript(
        [
          user(prompt(dir, `/r/work/${id}`, `BAKEOFF-ARM: ${id}`)),
          assistant("m", [output({})]),
        ].join("\n"),
      ),
      transcript,
    }) as Collected;

  it("keeps round 1's rulings when round 2 arrives, and numbers the next round", () => {
    const first = mergeAgents({}, [referee("r1-1", "/t/wf1/agent-z.jsonl", "A")], ARGS);
    expect(first.errors).toEqual([]);
    expect(nextRound(first.agents)).toBe(2);
    const second = mergeAgents(first.agents, [referee("r2-1", "/t/wf2/agent-a.jsonl", "B")], ARGS);
    expect(second.errors).toEqual([]);
    expect(Object.keys(second.agents).sort()).toEqual(["referee:r1-1", "referee:r2-1"]);
    expect(nextRound(second.agents)).toBe(3);
  });

  it("refuses two transcripts that claim the same marker", () => {
    const { errors } = mergeAgents(
      {},
      [referee("r1-1", "/t/wf1/agent-z.jsonl", "A"), referee("r1-1", "/t/wf2/agent-a.jsonl", "B")],
      ARGS,
    );
    expect(errors).toEqual([
      "referee:r1-1 has two transcripts: /t/wf1/agent-z.jsonl and /t/wf2/agent-a.jsonl",
    ]);
  });

  it("accepts the same transcript collected twice", () => {
    const one = referee("r1-1", "/t/wf1/agent-z.jsonl", "A");
    const first = mergeAgents({}, [one], ARGS);
    expect(mergeAgents(first.agents, [one], ARGS).errors).toEqual([]);
  });

  it("refuses a transcript from another run, and a marker that names no arm", () => {
    const { agents, errors } = mergeAgents(
      {},
      [
        arm("a", "/t/old/agent-1.jsonl", "/other/input"),
        arm("stranger", "/t/wf/agent-2.jsonl"),
        arm("a", "/t/wf/agent-3.jsonl"),
      ],
      ARGS,
    );
    expect(errors).toEqual([
      "/t/old/agent-1.jsonl: a's prompt does not name this run's input /r/input and work dir /r/work/a",
      "/t/wf/agent-2.jsonl: marker stranger names no arm of this run",
    ]);
    expect(Object.keys(agents)).toEqual(["a"]);
  });
});

describe("a referee chunk that returned nothing", () => {
  it("stops counting once no disagreement is left unruled", () => {
    const empty = readAgentTranscript(
      [user("(BAKEOFF-REFEREE: r1-1)"), assistant("m", [], "high", "claude-opus-5-5")].join("\n"),
    );
    expect(verifyRan(REFEREE, empty)).toEqual(["referee:r1-1: no accepted structured output"]);
    expect(verifyRan(REFEREE, empty, undefined, { needOutput: false })).toEqual([]);
  });
});

describe("verifyRan's write check", () => {
  it("resolves .. and treats a relative path as outside", () => {
    const t = {
      ...readAgentTranscript(
        [user("(BAKEOFF-ARM: a)"), assistant("m", [output({})], "low")].join("\n"),
      ),
      writes: ["/r/work/a/../b/census.py", "census.py", "/r/work/a/sub/ok.py"],
    };
    expect(verifyRan({ id: "a", model: "haiku", effort: "low" }, t, "/r/work/a")).toEqual([
      "a: wrote outside /r/work/a: /r/work/a/../b/census.py, census.py",
    ]);
  });
});

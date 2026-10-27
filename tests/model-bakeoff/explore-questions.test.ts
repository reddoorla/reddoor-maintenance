import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { AGENT_TYPE, armMarker, refereeMarker } from "../../scripts/model-bakeoff/lib/arms.mjs";
import {
  RULINGS_IN_TEXT,
  extractArgs,
  launches,
  verifyRan,
  withTextOutputs,
} from "../../scripts/model-bakeoff/bakeoff.mjs";
import { finalScores, scoreRun } from "../../scripts/model-bakeoff/lib/score.mjs";
import {
  readAgentTranscript,
  textStructured,
} from "../../scripts/model-bakeoff/lib/transcripts.mjs";
import * as task from "../../scripts/model-bakeoff/tasks/explore-questions.mjs";
import { runWorkflow } from "../_helpers/bakeoff-workflow.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOW = readFileSync(
  fileURLToPath(new URL("../../.claude/workflows/model-bakeoff.workflow.js", import.meta.url)),
  "utf8",
);

// A tree with just what every question reads, and a decoy for each one.
function fixture(dir: string) {
  const repo = join(dir, "input", "repo");
  const files: Record<string, string> = {
    "src/util/credentials.ts":
      "export function loadCredentialsIntoEnv() {}\nexport async function parseEnvFile() {}\nconst x = 1;\n",
    "src/cli/bin.ts": 'import { loadCredentialsIntoEnv } from "../util/credentials.js";\n',
    "src/db/client.ts": 'const m = await import("../util/credentials");\n',
    "src/audits/analytics.ts": 'type K = "credentials";\nconst p = "../util/credentials.ts";\n',
    "src/reports/x.ts": 'export { parseEnvFile } from "../util/credentials.ts";\n',
    "scripts/model-bakeoff/lib/ledger.mjs": "export function formatCost() {}\n",
    "scripts/model-bakeoff/lib/ledger.d.mts": "export function formatCost(): string;\n",
    "scripts/model-bakeoff/bakeoff.mjs":
      "const REFEREE_CHUNK = 90;\nthrow new Error(`${p} exists; pick a fresh --out`);\n",
    "scripts/model-bakeoff/tasks/a.mjs": "export function observe() {}\n",
    "scripts/model-bakeoff/tasks/b.mjs": "export const observe = 1;\n",
    "tests/l.test.ts": 'import { x } from "../scripts/model-bakeoff/lib/ledger.mjs";\n',
    "tests/m.test.ts": 'it("the ledger", () => {}); // pick a fresh --out\n',
    ".github/workflows/a.yml":
      "on:\n  schedule:\n    - cron: x\nenv:\n  T: ${{ secrets.TURSO_AUTH_TOKEN }}\n",
    ".github/workflows/b.yaml": "on:\n  push:\nenv:\n  T: ${{ secrets.TURSO_AUTH_TOKEN_OLD }}\n",
    "package.json": '{"packageManager":"pnpm@11.11.0"}\n',
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), body);
  }
  return join(dir, "input");
}

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "explore-q-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("explore-questions truth", () => {
  it("answers each question from the files, past every decoy", () =>
    withDir((dir) => {
      const t = task.truth(fixture(dir));
      const s = Object.fromEntries(t.scalars.map((x) => [x.id, x.value]));
      const l = Object.fromEntries(t.lists.map((x) => [x.id, x.values]));
      expect(s).toEqual({
        "def-credentials": "src/util/credentials.ts",
        "def-format-cost": "scripts/model-bakeoff/lib/ledger.mjs",
        "referee-chunk": "90",
        "scheduled-workflows": "1",
        "pnpm-version": "11.11.0",
      });
      expect(l).toEqual({
        "fresh-out": ["scripts/model-bakeoff/bakeoff.mjs"],
        "credentials-importers": ["src/cli/bin.ts", "src/db/client.ts", "src/reports/x.ts"],
        "credentials-exports": ["loadCredentialsIntoEnv", "parseEnvFile"],
        "turso-secret": [".github/workflows/a.yml"],
        "ledger-tests": ["tests/l.test.ts"],
        "src-dirs": ["audits", "cli", "db", "reports", "util"],
        "observe-tasks": ["scripts/model-bakeoff/tasks/a.mjs"],
      });
    }));

  it("refuses a definition question with two answers, rather than pick one", () =>
    withDir((dir) => {
      const input = fixture(dir);
      writeFileSync(join(input, "repo", "src", "two.ts"), "export function formatCost() {}\n");
      expect(() => task.truth(input)).toThrow(/def-format-cost: expected one match/);
    }));
});

describe("explore-questions scoring", () => {
  it("scores the truth perfectly, and a changed answer fails exactly its own check", () =>
    withDir((dir) => {
      const ref = task.truth(fixture(dir));
      const perfect = scoreRun(task, ref, ref);
      expect(perfect.every((c: { ok: boolean }) => c.ok)).toBe(true);
      const wrong = structuredClone(ref);
      wrong.scalars.find((x) => x.id === "referee-chunk")!.value = "91";
      wrong.lists.find((x) => x.id === "src-dirs")!.values.pop();
      const failed = scoreRun(task, ref, wrong)
        .filter((c: { ok: boolean }) => !c.ok)
        .map((c: { check: string }) => c.check)
        .sort();
      expect(failed).toEqual(["lists src-dirs / values", "scalars referee-chunk / value"]);
      const { per } = finalScores({ a: scoreRun(task, ref, wrong) });
      expect(per.a!.total - per.a!.correct).toBe(2);
    }));
});

describe("an agent that answers in text", () => {
  it("is read from the last ```json block of its final message", () => {
    const two = 'notes\n```json\n{"a":1}\n```\nmore\n```json\n{"scalars":[]}\n```';
    expect(textStructured(two)).toEqual({ scalars: [] });
    expect(textStructured("no block")).toBeNull();
    expect(textStructured("```json\n[1]\n```")).toBeNull();
    expect(textStructured("```json\n{oops\n```")).toBeNull();
    expect(textStructured(undefined)).toBeNull();
  });

  it("keeps the text of the last assistant message that has any", () => {
    const line = (o: unknown) => JSON.stringify(o);
    const t = readAgentTranscript(
      [
        line({ message: { role: "user", content: "q\n\n(BAKEOFF-ARM: a)" } }),
        line({ message: { role: "assistant", content: [{ type: "text", text: "first" }] } }),
        line({ message: { role: "assistant", content: [{ type: "text", text: "final" }] } }),
        line({
          message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Read" }] },
        }),
      ].join("\n"),
    );
    expect(t.finalText).toBe("final");
  });

  it("is given that block as its output only by a textOutput task", () => {
    const agents = {
      a: { structured: null, finalText: '```json\n{"v":1}\n```' },
      b: { structured: { v: 2 }, finalText: '```json\n{"v":3}\n```' },
    };
    expect(withTextOutputs({ textOutput: true }, agents)).toEqual({
      a: { ...agents.a, structured: { v: 1 } },
      b: agents.b,
    });
    expect(withTextOutputs({}, agents)).toEqual(agents);
  });
});

describe("the agent type a task names", () => {
  const agent = (agentType: string) => ({
    ...readAgentTranscript(""),
    models: ["claude-haiku-5-5"],
    efforts: ["low"],
    structured: {},
    agentType,
  });
  const arm = { id: "a", model: "haiku", effort: "low" };

  it("holds every agent to it, and the default stays bakeoff-readonly", () => {
    expect(verifyRan(arm, agent("Explore"), undefined, { agentType: "Explore" })).toEqual([]);
    expect(verifyRan(arm, agent(AGENT_TYPE), undefined, { agentType: "Explore" })).toEqual([
      `a: ran as agent type ${AGENT_TYPE}, not Explore`,
    ]);
    expect(verifyRan(arm, agent("Explore"))).toEqual([
      `a: ran as agent type Explore, not ${AGENT_TYPE}`,
    ]);
  });
});

describe("launching a text-output task by hand", () => {
  it("gives each agent the exact prompt, model and effort the workflow would", async () => {
    const args = extractArgs(task, "/r/input");
    const { calls } = await runWorkflow(args);
    const got = await launches(args, WORKFLOW, task);
    expect(got.map((g) => g.prompt)).toEqual(calls.map((c) => c.prompt));
    expect(got.map((g) => [g.model, g.effort])).toEqual(
      calls.map((c) => [c.opts.model, c.opts.effort]),
    );
    expect(new Set(got.map((g) => g.subagent_type))).toEqual(new Set(["Explore"]));
    expect(
      got
        .find((g) => g.label === "arm:haiku-low-1")!
        .prompt.endsWith(`(${armMarker("haiku-low-1")})`),
    ).toBe(true);
  });

  it("tells a referee how to write its rulings, with its marker still last", async () => {
    const args = {
      mode: "referee",
      task: task.id,
      dir: "/r/input",
      work: "/r/work",
      prompt: task.prompt("/r/input"),
      round: 1,
      referee: { id: "referee", model: "opus", effort: "high" },
      chunks: [[{ id: "d1", check: "c", ARM: "a", REFERENCE: "b" }]],
    };
    const [r] = await launches(args, WORKFLOW, task);
    expect(r!.prompt).toContain(RULINGS_IN_TEXT);
    expect(r!.prompt.endsWith(`${RULINGS_IN_TEXT}\n\n(${refereeMarker(1, 1)})`)).toBe(true);
    expect(
      readAgentTranscript(JSON.stringify({ message: { role: "user", content: r!.prompt } })).marker,
    ).toEqual({
      kind: "referee",
      id: "r1-1",
    });
  });
});

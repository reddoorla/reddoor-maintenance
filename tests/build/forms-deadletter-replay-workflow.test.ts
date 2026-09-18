import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  stepRunScript,
  stepEnv,
  withoutComments,
  workflowPath,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * MED-10(a). The scheduled drain for the form dead-letter queue.
 *
 * The gate script is EXTRACTED FROM THE YAML AND EXECUTED against a stubbed
 * `node`, clean case FIRST — the same harness fleet-db-backup's and fleet-smoke's
 * gates use, and the same reason: a workflow gate is trivially easy to write so
 * that it can never pass, and this repo has shipped exactly that twice.
 *
 * The distinction the gate encodes, and which these tests pin:
 *   still_failing > 0  → a STANDING CONDITION with an alarm of its own (the
 *                        `deadletter` attention item). Warn, stay green.
 *   unmarked > 0       → a lead re-ingested without its terminal mark. The next
 *   unreadable > 0       run duplicates it; nothing else in the system will ever
 *                        say so. Red.
 *   marker absent      → the replay did not complete at all. Red.
 */

const STEP = "Replay the dead-letter queue";

let gate: string;
let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("forms-deadletter-replay.yml"), "utf-8");
  gate = stepRunScript(workflow, STEP);
});

/** Run the extracted gate with a stubbed CLI that prints `out` and exits `code`. */
async function runGate(out: string, code = 0): Promise<{ code: number; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dl-replay-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "cli.txt"), out, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncat "${join(dir, "cli.txt")}"\nexit ${code}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, log: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, log: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const marker = (o: { replayed?: number; still?: number; unmarked?: number; unreadable?: number }) =>
  `DEADLETTER_REPLAY replayed=${o.replayed ?? 0} still_failing=${o.still ?? 0} unmarked=${o.unmarked ?? 0} unreadable=${o.unreadable ?? 0}`;

describe("forms-deadletter-replay — the gate PASSES on a known-good run", () => {
  it("an empty queue is green", async () => {
    const r = await runGate(marker({}));
    expect(r.code).toBe(0);
    expect(r.log).toContain("PASS: replayed=0");
  });

  it("leads actually recovered is green", async () => {
    const r = await runGate(
      [
        "replayed dl_a → accepted (sub_1)",
        "replayed dl_b → accepted (sub_2)",
        marker({ replayed: 2 }),
      ].join("\n"),
    );
    expect(r.code).toBe(0);
    expect(r.log).toContain("PASS: replayed=2");
  });

  it("rows still queued WARN but stay green — the standing condition keeps its own alarm", async () => {
    // The CLI exits 1 here on purpose ("loud and recoverable beats silent and
    // not"). The gate must not inherit that: a genuinely dead slug would file a
    // tracking issue every six hours until someone runs `--abandon`.
    const r = await runGate(
      ["still failing dl_c: unknown-site: no fleet row for 'gone'", marker({ still: 1 })].join(
        "\n",
      ),
      1,
    );
    expect(r.code).toBe(0);
    expect(r.log).toContain("::warning::");
    expect(r.log).toContain("PASS: replayed=0 still_failing=1");
  });
});

describe("forms-deadletter-replay — the gate FAILS on each thing it exists to catch", () => {
  it("reds when the marker is absent — the #585 silent-stop shape", async () => {
    const r = await runGate("some unrelated log line\n");
    expect(r.code).toBe(1);
    expect(r.log).toContain("no DEADLETTER_REPLAY marker");
  });

  it("reds when the command crashed with no output at all", async () => {
    const r = await runGate("", 1);
    expect(r.code).toBe(1);
    expect(r.log).toContain("no DEADLETTER_REPLAY marker");
  });

  it("reds on an unmarked row — the next run would duplicate that lead", async () => {
    const r = await runGate(
      [
        "UNMARKED dl_d: re-ingested as sub_9 → accepted, but the terminal mark could NOT be written",
        marker({ unmarked: 1 }),
      ].join("\n"),
      1,
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("unmarked=1");
    expect(r.log).toContain("DUPLICATED");
  });

  it("reds on an undecodable row", async () => {
    const r = await runGate(
      [
        "UNREADABLE dl_e (site 'acme', received …): payload is not decodable JSON",
        marker({ unreadable: 1 }),
      ].join("\n"),
      1,
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("unreadable=1");
  });

  it("reds on a marker missing a counter — an older CLI cannot pass by omission", async () => {
    const r = await runGate("DEADLETTER_REPLAY replayed=0 still_failing=0\n");
    expect(r.code).toBe(1);
    expect(r.log).toContain("missing a counter");
  });
});

describe("forms-deadletter-replay — wiring", () => {
  it("is single-flight and never cancels a run mid-replay", () => {
    const live = withoutComments(workflow);
    expect(live).toContain("group: forms-deadletter-replay");
    expect(live).toContain("cancel-in-progress: false");
  });

  it("carries the Turso credentials and NO Airtable ones (Phase 6)", () => {
    const env = stepEnv(workflow, STEP);
    expect(env.TURSO_DATABASE_URL).toBe("${{ secrets.TURSO_DATABASE_URL }}");
    expect(env.TURSO_AUTH_TOKEN).toBe("${{ secrets.TURSO_AUTH_TOKEN }}");
    expect(Object.keys(env).filter((k) => k.startsWith("AIRTABLE"))).toEqual([]);
  });

  it("runs on a schedule at all — the whole point of MED-10(a)", () => {
    expect(withoutComments(workflow)).toMatch(/schedule:\s*\n\s*- cron:/);
  });
});

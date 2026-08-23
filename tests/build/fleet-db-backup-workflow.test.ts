import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * The backup that must not lie. An unverified backup discovered broken during a
 * disaster is the canonical failure shape this repo's instrument rule exists
 * for — so the workflow's gate script is EXTRACTED FROM THE YAML AND EXECUTED
 * against a stubbed CLI, clean case first, same as fleet-smoke's and
 * fleet-prismic-drift's gates.
 *
 * The stub `node` prints a canned dump for `db dump` and a canned DUMP_VERIFY
 * for `db verify-dump`, so every branch of the shell is reachable without a
 * network or a real database.
 */

const BACKUP_STEP = "Dump + rehearse the restore";
const ENCRYPT_STEP = "Encrypt";

let gate: string;
let encrypt: string;

beforeAll(async () => {
  const wf = await readFile(workflowPath("fleet-db-backup.yml"), "utf-8");
  gate = stepRunScript(wf, BACKUP_STEP);
  encrypt = stepRunScript(wf, ENCRYPT_STEP);
});

async function runStep(
  script: string,
  opts: { dump?: string; verify?: string; env?: Record<string, string> },
): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "db-backup-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "dump.txt"), opts.dump ?? "", "utf-8");
  await writeFile(join(dir, "verify.txt"), opts.verify ?? "", "utf-8");
  // Route on the CLI subcommand: `db dump` → canned dump; `db verify-dump` →
  // canned verify output.
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncase "$*" in\n  *"db dump"*) cat "${join(dir, "dump.txt")}";;\n  *"db verify-dump"*) cat "${join(dir, "verify.txt")}";;\nesac\nexit 0\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", script], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        ...opts.env,
      },
    });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const GOOD_DUMP = [
  "CREATE TABLE sites (id TEXT PRIMARY KEY);",
  "INSERT INTO sites (id) VALUES ('recA');",
  "COMMIT;",
].join("\n");
const GOOD_VERIFY = "DUMP_VERIFY loaded=true tables=9 rows=340 mismatches=0";

describe("fleet-db-backup — the gate cannot go green on a backup that would not restore", () => {
  it("passes a dump with sites rows and a clean rehearsal", async () => {
    const r = await runStep(gate, { dump: GOOD_DUMP, verify: GOOD_VERIFY });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
  });

  it("FAILS when the dump carries no sites rows — a broken dump path, not an empty fleet", async () => {
    const r = await runStep(gate, {
      dump: "CREATE TABLE sites (id TEXT PRIMARY KEY);\nCOMMIT;",
      verify: GOOD_VERIFY,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("NO sites rows");
  });

  it("FAILS when the rehearsal reports mismatches", async () => {
    const r = await runStep(gate, {
      dump: GOOD_DUMP,
      verify:
        "✗ sites: dump=44 restored=43\nDUMP_VERIFY loaded=true tables=9 rows=339 mismatches=1",
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("restore rehearsal FAILED");
  });

  it("FAILS when the rehearsal never printed its line at all", async () => {
    // Absent line = the verify never ran; that must not read as success.
    const r = await runStep(gate, { dump: GOOD_DUMP, verify: "" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("restore rehearsal FAILED");
  });

  it("Encrypt REFUSES to ship a plaintext dump when the passphrase secret is unset", async () => {
    const r = await runStep(encrypt, { env: { BACKUP_PASSPHRASE: "" } });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("refusing to upload a plaintext dump");
  });
});

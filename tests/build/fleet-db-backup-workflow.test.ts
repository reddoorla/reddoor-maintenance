import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepEnv, stepRunScript, workflowPath, workflowSteps } from "./_helpers/workflow-source.js";

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
const RECORD_STEP = "Record the backup event";

let gate: string;
let encrypt: string;
let workflowText: string;

beforeAll(async () => {
  const wf = await readFile(workflowPath("fleet-db-backup.yml"), "utf-8");
  workflowText = wf;
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

  // Every case above hands the gate a CANNED dump and a CANNED DUMP_VERIFY, so
  // all of them keep passing if the real CLI's output stops matching the real
  // greps. The gate's rehearsal pattern is `^DUMP_VERIFY loaded=true .*
  // mismatches=0$` — anchored at the end, so appending a key to that line breaks
  // production while leaving every fixture case green. (Exactly that shape of
  // gap was found in fleet-db-sync's gate on 2026-08-25.)
  //
  // This case closes it end to end: a real migrated database → the real `db
  // dump` → the real `db verify-dump` → the real gate script.
  it("PASSES on the REAL dump and REAL rehearsal output, not fixtures of them", async () => {
    const { runDbCommand } = await import("../../src/cli/commands/db.js");
    const { openDb } = await import("../../src/db/client.js");

    // A file: url, not :memory: — each in-memory client is its own database, so
    // the CLI would otherwise dump an empty one.
    const dir = await mkdtemp(join(tmpdir(), "db-backup-real-"));
    const url = `file:${join(dir, "fleet.db")}`;
    const db = await openDb({ url });
    await db
      .insertInto("sites")
      .values({ id: "recREAL", slug: "real-site", name: "Real Site", require_turnstile: 0 })
      .execute();
    await db.destroy();

    const dumped = await runDbCommand("dump", { url });
    expect(dumped.code).toBe(0);

    const dumpFile = join(dir, "fleet.sql");
    await writeFile(dumpFile, dumped.output, "utf-8");
    const verified = await runDbCommand("verify-dump", { file: dumpFile });
    expect(verified.code).toBe(0);

    // Both halves are real: the gate greps the dump text for sites rows AND the
    // rehearsal line for a clean restore.
    const r = await runStep(gate, { dump: dumped.output, verify: verified.output });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
  });

  it("Encrypt REFUSES to ship a plaintext dump when the passphrase secret is unset", async () => {
    const r = await runStep(encrypt, { env: { BACKUP_PASSPHRASE: "" } });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("refusing to upload a plaintext dump");
  });
});

// P1-87 PR 9 (a). A backup is recorded as a feed event only once the whole job's
// work is done: after the Dropbox copy, before the failure-issue step. The record step
// has no `if:` of its own, so it runs only when every step before it succeeded (the
// rehearsal, Encrypt's round-trip gate and the upload; the Dropbox copy is
// continue-on-error and does not fail the job). It holds only the two TURSO_* secrets.
describe("fleet-db-backup — the backup event is recorded at the end of the job's work", () => {
  const DROPBOX_STEP = "Copy the encrypted dump to Dropbox";
  const FAILURE_ISSUE_STEP = "Open/update the backup-failure tracking issue";

  it("runs after the Dropbox copy and before the failure-issue step, in the same job", () => {
    const steps = workflowSteps(workflowText);
    const labels = steps.map((st) => st.label);
    const dropbox = labels.indexOf(DROPBOX_STEP);
    const record = labels.indexOf(RECORD_STEP);
    const issue = labels.indexOf(FAILURE_ISSUE_STEP);
    expect(dropbox).toBeGreaterThan(-1);
    expect(record).toBe(dropbox + 1);
    expect(issue).toBe(record + 1);
    expect(steps[record]!.job).toBe(steps[dropbox]!.job);
  });

  it("has no if: and no continue-on-error of its own, and does not name always() or failure()", () => {
    const step = workflowSteps(workflowText).find((st) => st.label === RECORD_STEP);
    expect(step).toBeDefined();
    expect(step!.if).toBeUndefined();
    expect(step!.continueOnError).toBeUndefined();
    expect(step!.source).not.toMatch(/always\(\)|failure\(\)/);
  });

  it("holds only the two TURSO_* secrets, exactly as the rehearsal does", () => {
    expect(stepEnv(workflowText, RECORD_STEP)).toEqual({
      TURSO_DATABASE_URL: "${{ secrets.TURSO_DATABASE_URL }}",
      TURSO_AUTH_TOKEN: "${{ secrets.TURSO_AUTH_TOKEN }}",
    });
  });

  it("records the rehearsal's own verify output", () => {
    const run = stepRunScript(workflowText, RECORD_STEP);
    expect(run).toContain(
      'node dist/cli/bin.js db record-backup-event --file "${RUNNER_TEMP:-/tmp}/verify.out"',
    );
  });

  it("leaves the existing gate lines unchanged", () => {
    expect(gate).toContain(
      `grep -qE '^DUMP_VERIFY loaded=true .* mismatches=0$' "$out/verify.out"`,
    );
    expect(gate).toContain(
      'node dist/cli/bin.js db verify-dump --file "$out/dump.sql" | tee "$out/verify.out"',
    );
    expect(encrypt).toContain(
      `grep -qE '^DUMP_VERIFY loaded=true .* mismatches=0$' "$out/verify.enc.out"`,
    );
  });
});

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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

/** #1615 end-to-end cases: the real replay CLI, with Resend stubbed. `null`
 *  is an unconfigured key, which is how the CLI meets a missing secret. */
const resend = vi.hoisted(() => ({ configured: true, sent: 0 }));
vi.mock("../../src/reports/send/resend.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/reports/send/resend.js")>();
  return {
    ...actual,
    defaultResendClient: () => {
      if (!resend.configured) throw new Error("RESEND_API_KEY not set");
      return {
        send: async () => {
          resend.sent++;
          return { messageId: `msg_${resend.sent}` };
        },
      };
    },
  };
});

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

const marker = (o: {
  replayed?: number;
  rejected?: number;
  notifyFailed?: number;
  still?: number;
  unmarked?: number;
  unreadable?: number;
}) =>
  `DEADLETTER_REPLAY replayed=${o.replayed ?? 0} rejected=${o.rejected ?? 0} notify_failed=${o.notifyFailed ?? 0} still_failing=${o.still ?? 0} unmarked=${o.unmarked ?? 0} unreadable=${o.unreadable ?? 0}`;

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
    expect(r.log).toContain("PASS: replayed=0 rejected=0 notify_failed=0 still_failing=1");
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

  // #1615. The marker before it: rejected and notify-failed rows both counted
  // as `replayed`, so neither had a counter for this gate to read.
  it("reds on the pre-#1615 marker, which has no rejected or notify_failed counter", async () => {
    const r = await runGate(
      "DEADLETTER_REPLAY replayed=3 still_failing=0 unmarked=0 unreadable=0\n",
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("missing a counter");
  });

  it("reds on a lead rejected on replay — it left the queue with no submission", async () => {
    const r = await runGate(
      [
        "REJECTED dl_f → rejected:invalid-payload: formType is not a recognized form type",
        marker({ rejected: 1 }),
      ].join("\n"),
      1,
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("rejected=1");
    expect(r.log).not.toContain("PASS:");
  });

  it("reds on a lead replayed without its notification email", async () => {
    const r = await runGate(
      ["NOTIFY FAILED dl_g → accepted (sub_7)", marker({ replayed: 1, notifyFailed: 1 })].join(
        "\n",
      ),
      1,
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("notify_failed=1");
    expect(r.log).not.toContain("PASS:");
  });
});

describe("forms-deadletter-replay — wiring", () => {
  it("is single-flight and never cancels a run mid-replay", () => {
    const live = withoutComments(workflow);
    expect(live).toContain("group: forms-deadletter-replay");
    expect(live).toContain("cancel-in-progress: false");
  });

  it("carries the Turso credentials", () => {
    const env = stepEnv(workflow, STEP);
    expect(env.TURSO_DATABASE_URL).toBe("${{ secrets.TURSO_DATABASE_URL }}");
    expect(env.TURSO_AUTH_TOKEN).toBe("${{ secrets.TURSO_AUTH_TOKEN }}");
  });

  it("runs on a schedule at all — the whole point of MED-10(a)", () => {
    expect(withoutComments(workflow)).toMatch(/schedule:\s*\n\s*- cron:/);
  });
});

/**
 * #1615. The cases above hand the gate a marker someone typed. These run the
 * REAL `db replay-deadletters` handler against a scratch `file:` database
 * migrated by this checkout, and hand its output and exit code to the gate
 * extracted from the YAML: the sweep's own harness, kept. Known-good first.
 */
describe("forms-deadletter-replay — the real CLI through the gate (#1615)", () => {
  const SITE = {
    id: "recACME",
    fields: {
      Name: "Acme Gallery",
      Status: "live",
      url: "https://acme.example.com",
      "point of contact": "owner@acme.example.com",
    },
  };

  afterEach(() => {
    resend.configured = true;
    resend.sent = 0;
  });

  /** A migrated scratch store holding one site and `leads` queued dead-letters. */
  async function seed(leads: Array<Record<string, unknown>>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dl-replay-e2e-"));
    const url = `file:${join(dir, "fleet.db")}`;
    const { runDbCommand } = await import("../../src/cli/commands/db.js");
    expect((await runDbCommand("migrate", { url })).code).toBe(0);
    const { openDb } = await import("../../src/db/client.js");
    const { mirrorSiteInsert } = await import("../../src/db/fleet-state.js");
    const { createDeadLetter } = await import("../../src/db/deadletter.js");
    const db = await openDb({ url });
    await mirrorSiteInsert(db, SITE, "2026-10-20T12:00:00.000Z");
    for (const [n, payload] of leads.entries()) {
      await createDeadLetter(db, {
        siteSlug: "acme-gallery",
        payload,
        turnstile: { outcome: "pass", hostname: "acme.example.com" },
        error: "Error: turso 503",
        receivedAt: new Date(Date.UTC(2026, 9, 21, 10, n, 0)),
      });
    }
    await db.destroy();
    return url;
  }

  const lead = (n: number, over: Record<string, unknown> = {}) => ({
    email: `lead${n}@example.com`,
    name: `Lead ${n}`,
    message: `I would like a quote for project number ${n}`,
    ...over,
  });

  async function replayThroughGate(url: string): Promise<{ code: number; log: string }> {
    const { runDbCommand } = await import("../../src/cli/commands/db.js");
    const cli = await runDbCommand("replay-deadletters", { url });
    return runGate(cli.output + "\n", cli.code);
  }

  it("KNOWN-GOOD: an empty queue — last night's real run — is green", async () => {
    const r = await replayThroughGate(await seed([]));
    expect(r.code).toBe(0);
    expect(r.log).toContain(
      "PASS: replayed=0 rejected=0 notify_failed=0 still_failing=0 unmarked=0 unreadable=0",
    );
  });

  it("KNOWN-GOOD: three leads placed and emailed is green", async () => {
    const r = await replayThroughGate(await seed([lead(1), lead(2), lead(3)]));
    expect(resend.sent).toBe(3);
    expect(r.code).toBe(0);
    expect(r.log).toContain("PASS: replayed=3 rejected=0 notify_failed=0");
  });

  it("the sweep's input: leads whose formType was since retired are rejected, and the gate reds", async () => {
    const url = await seed([
      lead(1, { formType: "estimate" }),
      lead(2, { formType: "estimate" }),
      lead(3, { formType: "estimate" }),
    ]);
    const r = await replayThroughGate(url);
    expect(r.log).toContain("replayed=0 rejected=3");
    expect(r.code).toBe(1);
    expect(r.log).not.toContain("PASS:");
  });

  it("the sweep's input: Resend unconfigured, three leads placed un-emailed, and the gate reds", async () => {
    resend.configured = false;
    const r = await replayThroughGate(await seed([lead(1), lead(2), lead(3)]));
    expect(r.log).toContain("replayed=3 rejected=0 notify_failed=3");
    expect(r.code).toBe(1);
    expect(r.log).not.toContain("PASS:");
  });
});

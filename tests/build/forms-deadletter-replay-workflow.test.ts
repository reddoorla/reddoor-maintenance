import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
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

/** #1615 end-to-end cases: the real replay CLI, with Resend stubbed.
 *  `configured: false` throws from the client factory, which is how the CLI meets
 *  a missing secret; `refuses: true` throws from `send`, a key Resend rejects. */
const resend = vi.hoisted(() => ({ configured: true, refuses: false, sent: 0 }));
vi.mock("../../src/reports/send/resend.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/reports/send/resend.js")>();
  return {
    ...actual,
    defaultResendClient: () => {
      if (!resend.configured) throw new Error("RESEND_API_KEY not set");
      return {
        send: async () => {
          if (resend.refuses) throw new Error("Resend error: API key is invalid");
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
  } finally {
    await rm(dir, { recursive: true, force: true });
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
  // One case per counter, each leaving out only that one: a marker missing both
  // would let either half of the check go unproven. Without the check, a missing
  // counter is `[ "" -gt 0 ]` inside an `if`, which bash reads as false: PASS.
  it.each(["replayed", "rejected", "notify_failed", "still_failing", "unmarked", "unreadable"])(
    "reds on a marker missing only %s= — an older CLI cannot pass by omission",
    async (counter) => {
      const line = marker({ rejected: 1, notifyFailed: 1 })
        .split(" ")
        .filter((part) => !part.startsWith(`${counter}=`))
        .join(" ")
        .replace(/rejected=1/, "rejected=0")
        .replace(/notify_failed=1/, "notify_failed=0");
      expect(line).not.toContain(`${counter}=`);
      const r = await runGate(line + "\n");
      expect(r.code).toBe(1);
      expect(r.log).toContain("missing a counter");
    },
  );

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

  const dirs: string[] = [];
  afterEach(async () => {
    resend.configured = true;
    resend.refuses = false;
    resend.sent = 0;
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  /** A migrated scratch store holding one site and `leads` queued dead-letters. */
  async function seed(leads: Array<Record<string, unknown>>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dl-replay-e2e-"));
    dirs.push(dir);
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

  /** The gate's verdict, plus the CLI's own exit code: the gate captures that
   *  code and ignores it, so it is asserted separately. */
  async function replayThroughGate(
    url: string,
  ): Promise<{ code: number; log: string; cliCode: number }> {
    const { runDbCommand } = await import("../../src/cli/commands/db.js");
    const cli = await runDbCommand("replay-deadletters", { url });
    return { ...(await runGate(cli.output + "\n", cli.code)), cliCode: cli.code };
  }

  it("KNOWN-GOOD: an empty queue — last night's real run — is green", async () => {
    const r = await replayThroughGate(await seed([]));
    expect(r.cliCode).toBe(0);
    expect(r.code).toBe(0);
    expect(r.log).toContain(
      "PASS: replayed=0 rejected=0 notify_failed=0 still_failing=0 unmarked=0 unreadable=0",
    );
  });

  it("KNOWN-GOOD: three leads placed and emailed is green", async () => {
    const r = await replayThroughGate(await seed([lead(1), lead(2), lead(3)]));
    expect(resend.sent).toBe(3);
    expect(r.cliCode).toBe(0);
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
    expect(r.log).toContain("rejected:invalid-payload: formType is not a recognized form type");
    expect(r.cliCode).toBe(1);
    expect(r.code).toBe(1);
    expect(r.log).not.toContain("PASS:");
  });

  it("the sweep's input: Resend unconfigured, three leads placed un-emailed, and the gate reds", async () => {
    resend.configured = false;
    const r = await replayThroughGate(await seed([lead(1), lead(2), lead(3)]));
    expect(r.log).toContain("replayed=3 rejected=0 notify_failed=3");
    expect(r.cliCode).toBe(1);
    expect(r.code).toBe(1);
    expect(r.log).not.toContain("PASS:");
  });

  it("a key Resend refuses: three leads placed un-emailed, and the gate reds", async () => {
    resend.refuses = true;
    const r = await replayThroughGate(await seed([lead(1), lead(2), lead(3)]));
    expect(r.log).toContain("replayed=3 rejected=0 notify_failed=3");
    expect(r.cliCode).toBe(1);
    expect(r.code).toBe(1);
  });
});

/**
 * #1615 round 1. A REJECTED or NOTIFY FAILED row is terminal, so the run after
 * the red one is green. The tracking issue is what carries the lead from then
 * on: it has to name the row, and a green run must not close it. Both steps run
 * here with a stubbed `gh` that logs its calls and serves one issue's text.
 */
describe("forms-deadletter-replay — the tracking issue keeps a lost lead (#1615)", () => {
  async function runIssueStep(
    step: string,
    opts: { replayOut?: string; issueText?: string },
  ): Promise<{ code: number; log: string; calls: string }> {
    const dir = await mkdtemp(join(tmpdir(), "dl-replay-issue-"));
    try {
      const bin = join(dir, "bin");
      await mkdir(bin, { recursive: true });
      if (opts.replayOut !== undefined) await writeFile(join(dir, "replay.out"), opts.replayOut);
      await writeFile(join(dir, "issue.txt"), opts.issueText ?? "");
      // `list` finds issue 42; `view` serves its text; every call is logged.
      await writeFile(
        join(bin, "gh"),
        [
          "#!/bin/sh",
          `printf '%s\\n' "$*" >> "${join(dir, "calls.txt")}"`,
          'case "$1 $2" in',
          '  "issue list") echo 42 ;;',
          `  "issue view") cat "${join(dir, "issue.txt")}" ;;`,
          "esac",
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(join(bin, "gh"), 0o755);
      const script = stepRunScript(workflow, step).replace(/\$\{\{[^}]*\}\}/g, "x");
      let code = 0;
      let log = "";
      try {
        const out = await execFileAsync("bash", ["-e", "-c", script], {
          cwd: dir,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
        });
        log = out.stdout + out.stderr;
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string };
        code = err.code ?? 1;
        log = (err.stdout ?? "") + (err.stderr ?? "");
      }
      const calls = await readFile(join(dir, "calls.txt"), "utf-8").catch(() => "");
      return { code, log, calls };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const OPEN = "Open/update the replay-failure tracking issue";
  const CLOSE = "Close the replay-failure issue on recovery";
  const REJECTED_LINE =
    "REJECTED dl_f → rejected:invalid-payload: formType is not a recognized form type. The row is marked replayed";

  it("the issue body names each REJECTED and NOTIFY FAILED row from the run", async () => {
    const r = await runIssueStep(OPEN, {
      replayOut: [
        "replayed dl_a → accepted (sub_1)",
        REJECTED_LINE,
        "NOTIFY FAILED dl_g → accepted (sub_7): the lead is stored",
        marker({ replayed: 2, rejected: 1, notifyFailed: 1 }),
      ].join("\n"),
    });
    expect(r.code).toBe(0);
    expect(r.calls).toContain("REJECTED dl_f");
    expect(r.calls).toContain("NOTIFY FAILED dl_g");
    expect(r.calls).not.toContain("replayed dl_a");
  });

  it("KNOWN-GOOD: a green run closes an issue about an unmarked row", async () => {
    const r = await runIssueStep(CLOSE, {
      issueText: "What this run found:\n\nUNMARKED dl_d: re-ingested as sub_9",
    });
    expect(r.calls).toMatch(/issue close 42/);
  });

  it("a green run does NOT close an issue that names a REJECTED lead", async () => {
    const r = await runIssueStep(CLOSE, { issueText: `What this run found:\n\n${REJECTED_LINE}` });
    expect(r.calls).not.toMatch(/issue close/);
    expect(r.log).toContain("not closing #42");
  });

  it("a green run does NOT close an issue whose COMMENT names a NOTIFY FAILED lead", async () => {
    const r = await runIssueStep(CLOSE, {
      issueText: "first failure body\nNOTIFY FAILED dl_g → accepted (sub_7)",
    });
    expect(r.calls).not.toMatch(/issue close/);
  });
});

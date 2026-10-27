import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * #1613, found by the P1-33 next-5 negative-control sweep. Three daily-reports
 * gates read a failure as green:
 *
 *   1. SEND: the queue holds no approved rows although an approval exists, and
 *      `report --send-ready` said "No reports ready to send." with exit 0.
 *   2. DRAFT: every `site_schedule` write threw; `NEXT_DUE_WRITE` said
 *      `mirror_failed=1` and nothing read it.
 *   3. DIGEST: a corrupt send-log row read as "never sent", so the digest re-sent
 *      as `decision=first` and the gate, which reads only the write, passed.
 *   4. DIGEST: a corrupt snapshot re-badges everything NEW, by design, with no line
 *      saying why.
 *
 * Each case runs the REAL code (the CLI command or the exported function) over a
 * scratch `file:` database, then hands its output and exit code to the step's
 * bash EXTRACTED FROM THE YAML, behind a stubbed `node`. Resend is stubbed: this
 * file sends nothing. Every gate is shown green on last night's real shape first
 * (runs 39560536344 and 39454599845, 2026-10-21 and 2026-10-20).
 */

const resend = vi.hoisted(() => ({ sent: [] as Array<{ subject: string }> }));
vi.mock("../../src/reports/send/resend.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/reports/send/resend.js")>();
  return {
    ...actual,
    defaultResendClient: () => ({
      send: async (input: { subject: string }) => {
        resend.sent.push(input);
        return { messageId: `msg_${resend.sent.length}` };
      },
    }),
  };
});

let workflow: string;
beforeAll(async () => {
  workflow = await readFile(workflowPath("daily-reports.yml"), "utf-8");
});

/** Run one extracted step with a stubbed `node` that prints `out` and exits `code`. */
async function runStep(
  step: string,
  out: string,
  code: number,
  env: Record<string, string>,
): Promise<{ code: number; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), "daily-reports-gate-"));
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
    const { stdout, stderr } = await execFileAsync(
      "bash",
      ["-e", "-c", stepRunScript(workflow, step)],
      {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: join(dir, "github_output"),
          ...env,
        },
      },
    );
    return { code: 0, log: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, log: (err.stdout ?? "") + (err.stderr ?? "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let dir: string;
let url: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "daily-reports-1613-"));
  url = `file:${join(dir, "fleet.db")}`;
  vi.stubEnv("TURSO_DATABASE_URL", url);
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  vi.stubEnv("OPERATOR_EMAIL", "tucker@reddoorla.com");
  // Belt and braces: the module mock above is what stops a send, and an empty
  // key makes any path around it fail instead of reaching Resend.
  vi.stubEnv("RESEND_API_KEY", "");
  resend.sent = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function db() {
  const { openDb } = await import("../../src/db/client.js");
  return openDb({ url });
}

async function seedSites(n: number): Promise<void> {
  const { mirrorSiteInsert } = await import("../../src/db/fleet-state.js");
  const d = await db();
  for (let i = 0; i < n; i++) {
    await mirrorSiteInsert(
      d,
      {
        id: `recSITE${i}`,
        fields: {
          Name: `Site ${i}`,
          Status: "maintained",
          url: `https://site${i}.example.com`,
          "Report recipients (To)": `owner@site${i}.example.com`,
          "maintenence freq": "Monthly",
        },
      },
      "2026-10-01T00:00:00.000Z",
    );
  }
  await d.destroy();
}

async function insertReport(fields: {
  draft_ready: number;
  approved_to_send: number;
  id?: string;
  sent_at?: string | null;
  withdrawn_at?: string | null;
}) {
  const d = await db();
  await d
    .insertInto("reports")
    .values({
      report_id: `Site 0 — Maintenance — ${fields.id ?? "2026-10-21"}`,
      site_id: "recSITE0",
      report_type: "Maintenance",
      period: "2026-10",
      period_start: "2026-09-21",
      period_end: "2026-10-21",
      completed_on: "2026-10-21",
      send_override: 0,
      sent_at: null,
      approved_at: "2026-10-21T15:00:00.000Z",
      ...fields,
      id: fields.id ?? "recREPORT",
    })
    .execute();
  await d.destroy();
}

// ── 1. SEND ───────────────────────────────────────────────────────────────────

const SEND = "Send approved reports";
const SEND_ENV = { MODE: "send", EVENT: "workflow_dispatch", REPO: "reddoorla/x" };

async function sendThroughGate(): Promise<{
  cli: { output: string; code: number };
  step: { code: number; log: string };
}> {
  const { runReportCommand } = await import("../../src/cli/commands/report.js");
  const cli = await runReportCommand(undefined, { sendReady: true });
  return { cli, step: await runStep(SEND, cli.output + "\n", cli.code, SEND_ENV) };
}

describe("#1613 (1) the send gate", () => {
  it("KNOWN-GOOD: nothing approved — the 10-20 send run's shape — stays green", async () => {
    await seedSites(3);
    const { cli, step } = await sendThroughGate();
    expect(cli).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(step.code).toBe(0);
  });

  it("KNOWN-GOOD: a superseded report, neither approved nor draft-ready, stays green", async () => {
    await seedSites(3);
    await insertReport({ draft_ready: 0, approved_to_send: 0 });
    const { cli, step } = await sendThroughGate();
    expect(cli).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(step.code).toBe(0);
  });

  it("KNOWN-GOOD: a drafted report not yet approved stays green", async () => {
    await seedSites(3);
    await insertReport({ draft_ready: 1, approved_to_send: 0 });
    const { cli, step } = await sendThroughGate();
    expect(cli.code).toBe(0);
    expect(step.code).toBe(0);
  });

  it("reds when an approved, unsent report is invisible to the send queue", async () => {
    await seedSites(3);
    // Approved and unsent, but out of the queue's WHERE: the queue reads empty.
    await insertReport({ draft_ready: 0, approved_to_send: 1 });
    const { cli, step } = await sendThroughGate();
    expect(cli.output).toContain("Site 0 — Maintenance — 2026-10-21");
    expect(cli.output).toMatch(/approved.*not in the send queue/i);
    expect(cli.code).toBe(1);
    expect(step.code).toBe(1);
    expect(resend.sent).toHaveLength(0);
  });

  it("KNOWN-GOOD: an approved report IN the queue is not reported as outside it", async () => {
    await seedSites(1);
    await insertReport({ draft_ready: 1, approved_to_send: 1 });
    const { listApprovedUnqueuedReports, listSendableReports } =
      await import("../../src/db/fleet-state.js");
    const d = await db();
    expect((await listSendableReports(d)).map((r) => r.id)).toEqual(["recREPORT"]);
    expect(await listApprovedUnqueuedReports(d)).toEqual([]);
    await d.destroy();
  });

  it("KNOWN-GOOD: approved reports already sent, or withdrawn, are not outside the queue", async () => {
    await seedSites(1);
    await insertReport({
      id: "recSENT",
      draft_ready: 0,
      approved_to_send: 1,
      sent_at: "2026-10-20T16:07:30.000Z",
    });
    await insertReport({
      id: "recWITHDRAWN",
      draft_ready: 0,
      approved_to_send: 1,
      withdrawn_at: "2026-10-20T12:00:00.000Z",
    });
    const { cli, step } = await sendThroughGate();
    expect(cli).toEqual({ output: "No reports ready to send.", code: 0 });
    expect(step.code).toBe(0);
  });

  it("reds when the store holds no sites at all — an empty or wrong database", async () => {
    const { cli, step } = await sendThroughGate();
    expect(cli.output).toMatch(/no sites/i);
    expect(cli.code).toBe(1);
    expect(step.code).toBe(1);
  });
});

// ── 2. DRAFT ──────────────────────────────────────────────────────────────────

const DRAFT = "Draft due reports";
const DRAFT_ENV = { MODE: "draft", PREVIEW_SITE: "", GA_SA_KEY_JSON: "" };
/** Last night's real draft run, 39560536344, verbatim. */
const DRAFT_GOOD = [
  "NEXT_DUE_WRITE wrote=0 skipped=47 failed=0 mirrored=0 mirror_failed=0 mirror_missed=0",
  "No reports due.",
].join("\n");

/** The real `writeNextDueDates`, its console line captured, through the draft gate. */
async function nextDueThroughGate(mirror: "real" | ((siteId: string) => Promise<boolean>)) {
  const { writeNextDueDates } = await import("../../src/cli/commands/report.js");
  const { listSites } = await import("../../src/db/fleet-state.js");
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(String(l)));
  vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(String(l)));
  await seedSites(1);
  const d = await db();
  const sites = await listSites(d);
  await d.destroy();
  const { makeScheduleMirror } = await import("../../src/audits/health-mirror.js");
  const scheduleMirror =
    mirror === "real"
      ? await makeScheduleMirror(async () =>
          (await import("../../src/db/client.js")).openDb({ url }),
        )
      : async (siteId: string) => mirror(siteId);
  await writeNextDueDates(sites, [], new Date("2026-10-21T07:13:00Z"), scheduleMirror);
  vi.restoreAllMocks();
  const out = [...lines, "No reports due."].join("\n");
  return { out, step: await runStep(DRAFT, out + "\n", 0, DRAFT_ENV) };
}

describe("#1613 (2) the draft step reads NEXT_DUE_WRITE", () => {
  it("KNOWN-GOOD: last night's real draft output is green", async () => {
    const r = await runStep(DRAFT, DRAFT_GOOD + "\n", 0, DRAFT_ENV);
    expect(r.code).toBe(0);
    expect(r.log).toContain("PASS: NEXT_DUE_WRITE");
  });

  it("KNOWN-GOOD: a real write that lands is green", async () => {
    const { out, step } = await nextDueThroughGate("real");
    expect(out).toMatch(/NEXT_DUE_WRITE wrote=1 .*mirror_failed=0 mirror_missed=0/);
    const d = await db();
    const row = await d
      .selectFrom("site_schedule")
      .select("next_maintenance_at")
      .where("site_id", "=", "recSITE0")
      .executeTakeFirstOrThrow();
    await d.destroy();
    expect(row.next_maintenance_at).toMatch(/^2026-1[01]-\d\d$/);
    expect(step.code).toBe(0);
  });

  it("the sweep's input: every site_schedule write throws, and the step reds", async () => {
    const { out, step } = await nextDueThroughGate(async () => {
      throw new Error("SERVER_ERROR: HTTP 503");
    });
    expect(out).toMatch(/mirror_failed=1/);
    expect(step.code).toBe(1);
    expect(step.log).toContain("::error::");
  });

  it("reds on a write that matched no site_schedule row", async () => {
    const { out, step } = await nextDueThroughGate(async () => false);
    expect(out).toMatch(/mirror_missed=1/);
    expect(out).toContain("Site 0: no site_schedule row to update");
    expect(step.code).toBe(1);
  });

  it("reds when the draft CLI fails after a clean NEXT_DUE_WRITE line", async () => {
    const r = await runStep(DRAFT, DRAFT_GOOD + "\n", 1, DRAFT_ENV);
    expect(r.code).toBe(1);
    expect(r.log).not.toContain("PASS:");
  });

  it("reds when no NEXT_DUE_WRITE line was printed", async () => {
    const r = await runStep(DRAFT, "No reports due.\n", 0, DRAFT_ENV);
    expect(r.code).toBe(1);
    expect(r.log).toContain("NEXT_DUE_WRITE");
  });

  it("reds on mirror=absent — the schedule writes were never attempted", async () => {
    const r = await runStep(
      DRAFT,
      "NEXT_DUE_WRITE wrote=0 skipped=47 failed=0 mirror=absent\nNo reports due.\n",
      0,
      DRAFT_ENV,
    );
    expect(r.code).toBe(1);
    expect(r.log).toContain("no Turso credentials reached the site_schedule writes");
  });

  it("reds on a line with no mirror counters — a reworded marker cannot pass by omission", async () => {
    const r = await runStep(
      DRAFT,
      "NEXT_DUE_WRITE wrote=0 skipped=47 failed=0\nNo reports due.\n",
      0,
      DRAFT_ENV,
    );
    expect(r.code).toBe(1);
  });

  it("reds on failed= — a site's dates could not be computed or written", async () => {
    const r = await runStep(
      DRAFT,
      "NEXT_DUE_WRITE wrote=0 skipped=46 failed=1 mirrored=0 mirror_failed=0 mirror_missed=0\n",
      0,
      DRAFT_ENV,
    );
    expect(r.code).toBe(1);
  });
});

// ── 3 and 4. DIGEST ───────────────────────────────────────────────────────────

const DIGEST = "Email the operator digest";
const DIGEST_ENV = { MODE: "draft" };

/** One site whose critical vuln has exhausted its auto-fix: the digest emails it. */
async function seedDigestFleet(): Promise<void> {
  const { mirrorSiteInsert } = await import("../../src/db/fleet-state.js");
  const d = await db();
  await mirrorSiteInsert(
    d,
    {
      id: "recVULN",
      fields: {
        Name: "Vuln Co",
        Status: "maintained",
        url: "https://vuln.example.com",
        "Security Vulns Critical": 2,
        "Security Auto-Fix Attempts": 3,
      },
    },
    "2026-10-01T00:00:00.000Z",
  );
  await d.destroy();
}

async function corruptDigestRow(id: "default" | "digest_send_log"): Promise<void> {
  const d = await db();
  await d
    .updateTable("digest_state")
    .set({ snapshot: '{"sentOn":"2026-10-' })
    .where("id", "=", id)
    .execute();
  await d.destroy();
}

/** The real `report --digest`, with its console captured, through the digest gate. */
async function digestThroughGate() {
  const { runReportCommand } = await import("../../src/cli/commands/report.js");
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(String(l)));
  vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(String(l)));
  let cli: { output: string; code: number };
  try {
    cli = await runReportCommand(undefined, { digest: true });
  } finally {
    vi.restoreAllMocks();
  }
  const out = [...lines, cli.output].join("\n");
  return { out, cli, step: await runStep(DIGEST, out + "\n", cli.code, DIGEST_ENV) };
}

describe("#1613 (3) and (4) the digest reads what it read, not only what it wrote", () => {
  it("KNOWN-GOOD: day 1 sends, day 2 unchanged skips, both green", async () => {
    await seedDigestFleet();
    const day1 = await digestThroughGate();
    expect(resend.sent).toHaveLength(1);
    expect(day1.step.code).toBe(0);
    const day2 = await digestThroughGate();
    expect(day2.out).toMatch(/DIGEST_SEND_LOG write=1 decision=unchanged read=ok/);
    expect(resend.sent).toHaveLength(1);
    expect(day2.step.code).toBe(0);
    expect(day2.step.log).not.toContain("::warning::");
  });

  it("KNOWN-GOOD: the very first run, with no rows yet, is green", async () => {
    await seedDigestFleet();
    const r = await digestThroughGate();
    expect(r.out).toMatch(/read=absent/);
    expect(r.out).toContain("DIGEST_STATE_READ snapshot=absent");
    expect(r.step.log).not.toContain("::warning::");
    expect(r.step.code).toBe(0);
  });

  it("the sweep's input (3): a truncated send-log row re-sends as first, and the gate reds", async () => {
    await seedDigestFleet();
    await digestThroughGate();
    await corruptDigestRow("digest_send_log");
    const day2 = await digestThroughGate();
    expect(day2.out).toMatch(/DIGEST_SEND_LOG write=1 decision=first read=corrupt/);
    expect(day2.step.code).toBe(1);
    expect(day2.step.log).toContain("::error::");
  });

  it.each([
    "null",
    "[]",
    '"x"',
    '{"sent_on":"2026-10-20"}',
    // #1639: one known key was enough, so a hand edit read as ok with sent={}.
    '{"sentOn":"2026-10-20","sent":"x"}',
    '{"sent":{}}',
    '{"sentOn":"2026-10-20","sent":{},"readySince":[]}',
    '{"sentOn":7,"sent":{},"readySince":{}}',
    '{"sentOn":null,"sent":[],"readySince":{}}',
    '{"sentOn":null,"sent":null,"readySince":{}}',
    '{"sent":{},"readySince":{}}',
    '{"sentOn":null,"sent":{}}',
  ])(
    "a send-log row of the wrong shape (%s) reads as corrupt, not as a clean first send",
    async (snapshot) => {
      await seedDigestFleet();
      await digestThroughGate();
      const d = await db();
      await d
        .updateTable("digest_state")
        .set({ snapshot })
        .where("id", "=", "digest_send_log")
        .execute();
      const { readDigestSendLogChecked } = await import("../../src/db/digest-state.js");
      expect((await readDigestSendLogChecked(d)).state).toBe("corrupt");
      await d.destroy();
    },
  );

  it.each([
    '{"sentOn":null,"sent":{},"readySince":{}}',
    '{"sentOn":"2026-10-20","sent":{"a":{"metric":1}},"readySince":{"a":"2026-10-19"}}',
  ])("KNOWN-GOOD: a send log of the writer's shape (%s) reads as ok", async (snapshot) => {
    await seedDigestFleet();
    await digestThroughGate();
    const d = await db();
    await d
      .updateTable("digest_state")
      .set({ snapshot })
      .where("id", "=", "digest_send_log")
      .execute();
    const { readDigestSendLogChecked } = await import("../../src/db/digest-state.js");
    expect((await readDigestSendLogChecked(d)).state).toBe("ok");
    await d.destroy();
  });

  it("KNOWN-GOOD: the send log the digest itself writes reads back as ok", async () => {
    await seedDigestFleet();
    await digestThroughGate();
    const d = await db();
    const { readDigestSendLogChecked } = await import("../../src/db/digest-state.js");
    expect((await readDigestSendLogChecked(d)).state).toBe("ok");
    await d.destroy();
  });

  it("the sweep's input (4): a truncated snapshot prints a line, and the gate warns", async () => {
    await seedDigestFleet();
    await digestThroughGate();
    await corruptDigestRow("default");
    const day2 = await digestThroughGate();
    expect(day2.out).toContain("DIGEST_STATE_READ snapshot=corrupt");
    expect(day2.step.code).toBe(0);
    expect(day2.step.log).toMatch(/::warning::.*snapshot/);
  });

  it("a send-log read that throws prints read=failed, and the gate reds", async () => {
    await seedDigestFleet();
    const { runDigest } = await import("../../src/reports/digest.js");
    const { listSites, listAllReports } = await import("../../src/db/fleet-state.js");
    const d = await db();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => void lines.push(String(l)));
    vi.spyOn(console, "warn").mockImplementation((l: string) => void lines.push(String(l)));
    try {
      const cli = await runDigest({
        baseUrl: "https://reddoor-maintenance.netlify.app",
        roster: () => listSites(d),
        allReports: () => listAllReports(d),
        sendLog: {
          read: async () => {
            throw new Error("SERVER_ERROR: HTTP 503");
          },
          write: async () => undefined,
        },
      });
      lines.push(cli.output);
    } finally {
      vi.restoreAllMocks();
      await d.destroy();
    }
    const out = lines.join("\n");
    expect(out).toMatch(/DIGEST_SEND_LOG write=1 decision=first read=failed/);
    const step = await runStep(DIGEST, out + "\n", 0, DIGEST_ENV);
    expect(step.code).toBe(1);
  });

  it("reds on a send-log line with no read= field — an older CLI cannot pass by omission", async () => {
    const r = await runStep(
      DIGEST,
      "DIGEST_STATE_WRITE turso=1 rollup=1\nDIGEST_SEND_LOG write=1 decision=worse\n",
      0,
      DIGEST_ENV,
    );
    expect(r.code).toBe(1);
  });
});

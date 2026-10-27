import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "../build/_helpers/workflow-source.js";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const wf = (f: string) => readFileSync(workflowPath(f), "utf-8");

function runStep(
  file: string,
  step: string,
  env: Record<string, string>,
  fakes: {
    ghOut?: string;
    ghFail?: boolean;
    hhmm?: string;
    day?: string;
    yesterday?: string;
    /** A failed run's job ids, and its job log (#1639). */
    ghJobs?: string;
    ghLog?: string;
    ghLogFail?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "nightly-step-"));
  roots.push(dir);
  const log = join(dir, "calls.log");
  const stub = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  stub("node", `printf 'node %s\\n' "$*" >> "${log}"`);
  writeFileSync(join(dir, "job.log"), fakes.ghLog ?? "");
  stub(
    "gh",
    `printf 'gh %s\\n' "$*" >> "${log}"
${fakes.ghFail ? "exit 1" : ""}
case "$1" in
  api) case "$2" in
    */logs) ${fakes.ghLogFail ? "exit 1" : `cat "${join(dir, "job.log")}"`} ;;
    */jobs) printf '%s\\n' "${fakes.ghJobs ?? ""}" ;;
    *) printf '%s\\n' "${fakes.ghOut ?? "0 0"}" ;;
  esac ;;
  issue) [ "$2" = list ] && printf '%s\\n' "${fakes.ghOut ?? ""}" ;;
esac`,
  );
  stub(
    "date",
    `case "$*" in
  "-u +%H%M") echo "${fakes.hhmm ?? "1700"}" ;;
  "-u +%F") echo "${fakes.day ?? "2026-10-09"}" ;;
  "-u -d yesterday +%F") echo "${fakes.yesterday ?? "2026-10-08"}" ;;
  *) /bin/date "$@" ;;
esac`,
  );
  const script = join(dir, "step.sh");
  writeFileSync(script, stepRunScript(wf(file), step).replace(/\$\{\{[^}]*\}\}/g, "x"));
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
    encoding: "utf-8",
    env: {
      PATH: `${dir}:/usr/bin:/bin`,
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: join(dir, "out"),
      ...env,
    },
  });
  const calls = existsSync(log)
    ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
    : [];
  const output = existsSync(join(dir, "out")) ? readFileSync(join(dir, "out"), "utf-8") : "";
  return { code: r.status, out: r.stdout + r.stderr, calls, output };
}

const sends = (calls: string[]) =>
  calls.filter((c) => c === "node dist/cli/bin.js report --send-ready");

describe("daily-reports — the send step, run as GitHub runs it", () => {
  const SEND = "Send approved reports";
  const base = { MODE: "send", REPO: "reddoorla/reddoor-maintenance" };

  it("a dispatched send run sends", () => {
    const r = runStep("daily-reports.yml", SEND, { ...base, EVENT: "workflow_dispatch" });
    expect(r.code).toBe(0);
    expect(sends(r.calls)).toHaveLength(1);
  });

  it("a draft run never sends", () => {
    const r = runStep("daily-reports.yml", SEND, {
      ...base,
      MODE: "draft",
      EVENT: "workflow_dispatch",
    });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  const fallback = (fakes: Parameters<typeof runStep>[3]) =>
    runStep("daily-reports.yml", SEND, { ...base, EVENT: "schedule" }, fakes);

  it("the fallback cron never sends between 04:00Z and 16:37Z, and marks itself a no-op", () => {
    for (const hhmm of ["0400", "1323", "1606", "1636"]) {
      const r = fallback({ hhmm, ghOut: "0 0" });
      expect(r.code, hhmm).toBe(0);
      expect(r.calls, hhmm).toEqual([]);
      expect(r.output, hhmm).toBe("sent=no-op\n");
    }
  });

  it("after 16:37Z it sends nothing, as a no-op, when a send succeeded today", () => {
    const r = fallback({ hhmm: "1912", ghOut: "1 1" });
    expect(r.code).toBe(0);
    expect(sends(r.calls)).toEqual([]);
    expect(r.output).toBe("sent=no-op\n");
    const query = r.calls.find((c) => c.startsWith("gh api"))!;
    expect(query).toContain("created=>=2026-10-09T00:00:00Z");
    expect(query).toContain("branch=main");
    expect(query).not.toContain("status=");
    expect(query).toContain('"daily-reports send"');
  });

  it("started after midnight, it looks at yesterday's sends", () => {
    const done = fallback({ hhmm: "0030", ghOut: "1 1" });
    expect(sends(done.calls)).toEqual([]);
    expect(done.calls.find((c) => c.startsWith("gh api"))).toContain(
      "created=>=2026-10-08T00:00:00Z",
    );
    const missed = fallback({ hhmm: "0030", ghOut: "0 0" });
    expect(sends(missed.calls)).toHaveLength(1);
    expect(missed.code).toBe(1);
  });

  it("with no send run at all, it sends late, says the clock missed, and fails the run", () => {
    const r = fallback({ hhmm: "1637", ghOut: "0 0" });
    expect(sends(r.calls)).toHaveLength(1);
    expect(r.code).toBe(1);
    expect(r.out).toContain("send-clock-missed");
    expect(r.output).toBe("");
  });

  it("when the clock's send ran but failed, it retries and says so, not that the clock missed", () => {
    const r = fallback({ hhmm: "1900", ghOut: "1 0" });
    expect(sends(r.calls)).toHaveLength(1);
    expect(r.code).toBe(1);
    expect(r.out).toContain("send-run-failed");
    expect(r.out).not.toContain("send-clock-missed");
  });

  // #1639. A stuck approval reds the clock's send run by name every day. The
  // fallback reads that run's log: when the ✗ unqueued-approval line is the only
  // failure in it, a retry cannot help, so it names the report instead.
  const ts = "2026-10-09T16:07:12.3456789Z";
  const stuckLine = async (reportId: string) => {
    const { sendApprovedReports } = await import("../../src/reports/send/orchestrate.js");
    const r = await sendApprovedReports({
      sendable: async () => [],
      approvedUnqueued: async () => [{ id: "rec1", reportId }],
      roster: async () => [],
      loadHeaderPlate: async () => null,
      siteMirror: {} as never,
      reportSentMirror: async () => {},
      claimForSend: async () => true,
      releaseSendClaim: async () => {},
      resend: {} as never,
    });
    expect(r.code).toBe(1);
    return r.output;
  };
  // What GitHub's job log also carries: each step's script, echoed, and the
  // tracking-issue step's body, both quoting the phrase the fallback looks for.
  const echoed = [
    `${ts} ##[group]Run if [ "$MODE" = "draft" ]; then`,
    `${ts}   stuck=$(printf '%s\\n' "$log" | sed -nE 's/^([0-9TZ:.-]+ )?✗ (.+) — approved but not in the send queue.*/\\2/p')`,
    `${ts} A \`✗ … approved but not in the send queue\` line names an approved report`,
  ];
  const jobLog = (...lines: string[]) =>
    [
      ...echoed,
      ...lines.map((l) => `${ts} ${l}`),
      `${ts} ##[error]Process completed with exit code 1.`,
    ].join("\n");

  it("when the clock's run failed only on an unqueued approval, it names the report and does not retry", async () => {
    const line = await stuckLine("Acme Co — Testing — 2026-10");
    const r = fallback({
      hhmm: "1900",
      ghOut: "1 0 98765",
      ghJobs: "4321",
      ghLog: jobLog("✓ sent: BETA-2026-10-M (Beta)", line),
    });
    expect(sends(r.calls)).toEqual([]);
    expect(r.code).toBe(1);
    const first = r.out.split("\n").find((l) => l.startsWith("::error::"))!;
    expect(first).toContain("unqueued-approval");
    expect(first).toContain("Acme Co — Testing — 2026-10");
    expect(first).toMatch(/unapprove it/i);
    expect(r.out).not.toContain("send-run-failed");
    expect(r.calls).toContain(
      "gh api repos/reddoorla/reddoor-maintenance/actions/runs/98765/jobs --jq .jobs[].id",
    );
    expect(r.calls).toContain("gh api repos/reddoorla/reddoor-maintenance/actions/jobs/4321/logs");
  });

  it("two stuck approvals are both named", async () => {
    const r = fallback({
      hhmm: "1900",
      ghOut: "1 0 98765",
      ghJobs: "4321",
      ghLog: jobLog(await stuckLine("ACME-2026-10-M"), await stuckLine("BETA-2026-10-T")),
    });
    expect(sends(r.calls)).toEqual([]);
    expect(r.out).toContain("ACME-2026-10-M; BETA-2026-10-T");
  });

  it("when the clock's run also failed on something else, it retries as send-run-failed", async () => {
    const line = await stuckLine("ACME-2026-10-M");
    for (const other of [
      "✗ BETA-2026-10-M — Resend refused the send",
      "  ✗ sent-stamp mirror failed for BETA-2026-10-M: timeout",
      "  ⚠ launch flip failed for Beta: timeout",
      // Indented, it is not the CLI's line, so it is not taken as a stuck approval.
      "  ✗ BETA-2026-10-M — approved but not in the send queue (not draft-ready)",
    ]) {
      const r = fallback({
        hhmm: "1900",
        ghOut: "1 0 98765",
        ghJobs: "4321",
        ghLog: jobLog(line, other),
      });
      expect(sends(r.calls), other).toHaveLength(1);
      expect(r.out, other).toContain("send-run-failed");
      expect(r.code, other).toBe(1);
    }
  });

  it("the runs query, run through real jq, gives the newest failed send run, or none", () => {
    const script = stepRunScript(wf("daily-reports.yml"), SEND);
    const jq = /--jq '([^']+)'\) \|\| \{/.exec(script)?.[1];
    expect(jq).toContain("failure");
    const runs = (...rs: Array<[number, string, string | null]>) =>
      JSON.stringify({
        workflow_runs: rs.map(([id, mode, conclusion]) => ({
          id,
          display_title: `daily-reports ${mode}`,
          conclusion,
        })),
      });
    const q = (json: string) =>
      spawnSync("jq", ["-r", jq!], { input: json, encoding: "utf-8" }).stdout.trim();
    // GitHub lists runs newest first.
    expect(
      q(runs([300, "send", "failure"], [250, "draft", "failure"], [200, "all", "failure"])),
    ).toBe("2 0 300");
    expect(q(runs([400, "send", null], [300, "send", "failure"]))).toBe("2 0 300");
    expect(q(runs([300, "send", "cancelled"], [200, "send", "success"]))).toBe("2 1");
    expect(q(runs([300, "send", "cancelled"]))).toBe("1 0");
  });

  it("when the failed run's log cannot be read, or holds no unqueued line, it retries as before", () => {
    for (const fakes of [
      { ghJobs: "4321", ghLogFail: true },
      { ghJobs: "4321", ghLog: jobLog("✗ BETA-2026-10-M — Resend refused the send") },
      { ghJobs: "" },
    ]) {
      const r = fallback({ hhmm: "1900", ghOut: "1 0 98765", ...fakes });
      expect(sends(r.calls)).toHaveLength(1);
      expect(r.out).toContain("send-run-failed");
      expect(r.code).toBe(1);
    }
  });

  it("when the runs cannot be read, it sends nothing and fails", () => {
    const r = fallback({ hhmm: "1900", ghFail: true });
    expect(sends(r.calls)).toEqual([]);
    expect(r.code).toBe(1);
  });

  it("a no-op fallback cannot close a failure issue", () => {
    const close = (
      wf("daily-reports.yml").split(
        "- name: Close the daily-reports-failing issue on recovery",
      )[1] ?? ""
    ).split("\n")[2];
    expect(close).toContain("steps.send.outputs.sent != 'no-op'");
    expect(wf("daily-reports.yml")).toMatch(/- name: Send approved reports\n\s+id: send\n/);
  });

  it("the run-name the fallback reads is the one the workflow writes", () => {
    expect(wf("daily-reports.yml")).toContain(
      "run-name: ${{ inputs.preview_site && format('daily-reports preview {0}', inputs.preview_site) || format('daily-reports {0}', inputs.mode || 'send') }}",
    );
  });
});

describe("daily-reports — the draft and digest guards, run", () => {
  it("a send run drafts nothing and sends no digest; a draft run does both", () => {
    const draftInSend = runStep("daily-reports.yml", "Draft due reports", {
      MODE: "send",
      PREVIEW_SITE: "",
    });
    expect(draftInSend.code).toBe(0);
    expect(draftInSend.calls).toEqual([]);
    const draft = runStep("daily-reports.yml", "Draft due reports", {
      MODE: "draft",
      PREVIEW_SITE: "",
    });
    expect(draft.calls).toContain("node dist/cli/bin.js report --due");
    const digestInSend = runStep("daily-reports.yml", "Email the operator digest", {
      MODE: "send",
    });
    expect(digestInSend.code).toBe(0);
    expect(digestInSend.calls).toEqual([]);
    const digest = runStep("daily-reports.yml", "Email the operator digest", { MODE: "draft" });
    expect(digest.calls[0]).toBe("node dist/cli/bin.js report --digest");
  });
});

describe("daily-reports — a green run closes only the failure issues of the modes it ran", () => {
  const CLOSE = "Close the daily-reports-failing issue on recovery";
  const searched = (calls: string[]) =>
    calls
      .filter((c) => c.startsWith("gh issue list"))
      .map((c) => /Daily reports run failing \((\w+)\)/.exec(c)?.[1]);

  it("send closes send, draft closes draft, all closes every mode", () => {
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "send" }).calls)).toEqual([
      "send",
    ]);
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "draft" }).calls)).toEqual([
      "draft",
    ]);
    expect(searched(runStep("daily-reports.yml", CLOSE, { RUN_MODE: "all" }).calls)).toEqual([
      "all",
      "draft",
      "send",
    ]);
  });

  it("the open step files under the same per-mode title", () => {
    const r = runStep(
      "daily-reports.yml",
      "Open/update the daily-reports-failing tracking issue",
      { MODE: "draft", JOB_STATUS: "failure" },
      { ghOut: "" },
    );
    expect(
      r.calls.some((c) => c.includes("issue create --title Daily reports run failing (draft)")),
    ).toBe(true);
  });
});

describe("fleet-nightly — the step hands the conductor its ref and inputs", () => {
  const STEP = "Dispatch the nightlies in order";
  const argv = (env: Record<string, string>) =>
    runStep("fleet-nightly.yml", STEP, env).calls.filter((c) => c.startsWith("node "));

  it("always passes the ref, and only, force when set", () => {
    expect(argv({ REF: "main", ONLY: "", FORCE: "false" })).toEqual([
      "node scripts/nightly-conductor.mjs --ref main",
    ]);
    expect(argv({ REF: "claude/x", ONLY: "fleet-smoke", FORCE: "true" })).toEqual([
      "node scripts/nightly-conductor.mjs --ref claude/x --only fleet-smoke --force",
    ]);
  });
});

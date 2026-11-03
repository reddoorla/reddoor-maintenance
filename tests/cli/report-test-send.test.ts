/** `report --test-send`, `--test-verdict` and `--test-streak` through the
 *  command entry point, against a real (temp-file) database with the Resend
 *  transport, the render and the header plate mocked. */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResendSendInput } from "../../src/reports/send/resend.js";

const dir = mkdtempSync(join(tmpdir(), "test-send-"));
let n = 0;
const state = vi.hoisted(() => ({ url: "", sent: [] as unknown[] }));

vi.mock("../../src/db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/client.js")>()),
  readDbConfig: () => ({ url: state.url }),
}));
vi.mock("../../src/db/header-images.js", () => ({
  loadHeaderImage: async () => ({ bytes: new Uint8Array([1]) }),
}));
vi.mock("../../src/reports/send/render-from-row.js", () => ({
  renderReportFromRow: vi.fn(async () => ({
    html: "<p>body</p>",
    attachments: [],
    subject: "Your report",
  })),
}));
vi.mock("../../src/reports/send/resend.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/send/resend.js")>()),
  defaultResendClient: () => ({
    send: async (input: unknown) => {
      state.sent.push(input);
      return { messageId: `re_${state.sent.length}` };
    },
  }),
}));

import { openDb } from "../../src/db/client.js";
import { insertReportRow, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { renderReportFromRow } from "../../src/reports/send/render-from-row.js";
import { runReportCommand } from "../../src/cli/commands/report.js";

const OPERATOR = "op@example.test";

async function seed() {
  state.url = `file:${join(dir, `db-${++n}.sqlite`)}`;
  state.sent = [];
  vi.mocked(renderReportFromRow).mockClear();
  const db = await openDb({ url: state.url });
  await mirrorSiteInsert(
    db,
    {
      id: "site_1",
      fields: {
        Name: "Acme Co",
        "Report recipients (To)": "owner@client.test",
        "Report recipients (CC)": "cc@client.test",
        "Point of contact": "poc@client.test",
      },
    },
    "2026-11-01T00:00:00.000Z",
  );
  await insertReportRow(db, {
    id: "report_1",
    fields: {
      Site: ["site_1"],
      "Report ID": "ACME-2026-10-M",
      "Report type": "Maintenance",
      Period: "2026-10",
      "Period start": "2026-10-01",
      "Draft ready": true,
      "Approved to send": false,
    },
  });
  return db;
}

const reportsRow = async (db: Awaited<ReturnType<typeof openDb>>) =>
  db.selectFrom("reports").selectAll().where("id", "=", "report_1").executeTakeFirstOrThrow();

beforeEach(() => {
  process.env.OPERATOR_EMAIL = OPERATOR;
});
afterAll(() => {
  delete process.env.OPERATOR_EMAIL;
  rmSync(dir, { recursive: true, force: true });
});

describe("report --test-send", () => {
  it("refuses --to, --cc and --bcc before sending anything", async () => {
    const db = await seed();
    for (const flag of ["to", "cc", "bcc"] as const) {
      await expect(
        runReportCommand(undefined, { testSend: "report_1", [flag]: "owner@client.test" }),
      ).rejects.toMatchObject({
        exitCode: 2,
        message: expect.stringContaining(`--${flag} is refused`),
      });
    }
    expect(state.sent).toHaveLength(0);
    expect(await db.selectFrom("report_test_sends").selectAll().execute()).toHaveLength(0);
  });

  it("sends the row's renderReportFromRow output to operatorEmail() alone and logs one row", async () => {
    const db = await seed();
    const out = await runReportCommand(undefined, { testSend: "report_1" });
    expect(out.code).toBe(0);
    expect(out.output).toMatch(
      /^REPORT_TEST_SEND send=ts_\S+ report=report_1 site=Acme Co to=op@example.test message=re_1/,
    );

    expect(renderReportFromRow).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderReportFromRow).mock.calls[0]![1].id).toBe("report_1");

    expect(state.sent).toHaveLength(1);
    const p = state.sent[0] as ResendSendInput;
    expect(p.to).toEqual([OPERATOR]);
    expect(p.cc).toBeUndefined();
    expect(p.subject).toBe("[TEST] Your report");
    expect(JSON.stringify(p)).not.toContain("client.test");

    const rows = await db.selectFrom("report_test_sends").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      report_id: "report_1",
      sent_to: OPERATOR,
      verdict: "awaiting",
      resend_message_id: "re_1",
    });
  });

  it("never stamps the report: the reports row is unchanged, sent_at and approval included", async () => {
    const db = await seed();
    const before = await reportsRow(db);
    await runReportCommand(undefined, { testSend: "report_1" });
    const after = await reportsRow(db);
    expect(after).toEqual(before);
    expect(after.sent_at).toBeNull();
  });

  it("takes a slug for the site's newest unsent report", async () => {
    await seed();
    const out = await runReportCommand(undefined, { testSend: "acme-co" });
    expect(out.output).toContain("report=report_1");
  });
});

describe("report --test-verdict and --test-streak", () => {
  it("records the operator's verdicts and prints the streak they give", async () => {
    await seed();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const out = await runReportCommand(undefined, { testSend: "report_1" });
      ids.push(/send=(\S+)/.exec(out.output)![1]!);
    }
    expect((await runReportCommand(undefined, { testStreak: true })).output).toMatch(
      /^TEST_SEND_STREAK streak=0 sends=3 awaiting=3/,
    );

    await runReportCommand("header is blank", { testVerdict: ids[0]! });
    await runReportCommand("clean", { testVerdict: ids[1]! });
    const last = await runReportCommand("clean", { testVerdict: ids[2]! });
    expect(last.output).toBe(`TEST_SEND_VERDICT send=${ids[2]} clean`);
    const streak = await runReportCommand(undefined, { testStreak: true });
    expect(streak.output.split("\n")[0]).toBe("TEST_SEND_STREAK streak=2 sends=3 awaiting=0");
    expect(streak.output).toContain(`${ids[0]} report=report_1 problem: header is blank`);
  });

  it("refuses a blank verdict and names an unknown send", async () => {
    await seed();
    await expect(runReportCommand("  ", { testVerdict: "ts_x" })).rejects.toMatchObject({
      exitCode: 2,
    });
    const out = await runReportCommand("clean", { testVerdict: "ts_x" });
    expect(out).toEqual({ output: "No test send ts_x", code: 1 });
  });

  it("refuses being combined with another mode", async () => {
    await expect(
      runReportCommand(undefined, { testStreak: true, sendReady: true }),
    ).rejects.toMatchObject({ exitCode: 2 });
    await expect(
      runReportCommand(undefined, { testSend: "report_1", testStreak: true }),
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});

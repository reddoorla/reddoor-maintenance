/**
 * #647: the send batch's sent-stamp mirror (`report --send-ready`) hands
 * `mirrorReportPatch`'s row count to `mirrorWrite`, so a stamp for a report row
 * Turso never held is `missed` rather than a green no-op. `mirrorWrite`'s own
 * strict/loose behaviour on a `false` result is proven in
 * `tests/db/mirror-write-freeze.test.ts`; this suite pins only the WIRING —
 * that the closure the CLI builds actually surfaces the count — independent of
 * which way the freeze constant points.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mirrorReportInsert } from "../../src/db/fleet-state.js";
import type { OrchestrateOptions } from "../../src/reports/send/orchestrate.js";

let captured: OrchestrateOptions | null = null;
vi.mock("../../src/reports/send/orchestrate.js", () => ({
  sendApprovedReports: vi.fn(async (opts: OrchestrateOptions) => {
    captured = opts;
    return { output: "", code: 0 };
  }),
}));
vi.mock("../../src/db/site-mirror.js", () => ({
  makeSiteMirror: async () => ({
    created: async () => {},
    health: async () => {},
    site: async () => {},
  }),
}));
// The closure opens its own connection; point it at one shared in-memory db.
vi.mock("../../src/db/client.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/client.js")>();
  return { ...real, readDbConfig: () => ({ url: ":memory:" }), openDb: vi.fn() };
});
// Record what the CLI's `run` closure RESOLVES to, whatever the switch says.
const results: unknown[] = [];
vi.mock("../../src/db/freeze.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/freeze.js")>();
  return {
    ...real,
    mirrorWrite: vi.fn(async (_label: string, run: () => Promise<unknown>) => {
      results.push(await run());
    }),
  };
});
import { openDb } from "../../src/db/client.js";
const { openDb: realOpenDb } =
  await vi.importActual<typeof import("../../src/db/client.js")>("../../src/db/client.js");
import { runReportCommand } from "../../src/cli/commands/report.js";

beforeEach(() => {
  captured = null;
  results.length = 0;
});

describe("report --send-ready: the sent-stamp mirror surfaces the row count", () => {
  it("resolves true for a row Turso holds and false for one it never did", async () => {
    const db = await realOpenDb({ url: ":memory:" });
    vi.mocked(openDb).mockResolvedValue(db);
    await mirrorReportInsert(db, { id: "recHELD", fields: { "Report ID": "R1" } });

    await runReportCommand(undefined, { sendReady: true });
    expect(captured?.reportSentMirror).toBeTypeOf("function");

    await captured!.reportSentMirror!("recHELD", new Date("2026-09-15T00:00:00Z"), "msg_1");
    await captured!.reportSentMirror!("recGHOST", new Date("2026-09-15T00:00:00Z"), null);
    expect(results).toEqual([true, false]);

    const stamped = await db
      .selectFrom("reports")
      .select(["sent_at", "resend_message_id"])
      .where("id", "=", "recHELD")
      .executeTakeFirst();
    expect(stamped).toEqual({ sent_at: "2026-09-15T00:00:00.000Z", resend_message_id: "msg_1" });
  });
});

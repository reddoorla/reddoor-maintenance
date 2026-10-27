/**
 * #647: the send batch's sent-stamp mirror (`report --send-ready`) hands
 * `mirrorReportPatch`'s row count to `mirrorWrite`, so a stamp for a report row
 * Turso never held is `missed` rather than a green no-op. `mirrorWrite`'s own
 * behaviour on a `false` result is proven in `tests/db/mirror-write.test.ts`;
 * this suite pins only the WIRING — that the closure the CLI builds actually
 * surfaces the count.
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
    health: async () => {},
    site: async () => {},
  }),
}));
// The closure opens its own connection; point it at one shared in-memory db.
vi.mock("../../src/db/client.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/client.js")>();
  return { ...real, readDbConfig: () => ({ url: ":memory:" }), openDb: vi.fn() };
});
// Record what the CLI's `run` closure RESOLVES to, before mirrorWrite judges it.
const results: unknown[] = [];
vi.mock("../../src/db/mirror-write.js", async (orig) => {
  const real = await orig<typeof import("../../src/db/mirror-write.js")>();
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

    await captured!.reportSentMirror("recHELD", new Date("2026-09-15T00:00:00Z"), "msg_1");
    await captured!.reportSentMirror("recGHOST", new Date("2026-09-15T00:00:00Z"), null);
    expect(results).toEqual([true, false]);

    const stamped = await db
      .selectFrom("reports")
      .select(["sent_at", "resend_message_id"])
      .where("id", "=", "recHELD")
      .executeTakeFirst();
    expect(stamped).toEqual({ sent_at: "2026-09-15T00:00:00.000Z", resend_message_id: "msg_1" });
  });

  it("the stamp never touches Delivery status, and the 409 replay keeps the original message id", async () => {
    const db = await realOpenDb({ url: ":memory:" });
    vi.mocked(openDb).mockResolvedValue(db);
    await mirrorReportInsert(db, {
      id: "recLANDED",
      fields: {
        "Report ID": "R2",
        "Delivery status": "delivered",
        "Resend message ID": "msg_original",
      },
    });

    await runReportCommand(undefined, { sendReady: true });
    await captured!.reportSentMirror("recLANDED", new Date("2026-09-16T00:00:00Z"), null);

    const row = await db
      .selectFrom("reports")
      .select(["sent_at", "resend_message_id", "delivery_status"])
      .where("id", "=", "recLANDED")
      .executeTakeFirst();
    expect(row).toEqual({
      sent_at: "2026-09-16T00:00:00.000Z",
      resend_message_id: "msg_original",
      delivery_status: "delivered",
    });
  });
});

describe("report --send-ready: the claim before Resend is the real conditioned write (#1262)", () => {
  it("claims a sendable row and refuses one unapproved since the queue was read", async () => {
    const db = await realOpenDb({ url: ":memory:" });
    vi.spyOn(db, "destroy").mockResolvedValue(undefined);
    vi.mocked(openDb).mockResolvedValue(db);
    await mirrorReportInsert(db, {
      id: "recSENDABLE",
      fields: {
        "Report ID": "R3",
        "Draft ready": true,
        "Approved to send": true,
        "Approved At": "2026-10-08T15:11:12.000Z",
      },
    });
    await mirrorReportInsert(db, {
      id: "recUNAPPROVED",
      fields: { "Report ID": "R4", "Draft ready": true, "Approved to send": false },
    });

    await runReportCommand(undefined, { sendReady: true });
    const at = new Date("2026-10-09T16:07:03Z");
    expect(await captured!.claimForSend("recSENDABLE", "2026-10-08T15:11:12.000Z", at)).toBe(true);
    expect(await captured!.claimForSend("recUNAPPROVED", null, at)).toBe(false);
    await captured!.releaseSendClaim("recUNAPPROVED");

    const rows = await db
      .selectFrom("reports")
      .select(["id", "send_started_at"])
      .where("id", "in", ["recSENDABLE", "recUNAPPROVED"])
      .orderBy("id")
      .execute();
    expect(rows).toEqual([
      { id: "recSENDABLE", send_started_at: "2026-10-09T16:07:03.000Z" },
      { id: "recUNAPPROVED", send_started_at: null },
    ]);
  });
});

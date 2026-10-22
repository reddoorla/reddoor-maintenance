import { describe, it, expect } from "vitest";
import { BUSY_ATTEMPTS, isBusy, retryOnBusy } from "../../src/db/busy.js";

/** The SQLITE_BUSY retry shared by the prospect reservation and `runMigrations`
 *  (#1674). The reservation's own behaviour through it is pinned in
 *  `prospect-audit-reservation.test.ts`. */
describe("isBusy", () => {
  it.each([
    ["the libSQL code", Object.assign(new Error("x"), { code: "SQLITE_BUSY" })],
    ["the WAL snapshot code", Object.assign(new Error("x"), { code: "SQLITE_BUSY_SNAPSHOT" })],
    ["the message with its code", new Error("SQLITE_BUSY: database is locked")],
    // Seen from a child process in migrate-processes.test.ts: no code, no prefix.
    ["the bare message", new Error("database is locked")],
  ])("is true for %s", (_, err) => expect(isBusy(err)).toBe(true));

  it.each([
    ["a syntax error", new Error('SQLITE_ERROR: near "x": syntax error')],
    ["a constraint", Object.assign(new Error("x"), { code: "SQLITE_CONSTRAINT_PRIMARYKEY" })],
    ["an I/O error", new Error("SQLITE_IOERR: disk I/O error")],
    ["null", null],
  ])("is false for %s", (_, err) => expect(isBusy(err)).toBe(false));
});

describe("retryOnBusy", () => {
  const busy = () => Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

  it("returns the first answer after BUSY attempts", async () => {
    let calls = 0;
    const out = await retryOnBusy(async () => {
      if (++calls < 3) throw busy();
      return "ok";
    });
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("lets BUSY through after its attempts", async () => {
    let calls = 0;
    await expect(
      retryOnBusy(async () => {
        calls++;
        throw busy();
      }, 3),
    ).rejects.toThrow(/locked/);
    expect(calls).toBe(3);
  });

  it("defaults to BUSY_ATTEMPTS, the reservation's 8", () => {
    expect(BUSY_ATTEMPTS).toBe(8);
  });

  it("throws any other error on the first attempt", async () => {
    let calls = 0;
    await expect(
      retryOnBusy(async () => {
        calls++;
        throw new Error("SQLITE_IOERR: disk I/O error");
      }),
    ).rejects.toThrow(/IOERR/);
    expect(calls).toBe(1);
  });
});

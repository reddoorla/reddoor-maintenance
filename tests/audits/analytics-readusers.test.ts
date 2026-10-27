import { describe, it, expect, vi, afterEach } from "vitest";

/** defaultReadUsers' window and hostname filter, with the GA client replaced
 *  by a recorder. No network: the client module itself is mocked. */
const calls = vi.hoisted(() => [] as Array<{ query: unknown; start: Date; end: Date }>);
vi.mock("../../src/reports/ga/client.js", () => ({
  fetchPeriodUsers: async (query: unknown, start: Date, end: Date) => {
    calls.push({ query, start, end });
    return { current: 12, previous: 3 };
  },
}));

import { defaultReadUsers } from "../../src/audits/analytics.js";

afterEach(() => vi.unstubAllEnvs());

describe("defaultReadUsers", () => {
  it("reads exactly the requested window, on exactly the given hostnames", async () => {
    vi.stubEnv("GA_SUBJECT", "a@example.invalid, b@example.invalid");
    vi.stubEnv("GA_SA_KEY_PATH", "/nonexistent/key.json");
    const read = await defaultReadUsers();
    expect(read.readUsers).toBeTypeOf("function");
    const out = await read.readUsers!("111111111", 7, ["example.com", "www.example.com"]);
    expect(out).toEqual({ ok: true, users: 12 });
    const call = calls.at(-1)!;
    expect(call.query).toEqual({
      propertyId: "111111111",
      subjects: ["a@example.invalid", "b@example.invalid"],
      keyPath: "/nonexistent/key.json",
      hostnames: ["example.com", "www.example.com"],
    });
    expect(call.end.getTime() - call.start.getTime()).toBe(7 * 86_400_000);
  });
});

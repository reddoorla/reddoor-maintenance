import { describe, it, expect, vi } from "vitest";
import { updateLaunched } from "../../../src/reports/airtable/websites.js";

vi.mock("../../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

function fakeBase() {
  const calls: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const base = (() => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      calls.push(...recs);
      return recs;
    },
  })) as unknown as Parameters<typeof updateLaunched>[0];
  return { base, calls };
}

describe("updateLaunched", () => {
  it("writes Status=maintained + Launched at", async () => {
    const { base, calls } = fakeBase();
    await updateLaunched(base, "rec1", "2026-06-12T00:00:00Z");
    expect(calls[0]!.fields).toMatchObject({
      Status: "maintained",
      "Launched at": "2026-06-12T00:00:00Z",
    });
  });
});

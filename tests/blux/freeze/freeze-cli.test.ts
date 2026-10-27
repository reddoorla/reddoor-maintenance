import { describe, it, expect } from "vitest";
import { runBluxCommand } from "../../../src/cli/commands/blux.js";

describe("blux freeze CLI wiring", () => {
  it("errors (code 1) without an export directory", async () => {
    const r = await runBluxCommand("freeze", undefined, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("needs a Blux export directory");
  });

  it("advertises freeze + migrate-frozen in the unknown-action help", async () => {
    const r = await runBluxCommand("bogus", undefined, {});
    expect(r.code).toBe(1);
    expect(r.output).toContain("freeze");
    expect(r.output).toContain("migrate-frozen");
  });
});

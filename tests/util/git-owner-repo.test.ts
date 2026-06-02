import { describe, it, expect } from "vitest";
import { parseOwnerRepo } from "../../src/util/git.js";

describe("parseOwnerRepo", () => {
  it("parses https URLs with and without .git", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds.git")).toBe(
      "tucksravin/erpfunds",
    );
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds")).toBe("tucksravin/erpfunds");
  });
  it("parses scp-style git@ URLs", () => {
    expect(parseOwnerRepo("git@github.com:tucksravin/erpfunds.git")).toBe("tucksravin/erpfunds");
  });
  it("strips a trailing slash", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds/")).toBe("tucksravin/erpfunds");
  });
  it("returns null for an unparseable remote", () => {
    expect(parseOwnerRepo("not a url")).toBeNull();
  });
});

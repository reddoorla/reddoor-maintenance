import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { lhciInvocation, LHCI_VERSION } from "../../src/audits/lighthouse.js";

const CONFIG = "/tmp/reddoor-lhci-test/lighthouserc.json";

describe("lhciInvocation (which lhci the audit runs)", () => {
  it("runs the lhci this package resolves, under node, never a bare npx fetch", () => {
    const inv = lhciInvocation(CONFIG);
    expect(inv.cmd).toBe(process.execPath);
    expect(inv.args[0]).toMatch(/[\\/]@lhci[\\/]cli[\\/].*cli\.js$/);
    expect(inv.args.slice(1)).toEqual(["autorun", `--config=${CONFIG}`]);
  });

  it("falls back to npx pinned to LHCI_VERSION when the package cannot be resolved", () => {
    const inv = lhciInvocation(CONFIG, () => {
      throw new Error("Cannot find module '@lhci/cli/package.json'");
    });
    expect(inv.cmd).toBe("npx");
    expect(inv.args).toEqual([
      "--yes",
      `@lhci/cli@${LHCI_VERSION}`,
      "autorun",
      `--config=${CONFIG}`,
    ]);
  });

  it("pins LHCI_VERSION to the range package.json declares for @lhci/cli", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as { devDependencies: Record<string, string> };
    expect(LHCI_VERSION).toBe(pkg.devDependencies["@lhci/cli"]);
    // Sanity: the resolver used by the default path is the same module the pin names.
    expect(createRequire(import.meta.url).resolve("@lhci/cli/package.json")).toBeTruthy();
  });
});

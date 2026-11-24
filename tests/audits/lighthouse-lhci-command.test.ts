import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { lhciInvocation, LHCI_VERSION, satisfiesCaret } from "../../src/audits/lighthouse.js";

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

  it("passes over a resolved lhci outside LHCI_VERSION (a fleet site's own 0.15) for the pinned npx", () => {
    // Review round 1 of #2281: @lhci/cli is a devDependency here, so on a fleet
    // site the resolver walks up to the site's own copy, which onboarding pins
    // at ^0.15.1 (baseline-versions.ts). Running it would break the pin.
    const pkgDir = mkdtempSync(join(tmpdir(), "lhci-site-"));
    mkdirSync(join(pkgDir, "src"));
    const pkgPath = join(pkgDir, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ version: "0.15.1", bin: { lhci: "./src/cli.js" } }));
    expect(lhciInvocation(CONFIG, () => pkgPath, {})).toEqual({
      cmd: "npx",
      args: ["--yes", `@lhci/cli@${LHCI_VERSION}`, "autorun", `--config=${CONFIG}`],
    });

    // Control: the same package at a version inside the range is run directly.
    writeFileSync(pkgPath, JSON.stringify({ version: "0.16.4", bin: { lhci: "./src/cli.js" } }));
    expect(lhciInvocation(CONFIG, () => pkgPath, {})).toEqual({
      cmd: process.execPath,
      args: [join(pkgDir, "src/cli.js"), "autorun", `--config=${CONFIG}`],
    });
  });

  it("reads a caret range the way npm does, for the ranges a pin uses", () => {
    expect(satisfiesCaret("0.16.0", "^0.16.0")).toBe(true);
    expect(satisfiesCaret("0.16.9", "^0.16.0")).toBe(true);
    expect(satisfiesCaret("0.15.9", "^0.16.0")).toBe(false);
    expect(satisfiesCaret("0.17.0", "^0.16.0")).toBe(false);
    expect(satisfiesCaret("0.16.0-beta.1", "^0.16.0")).toBe(false);
    expect(satisfiesCaret("1.4.0", "^1.2.0")).toBe(true);
    expect(satisfiesCaret("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesCaret("1.1.9", "^1.2.0")).toBe(false);
    expect(satisfiesCaret(undefined, "^0.16.0")).toBe(false);
  });

  it("runs REDDOOR_LHCI_BIN first when it is set, so a test can supply its own lhci", () => {
    const inv = lhciInvocation(CONFIG, undefined, { REDDOOR_LHCI_BIN: "/tmp/fake-lhci" });
    expect(inv).toEqual({ cmd: "/tmp/fake-lhci", args: ["autorun", `--config=${CONFIG}`] });
  });

  it("ignores an empty REDDOOR_LHCI_BIN", () => {
    const inv = lhciInvocation(CONFIG, undefined, { REDDOOR_LHCI_BIN: "" });
    expect(inv.cmd).toBe(process.execPath);
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

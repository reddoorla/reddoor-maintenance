import { describe, it, expect } from "vitest";
import playwrightA11yConfig, {
  a11yRoutes,
  playwrightA11yConfig as named,
} from "../../src/configs/playwright-a11y.js";

describe("configs/playwright-a11y", () => {
  it("default equals named export", () => {
    expect(playwrightA11yConfig).toBe(named);
  });

  it("exports the canonical starter routes", () => {
    expect(a11yRoutes).toEqual([
      { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
      { path: "/dev/animate-in", name: "animate-in demo" },
    ]);
  });

  it("uses port 5173 and the starter's webServer command", () => {
    expect(playwrightA11yConfig.use?.baseURL).toBe("http://localhost:5173");
    expect(playwrightA11yConfig.webServer).toMatchObject({
      command: "pnpm vite:dev",
      url: "http://localhost:5173/dev/a11y-fixtures",
    });
  });

  it("runs the chromium project only (matches starter)", () => {
    expect(playwrightA11yConfig.projects).toHaveLength(1);
    expect(playwrightA11yConfig.projects?.[0]?.name).toBe("chromium");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultShooter } from "../../../src/reports/header-image/capture.js";

/** Every call the fake page saw, in order, so assertions read off real calls
 *  rather than a re-implementation of the navigation. */
type Call = { name: string; args: unknown[] };

const calls: Call[] = [];
let closed = false;
/** Set per-test to make the best-effort idle wait reject, the way a site with a
 *  chat widget or analytics polling makes it reject in production. */
let idleRejects = false;

const SHOT = new Uint8Array([137, 80, 78, 71]);

function record(name: string, ...args: unknown[]): void {
  calls.push({ name, args });
}

function calledWith(name: string): Call | undefined {
  return calls.find((c) => c.name === name);
}

vi.mock("@playwright/test", () => {
  const page = {
    goto: async (...args: unknown[]) => {
      record("goto", ...args);
    },
    waitForLoadState: async (...args: unknown[]) => {
      record("waitForLoadState", ...args);
      if (idleRejects) throw new Error("page.waitForLoadState: Timeout 3000ms exceeded.");
    },
    evaluate: async (...args: unknown[]) => {
      record("evaluate", ...args);
    },
    waitForTimeout: async (...args: unknown[]) => {
      record("waitForTimeout", ...args);
    },
    screenshot: async (...args: unknown[]) => {
      record("screenshot", ...args);
      return SHOT;
    },
  };
  return {
    chromium: {
      launch: async () => ({
        newPage: async (...args: unknown[]) => {
          record("newPage", ...args);
          return page;
        },
        close: async () => {
          closed = true;
          record("close");
        },
      }),
    },
  };
});

async function shoot(): Promise<Uint8Array> {
  const s = await defaultShooter();
  return s.shoot({
    url: "https://acme.com/",
    width: 1600,
    height: 1000,
    deviceScaleFactor: 2,
    settleMs: 2500,
  });
}

describe("reports/header-image defaultShooter navigation", () => {
  beforeEach(() => {
    calls.length = 0;
    closed = false;
    idleRejects = false;
  });

  it("navigates on the load milestone, never on networkidle", async () => {
    await shoot();
    const goto = calledWith("goto");
    expect(goto?.args[0]).toBe("https://acme.com/");
    expect(goto?.args[1]).toMatchObject({ waitUntil: "load" });
    // Regression guard: 4 of 14 live fleet sites never reach network idle, so
    // gating the navigation on it made them permanently uncapturable.
    expect(goto?.args[1]).not.toMatchObject({ waitUntil: "networkidle" });
  });

  it("still attempts network idle on a short budget after load", async () => {
    await shoot();
    const idle = calledWith("waitForLoadState");
    expect(idle?.args[0]).toBe("networkidle");
    expect(idle?.args[1]).toMatchObject({ timeout: 3000 });
    expect(calls.map((c) => c.name).indexOf("waitForLoadState")).toBeGreaterThan(
      calls.map((c) => c.name).indexOf("goto"),
    );
  });

  it("captures the screenshot even when the idle wait times out", async () => {
    idleRejects = true;
    const bytes = await shoot();
    // Assert the reject path was actually taken, so this can't pass vacuously
    // against an implementation that skips the idle wait altogether.
    expect(calledWith("waitForLoadState")).toBeDefined();
    expect(bytes).toEqual(SHOT);
    expect(calledWith("screenshot")).toBeDefined();
    // The font and settle waits still run — swallowing the idle timeout must not
    // skip what actually covers webfonts and entrance animations.
    expect(calledWith("evaluate")).toBeDefined();
    expect(calledWith("waitForTimeout")?.args[0]).toBe(2500);
  });

  it("closes the browser on the idle-timeout path", async () => {
    idleRejects = true;
    await shoot();
    expect(calledWith("waitForLoadState")).toBeDefined();
    expect(closed).toBe(true);
  });
});

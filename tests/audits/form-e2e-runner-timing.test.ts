import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The live runner's waits, pinned without a browser. The browser fixture file
// (form-e2e-live-runner.test.ts) passes small values through these options to
// run fast, so it can no longer see the production defaults; this file is what
// fails if a default drifts or the options stop reaching the calls.

type Call = { name: string; opts: unknown };
const calls: Call[] = [];
const timeoutOf = (name: string) =>
  calls.filter((c) => c.name === name).map((c) => (c.opts as { timeout?: number })?.timeout);

vi.mock("@playwright/test", () => {
  const first = {
    click: async (opts: unknown) => void calls.push({ name: "click", opts }),
    waitFor: async (opts: unknown) => void calls.push({ name: "waitFor", opts }),
    textContent: async () => null,
  };
  const page = {
    on: () => {},
    goto: async () => ({ ok: () => true }),
    locator: (selector: string) => ({
      count: async () => (selector === ".cf-turnstile" ? 0 : 1),
      first: () => first,
    }),
    fill: async () => {},
    evaluate: async (expr: string) => {
      if (expr.includes(`form [name="testMode"]`)) return true;
      if (expr.includes("let wiped")) return 0;
      return [];
    },
    waitForLoadState: async (_state: string, opts: unknown) =>
      void calls.push({ name: "waitForLoadState", opts }),
    waitForFunction: async (_expr: string, _arg: unknown, opts: unknown) =>
      void calls.push({ name: "waitForFunction", opts }),
    waitForTimeout: async (ms: number) => void calls.push({ name: "waitForTimeout", opts: ms }),
    waitForResponse: async (_pred: unknown, opts: unknown) => {
      calls.push({ name: "waitForResponse", opts });
      return { status: () => 200, text: async () => "" };
    },
  };
  return {
    chromium: {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page }),
        close: async () => {},
      }),
    },
  };
});

const { defaultFormRunner } = await import("../../src/audits/form-e2e.js");

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: true, forms: { testMode: true, turnstile: false } })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const run = async (opts?: Parameters<typeof defaultFormRunner>[0]) => {
  const runner = await defaultFormRunner(opts);
  return runner.submit({
    baseUrl: "https://fixture.test/",
    testMode: true,
    testSitekey: "1x00000000000000000000AA",
  });
};

describe("defaultFormRunner waits", () => {
  it("keeps the production defaults: 1200 ms settle, 5 s hydration cap, 30 s submit waits", async () => {
    const out = await run();
    expect(out).toMatchObject({ formPresent: true, success: true });
    expect(calls.filter((c) => c.name === "waitForTimeout").map((c) => c.opts)).toEqual([1200]);
    expect(timeoutOf("waitForLoadState")).toEqual([5000]);
    expect(timeoutOf("waitForFunction")[0]).toBeGreaterThan(4000);
    expect(timeoutOf("waitForResponse")).toEqual([30_000]);
    expect(timeoutOf("click")).toEqual([30_000]);
    expect(timeoutOf("waitFor")).toEqual([30_000]);
  });

  it("passes the test-only values through to every wait they name", async () => {
    // 3100 is deliberately not a multiple of 500 or 200, so a submit cap derived
    // from either of the other two values cannot pass by coincidence (#1470).
    await run({ hydrationTimeoutMs: 500, settleMs: 200, submitTimeoutMs: 3100 });
    expect(calls.filter((c) => c.name === "waitForTimeout").map((c) => c.opts)).toEqual([200]);
    expect(timeoutOf("waitForLoadState")).toEqual([500]);
    expect(timeoutOf("waitForFunction")[0]).toBeLessThanOrEqual(500);
    expect(timeoutOf("waitForResponse")).toEqual([3100]);
    expect(timeoutOf("click")).toEqual([3100]);
    expect(timeoutOf("waitFor")).toEqual([3100]);
  });

  // A settle of 0 is a real value, not "unset": it must reach the wait as 0,
  // not fall back to the 1200 ms default (`??`, never `||`) (#1470).
  it("passes a settleMs of 0 through rather than falling back to the default", async () => {
    await run({ settleMs: 0 });
    expect(calls.filter((c) => c.name === "waitForTimeout").map((c) => c.opts)).toEqual([0]);
  });
});

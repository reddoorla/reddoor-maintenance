import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

/**
 * The regression this file exists for.
 *
 * Playwright re-evaluates the config file in every worker process, not only the
 * main one. When the port was allocated per evaluation, each worker got a
 * different one: the main process started the dev server on its port, every
 * worker aimed `baseURL` at another, and the whole run failed with
 * ERR_CONNECTION_REFUSED against ports nothing was ever serving.
 *
 * It reached every fleet site that consumes this base without setting
 * REDDOOR_SMOKE_PORT, and it did NOT reach `audit --only a11y`, which writes its
 * own config and never loads this file — which is why nothing caught it.
 *
 * Workers are forked and inherit the parent environment, so pinning the
 * allocation into REDDOOR_SMOKE_PORT is what makes every later evaluation agree.
 */

const ORIGINAL = process.env.REDDOOR_SMOKE_PORT;

beforeEach(() => {
  delete process.env.REDDOOR_SMOKE_PORT;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.REDDOOR_SMOKE_PORT;
  else process.env.REDDOOR_SMOKE_PORT = ORIGINAL;
});

/** Fresh module instance, so each load re-runs the module-scope resolution the
 *  way a newly forked worker process would. `resetModules` is what makes this a
 *  real second evaluation rather than a cache hit — without it the assertion
 *  passes whatever the code does. */
async function loadConfig() {
  vi.resetModules();
  const mod = await import("../../src/configs/playwright-a11y.js");
  return mod.default as { use?: { baseURL?: string }; webServer?: { url?: string } };
}

function portOf(baseURL: string | undefined): string {
  return new URL(baseURL ?? "http://localhost:0").port;
}

describe("playwright-a11y — port stability", () => {
  it("pins its allocated port into the environment", async () => {
    const cfg = await loadConfig();
    const pinned = process.env.REDDOOR_SMOKE_PORT;
    expect(pinned).toMatch(/^\d+$/);
    expect(portOf(cfg.use?.baseURL)).toBe(pinned);
  });

  // The actual failure mode: a second evaluation is a worker process starting
  // up, and it must land on the port the dev server is already bound to.
  it("gives every later evaluation the same port", async () => {
    const first = await loadConfig();
    const second = await loadConfig();
    expect(portOf(second.use?.baseURL)).toBe(portOf(first.use?.baseURL));
  });

  it("points the readiness probe at the same port as baseURL", async () => {
    const cfg = await loadConfig();
    expect(portOf(cfg.webServer?.url)).toBe(portOf(cfg.use?.baseURL));
  });

  it("still lets an externally allocated port win", async () => {
    process.env.REDDOOR_SMOKE_PORT = "41234";
    const cfg = await loadConfig();
    expect(portOf(cfg.use?.baseURL)).toBe("41234");
    expect(process.env.REDDOOR_SMOKE_PORT).toBe("41234");
  });
});

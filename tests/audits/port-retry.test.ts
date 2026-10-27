import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const picks = vi.hoisted(() => ({ queue: [] as number[], served: [] as number[] }));

vi.mock("../../src/util/free-port.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/free-port.js")>();
  return {
    ...actual,
    findFreePort: vi.fn(async () => {
      const port = picks.queue.shift() ?? (await actual.findFreePort());
      picks.served.push(port);
      return port;
    }),
  };
});

import { lighthouseAudit } from "../../src/audits/lighthouse.js";
import { smokeAudit } from "../../src/audits/smoke.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import {
  PORT_ATTEMPTS,
  findFreePorts,
  portInUse,
  withPortRetry,
} from "../../src/util/port-retry.js";

/**
 * Squatters bind the way the fixture servers do (`listen(port)`, every
 * interface), so the server an audit starts on a squatted port gets the
 * kernel's real EADDRINUSE and Node's real message for it.
 */
const squatters: Server[] = [];

async function squat(): Promise<number> {
  const s = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, () => resolve());
  });
  squatters.push(s);
  const addr = s.address();
  if (typeof addr !== "object" || !addr) throw new Error("squat: no address");
  return addr.port;
}

type Bound = { ok: true; close: () => Promise<void> } | { ok: false; stack: string };

async function bind(port: number): Promise<Bound> {
  const s = createServer();
  return new Promise((resolve) => {
    s.once("error", (err) => resolve({ ok: false, stack: String((err as Error).stack) }));
    s.listen(port, () =>
      resolve({ ok: true, close: () => new Promise<void>((r) => s.close(() => r())) }),
    );
  });
}

afterEach(async () => {
  picks.queue.length = 0;
  picks.served.length = 0;
  await Promise.all(squatters.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/**
 * Stands in for `npx @lhci/cli autorun`: binds the port its
 * `startServerCommand` names, and on failure prints what lhci's cli.js prints
 * when the server command exits (its own stack, then the server's stderr).
 */
function lhciThatBinds(serverStderr?: (port: number) => string): SpawnFn & { ports: number[] } {
  const ports: number[] = [];
  const spawn = async (_cmd: string, args: readonly string[], opts?: { cwd?: string }) => {
    const configArg = args.find((a) => a.startsWith("--config="))!;
    const config = JSON.parse(await readFile(configArg.slice("--config=".length), "utf-8"));
    const port = Number(/--port (\d+)/.exec(config.ci.collect.startServerCommand)![1]);
    ports.push(port);
    const lhciStack = "Error: Command exited with code 1\n    at ChildProcess.exitListener";
    if (serverStderr) return { code: 1, stdout: "", stderr: `${lhciStack}\n${serverStderr(port)}` };
    const bound = await bind(port);
    if (!bound.ok) return { code: 1, stdout: "", stderr: `${lhciStack}\n${bound.stack}` };
    const dir = join(opts?.cwd ?? process.cwd(), ".lighthouseci");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "lhr-1.json"),
      JSON.stringify({
        requestedUrl: config.ci.collect.url[0],
        finalUrl: config.ci.collect.url[0],
        categories: { performance: { score: 0.9 }, accessibility: { score: 1 } },
      }),
    );
    await writeFile(join(dir, "assertion-results.json"), "[]");
    await bound.close();
    return { code: 0, stdout: "", stderr: "" };
  };
  return Object.assign(spawn, { ports });
}

/**
 * Stands in for `pnpm test:smoke`: binds REDDOOR_SMOKE_PORT, and on failure
 * prints what Playwright prints when a vite webServer under `--strictPort`
 * cannot have its port.
 */
function smokeThatBinds(serverStderr?: (port: number) => string): SpawnFn & { ports: number[] } {
  const ports: number[] = [];
  const spawn = async (
    _cmd: string,
    args: readonly string[],
    opts?: { env?: Record<string, string | undefined> },
  ) => {
    if (args[0] !== "test:smoke") return { code: 0, stdout: "", stderr: "" };
    const port = Number(opts?.env?.REDDOOR_SMOKE_PORT);
    ports.push(port);
    const notStarted = "Error: Process from config.webServer was not able to start. Exit code: 1";
    if (serverStderr)
      return { code: 1, stdout: "", stderr: `${serverStderr(port)}\n${notStarted}` };
    const bound = await bind(port);
    if (!bound.ok) {
      return {
        code: 1,
        stdout: "",
        stderr: `[WebServer] error when starting dev server:\n[WebServer] Error: Port ${port} is already in use\n${notStarted}`,
      };
    }
    await bound.close();
    return { code: 0, stdout: "1 passed", stderr: "" };
  };
  return Object.assign(spawn, { ports });
}

async function smokeSite(): Promise<{ path: string; name: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-smoke-port-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "acme", scripts: { "test:smoke": "playwright test smoke" } }),
  );
  await mkdir(join(dir, "node_modules"));
  return { path: dir, name: "acme" };
}

describe("portInUse", () => {
  it("reads Node's EADDRINUSE, vite's --strictPort refusal and Playwright's, for that port only", () => {
    expect(portInUse("Error: listen EADDRINUSE: address already in use :::40937", 40937)).toBe(
      true,
    );
    expect(
      portInUse("Error: listen EADDRINUSE: address already in use 127.0.0.1:40937", 40937),
    ).toBe(true);
    expect(portInUse("[WebServer] Error: Port 40937 is already in use", 40937)).toBe(true);
    expect(
      portInUse(
        "Error: http://localhost:40937/_app/version.json is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.",
        40937,
      ),
    ).toBe(true);
  });

  it("does not read a collision on another port, or a port that only starts with ours", () => {
    expect(portInUse("WebSocket server error: Port 24678 is already in use", 40937)).toBe(false);
    expect(portInUse("Error: listen EADDRINUSE: address already in use :::409370", 40937)).toBe(
      false,
    );
    expect(portInUse("Error: listen EADDRINUSE: address already in use :::4093", 40937)).toBe(
      false,
    );
    expect(portInUse("Error: listen EACCES: permission denied :::40937", 40937)).toBe(false);
    expect(portInUse("", 40937)).toBe(false);
  });
});

describe("withPortRetry", () => {
  it("stops after PORT_ATTEMPTS collisions, each on a fresh port", async () => {
    picks.queue.push(1001, 1002, 1003, 1004, 1005);
    const tried: number[][] = [];
    const result = await withPortRetry(
      1,
      async (ports) => {
        tried.push(ports);
        if (tried.length > 10) throw new Error("withPortRetry: retried without a bound");
        return "collided";
      },
      () => true,
    );
    expect(PORT_ATTEMPTS).toBe(3);
    expect(result).toBe("collided");
    expect(tried).toEqual([[1001], [1002], [1003]]);
  });

  it("hands out distinct ports when the allocator repeats one", async () => {
    picks.queue.push(2001, 2001, 2002);
    expect(await findFreePorts(2)).toEqual([2001, 2002]);
  });
});

describe("audits retry their server on a fresh port when the one picked was taken (P1-27)", () => {
  it("lighthouse: a squatted first port still produces a scored result", async () => {
    const taken = await squat();
    picks.queue.push(taken);
    const spawn = lhciThatBinds();
    const result = await lighthouseAudit({ site: { path: (await smokeSite()).path }, spawn });
    expect(result.status).toBe("pass");
    expect(spawn.ports).toHaveLength(2);
    expect(spawn.ports[0]).toBe(taken);
    expect(spawn.ports[1]).not.toBe(taken);
  });

  it("smoke: a squatted first port still produces a verdict", async () => {
    const taken = await squat();
    picks.queue.push(taken);
    const spawn = smokeThatBinds();
    const result = await smokeAudit({ site: await smokeSite(), spawn });
    expect(result.status).toBe("pass");
    expect(spawn.ports).toHaveLength(2);
    expect(spawn.ports[0]).toBe(taken);
    expect(spawn.ports[1]).not.toBe(taken);
  });

  it("gives up after three collisions and says which port was taken", async () => {
    const taken = [await squat(), await squat(), await squat(), await squat()];
    picks.queue.push(...taken);
    const spawn = lhciThatBinds();
    const result = await lighthouseAudit({ site: { path: (await smokeSite()).path }, spawn });
    expect(spawn.ports).toEqual(taken.slice(0, 3));
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("EADDRINUSE");
  });

  it("lighthouse: a server that fails for any other reason fails at once", async () => {
    const spawn = lhciThatBinds(() => "Error: Cannot find module 'vite'");
    const result = await lighthouseAudit({ site: { path: (await smokeSite()).path }, spawn });
    expect(spawn.ports).toHaveLength(1);
    expect(result.status).toBe("fail");
  });

  it("smoke: a server that fails for any other reason fails at once", async () => {
    const spawn = smokeThatBinds(() => "[WebServer] Error: Cannot find module 'vite'");
    const result = await smokeAudit({ site: await smokeSite(), spawn });
    expect(spawn.ports).toHaveLength(1);
    expect(result.status).toBe("fail");
  });

  it("smoke: a collision on a port the audit did not pick is the site's failure, not retried", async () => {
    const spawn = smokeThatBinds(
      () => "[WebServer] WebSocket server error: Port 24678 is already in use",
    );
    const result = await smokeAudit({ site: await smokeSite(), spawn });
    expect(spawn.ports).toHaveLength(1);
    expect(result.status).toBe("fail");
  });
});

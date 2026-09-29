import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSpawn, SpawnTimeoutError } from "../../../src/audits/util/spawn.js";
import { findFreePort } from "../../../src/util/free-port.js";
import { killLeftover, reapedWithin, waitForPid } from "./orphan-probe.js";

/**
 * #969 against the real runner. Playwright starts its webServer through
 * launchProcess with `detached: true`, so the server leads a process group of
 * its own, and the runner has no SIGTERM handler, so the teardown that would
 * stop the server never runs. A timeout used to leave the dev server holding
 * its port with no parent. The spec never resolves and never asks for `page`,
 * so no browser is launched.
 */

const REPO_NODE_MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve("@playwright/test/cli");

const SERVER = `
import http from "node:http";
import { writeFileSync } from "node:fs";
http.createServer((_q, r) => r.end("ok")).listen(Number(process.env.PORT), "127.0.0.1", () =>
  writeFileSync("server.pid", String(process.pid)),
);
`;

const CONFIG = (port: number) => `
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: /hang\\.spec\\.mjs$/,
  timeout: 0,
  webServer: {
    command: ${JSON.stringify(`${JSON.stringify(process.execPath)} server.mjs`)},
    url: "http://127.0.0.1:${port}/",
    reuseExistingServer: false,
  },
});
`;

const SPEC = `
import { test } from "@playwright/test";
test("hang", () => new Promise(() => {}));
`;

describe("defaultSpawn timeout reaps Playwright's detached webServer", () => {
  it("leaves no dev server holding the port after a timed-out playwright test", async () => {
    const site = await mkdtemp(join(tmpdir(), "reddoor-spawn-pw-"));
    const port = await findFreePort();
    await writeFile(join(site, "server.mjs"), SERVER);
    await writeFile(join(site, "playwright.config.mjs"), CONFIG(port));
    await writeFile(join(site, "hang.spec.mjs"), SPEC);
    await symlink(REPO_NODE_MODULES, join(site, "node_modules"), "dir");

    let settled = false;
    const outcome = defaultSpawn(
      process.execPath,
      [PLAYWRIGHT_CLI, "test", "--config=playwright.config.mjs", "--reporter=line"],
      { cwd: site, env: { ...process.env, PORT: String(port) }, timeoutMs: 15_000 },
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    void outcome.finally(() => (settled = true));
    const serverPid = await waitForPid(join(site, "server.pid"), () => settled);
    const err = await outcome;
    try {
      expect(
        serverPid,
        "fixture broken: the webServer was not up before the timeout",
      ).toBeDefined();
      expect(err).toBeInstanceOf(SpawnTimeoutError);
      expect(await reapedWithin(port, serverPid as number, 4000)).toBe(true);
    } finally {
      killLeftover(serverPid);
      await rm(site, { recursive: true, force: true });
    }
  });
});

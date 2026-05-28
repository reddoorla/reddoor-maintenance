import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:net";
import { findFreePort, withFreePort } from "../../src/util/free-port.js";

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

describe("util/free-port", () => {
  it("returns a port in the valid TCP range", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65_536);
  });

  it("returns a port that is actually free at allocation time", async () => {
    const port = await findFreePort();
    const s = await listenOn(port);
    await new Promise<void>((r) => s.close(() => r()));
  });

  it("returns distinct ports across rapid successive calls", async () => {
    // Sanity check that we're not handing out a stale single value. Even if
    // the OS happens to recycle, batch unique-count should be > 1 in practice.
    const ports = await Promise.all([
      findFreePort(),
      findFreePort(),
      findFreePort(),
      findFreePort(),
    ]);
    expect(new Set(ports).size).toBeGreaterThan(1);
  });

  describe("withFreePort", () => {
    it("rewrites the port while preserving the path", () => {
      expect(withFreePort("http://localhost:5173/dev/a11y-fixtures", 41234)).toBe(
        "http://localhost:41234/dev/a11y-fixtures",
      );
    });

    it("preserves the query string", () => {
      expect(withFreePort("http://localhost:5173/x?foo=bar&baz=1", 9090)).toBe(
        "http://localhost:9090/x?foo=bar&baz=1",
      );
    });

    it("forces hostname to localhost even when input uses a different host", () => {
      // The audit always serves locally; preventing a stale custom host on
      // package.json#reddoor.lighthouseUrl from breaking the spawned server.
      expect(withFreePort("http://example.com:8080/foo", 41234)).toBe("http://localhost:41234/foo");
    });

    it("handles URLs with no explicit port", () => {
      expect(withFreePort("http://localhost/", 41234)).toBe("http://localhost:41234/");
    });
  });
});

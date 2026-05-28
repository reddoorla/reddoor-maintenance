import { createServer } from "node:net";

/**
 * Bind an ephemeral TCP port, capture it, release it, and return it. Used
 * by the lighthouse and a11y audits to pick a port the audit's own dev
 * server will then bind via `--strictPort`.
 *
 * Why: vite's default behavior on a busy port is to bump to the next free
 * one (5173 → 5174 → …). When zombie vite processes (or any squatter) are
 * already on 5173, the audit's spawned vite lands on a higher port, but
 * the audit tooling (lhci, playwright) still probes 5173 — hits the
 * zombie — gets stale 404s — fails with "no manifest written" / "no
 * results written (exit 1)". Reproduced on caltex 2026-05-28 with 10
 * orphaned vite processes accumulated across this repo, the reports repo,
 * and caltex itself. Allocating a free port up front + `--strictPort`
 * makes the audit immune to port collisions.
 *
 * TOCTOU note: the small window between close() and the spawned vite
 * binding is theoretically racy, but in practice we run one audit at a
 * time and the OS keeps the port free for re-use. If vite still fails to
 * bind under `--strictPort`, the audit fails loudly — that's the correct
 * outcome (vs. silently auditing the wrong server).
 */
export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("findFreePort: could not determine assigned port from socket"));
      }
    });
  });
}

/**
 * Swap the port (and force `localhost` host) on a URL so it points at the
 * audit's freshly-allocated dev server. Preserves the path + any query.
 * Used to rewrite the lighthouse `url` so lhci probes the correct port.
 */
export function withFreePort(url: string, port: number): string {
  const u = new URL(url);
  u.hostname = "localhost";
  u.port = String(port);
  return u.toString();
}

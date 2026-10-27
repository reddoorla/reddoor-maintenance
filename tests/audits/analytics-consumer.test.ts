import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A fleet site's install, as far as the analytics audit is concerned: the GA
 * client libraries are devDependencies of this package, so a site never has
 * them. Importing `src/reports/ga/client.js` there throws. This file makes that
 * import throw exactly the way a site's resolver does, and runs the audit
 * through its DEFAULT deps — the path a bare `reddoor-maint audit` takes.
 *
 * Before round six the client was imported before the credentials check, so
 * this reached "unexpected error" on every site, with or without credentials.
 */
const clientImports = vi.hoisted(() => ({ n: 0 }));
vi.mock("../../src/reports/ga/client.js", () => {
  clientImports.n += 1;
  throw new Error("Cannot find package 'google-auth-library' imported from dist/cli/bin.js");
});

import { analyticsAudit, defaultReadUsers } from "../../src/audits/analytics.js";

async function tagged(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rd-consumer-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "src", "hooks.client.ts"),
    `initAnalytics({ measurementId: "G-AAAAAAAAAA", productionHost: "www.example.com" });`,
  );
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the analytics audit in a site install (no GA client libraries)", () => {
  it("never imports the GA client when there are no credentials", async () => {
    vi.stubEnv("GA_SUBJECT", "");
    const before = clientImports.n;
    expect(await defaultReadUsers()).toEqual({
      readUsers: undefined,
      reason: "no GA credentials here",
    });
    expect(clientImports.n).toBe(before);
  });

  it("says the libraries are absent, rather than crashing, when credentials exist", async () => {
    vi.stubEnv("GA_SUBJECT", "subject@example.invalid");
    const read = await defaultReadUsers();
    expect(read.readUsers).toBeUndefined();
    expect("reason" in read && read.reason).toContain("not installed");
  });

  it("runs to a verdict through its default deps, with and without credentials", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    for (const subject of ["", "subject@example.invalid"]) {
      vi.stubEnv("GA_SUBJECT", subject);
      const res = await analyticsAudit({
        site: {
          path: await tagged(),
          deployedUrl: "https://www.example.com/",
          ga4PropertyId: "111111111",
        },
      });
      expect(res.status).toBe("pass");
      expect(res.summary).not.toContain("unexpected");
      expect(res.summary).toContain("Not checked:");
    }
  });
});

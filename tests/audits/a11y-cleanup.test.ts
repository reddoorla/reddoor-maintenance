import { describe, it, expect, vi } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Force the post-mkdtemp setup to fail: the audit allocates a free port AFTER
// creating its transient spec dir inside the checkout. If setup throws (or the
// parent is killed) between mkdtemp and the spawn try-block, the spec dir is
// orphaned — untracked files in a repo whose self-updating CI checks for a
// clean tree. (morning-brief 2026-06-10 MEDIUM-D; recurred from 06-05 M3.)
// This isolated file mocks free-port so the main a11y suite's port-hardening
// assertions keep exercising the real allocator.
vi.mock("../../src/util/free-port.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/free-port.js")>();
  return {
    ...actual,
    findFreePort: vi.fn(async () => {
      throw new Error("no free port available");
    }),
  };
});

import { a11yAudit } from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

async function tmpSite(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reddoor-a11y-cleanup-"));
}

describe("audits/a11y temp-dir cleanup (MEDIUM-D)", () => {
  it("removes the transient spec dir even when setup fails after mkdtemp", async () => {
    const cwd = await tmpSite();
    // spawn must never be reached (findFreePort throws first); a harmless stub
    // keeps a regression that DOES reach it off the network.
    const spawn: SpawnFn = async () => ({ code: 0, stdout: "", stderr: "" });
    await expect(a11yAudit({ site: { path: cwd }, spawn })).rejects.toThrow(/free port/);
    const leftovers = (await readdir(cwd)).filter((e) => e.startsWith(".reddoor-a11y-spec-"));
    expect(leftovers).toEqual([]);
  });
});

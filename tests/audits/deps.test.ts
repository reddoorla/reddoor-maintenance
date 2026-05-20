import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { depsAudit } from "../../src/audits/deps.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");

describe("audits/deps", () => {
  it("pristine-starter passes", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter") },
    });
    expect(result.audit).toBe("deps");
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/in line with baseline|no drift/i);
  });

  it("drifted-configs warns on bumped svelte/vite (ahead of baseline)", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "drifted-configs") },
    });
    expect(result.status).toBe("warn");
    const details = result.details as Array<{ pkg: string; drift: string }>;
    const svelte = details.find((d) => d.pkg === "svelte");
    const vite = details.find((d) => d.pkg === "vite");
    expect(svelte?.drift).toBe("newer");
    expect(vite?.drift).toBe("newer");
  });

  it("pre-svelte5 fails on major-version lag for svelte", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pre-svelte5") },
    });
    expect(result.status).toBe("fail");
    const details = result.details as Array<{ pkg: string; drift: string }>;
    const svelte = details.find((d) => d.pkg === "svelte");
    expect(svelte?.drift).toBe("major");
  });

  it("uses site.name in result when provided", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter"), name: "labeled-site" },
    });
    expect(result.site).toBe("labeled-site");
  });

  it("falls back to site.path when site.name is missing", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter") },
    });
    expect(result.site).toBe(resolve(fixtures, "pristine-starter"));
  });
});

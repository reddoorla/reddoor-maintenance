import { describe, it, expect } from "vitest";
import { securityAudit } from "../../src/audits/security.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import type { DependabotAlert } from "../../src/github/gh-rest.js";

function fakeSpawn(
  byCmd: Record<string, { code: number; stdout: string; stderr?: string }>,
): SpawnFn {
  return async (cmd) => {
    const r = byCmd[cmd];
    if (!r) throw new Error(`ENOENT: ${cmd}`);
    return { code: r.code, stdout: r.stdout, stderr: r.stderr ?? "" };
  };
}

/** An injectable Dependabot fetcher returning a fixed list (or throwing, to exercise fallback). */
function fakeDependabot(alerts: DependabotAlert[] | Error): {
  listAlerts: (repo: string) => Promise<DependabotAlert[]>;
} {
  return {
    listAlerts: async () => {
      if (alerts instanceof Error) throw alerts;
      return alerts;
    },
  };
}

describe("audits/security", () => {
  it("returns pass when pnpm audit reports zero vulnerabilities", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
  });

  it("returns warn for moderate-only vulnerabilities", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 2, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("warn");
  });

  it("returns fail for any high or critical", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("fail");
  });

  it("falls back to npm audit when pnpm is missing", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        npm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/^npm audit/);
  });

  it("returns skip when neither pnpm nor npm is available", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("skip");
  });

  it("normalizes pnpm severity 'info' to 'low' (not the moderate default)", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            advisories: {
              "1": {
                id: 1,
                title: "informational notice",
                module_name: "harmless",
                severity: "info",
              },
            },
            metadata: { vulnerabilities: { low: 1, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    const details = result.details as { advisories: Array<{ severity: string }> };
    expect(details.advisories[0]?.severity).toBe("low");
  });

  it("npm transitive vulnerabilities deduplicate to their root advisory", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        // pnpm missing in this scenario; falls through to npm.
        npm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 1, critical: 0 } },
            vulnerabilities: {
              tmp: {
                name: "tmp",
                severity: "high",
                via: [
                  {
                    title: "tmp allows arbitrary write",
                    url: "https://advisory/123",
                  },
                ],
              },
              // Transitive: @lhci/cli is vulnerable because it depends on tmp.
              "@lhci/cli": {
                name: "@lhci/cli",
                severity: "high",
                via: ["tmp"],
              },
              // Another transitive layer.
              "outer-pkg": {
                name: "outer-pkg",
                severity: "high",
                via: ["@lhci/cli"],
              },
            },
          }),
        },
      }),
    });
    const details = result.details as {
      advisories: Array<{ module: string; title: string }>;
    };
    // Even though three entries appear in npm's vulnerabilities map, they
    // all root in the same advisory. We surface exactly one canonical entry.
    expect(details.advisories).toHaveLength(1);
    expect(details.advisories[0]?.module).toBe("tmp");
    expect(details.advisories[0]?.title).toMatch(/arbitrary/);
  });

  it("falls through to npm audit when pnpm returns its no-lockfile error envelope", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        // pnpm responds with an error envelope and no metadata at all when
        // the project has no pnpm-lock.yaml.
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            error: {
              code: "ERR_PNPM_AUDIT_NO_LOCKFILE",
              message: "No pnpm-lock.yaml found",
            },
          }),
        },
        // npm picks up the project's package-lock.json and reports cleanly.
        npm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/^npm audit/);
  });

  it("falls through to npm audit when pnpm output lacks metadata.vulnerabilities", async () => {
    // Defensive: any pnpm output that doesn't include the count summary
    // means the audit didn't actually run successfully.
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: { code: 1, stdout: JSON.stringify({ actions: [], advisories: {} }) },
        npm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 2, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toMatch(/^npm audit/);
  });

  it("treats metadata.vulnerabilities = {} as a tool error, not a clean pass (false-pass guard)", async () => {
    // Regression: previously `!parsed.metadata?.vulnerabilities` evaluated
    // to false on an empty object, so a malformed audit output with
    // `{ metadata: { vulnerabilities: {} } }` passed the existence check.
    // counts defaulted to 0 and the result was silently "pass". Reject the
    // empty-object shape as a tool error so we fall through to the other
    // audit tool (or surface "skip" if neither tool produced real data).
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 0,
          stdout: JSON.stringify({ metadata: { vulnerabilities: {} } }),
        },
        // No npm → falls through to skip.
      }),
    });
    expect(result.status).toBe("skip");
  });

  it("returns skip when both pnpm and npm fail to audit", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            error: { code: "ERR_PNPM_AUDIT_NO_LOCKFILE", message: "No pnpm-lock.yaml" },
          }),
        },
        npm: { code: 1, stdout: JSON.stringify({ error: { code: "ENOLOCK" } }) },
      }),
    });
    expect(result.status).toBe("skip");
    expect(result.summary).toMatch(/pnpm/);
    expect(result.summary).toMatch(/npm/);
  });

  it("surfaces advisory titles and modules from pnpm output", async () => {
    const result = await securityAudit({
      site: { path: "/fake" },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            advisories: {
              "1109537": {
                id: 1109537,
                title: "tmp allows arbitrary temporary file write via symlink",
                module_name: "tmp",
                severity: "low",
                vulnerable_versions: "<0.2.4",
                cves: ["CVE-2025-54798"],
              },
              "9999999": {
                id: 9999999,
                title: "example high-severity issue",
                module_name: "example",
                severity: "high",
                vulnerable_versions: "*",
                cves: [],
              },
            },
            metadata: { vulnerabilities: { low: 1, moderate: 0, high: 1, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("fail");
    const details = result.details as {
      counts: { low: number; high: number };
      advisories: Array<{ module: string; severity: string; title: string }>;
    };
    expect(details.counts.high).toBe(1);
    expect(details.advisories).toHaveLength(2);
    const tmp = details.advisories.find((a) => a.module === "tmp");
    expect(tmp?.severity).toBe("low");
    expect(tmp?.title).toMatch(/tmp/);
  });
});

describe("audits/security — Dependabot source (preferred when gitRepo + token)", () => {
  const alerts: DependabotAlert[] = [
    {
      package: "shell-quote",
      severity: "critical",
      summary: "shell-quote escape bug",
      cves: ["CVE-1"],
      url: "https://x/1",
      scope: "development",
    },
    {
      package: "cookie",
      severity: "low",
      summary: "oob chars",
      cves: [],
      url: "https://x/2",
      scope: "runtime",
    },
  ];

  it("prefers Dependabot alerts over pnpm when site.gitRepo and a fetcher are present", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot(alerts),
      // pnpm/npm MUST NOT be consulted; an empty spawn map would throw ENOENT → "skip" if it were.
      spawn: fakeSpawn({}),
    });
    // Pin the full summary so the total and the C/H/M/L band order/format can't silently drift.
    expect(result.summary).toBe("Dependabot: 2 alert(s) (1C/0H/0M/1L)");
    expect(result.status).toBe("fail"); // a critical is present
    const details = result.details as {
      counts: { critical: number; low: number };
      advisories: unknown[];
    };
    expect(details.counts.critical).toBe(1);
    expect(details.counts.low).toBe(1);
    expect(details.advisories).toHaveLength(2);
  });

  it("maps GitHub 'medium' severity to 'moderate'", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([
        {
          package: "http-proxy-middleware",
          severity: "medium",
          summary: "host bypass",
          cves: [],
          url: null,
          scope: "development",
        },
      ]),
    });
    const details = result.details as {
      counts: { moderate: number };
      advisories: Array<{ severity: string }>;
    };
    expect(details.counts.moderate).toBe(1);
    expect(details.advisories[0]?.severity).toBe("moderate");
    expect(result.status).toBe("warn");
  });

  it("tags each advisory with the dependency scope from the alert", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot(alerts),
    });
    const details = result.details as {
      advisories: Array<{ module: string; scope?: string }>;
    };
    expect(details.advisories.find((a) => a.module === "shell-quote")?.scope).toBe("development");
    expect(details.advisories.find((a) => a.module === "cookie")?.scope).toBe("runtime");
  });

  it("returns pass with 'Dependabot: 0 alerts' when there are no open alerts", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([]),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toBe("Dependabot: 0 alerts");
  });

  it("falls back to pnpm audit when the Dependabot fetch fails (e.g. 403/404/network)", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot(new Error("GitHub GET dependabot/alerts failed (403)")),
      spawn: fakeSpawn({
        pnpm: {
          code: 0,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
          }),
        },
      }),
    });
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/^pnpm audit/);
  });

  it("uses pnpm audit (never the fetcher) when the site has no gitRepo", async () => {
    let fetcherCalled = false;
    const result = await securityAudit({
      site: { path: "/fake" }, // no gitRepo
      dependabotDeps: {
        listAlerts: async () => {
          fetcherCalled = true;
          return [];
        },
      },
      spawn: fakeSpawn({
        pnpm: {
          code: 1,
          stdout: JSON.stringify({
            metadata: { vulnerabilities: { low: 0, moderate: 0, high: 2, critical: 0 } },
          }),
        },
      }),
    });
    expect(fetcherCalled).toBe(false);
    expect(result.summary).toMatch(/^pnpm audit/);
    expect(result.status).toBe("fail");
  });

  it("counts an unknown/absent severity as low (down-map, never inflate)", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([
        {
          package: "mystery",
          severity: "",
          summary: "no severity",
          cves: [],
          url: null,
          scope: null,
        },
      ]),
    });
    const details = result.details as {
      counts: { low: number; moderate: number };
      advisories: Array<{ severity: string }>;
    };
    expect(details.counts.low).toBe(1);
    expect(details.counts.moderate).toBe(0);
    expect(details.advisories[0]?.severity).toBe("low");
    expect(result.status).toBe("warn");
  });

  it("falls back to pnpm when gitRepo is set but no token is configured (default deps → null)", async () => {
    // No dependabotDeps injected → securityAudit builds defaultDependabotDeps(), which returns null
    // without GITHUB_TOKEN, so it must fall THROUGH to pnpm rather than throw or skip. Scrub the
    // env so the path is exercised even if the dev/CI shell has a token set.
    const savedGh = process.env.GITHUB_TOKEN;
    const savedReno = process.env.RENOVATE_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.RENOVATE_TOKEN;
    try {
      const result = await securityAudit({
        site: { path: "/fake", gitRepo: "reddoorla/acme" },
        spawn: fakeSpawn({
          pnpm: {
            code: 0,
            stdout: JSON.stringify({
              metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0 } },
            }),
          },
        }),
      });
      expect(result.status).toBe("pass");
      expect(result.summary).toMatch(/^pnpm audit/);
    } finally {
      if (savedGh === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = savedGh;
      if (savedReno === undefined) delete process.env.RENOVATE_TOKEN;
      else process.env.RENOVATE_TOKEN = savedReno;
    }
  });
});

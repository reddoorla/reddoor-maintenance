import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      relationship: null,
      manifestPath: "pnpm-lock.yaml",
    },
    {
      package: "cookie",
      severity: "low",
      summary: "oob chars",
      cves: [],
      url: "https://x/2",
      scope: "runtime",
      relationship: null,
      manifestPath: "pnpm-lock.yaml",
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
          relationship: null,
          manifestPath: "pnpm-lock.yaml",
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

  it("tags each advisory with the dependency relationship from the alert (omitted when GitHub reports none)", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([
        { ...alerts[0]!, relationship: "direct" },
        { ...alerts[1]!, relationship: "transitive" },
        {
          package: "nanoid",
          severity: "high",
          summary: "predictable ids",
          cves: [],
          url: null,
          scope: "runtime",
          relationship: null,
          manifestPath: "pnpm-lock.yaml",
        },
      ]),
    });
    const details = result.details as {
      advisories: Array<{ module: string; relationship?: string }>;
    };
    expect(details.advisories.find((a) => a.module === "shell-quote")?.relationship).toBe("direct");
    expect(details.advisories.find((a) => a.module === "cookie")?.relationship).toBe("transitive");
    // null from the API stays OFF the persisted advisory (unknown, not a claim).
    expect("relationship" in details.advisories.find((a) => a.module === "nanoid")!).toBe(false);
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
          relationship: null,
          manifestPath: "pnpm-lock.yaml",
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
    delete process.env.GITHUB_TOKEN;
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
    }
  });
});

// #702: GitHub's dependency graph keeps a manifest after the file is deleted from the
// default branch and keeps filing alerts against that frozen snapshot. Nothing can fix
// them (no file to bump), so one ghost pinned erp-industrial and data-dynamiq red for
// five days in the cockpit's "Renovate exhausted" band — the wrong diagnosis.
describe("audits/security — alerts on a manifest GitHub no longer tracks (#702)", () => {
  const ghost: DependabotAlert = {
    package: "immutable",
    severity: "high",
    summary: "immutable prototype pollution",
    cves: ["CVE-2025-1"],
    url: "https://github.com/reddoorla/erp-industrial/security/dependabot/55",
    scope: "runtime",
    relationship: "inconclusive",
    manifestPath: "package-lock.json",
  };
  const live: DependabotAlert = {
    package: "nanoid",
    severity: "high",
    summary: "nanoid predictable ids",
    cves: [],
    url: "https://github.com/reddoorla/acme/security/dependabot/9",
    scope: "runtime",
    relationship: "transitive",
    manifestPath: "pnpm-lock.yaml",
  };
  type Details = {
    counts: { high: number };
    advisories: Array<{ module: string }>;
    ghostAdvisories?: Array<{ module: string; manifestPath: string }>;
  };
  const deps = (alerts: DependabotAlert[], exists: (path: string) => Promise<boolean>) => ({
    listAlerts: async () => alerts,
    manifestExists: async (_repo: string, path: string) => exists(path),
  });

  // The instrument's proof, written first: a real high on a manifest that IS on the
  // default branch must still fail and still count, byte-identical to before.
  it("still fails and counts a high whose manifest exists on the default branch", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: deps([live], async () => true),
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toBe("Dependabot: 1 alert(s) (0C/1H/0M/0L)");
    const d = result.details as Details;
    expect(d.counts.high).toBe(1);
    expect(d.advisories.map((a) => a.module)).toEqual(["nanoid"]);
    expect(d.ghostAdvisories ?? []).toEqual([]);
  });

  it("does not count a high whose manifest is gone, and says so in one warn line", async () => {
    const seen: string[] = [];
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/erp-industrial" },
      dependabotDeps: deps([ghost], async (path) => {
        seen.push(path);
        return false;
      }),
      spawn: fakeSpawn({}),
    });
    expect(seen).toEqual(["package-lock.json"]);
    expect(result.status).toBe("warn");
    expect(result.summary).toBe(
      "Dependabot: 0 live alert(s); 1 alert(s) on a manifest GitHub no longer tracks (package-lock.json) — dismiss as inaccurate",
    );
    const d = result.details as Details;
    expect(d.counts.high).toBe(0);
    expect(d.advisories).toEqual([]);
    expect(d.ghostAdvisories).toEqual([
      expect.objectContaining({ module: "immutable", manifestPath: "package-lock.json" }),
    ]);
  });

  it("keeps the live tally and appends the ghost line when both are present", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: deps([live, ghost], async (path) => path === "pnpm-lock.yaml"),
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toBe(
      "Dependabot: 1 alert(s) (0C/1H/0M/0L); 1 alert(s) on a manifest GitHub no longer tracks (package-lock.json) — dismiss as inaccurate",
    );
    const d = result.details as Details;
    expect(d.advisories.map((a) => a.module)).toEqual(["nanoid"]);
    expect(d.ghostAdvisories?.map((a) => a.module)).toEqual(["immutable"]);
  });

  it("counts the alert when the contents lookup errors — an API hiccup must never hide a vulnerability", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: deps([ghost], async () => {
        throw new Error("GitHub GET contents failed (403)");
      }),
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("fail");
    expect((result.details as Details).counts.high).toBe(1);
    expect((result.details as Details).ghostAdvisories ?? []).toEqual([]);
  });

  it("counts an alert with no manifest_path, and never looks one up", async () => {
    let looked = 0;
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: deps([{ ...ghost, manifestPath: null }], async () => {
        looked += 1;
        return false;
      }),
      spawn: fakeSpawn({}),
    });
    expect(looked).toBe(0);
    expect(result.status).toBe("fail");
    expect((result.details as Details).counts.high).toBe(1);
  });

  it("resolves each distinct manifest once per audit, not once per alert", async () => {
    const seen: string[] = [];
    await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: deps([ghost, { ...ghost, package: "nanoid" }, live], async (path) => {
        seen.push(path);
        return path === "pnpm-lock.yaml";
      }),
      spawn: fakeSpawn({}),
    });
    expect(seen.sort()).toEqual(["package-lock.json", "pnpm-lock.yaml"]);
  });

  it("counts everything when the injected deps carry no manifest lookup at all", async () => {
    const result = await securityAudit({
      site: { path: "/fake", gitRepo: "reddoorla/acme" },
      dependabotDeps: { listAlerts: async () => [ghost] },
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("fail");
    expect((result.details as Details).counts.high).toBe(1);
  });
});

describe("audits/security — a lockfile GitHub's dependency graph cannot read (P1-54)", () => {
  const pnpm12Lockfile = [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    configDependencies: {}",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.5.1",
    "        version: 12.5.1",
    "",
    "---",
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      sharp:",
    "        specifier: ^0.35.0",
    "        version: 0.35.4",
    "",
  ].join("\n");
  const pnpm11Lockfile = ["lockfileVersion: '9.0'", "", "importers:", "", "  .: {}", ""].join("\n");
  const pnpmAuditOut = JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } },
    advisories: {
      "1": {
        module_name: "sharp",
        severity: "high",
        title: "sharp : Vulnerability in librsvg dependency CVE-2026-96889",
        url: "https://github.com/advisories/GHSA-wq5f-xc86-pv6w",
      },
      "2": {
        module_name: "devalue",
        severity: "high",
        title: "devalue: `stringify`/`uneval` serialize shared memory",
        url: "https://github.com/advisories/GHSA-j22f-vq7h-c4qm",
      },
    },
  });

  function clone(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "security-audit-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  }

  it("adds pnpm audit for a pnpm 12 lockfile, since Dependabot's 0 alerts only means it saw nothing", async () => {
    const result = await securityAudit({
      site: {
        path: clone({
          "pnpm-lock.yaml": pnpm12Lockfile,
          "package.json": JSON.stringify({ dependencies: { sharp: "^0.35.0" } }),
        }),
        gitRepo: "reddoorla/caltex-landing",
      },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toBe("pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L)");
    const details = result.details as {
      advisories: Array<{ module: string; relationship?: string }>;
    };
    expect(details.advisories.map((a) => [a.module, a.relationship])).toEqual([
      ["sharp", "direct"],
      ["devalue", "transitive"],
    ]);
  });

  it("leaves relationship unknown when package.json cannot be read", async () => {
    const result = await securityAudit({
      site: { path: clone({ "pnpm-lock.yaml": pnpm12Lockfile }), gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
    });
    expect(result.summary).toBe("pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L)");
    const details = result.details as { advisories: Array<Record<string, unknown>> };
    expect(details.advisories.some((a) => "relationship" in a)).toBe(false);
  });

  const actionAlert: DependabotAlert = {
    package: "actions/checkout",
    severity: "high",
    summary: "checkout leaks the token",
    cves: [],
    url: "https://github.com/reddoorla/caltex-landing/security/dependabot/1",
    scope: "runtime",
    relationship: "direct",
    manifestPath: ".github/workflows/ci.yml",
  };
  const cleanPnpm = JSON.stringify({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
    advisories: {},
  });

  it("keeps Dependabot's alerts on what the graph does see, beside pnpm audit's", async () => {
    const result = await securityAudit({
      site: { path: clone({ "pnpm-lock.yaml": pnpm12Lockfile }), gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([actionAlert]),
      spawn: fakeSpawn({ pnpm: { code: 0, stdout: cleanPnpm } }),
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toBe("pnpm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
  });

  it("counts an advisory both sources report once", async () => {
    const dup: DependabotAlert = {
      ...actionAlert,
      package: "sharp",
      summary: "sharp : Vulnerability in librsvg dependency CVE-2026-96889",
      manifestPath: "pnpm-lock.yaml",
    };
    const result = await securityAudit({
      site: { path: clone({ "pnpm-lock.yaml": pnpm12Lockfile }), gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([dup]),
      spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
    });
    expect(result.summary).toBe("pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L)");
  });

  it("skips, writing no counts, when the lockfile audit cannot run", async () => {
    const result = await securityAudit({
      site: { path: clone({ "pnpm-lock.yaml": pnpm12Lockfile }), gitRepo: "reddoorla/acme" },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({}),
    });
    expect(result.status).toBe("skip");
  });

  it("counts an aliased dependency as direct under the package it installs", async () => {
    const result = await securityAudit({
      site: {
        path: clone({
          "pnpm-lock.yaml": pnpm12Lockfile,
          "package.json": JSON.stringify({ dependencies: { img: "npm:sharp@^0.35.0" } }),
        }),
        gitRepo: "reddoorla/acme",
      },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
    });
    const details = result.details as {
      advisories: Array<{ module: string; relationship?: string }>;
    };
    expect(details.advisories.find((a) => a.module === "sharp")!.relationship).toBe("direct");
  });

  it("leaves relationship unknown for a workspace, whose members declare their own deps", async () => {
    const result = await securityAudit({
      site: {
        path: clone({
          "pnpm-lock.yaml": pnpm12Lockfile,
          "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
          "package.json": JSON.stringify({ devDependencies: { devalue: "^5.0.0" } }),
        }),
        gitRepo: "reddoorla/acme",
      },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
    });
    const details = result.details as { advisories: Array<Record<string, unknown>> };
    expect(details.advisories.some((a) => "relationship" in a)).toBe(false);
  });

  describe("merging pnpm audit with Dependabot (#1408, #1409, #1410, #1411)", () => {
    const repo = () => clone({ "pnpm-lock.yaml": pnpm12Lockfile });
    const devHighPnpm = JSON.stringify({
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
      advisories: {
        "1": {
          module_name: "vite",
          severity: "high",
          title: "vite: server.fs.deny bypass",
          url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
        },
      },
    });

    // #1408: Dependabot counts every open alert, dev scope included, so the audit that stands in
    // for it on a hidden lockfile must not narrow to production dependencies.
    it("audits devDependencies too, as the Dependabot count it stands in for does", async () => {
      const calls: string[][] = [];
      const spawn: SpawnFn = async (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd !== "pnpm") throw new Error(`ENOENT: ${cmd}`);
        // pnpm's --prod drops the dev-only vite advisory; without it the advisory is found.
        const prod = args.includes("--prod");
        return { code: prod ? 0 : 1, stdout: prod ? cleanPnpm : devHighPnpm, stderr: "" };
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([]),
        spawn,
      });
      expect(result.status).toBe("fail");
      expect(result.summary).toBe("pnpm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
      expect(calls).toEqual([["pnpm", "audit", "--json"]]);
    });

    it("leaves the plain lockfile fallback, with no Dependabot, at production scope", async () => {
      const calls: string[][] = [];
      const spawn: SpawnFn = async (cmd, args) => {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: cleanPnpm, stderr: "" };
      };
      await securityAudit({ site: { path: repo() }, spawn });
      expect(calls).toEqual([["pnpm", "audit", "--json", "--prod"]]);
    });

    // #1409: the same advisory, worded differently by the two sources, is one advisory.
    it("counts once an advisory both sources report under one GHSA id, whatever its title", async () => {
      const sameGhsa: DependabotAlert = {
        ...actionAlert,
        package: "sharp",
        summary: "sharp vulnerable through bundled librsvg",
        ghsaId: "GHSA-wq5f-xc86-pv6w",
        manifestPath: "pnpm-lock.yaml",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([sameGhsa]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L)");
      expect((result.details as { advisories: unknown[] }).advisories).toHaveLength(2);
    });

    it("falls back to the CVE when one side has no GHSA id", async () => {
      const cvePnpm = JSON.stringify({
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
        advisories: {
          "1": {
            module_name: "sharp",
            severity: "high",
            title: "sharp : Vulnerability in librsvg dependency",
            cves: ["CVE-2026-96889"],
          },
        },
      });
      const sameCve: DependabotAlert = {
        ...actionAlert,
        package: "sharp",
        summary: "sharp vulnerable through bundled librsvg",
        cves: ["CVE-2026-96889"],
        ghsaId: "GHSA-wq5f-xc86-pv6w",
        manifestPath: "pnpm-lock.yaml",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([sameCve]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: cvePnpm } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
    });

    it("keeps two advisories with different GHSA ids apart even under one module and title", async () => {
      const otherGhsa: DependabotAlert = {
        ...actionAlert,
        package: "sharp",
        summary: "sharp : Vulnerability in librsvg dependency CVE-2026-96889",
        ghsaId: "GHSA-zzzz-zzzz-zzzz",
        manifestPath: "pnpm-lock.yaml",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([otherGhsa]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 3 vulnerabilities (0C/3H/0M/0L)");
    });

    // #1410: the merged count is the live count; Dependabot's own "0 live" must not follow it.
    it("appends only the ghost clause, not Dependabot's own live count", async () => {
      const ghost: DependabotAlert = {
        ...actionAlert,
        package: "immutable",
        summary: "immutable prototype pollution",
        manifestPath: "package-lock.json",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: { listAlerts: async () => [ghost], manifestExists: async () => false },
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
      });
      expect(result.status).toBe("fail");
      expect(result.summary).toBe(
        "pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L); 1 alert(s) on a manifest " +
          "GitHub no longer tracks (package-lock.json) — dismiss as inaccurate",
      );
    });

    // #1411: the merged counts never add Dependabot's per-alert tallies to pnpm's metadata,
    // which may count per path; per severity they are the larger of the two views.
    it("takes the larger of the merged advisories and pnpm's metadata, never their sum", async () => {
      const perPath = JSON.stringify({
        ...JSON.parse(pnpmAuditOut),
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 5, critical: 0 } },
      });
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([actionAlert]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: perPath } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 5 vulnerabilities (0C/5H/0M/0L)");
      expect((result.details as { counts: Record<string, number> }).counts).toEqual({
        low: 0,
        moderate: 0,
        high: 5,
        critical: 0,
      });
    });

    it("counts the merged advisories when they outnumber pnpm's metadata", async () => {
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([actionAlert]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: pnpmAuditOut } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 3 vulnerabilities (0C/3H/0M/0L)");
    });

    it("never reads clean when pnpm counts a severity with no advisory detail", async () => {
      const noDetail = JSON.stringify({
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } },
      });
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: noDetail } }),
      });
      expect(result.status).toBe("fail");
      expect(result.summary).toBe("pnpm audit + Dependabot: 2 vulnerabilities (0C/2H/0M/0L)");
    });

    it("does not add a Dependabot alert onto pnpm's detail-less count of the same severity", async () => {
      const noDetail = JSON.stringify({
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
      });
      const sharp: DependabotAlert = {
        ...actionAlert,
        package: "sharp",
        ghsaId: "GHSA-wq5f-xc86-pv6w",
        manifestPath: "pnpm-lock.yaml",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([sharp]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: noDetail } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
    });

    it("keeps pnpm's count when it has detail for only some of a severity", async () => {
      const partial = JSON.stringify({
        ...JSON.parse(pnpmAuditOut),
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 3, critical: 0 } },
      });
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([]),
        spawn: fakeSpawn({ pnpm: { code: 1, stdout: partial } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 3 vulnerabilities (0C/3H/0M/0L)");
    });

    it("dedupes by GHSA when the merge falls back to npm audit", async () => {
      const npmOut = JSON.stringify({
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
        vulnerabilities: {
          foo: {
            name: "foo",
            severity: "high",
            via: [
              {
                source: 1,
                name: "foo",
                title: "Prototype pollution in foo",
                url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
                severity: "high",
              },
            ],
          },
        },
      });
      const foo: DependabotAlert = {
        ...actionAlert,
        package: "foo",
        summary: "foo allows prototype pollution via merge()",
        ghsaId: "GHSA-aaaa-bbbb-cccc",
        manifestPath: "pnpm-lock.yaml",
      };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([foo]),
        spawn: fakeSpawn({ npm: { code: 1, stdout: npmOut } }),
      });
      expect(result.summary).toBe("npm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
    });

    it("counts once two Dependabot alerts on one GHSA filed against two manifests", async () => {
      const a: DependabotAlert = { ...actionAlert, ghsaId: "GHSA-cccc-dddd-eeee" };
      const b: DependabotAlert = { ...a, manifestPath: ".github/workflows/deploy.yml" };
      const result = await securityAudit({
        site: { path: repo(), gitRepo: "reddoorla/acme" },
        dependabotDeps: fakeDependabot([a, b]),
        spawn: fakeSpawn({ pnpm: { code: 0, stdout: cleanPnpm } }),
      });
      expect(result.summary).toBe("pnpm audit + Dependabot: 1 vulnerabilities (0C/1H/0M/0L)");
    });
  });

  it("still prefers Dependabot for a single-document lockfile", async () => {
    const result = await securityAudit({
      site: { path: clone({ "pnpm-lock.yaml": pnpm11Lockfile }), gitRepo: "reddoorla/29-navy" },
      dependabotDeps: fakeDependabot([]),
      spawn: fakeSpawn({}),
    });
    expect(result.summary).toBe("Dependabot: 0 alerts");
  });
});

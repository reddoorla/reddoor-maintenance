import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, matchingDisposition, UNGUARDED_TWIN_MARKER } from "../../src/recipes/launch.js";
import {
  MATCH_ROUTE_SERVER_TEMPLATE,
  UNGUARDED_TWIN_TELL,
} from "../../src/recipes/match-harness/template.js";
import type { AuditResult, RecipeResult, Site } from "../../src/types.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// uploadAttachment (src/reports/airtable/attachments.ts) POSTs to content.airtable.com
// via global fetch. Stub fetch so the preview upload "succeeds" without a network call;
// AIRTABLE_PAT/BASE_ID are also required by uploadAttachment before it fetches.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
});

/** A real, empty SvelteKit checkout — `src/routes`, no `src/routes/dev/match`.
 *  It has to exist on disk: `matchingDisposition` now requires positive evidence
 *  that the path IS a checkout before it will read "no twin here" as a pass, so
 *  the `/fake/acme` this used to return fails the pre-flight rather than sailing
 *  through it, which is the point of that change. */
let checkoutDir = "";

beforeAll(async () => {
  checkoutDir = await mkdtemp(join(tmpdir(), "launch-checkout-"));
  await mkdir(join(checkoutDir, "src/routes"), { recursive: true });
});

afterAll(async () => {
  await rm(checkoutDir, { recursive: true, force: true });
});

function siteOf(): Site {
  return { path: checkoutDir, name: "Acme Co" };
}

const BC_PLAN = new URL(
  "../../docs/superpowers/plans/2026-09-08-webflow-pipeline-bc-harness.md",
  import.meta.url,
);

/** Plan BC's `ROUTE_SERVER` template, lifted out of the plan rather than
 *  restated here. `matchingDisposition` is a CONTRACT with that template — BC
 *  installs it and the launch pre-flight has to accept it — and a copy of the
 *  guard pasted into this file would let the two drift silently, which is the
 *  failure the plan's own "import the predicate, do not restate the regex" note
 *  is about. Extraction failing loudly is deliberate. */
function bcRouteServerTemplate(): string {
  const md = readFileSync(BC_PLAN, "utf-8");
  const heading = "`ROUTE_SERVER` (`src/routes/dev/match/[uid]/+page.server.ts`):";
  const at = md.indexOf(heading);
  if (at === -1) throw new Error(`ROUTE_SERVER heading missing from ${BC_PLAN.pathname}`);
  const open = md.indexOf("```ts\n", at);
  const close = md.indexOf("\n```", open + 6);
  if (open === -1 || close === -1) throw new Error("ROUTE_SERVER ts fence missing");
  return md.slice(open + 6, close + 1);
}

/** A lighthouse AuditResult with real scores in the LHCI summary shape (floats in
 *  [0,1] under details.summary, keyed by the canonical category ids). */
function lighthouseResult(): AuditResult {
  return {
    audit: "lighthouse",
    site: "Acme Co",
    status: "pass",
    summary: "lighthouse ok",
    details: {
      summary: {
        performance: 0.87,
        accessibility: 0.91,
        "best-practices": 1.0,
        seo: 0.95,
      },
    },
  };
}

/** Seed a Websites row whose siteSlug matches the launched site. */
function websitesSeed() {
  return {
    Websites: [
      {
        id: "rec_site_acme",
        fields: { Name: "Acme Co", url: "https://acme.example.com", Status: "launch period" },
      },
    ],
    Reports: [] as Array<{ id: string; fields: Record<string, unknown> }>,
  };
}

function deps(base: ReturnType<typeof makeFakeBase>) {
  return {
    base,
    bootstrap: async (): Promise<RecipeResult> => ({
      recipe: "self-updating",
      site: "Acme Co",
      status: "applied",
      commits: ["abc123"],
    }),
    audit: async (): Promise<AuditResult[]> => [lighthouseResult()],
    probe: async (url: string) => {
      if (url.endsWith("/dev/match/home"))
        return { status: 404, body: "<div><h1>404</h1><p>Not found</p></div>" };
      return { status: 200, body: '{"ok":true,"prismic":"ok"}' };
    },
  };
}

describe("recipes/launch", () => {
  it("runs bootstrap + audit + draft and reports complete=true", async () => {
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual([
      "matching-disposition",
      "self-updating",
      "dev-guard",
      "audit",
      "draft",
    ]);
  });

  it("creates a Launch draft carrying the audited Lighthouse scores", async () => {
    const base = makeFakeBase(websitesSeed());
    await launch(siteOf(), deps(base));

    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Reports");
    if (!create || create.kind !== "create") throw new Error("expected a Reports create");
    const fields = create.records[0]!.fields;
    expect(fields["Report type"]).toBe("Launch");
    expect(fields["Lighthouse — Performance"]).toBe(87);
    expect(fields["Lighthouse — Accessibility"]).toBe(91);
    expect(fields["Lighthouse — Best Practices"]).toBe(100);
    expect(fields["Lighthouse — SEO"]).toBe(95);
  });

  it("mirrors the FIRST audit write-back onto the site row (#539 Phase 5)", async () => {
    // Launch is the one path that writes a brand-new site's health. The FLEET
    // sweep has mirrored since Phase 3; this single-site write never did, so the
    // new site's row read empty in the console until the next hourly sync.
    const base = makeFakeBase(websitesSeed());
    const mirrored: Array<{ id: string; fields: Record<string, unknown> }> = [];

    await launch(siteOf(), {
      ...deps(base),
      siteMirror: {
        created: async () => {},
        hasRow: async () => true,
        health: async (id: string, fields: Record<string, unknown>) => {
          mirrored.push({ id, fields });
        },
        site: async () => {},
      },
    });

    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.id).toBe("rec_site_acme");
    // The EXACT FieldSet Airtable got — the audited Lighthouse scores.
    expect(mirrored[0]!.fields).toMatchObject({ pScore: 87, seoScore: 95 });
  });

  it("hands the created row to deps.reportMirror (#539 Phase 5 create-side dual-write)", async () => {
    const base = makeFakeBase(websitesSeed());
    const seen: Array<{ id: string; fields: Record<string, unknown> }> = [];

    await launch(siteOf(), {
      ...deps(base),
      reportMirror: {
        created: async (rec: { id: string; fields: Record<string, unknown> }) => {
          seen.push(rec);
        },
        body: async () => {},
        patch: async () => {},
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.fields["Report type"]).toBe("Launch");
  });

  it("flips Draft ready=true so the launch draft enters the approve queue (BLOCKER)", async () => {
    const base = makeFakeBase(websitesSeed());
    await launch(siteOf(), deps(base));

    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("reuses an existing Launch row on a re-run instead of creating a second", async () => {
    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    const base = makeFakeBase({
      Websites: websitesSeed().Websites,
      Reports: [
        {
          id: "rec_existing_launch",
          fields: {
            "Report ID": "Acme Co — Launch — existing",
            Site: ["rec_site_acme"],
            "Report type": "Launch",
            Period: period,
          },
        },
      ],
    });

    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    // No second Reports row created — the existing one is reused.
    const reportCreates = base.__calls.filter((c) => c.kind === "create" && c.table === "Reports");
    expect(reportCreates).toHaveLength(0);
    // It is still made Draft-ready (idempotent re-flip).
    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_launch" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("mirrors the reused Launch row's refreshed scores (#539 Phase 5)", async () => {
    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    const base = makeFakeBase({
      Websites: websitesSeed().Websites,
      Reports: [
        {
          id: "rec_existing_launch",
          fields: {
            "Report ID": "Acme Co — Launch — existing",
            Site: ["rec_site_acme"],
            "Report type": "Launch",
            Period: period,
            "Lighthouse — Performance": 10,
          },
        },
      ],
    });
    const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];

    await launch(siteOf(), {
      ...deps(base),
      reportMirror: {
        created: async () => {},
        body: async () => {},
        patch: async (id: string, patch: Record<string, unknown>) => {
          patched.push({ id, patch });
        },
      },
    });

    const scores = patched.find((p) => p.patch.lighthouse_performance !== undefined);
    expect(scores).toMatchObject({
      id: "rec_existing_launch",
      patch: {
        lighthouse_performance: 87,
        lighthouse_accessibility: 91,
        lighthouse_best_practices: 100,
        lighthouse_seo: 95,
      },
    });
  });

  it("refreshes the reused Launch row's Lighthouse scores with the fresh audit (no stale email)", async () => {
    const today = new Date();
    const period = today.toISOString().slice(0, 7);
    // Seed an existing Launch row carrying STALE scores from a prior run.
    const base = makeFakeBase({
      Websites: websitesSeed().Websites,
      Reports: [
        {
          id: "rec_existing_launch",
          fields: {
            "Report ID": "Acme Co — Launch — existing",
            Site: ["rec_site_acme"],
            "Report type": "Launch",
            Period: period,
            "Lighthouse — Performance": 10,
            "Lighthouse — Accessibility": 20,
            "Lighthouse — Best Practices": 30,
            "Lighthouse — SEO": 40,
          },
        },
      ],
    });

    await launch(siteOf(), deps(base));

    // The reuse path updates the existing row's Lighthouse cells to the fresh audit
    // (lighthouseResult: 87/91/100/95) — NOT a second create.
    const scoreUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_launch" &&
        c.records[0]!.fields["Lighthouse — Performance"] !== undefined,
    );
    expect(scoreUpdate).toBeDefined();
    if (!scoreUpdate || scoreUpdate.kind !== "update") throw new Error("expected a score update");
    expect(scoreUpdate.records[0]!.fields).toMatchObject({
      "Lighthouse — Performance": 87,
      "Lighthouse — Accessibility": 91,
      "Lighthouse — Best Practices": 100,
      "Lighthouse — SEO": 95,
    });
    // Completed on is refreshed too (today, YYYY-MM-DD).
    expect(scoreUpdate.records[0]!.fields["Completed on"]).toBe(today.toISOString().slice(0, 10));
  });

  it("still completes (and flips Draft ready) when the preview upload fails", async () => {
    // A preview-upload hiccup must not fail the launch — it's wrapped in try/catch.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    }) as unknown as typeof global.fetch;

    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), deps(base));

    expect(result.complete).toBe(true);
    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("stops at dev-guard when the matching twin still answers 200 in production", async () => {
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async () => ({ status: 200, body: "<h1>Home</h1>" }),
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect(guard?.result).toMatchObject({ kind: "error" });
    expect((guard?.result as { message: string }).message).toMatch(/live in production/);
  });

  it("stops at dev-guard when the 404 is not this site's own error page", async () => {
    // A parked domain, a CDN 404 and a deleted route all answer 404. Only the
    // site's own +error.svelte renders <h1>404</h1>. Without the marker the guard
    // would pass on a site that is simply gone.
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) =>
        url.endsWith("/dev/match/home")
          ? { status: 404, body: "<html><body>Page not found · Netlify</body></html>" }
          : { status: 200, body: "<h1>Fixtures</h1>" },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect((guard?.result as { message: string }).message).toMatch(/own error page/);
  });

  it("stops at dev-guard when the liveness control does not answer 200", async () => {
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) =>
        url.endsWith("/health") ? { status: 503, body: "" } : { status: 404, body: "<h1>404</h1>" },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect((guard?.result as { message: string }).message).toMatch(/proves nothing/);
    expect((guard?.result as { message: string }).message).toMatch(
      /https:\/\/acme\.example\.com\/health answered 503/,
    );
  });

  it("uses /health as the liveness control, never a /dev route", async () => {
    // The control has to be a route production is ALLOWED to serve. Probing
    // /dev/a11y-fixtures made the gate require an unguarded dev page to be
    // publicly reachable — so the class-fix for "dev routes ship in production"
    // (one src/routes/dev/+layout.server.ts doing `if (!dev) error(404)`) would
    // take the control down with it and fail every correctly-guarded site.
    // Verified across the fleet: 23 of 23 starter-derived repos ship
    // src/routes/health/+server.ts, every one declaring `prerender = false`, so
    // a 200 from it still proves the render/function path is alive.
    const base = makeFakeBase(websitesSeed());
    const probed: string[] = [];
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) => {
        probed.push(url);
        if (url.endsWith("/dev/match/home"))
          return { status: 404, body: "<div><h1>404</h1><p>Not found</p></div>" };
        return { status: 200, body: '{"ok":true,"prismic":"ok"}' };
      },
    });

    expect(result.complete).toBe(true);
    expect(probed).toContain("https://acme.example.com/health");
    expect(probed.some((u) => u.includes("/dev/a11y-fixtures"))).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect((guard?.result as { message: string }).message).toContain("/health 200");
  });

  it('stops at dev-guard when the twin\'s 404 is its OWN "no matching assembly" refusal', async () => {
    // The UNGUARDED twin (verified on disk: beachfront-dentistry's
    // src/routes/dev/match/[uid]/+page.server.ts imports $app/environment zero
    // times) answers `error(404, { message: 'no matching assembly for "..."' })`
    // for any uid absent from its assembly map — rendered through the very same
    // +error.svelte the guard's 404 uses, so it carries <h1>404</h1> too. On a
    // site whose uid set lacks "home" the grant condition could never fail,
    // guarded or not. The route's own message is the tell, and it is a DENY.
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) =>
        url.endsWith("/dev/match/home")
          ? {
              status: 404,
              body: '<h1>404</h1><p>no matching assembly for "home" (have: about, services)</p>',
            }
          : { status: 200, body: '{"ok":true}' },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect(guard?.result).toMatchObject({ kind: "error" });
    expect((guard?.result as { message: string }).message).toMatch(/no matching assembly/i);
    expect((guard?.result as { message: string }).message).toMatch(/not evidence of a dev guard/i);
    // And nothing downstream ran: no draft, no Airtable write.
    expect(result.steps.map((s) => s.name)).toEqual([
      "matching-disposition",
      "self-updating",
      "dev-guard",
    ]);
  });

  it("denies on the twin's MACHINE tell, so the human wording can change without the guard failing open", async () => {
    // #719: the deny clause matched a human-readable message. Reword it in the
    // site template — "no document for", "unknown uid" — and the guard silently
    // stops denying: the launch proceeds and a site ships its fixtures public.
    // The durable contract is a machine tell the installed route emits ahead
    // of its message, and the marker is BUILT from that exported constant.
    expect(UNGUARDED_TWIN_TELL).toMatch(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
    // The template the harness installs carries the tell in its 404 message.
    expect(MATCH_ROUTE_SERVER_TEMPLATE).toContain(`message: \`${UNGUARDED_TWIN_TELL}`);
    // The template string itself trips the marker...
    expect(UNGUARDED_TWIN_MARKER.test(MATCH_ROUTE_SERVER_TEMPLATE)).toBe(true);
    // ...and still does with every human wording gone: the tell alone carries it.
    const reworded = MATCH_ROUTE_SERVER_TEMPLATE.replace(
      /no (matching )?assembly for/gi,
      "no document for",
    );
    expect(reworded).not.toMatch(/assembly for/i);
    expect(UNGUARDED_TWIN_MARKER.test(reworded)).toBe(true);

    // End to end: a 404 whose only tell is the machine one is refused.
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) =>
        url.endsWith("/dev/match/home")
          ? {
              status: 404,
              body: `<h1>404</h1><p>${UNGUARDED_TWIN_TELL}: no document for "home" (have: about)</p>`,
            }
          : { status: 200, body: '{"ok":true}' },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect(guard?.result).toMatchObject({ kind: "error" });
    expect((guard?.result as { message: string }).message).toMatch(/not evidence of a dev guard/i);
  });

  it('also denies the harness template\'s wording ("no assembly for")', async () => {
    // Two wordings exist. beachfront-dentistry's on-disk twin says "no matching
    // assembly for"; the ROUTE_PAGE template this same plan will install via
    // `match-harness` says "no assembly for". A deny clause that only knew the
    // first would go blind the moment the harness recipe ships.
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async (url: string) =>
        url.endsWith("/dev/match/home")
          ? {
              status: 404,
              body: '<h1>404</h1><p>no assembly for "home" (have: about, contact)</p>',
            }
          : { status: 200, body: '{"ok":true}' },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect((guard?.result as { message: string }).message).toMatch(/not evidence of a dev guard/i);
  });

  it("refuses when the probe REJECTS — a network blip is never a pass", async () => {
    // Every other test injects a resolving probe, so "a rejection reads as a
    // refusal" was a claim from reading the code, not a pinned behaviour. It is
    // also the shape the 15s AbortSignal produces on a stalled origin.
    const base = makeFakeBase(websitesSeed());
    const result = await launch(siteOf(), {
      ...deps(base),
      probe: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(result.complete).toBe(false);
    const guard = result.steps.find((s) => s.name === "dev-guard");
    expect(guard?.result).toMatchObject({ kind: "error", message: "fetch failed" });
    // The chain stopped there: nothing was drafted, nothing written to Airtable.
    expect(result.steps.map((s) => s.name)).toEqual([
      "matching-disposition",
      "self-updating",
      "dev-guard",
    ]);
    expect(base.__calls.filter((c) => c.kind === "create" && c.table === "Reports")).toHaveLength(
      0,
    );
  });

  it("time-boxes the default probe so a trickling origin cannot stall the chain", async () => {
    // The real defaultProbe, not an injected one. Undici's defaults are 300s
    // headers + 300s body, and the body timeout is an INACTIVITY timer — so a
    // trickling origin could hold the launch chain for ~10 minutes AFTER the
    // GitHub writes and a full Lighthouse audit had already run. Every other
    // outbound fetch in this repo is timeboxed (audits/function-health.ts,
    // audits/netlify-deploy.ts, ~15 call sites in prospect/).
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, init });
      if (url.endsWith("/dev/match/home"))
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => "<div><h1>404</h1><p>Not found</p></div>",
        };
      return { ok: true, status: 200, statusText: "OK", text: async () => '{"ok":true}' };
    }) as unknown as typeof global.fetch;

    const base = makeFakeBase(websitesSeed());
    const d = deps(base);
    // NOTE: deps.probe deliberately omitted — this exercises defaultProbe.
    const result = await launch(siteOf(), {
      base: d.base,
      bootstrap: d.bootstrap,
      audit: d.audit,
    });
    expect(result.complete).toBe(true);

    for (const path of ["/dev/match/home", "/health"]) {
      const call = seen.find((c) => c.url.endsWith(path));
      expect(call, `expected defaultProbe to fetch ${path}`).toBeDefined();
      expect(call!.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call!.init?.redirect).toBe("follow");
    }
  });

  it("stops before bootstrap when the checkout serves an unguarded /dev/match twin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      "export const prerender = false;\nexport async function load({ params }) {\n  return { uid: params.uid };\n}\n",
    );
    const base = makeFakeBase(websitesSeed());
    let bootstrapped = false;
    const result = await launch(
      { path: dir, name: "Acme Co" },
      {
        ...deps(base),
        bootstrap: async (): Promise<RecipeResult> => {
          bootstrapped = true;
          return { recipe: "self-updating", site: "Acme Co", status: "applied", commits: [] };
        },
      },
    );
    expect(result.complete).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual(["matching-disposition"]);
    expect(bootstrapped).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a COMMENTED-OUT dev guard (the likeliest real-world state)", async () => {
    // Import left in place, guard commented out. Pre-hardening this PASSED:
    // `includes("$app/environment")` matched the live import and the `if (!dev)`
    // regex happily matched inside the comment.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-commented-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        "  // temporarily disabled for the matching gates:",
        '  // if (!dev) error(404, { message: "Not found" });',
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    const base = makeFakeBase(websitesSeed());
    const result = await launch({ path: dir, name: "Acme Co" }, deps(base));
    expect(result.complete).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual(["matching-disposition"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a guard that does not actually refuse", async () => {
    // `if (!dev) console.warn(...)` satisfied the old regex pair and shipped the
    // twin anyway. A refusal (`error(404` or a `throw`) must co-occur.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-nowarn-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        '  if (!dev) console.warn("matching twin reached in production");',
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    const base = makeFakeBase(websitesSeed());
    const result = await launch({ path: dir, name: "Acme Co" }, deps(base));
    expect(result.complete).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual(["matching-disposition"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a LAYOUT-level guard covering every child of /dev/match", async () => {
    // A guard on src/routes/dev/match/+layout.server.ts covers the whole subtree
    // and is the BETTER placement — yet the page-file-only check reported it as
    // "would ship", penalising the correct fix.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-layout-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/+layout.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export function load() {",
        '  if (!dev) error(404, { message: "Not found" });',
        "}",
      ].join("\n"),
    );
    // The page itself is the UNGUARDED beachfront-shaped twin.
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        '  if (!assemblies[params.uid]) error(404, { message: "no matching assembly" });',
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    const base = makeFakeBase(websitesSeed());
    const result = await launch({ path: dir, name: "Acme Co" }, deps(base));
    expect(result.complete).toBe(true);
    expect(result.steps[0]!.result).toMatchObject({
      kind: "probe",
      message: expect.stringContaining("+layout.server.ts"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("passes the pre-flight once the twin route carries the dev guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-ok-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      'import { dev } from "$app/environment";\nimport { error } from "@sveltejs/kit";\nexport const prerender = false;\nexport async function load({ params }) {\n  if (!dev) error(404, { message: "Not found" });\n  return { uid: params.uid };\n}\n',
    );
    const base = makeFakeBase(websitesSeed());
    const result = await launch({ path: dir, name: "Acme Co" }, deps(base));
    expect(result.complete).toBe(true);
    expect(result.steps[0]!.result).toMatchObject({
      kind: "probe",
      message: expect.stringContaining("dev guard"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts the guard one level UP, on src/routes/dev/+layout.server.ts (#717)", async () => {
    // The fleet-wide class-fix for "dev routes ship in production" is ONE file:
    // src/routes/dev/+layout.server.ts doing `if (!dev) error(404)`. Its load
    // runs for /dev/match/[uid] as well, so such a site is guarded — and better
    // guarded than one that patched only the twin. The dev-guard half of this
    // feature was deliberately redesigned to survive that fix (the control moved
    // off /dev/a11y-fixtures onto /health for exactly this reason); a filesystem
    // half that reads only inside /dev/match contradicts it and reports the
    // correct fix as "the matching twin would ship".
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-dev-layout-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/+layout.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export function load() {",
        '  if (!dev) error(404, { message: "Not found" });',
        "}",
      ].join("\n"),
    );
    // The twin itself is the UNGUARDED beachfront-shaped route.
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        '  if (!assemblies[params.uid]) error(404, { message: "no matching assembly" });',
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({
      ok: true,
      message: expect.stringContaining("src/routes/dev/+layout.server.ts"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a guard whose refusal sits in a BLOCK", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-block-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        "  if (!dev) {",
        '    error(404, { message: "Not found" });',
        "  }",
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a warn-only guard even when an unrelated throw follows it", async () => {
    // The three conditions used to be ANDed across the WHOLE file, with nothing
    // tying the refusal to the `if (!dev)`. Any `throw` anywhere in the file —
    // here the route's own missing-document branch, three lines down and with no
    // closing brace in between — granted the refusal the guard never makes. This
    // is the exact half-fix the code comment claimed had already been closed.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-warn-then-throw-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        '  if (!dev) console.warn("matching twin reached in production");',
        "  const doc = assemblies[params.uid];",
        '  if (!doc) throw new Error("no matching assembly");',
        "  return { uid: params.uid, doc };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: false });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a refusal that exists only inside a string literal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-string-refusal-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        "export const prerender = false;",
        "export async function load({ params }) {",
        '  if (!dev) console.warn("this should throw error(404, ...) and does not");',
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: false });
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts plan BC's ROUTE_SERVER template — the predicate is a contract with it", async () => {
    const source = bcRouteServerTemplate();
    // Fail loudly if the extraction silently grabbed the wrong fence: an empty
    // string would sail through the guard check as a plain `ok: false` and this
    // test would then be measuring nothing.
    expect(source).toContain("if (!dev) error(404");
    expect(source).toContain("no assembly for");
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-bc-template-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), source);
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a path that is not a SvelteKit checkout at all", async () => {
    // `resolveSites` does `localPath(resolve(cwd, site))` with no existence
    // check, so a path never cloned, a stale clone, a typo'd site name and the
    // wrong working directory all produce the same absent src/routes/dev/match —
    // and that absence was being read as positive evidence of a pass. This is
    // the shape the deployed gate closed by requiring /health to answer 200
    // before its 404 could mean anything.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-not-a-checkout-"));
    await expect(matchingDisposition(dir)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("disposition cannot be established"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("passes a real checkout that simply carries no matching twin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-no-twin-"));
    await mkdir(join(dir, "src/routes"), { recursive: true });
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a correct guard in a file whose regex literal contains a quote (#726)", async () => {
    // The scanner pair was not regex-aware: the apostrophe inside `/[a-z0-9']+/`
    // opened a string literal that never closed, so `stripComments` under-stripped
    // from there and `maskLiterals` then blanked the rest of the file — taking the
    // live `if (!dev) error(404)` with it. A correctly guarded twin read as
    // unguarded and `launch` stopped at step 0 saying "the matching twin would
    // ship". This is the fixture #726 asks for.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-regex-quote-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "const SLUG = /[a-z0-9']+/;",
        "export async function load({ params }) {",
        '  if (!dev) error(404, { message: "Not found" });',
        "  return { uid: params.uid, ok: SLUG.test(params.uid) };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a refusal that exists only inside a REGEX literal", async () => {
    // The other half of regex-awareness, and the reason the regex body is masked
    // rather than passed through: `maskLiterals` exists so a refusal token that is
    // only ever data cannot grant a pass. A regex is data too — without this, the
    // guard's own consequent `RE = /throw/` matched REFUSAL and granted.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-regex-refusal-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        "export const prerender = false;",
        "let RE;",
        "export async function load({ params }) {",
        "  if (!dev) RE = /throw/;",
        "  return { uid: params.uid };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: false });
    await rm(dir, { recursive: true, force: true });
  });

  it("still refuses a COMMENTED-OUT guard that sits below a regex literal", async () => {
    // Regex-awareness must not widen the grant: the comment stripper still has to
    // reach a commented-out guard on the far side of a regex containing a quote.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-regex-commented-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "const SLUG = /[a-z0-9']+/;",
        "export async function load({ params }) {",
        '  // if (!dev) error(404, { message: "Not found" });',
        "  return { uid: params.uid, ok: SLUG.test(params.uid) };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: false });
    await rm(dir, { recursive: true, force: true });
  });

  it("reads `/` after an identifier as DIVISION, not as a regex literal", async () => {
    // The disambiguation's other direction. If division opened a regex literal,
    // the scan would run to the next `/` and could swallow the guard — so this is
    // the control that proves the lookback is not simply calling every `/` a
    // regex.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-division-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+page.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export const prerender = false;",
        "export async function load({ params, total = 10 }) {",
        "  const half = total / 2;",
        "  const ratio = half / total;",
        '  if (!dev) error(404, { message: "Not found" });',
        "  return { uid: params.uid, ratio };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  /** A guarded twin page, so a fixture exercising ANOTHER gap still clears the
   *  page half of the pre-flight. */
  const GUARDED_TWIN = [
    'import { dev } from "$app/environment";',
    'import { error } from "@sveltejs/kit";',
    "export const prerender = false;",
    "export async function load({ params }) {",
    '  if (!dev) error(404, { message: "Not found" });',
    "  return { uid: params.uid };",
    "}",
  ].join("\n");

  it("refuses a +server.ts under /dev/match that a LAYOUT guard cannot cover (#723)", async () => {
    // SvelteKit layout `load` does not run for `+server.ts` endpoints, so a site
    // whose only guard is the /dev layout satisfies the old fixed-path check
    // while the endpoint is served in production. The deployed gate misses it
    // too: it probes the page path, which 404s correctly.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-endpoint-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(
      join(dir, "src/routes/dev/+layout.server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error } from "@sveltejs/kit";',
        "export function load() {",
        '  if (!dev) error(404, { message: "Not found" });',
        "}",
      ].join("\n"),
    );
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), GUARDED_TWIN);
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+server.ts"),
      [
        "import { json } from '@sveltejs/kit';",
        "export async function GET({ params }) {",
        "  return json({ uid: params.uid });",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("+server.ts"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a +server.ts that carries its OWN guard", async () => {
    // The control for the rule above: the endpoint rule must be able to PASS, or
    // the refusal it produces is not evidence of anything.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-endpoint-ok-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), GUARDED_TWIN);
    await writeFile(
      join(dir, "src/routes/dev/match/[uid]/+server.ts"),
      [
        'import { dev } from "$app/environment";',
        'import { error, json } from "@sveltejs/kit";',
        "export async function GET({ params }) {",
        '  if (!dev) error(404, { message: "Not found" });',
        "  return json({ uid: params.uid });",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({ ok: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses an unguarded SIBLING route under /dev/match (#723)", async () => {
    // The old check inspected three fixed paths and returned on the first guarded
    // one, so a /dev/match/frozen index — a natural thing for a match harness to
    // grow — was inspected by neither gate. The deployed half probes only
    // /dev/match/home and never sees it either.
    const dir = await mkdtemp(join(tmpdir(), "launch-disposition-sibling-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await mkdir(join(dir, "src/routes/dev/match/frozen"), { recursive: true });
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), GUARDED_TWIN);
    await writeFile(
      join(dir, "src/routes/dev/match/frozen/+page.server.ts"),
      [
        "export const prerender = false;",
        "export async function load() {",
        "  return { comps: [] };",
        "}",
      ].join("\n"),
    );
    await expect(matchingDisposition(dir)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("frozen"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("probes EVERY uid in matching/harness.json, not just home (#723)", async () => {
    // harness.json is the real uid source — it is what the match-harness recipe
    // installs and what the gates read. Probing a hardcoded "home" leaves every
    // sibling uid unprobed, so a LIVE twin on any other uid passed the deployed
    // gate untouched.
    const dir = await mkdtemp(join(tmpdir(), "launch-devguard-uids-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), GUARDED_TWIN);
    await mkdir(join(dir, "matching"), { recursive: true });
    await writeFile(
      join(dir, "matching/harness.json"),
      JSON.stringify({
        pages: {
          home: { uid: "home", cand: "/dev/match/home" },
          services: { uid: "services", cand: "/dev/match/services" },
          legal: { uid: null, cand: "/legal" },
        },
      }),
    );
    const base = makeFakeBase(websitesSeed());
    const result = await launch(
      { path: dir, name: "Acme Co" },
      {
        ...deps(base),
        probe: async (url: string) => {
          // home is correctly guarded; services is the LIVE twin, announcing
          // itself with the machine tell.
          if (url.endsWith("/dev/match/services"))
            return {
              status: 404,
              body: `<h1>404</h1><p>${UNGUARDED_TWIN_TELL}: no assembly for "services"</p>`,
            };
          if (url.includes("/dev/match/")) return { status: 404, body: "<h1>404</h1>" };
          return { status: 200, body: '{"ok":true}' };
        },
      },
    );
    expect(result.complete).toBe(false);
    const devGuard = result.steps.find((s) => s.name === "dev-guard");
    expect(devGuard?.result).toMatchObject({
      kind: "error",
      message: expect.stringContaining("services"),
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to /dev/match/home when there is no matching/harness.json", async () => {
    // Not every launched site carries the harness. An absent harness.json must
    // keep the previous behaviour rather than becoming a hard failure — and this
    // control is what proves the enumeration did not turn absence into a refusal.
    const dir = await mkdtemp(join(tmpdir(), "launch-devguard-no-harness-"));
    await mkdir(join(dir, "src/routes/dev/match/[uid]"), { recursive: true });
    await writeFile(join(dir, "src/routes/dev/match/[uid]/+page.server.ts"), GUARDED_TWIN);
    const base = makeFakeBase(websitesSeed());
    const probed: string[] = [];
    const result = await launch(
      { path: dir, name: "Acme Co" },
      {
        ...deps(base),
        probe: async (url: string) => {
          probed.push(url);
          if (url.endsWith("/dev/match/home")) return { status: 404, body: "<h1>404</h1>" };
          return { status: 200, body: '{"ok":true}' };
        },
      },
    );
    expect(result.complete).toBe(true);
    expect(probed.some((u) => u.endsWith("/dev/match/home"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

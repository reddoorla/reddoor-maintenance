# Prospect Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `maintenance prospect-audit <url>` runs a three-tier AEO/SEO audit of an external prospect's website and produces a Reddoor-branded report at a public tokened link (`/r/{token}`) on the maintenance Netlify site.

**Architecture:** A new `src/prospect/` module — five pipeline stages (crawl → checks → lighthouse → analyze → probes) behind one orchestrator with per-stage isolation, persisted to Turso (`prospect_audits`), rendered by one HTML renderer shared by the CLI `--out` file and the hosted Netlify function. Spec: `docs/superpowers/specs/2026-08-24-prospect-audit-design.md`.

**Tech Stack:** TypeScript ESM, node-html-parser (already a dependency), @playwright/test (already a dependency) for rendered DOM, @anthropic-ai/sdk (NEW devDependency) for the answerability pass + Claude web-search probe, Perplexity Sonar via plain fetch, kysely + libSQL (Turso), cac CLI + listr2, Netlify functions (.mts), vitest.

**Working directory:** the `feat/prospect-audit` worktree at `.worktrees/prospect-audit/` (the main checkout belongs to another session — never touch it). All paths below are relative to the worktree root. Run installs/tests inside it (`pnpm install` once at the start; the worktree shares the repo's store).

---

## Repo conventions the engineer must know

- **Tests live in `tests/`, mirroring `src/`** — `tests/prospect/*.test.ts`, `tests/db/*.test.ts`, `tests/cli/*.test.ts`. NOT colocated (the spec says "colocated per module (repo convention)"; that was wrong — vitest.config.ts includes only `tests/**/*.test.ts`. Follow the repo, note nothing).
- **`pnpm test` rebuilds `dist/` first** (pretest → tsup) because CLI tests exec `dist/cli/bin.js`. A single test file: `pnpm vitest run tests/prospect/extract.test.ts` (skips the build; fine for pure-module TDD loops). Use plain `pnpm vitest run <file>` for the red/green steps and the full `pnpm test` at task boundaries.
- **Coverage floor** (statements 78 / branches 67 / functions 76 / lines 80) counts EVERY `src/**/*.ts` file, tested or not. Untested additions trip CI. Every module below ships with tests in the same task.
- **Heavy deps are devDependencies** (libSQL/kysely, airtable, mjml…) so consuming fleet sites don't inherit them; `@anthropic-ai/sdk` follows that pattern. `tsup.config.ts` externalizes all dep groups and has `splitting: true`, so `bin.ts`'s lazy `await import("./commands/…")` becomes an on-demand chunk automatically — **no tsup change needed**, but every heavy import in the new CLI command/pipeline must be a lazy dynamic import (same reason as the existing commands: fleet sites run `reddoor-maint audit` without those packages installed).
- **Netlify functions** self-register routes via `export const config = { path: [...] }` (no netlify.toml redirects) and import `src/**` directly with `.js` extensions (esbuild resolves to `.ts`). `pnpm typecheck` also runs `tsc -p tsconfig.netlify.json` which covers `netlify/functions/`.
- **Migrations** are append-only, idempotent, standard SQLite; next id is `0009` (0008 shipped). Keep `src/db/schema.ts` in lockstep.
- **DB tests** use `openDb({ url: ":memory:" })` — migrations run automatically.
- Small utils to reuse: `escapeHtml`/`safeUrl` (`src/util/html.ts`), `isHttpUrl` (`src/util/url.ts`).
- Errors that should set a CLI exit code carry it: `Object.assign(new Error(msg), { exitCode: 2 })` (see `src/db/client.ts:missing`).

## File structure

| File | Responsibility |
|---|---|
| `src/prospect/types.ts` | All shared types: `StageResult`, crawl/checks/analyze/probes shapes, `ProspectAuditResult` |
| `src/prospect/extract.ts` | Pure HTML → `PageExtract` (title/meta/OG/headings/JSON-LD/alt/viewport/text) |
| `src/prospect/crawl.ts` | robots parsing + AI-crawler matrix (pure) and `crawlSite` (injectable fetch/renderer) |
| `src/prospect/checks.ts` | Pure scoring over `CrawlResult` + `computeScores` |
| `src/prospect/analyze.ts` | Prompt builder (pure), JSON schema, injectable Claude call, shape validation |
| `src/prospect/probes.ts` | `VisibilityEngine` interface, query builder (pure), Perplexity + Claude adapters, aggregation |
| `src/prospect/pipeline.ts` | `runProspectAudit` orchestrator: stage isolation, lighthouse reuse, score assembly |
| `src/prospect/render.ts` | `renderProspectReport(result): string` — one branded self-contained HTML page |
| `src/db/migrations.ts` | + migration `0009_prospect_audits` |
| `src/db/schema.ts` | + `ProspectAuditsTable` |
| `src/db/prospect-audits.ts` | token generate/validate, insert, get-by-token |
| `src/cli/commands/prospect-audit.ts` | CLI command: listr2 progress, persist, link/`--out` output |
| `src/cli/bin.ts` | register `prospect-audit <url>` (lazy import) |
| `netlify/functions/prospect-report.mts` | public `GET /r/:token` — no basic auth, noindex |
| `tests/fixtures/prospect/*.html` | rich/bare page fixtures |
| `tests/prospect/*.test.ts`, `tests/db/prospect-audits.test.ts`, `tests/cli/prospect-audit-command.test.ts` | coverage |

---

### Task 1: Types

**Files:**
- Create: `src/prospect/types.ts`

Types-only module — no runtime code, so no test file (nothing to execute); `tsc` is the check. Everything later imports from here; later tasks MUST match these names exactly.

- [ ] **Step 1: Write the module**

```ts
import type { AuditResult } from "../types.js";

/** Every pipeline stage resolves to this. A failed stage degrades its report
 *  section to "not measured" — it never kills the run (spec: error handling). */
export type StageResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type RobotsAgentAccess = {
  agent: string;
  /** May this agent fetch "/" per robots.txt? (No robots.txt → allowed.) */
  allowed: boolean;
  /** The deciding rule, e.g. "User-agent: GPTBot → Disallow: /". Null = no rule matched. */
  matchedRule: string | null;
};

export type PageExtract = {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  /** property/name → content for og:* and twitter:* metas. */
  social: Record<string, string>;
  headings: { level: number; text: string }[];
  /** Raw text of each <script type="application/ld+json"> block. */
  jsonLd: string[];
  images: { total: number; withAlt: number };
  hasViewportMeta: boolean;
  /** Visible text, whitespace-collapsed. */
  text: string;
};

export type PageCapture = {
  url: string;
  /** HTTP status of the raw fetch. Null = the fetch itself failed. */
  status: number | null;
  /** Extract of the raw HTTP HTML (what non-JS crawlers see). */
  raw: PageExtract | null;
  /** Extract of the Playwright-rendered DOM (what a browser sees). */
  rendered: PageExtract | null;
  error: string | null;
};

export type CrawlResult = {
  /** Normalized origin, e.g. "https://example.com". */
  origin: string;
  robotsTxt: string | null;
  /** One entry per agent in crawl.ts's ALL_AGENTS (6 AI + 2 classical). */
  agentAccess: RobotsAgentAccess[];
  sitemap: { present: boolean; urlCount: number };
  llmsTxt: { present: boolean; firstLine: string | null };
  /** Lower-cased homepage response headers (security-header check input). */
  homeHeaders: Record<string, string>;
  pages: PageCapture[];
};

export type ChecksResult = {
  crawlerAccess: { blockedAi: string[]; allowedAi: string[]; blockedClassical: string[] };
  jsDependence: {
    /** 0..1 — fraction of rendered words absent from the raw HTML, averaged over pages. */
    avgMissing: number;
    perPage: { url: string; missing: number }[];
  };
  schema: { typesFound: string[]; missingExpected: string[]; invalidBlocks: number };
  meta: {
    pageCount: number;
    missingTitle: number;
    missingDescription: number;
    missingCanonical: number;
    missingSocial: number;
  };
  headings: { pagesWithoutH1: number; pagesWithLevelSkips: number };
  securityHeaders: { present: string[]; missing: string[] };
  sitemapPresent: boolean;
  llmsTxtPresent: boolean;
  viewportOk: boolean;
};

export type BuyerQuestion = {
  question: string;
  answered: "yes" | "partial" | "no";
  /** Is there a passage an AI answer could quote verbatim? */
  quotable: boolean;
  page: string | null;
  evidence: string | null;
};

export type Fix = {
  title: string;
  why: string;
  impact: "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
  tier: "crawl" | "content" | "technical";
};

export type AnalyzeResult = {
  /** The model's read of what this company does, for whom, where. */
  business: string;
  entityClarity: { score: number; missing: string[] };
  buyerQuestions: BuyerQuestion[];
  fixes: Fix[];
  narrative: { findability: string; readability: string; answers: string };
};

export type ProbeAnswer = {
  engine: string;
  query: string;
  domainCited: boolean;
  brandMentioned: boolean;
  citedDomains: string[];
  /** First ~300 chars of the engine's answer — the report's receipt. */
  snippet: string;
};

export type ProbesResult = {
  answers: ProbeAnswer[];
  /** 0..100 — fraction of answers where the prospect was cited or mentioned. */
  visibilityScore: number;
  competitorsSeen: { domain: string; count: number }[];
};

export type LighthouseScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  summary: string;
  status: AuditResult["status"];
};

export type Scores = {
  findability: number | null;
  readability: number | null;
  answers: number | null;
  aiVisibility: number | null;
};

export type ProspectAuditResult = {
  url: string;
  business: string | null;
  generatedAt: string;
  scores: Scores;
  crawl: StageResult<CrawlResult>;
  checks: StageResult<ChecksResult>;
  lighthouse: StageResult<LighthouseScores>;
  analyze: StageResult<AnalyzeResult>;
  probes: StageResult<ProbesResult>;
};
```

- [ ] **Step 2: Typecheck**

Run: `cd .worktrees/prospect-audit && npx tsc --noEmit`
Expected: clean (the file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/prospect/types.ts
git commit -m "feat(prospect): shared types for the prospect audit pipeline"
```

---

### Task 2: Turso table + accessors

**Files:**
- Modify: `src/db/migrations.ts` (append after `0008_query_plan_indexes`)
- Modify: `src/db/schema.ts` (new interface + `Database` entry)
- Create: `src/db/prospect-audits.ts`
- Test: `tests/db/prospect-audits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
  generateToken,
  isValidToken,
} from "../../src/db/prospect-audits.js";

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

describe("prospect_audits", () => {
  it("round-trips an audit and finds it by token", async () => {
    const { id, token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      resultJson: '{"scores":{}}',
    });
    expect(id).toBeTruthy();
    const row = await getProspectAuditByToken(db, token);
    expect(row).not.toBeNull();
    expect(row!.url).toBe("https://example.com");
    expect(row!.business).toBe("Example Co");
    expect(row!.result_json).toBe('{"scores":{}}');
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null for an unknown token", async () => {
    expect(await getProspectAuditByToken(db, "AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });

  it("stores a null business", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: null,
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.business).toBeNull();
  });

  it("generates distinct 22-char base64url tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isValidToken(a)).toBe(true);
  });

  it("isValidToken rejects malformed tokens", () => {
    expect(isValidToken("short")).toBe(false);
    expect(isValidToken("A".repeat(23))).toBe(false);
    expect(isValidToken("has/slash_but_22_chars")).toBe(false);
    expect(isValidToken("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/db/prospect-audits.test.ts`
Expected: FAIL — cannot resolve `../../src/db/prospect-audits.js`.

- [ ] **Step 3: Append migration 0009 in `src/db/migrations.ts`**

Add to the end of the `MIGRATIONS` array (after the `0008_query_plan_indexes` entry):

```ts
  {
    // Prospect audits (spec 2026-08-24): one row per `prospect-audit` CLI run.
    // `token` is the unguessable public handle for GET /r/{token}; `result_json`
    // is the full ProspectAuditResult, re-rendered on every request so report
    // styling updates apply to already-shared links.
    id: "0009_prospect_audits",
    sql: `
      CREATE TABLE IF NOT EXISTS prospect_audits (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        business TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'complete',
        result_json TEXT NOT NULL
      );
    `,
  },
```

- [ ] **Step 4: Add the table to `src/db/schema.ts`**

Append the interface and register it in `Database`:

```ts
/** One prospect-audit run (migration 0009). `token` is the 128-bit unguessable
 *  public handle for GET /r/{token}; `result_json` holds the full
 *  ProspectAuditResult (src/prospect/types.ts). */
export interface ProspectAuditsTable {
  id: string;
  token: string;
  url: string;
  business: string | null;
  created_at: string;
  status: string;
  result_json: string;
}
```

In `export interface Database { … }` add:

```ts
  prospect_audits: ProspectAuditsTable;
```

- [ ] **Step 5: Write `src/db/prospect-audits.ts`**

```ts
import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./client.js";

/** 16 random bytes → 22-char base64url string: unguessable, URL-safe. */
export function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Anything not exactly generateToken()-shaped is a probe, not a report. */
export function isValidToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(s);
}

export type NewProspectAudit = {
  url: string;
  business: string | null;
  resultJson: string;
};

export async function createProspectAudit(
  db: Db,
  audit: NewProspectAudit,
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = generateToken();
  await db
    .insertInto("prospect_audits")
    .values({
      id,
      token,
      url: audit.url,
      business: audit.business,
      created_at: new Date().toISOString(),
      status: "complete",
      result_json: audit.resultJson,
    })
    .execute();
  return { id, token };
}

export type ProspectAuditRow = {
  id: string;
  url: string;
  business: string | null;
  created_at: string;
  result_json: string;
};

export async function getProspectAuditByToken(
  db: Db,
  token: string,
): Promise<ProspectAuditRow | null> {
  const row = await db
    .selectFrom("prospect_audits")
    .select(["id", "url", "business", "created_at", "result_json"])
    .where("token", "=", token)
    .executeTakeFirst();
  return row ?? null;
}
```

- [ ] **Step 6: Run the test — must pass**

Run: `pnpm vitest run tests/db/prospect-audits.test.ts`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts src/db/prospect-audits.ts tests/db/prospect-audits.test.ts
git commit -m "feat(prospect): prospect_audits table, token helpers, accessors (migration 0009)"
```

---

### Task 3: HTML extraction + fixtures

**Files:**
- Create: `tests/fixtures/prospect/rich.html`
- Create: `tests/fixtures/prospect/bare.html`
- Create: `src/prospect/extract.ts`
- Test: `tests/prospect/extract.test.ts`

`extract.ts` walks the parsed tree ONCE, collecting metas/links/scripts/images/headings/text in document order. Do not reach for CSS selectors — heading order decides the level-skip check, and a single ordered walk is the only thing that guarantees it.

- [ ] **Step 1: Write the two fixtures**

`tests/fixtures/prospect/rich.html` — a well-marked-up page (the "good" case):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Acme Roofing — Commercial Roof Repair in Boise, Idaho</title>
    <meta
      name="description"
      content="Acme Roofing repairs and replaces commercial roofs across the Treasure Valley."
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta property="og:title" content="Acme Roofing" />
    <meta property="og:image" content="https://acme.example/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="https://acme.example/" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Acme Roofing",
        "address": { "@type": "PostalAddress", "addressLocality": "Boise", "addressRegion": "ID" }
      }
    </script>
  </head>
  <body>
    <header>
      <nav>
        <a href="/services">Services</a>
        <a href="/about">About</a>
        <a href="/services">Services again</a>
        <a href="https://facebook.example/acme">Facebook</a>
      </nav>
    </header>
    <main>
      <h1>Commercial <span>roof repair</span> in Boise</h1>
      <p>We repair flat commercial roofs across the Treasure Valley, usually within two business days.</p>
      <h2>What it costs</h2>
      <p>Most repairs run between $1,200 and $8,000 depending on membrane type.</p>
      <img src="/roof.jpg" alt="A repaired flat roof" />
      <img src="/spacer.gif" alt="" />
    </main>
    <script>
      window.__ANALYTICS__ = "should not appear in text";
    </script>
  </body>
</html>
```

`tests/fixtures/prospect/bare.html` — the same site's RAW HTML when everything is client-rendered (the JS-dependence case):

```html
<!doctype html>
<html lang="en">
  <head>
    <title>Acme</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="root"></div>
    <script src="/bundle.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test**

`tests/prospect/extract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractPage } from "../../src/prospect/extract.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

describe("extractPage — a fully marked-up page", () => {
  const page = extractPage(fixture("rich.html"));

  it("reads the title, description and canonical", () => {
    expect(page.title).toBe("Acme Roofing — Commercial Roof Repair in Boise, Idaho");
    expect(page.metaDescription).toContain("Treasure Valley");
    expect(page.canonical).toBe("https://acme.example/");
  });

  it("collects only og:/twitter: metas as social", () => {
    expect(page.social["og:title"]).toBe("Acme Roofing");
    expect(page.social["og:image"]).toBe("https://acme.example/og.jpg");
    expect(page.social["twitter:card"]).toBe("summary_large_image");
    expect(page.social["description"]).toBeUndefined();
    expect(page.social["viewport"]).toBeUndefined();
  });

  it("reads headings in document order, flattening inline markup", () => {
    expect(page.headings).toEqual([
      { level: 1, text: "Commercial roof repair in Boise" },
      { level: 2, text: "What it costs" },
    ]);
  });

  it("captures JSON-LD blocks verbatim", () => {
    expect(page.jsonLd).toHaveLength(1);
    expect(JSON.parse(page.jsonLd[0]!)["@type"]).toBe("LocalBusiness");
  });

  it("counts images with a non-empty alt", () => {
    expect(page.images).toEqual({ total: 2, withAlt: 1 });
  });

  it("detects the viewport meta", () => {
    expect(page.hasViewportMeta).toBe(true);
  });

  it("returns word-separated visible text without script or head content", () => {
    expect(page.text).toContain("roof repair in Boise We repair flat commercial roofs");
    expect(page.text).not.toContain("should not appear in text");
    expect(page.text).not.toContain("Acme Roofing — Commercial");
    expect(page.text).not.toContain("<!doctype");
  });
});

describe("extractPage — a client-rendered shell", () => {
  const page = extractPage(fixture("bare.html"));

  it("has a title but no body text, headings or schema", () => {
    expect(page.title).toBe("Acme");
    expect(page.text).toBe("");
    expect(page.headings).toEqual([]);
    expect(page.jsonLd).toEqual([]);
  });

  it("reports the missing description and canonical as null", () => {
    expect(page.metaDescription).toBeNull();
    expect(page.canonical).toBeNull();
  });
});
```

- [ ] **Step 3: Run it — must fail**

Run: `pnpm vitest run tests/prospect/extract.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/extract.js`.

- [ ] **Step 4: Write `src/prospect/extract.ts`**

```ts
import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { PageExtract } from "./types.js";

/** Subtrees a browser never renders. Skipped WHOLE — including their headings,
 *  images and schema blocks, which a <template> stamp would otherwise donate to
 *  the page's real counts. */
const OPAQUE = new Set(["STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);

/** Elements that force a break in rendered text. Inline elements deliberately do
 *  NOT: `<b>Acme</b>Corp` is one word on screen and must stay one word here,
 *  because the raw-vs-rendered word diff is what the audit's headline number is
 *  made of, and an invented word break biases it in only one direction. */
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "TABLE", "TD", "TH", "TR", "UL",
]);

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Rendered text of one element: text nodes concatenated with NO inserted
 *  separator, a newline at each block boundary, whitespace collapsed last —
 *  which is what a browser shows. TITLE and SCRIPT are dropped wherever they
 *  appear, since a <title> misplaced in <body> is still invisible. */
function textOf(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: HTMLElement): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) {
        parts.push(child.text);
        continue;
      }
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      const tag = e.tagName;
      if (OPAQUE.has(tag) || tag === "SCRIPT" || tag === "TITLE") continue;
      const block = BLOCK.has(tag);
      if (block) parts.push("\n");
      walk(e);
      if (block) parts.push("\n");
    }
  };
  walk(el);
  return collapse(parts.join(""));
}

type Collected = {
  metas: HTMLElement[];
  links: HTMLElement[];
  jsonLd: string[];
  images: HTMLElement[];
  headings: { level: number; text: string }[];
  title: string | null;
};

/** One ordered pass for the element-level signals. Document order matters: the
 *  heading sequence drives a later level-skip check. */
function collect(el: HTMLElement, out: Collected): void {
  for (const child of el.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const e = child as HTMLElement;
    const tag = e.tagName;
    if (OPAQUE.has(tag)) continue;
    switch (tag) {
      case "META":
        out.metas.push(e);
        break;
      case "LINK":
        out.links.push(e);
        break;
      case "IMG":
        out.images.push(e);
        break;
      case "TITLE":
        if (out.title === null) out.title = collapse(e.text) || null;
        break;
      case "SCRIPT":
        if ((e.getAttribute("type") ?? "").toLowerCase().trim() === "application/ld+json") {
          out.jsonLd.push(e.text);
        }
        // Raw-text element — nothing inside to walk.
        continue;
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = textOf(e);
        if (text) out.headings.push({ level: Number(tag.slice(1)), text });
        break;
      }
    }
    collect(e, out);
  }
}

/** Parse one HTML document into the signals every downstream check reads.
 *  Pure — the same input always yields the same extract. */
export function extractPage(html: string): PageExtract {
  const root = parse(html);
  // node-html-parser surfaces `<!doctype html>` as a TEXT node that is a SIBLING
  // of <html>, not a doctype node, so the walk starts at <html> when there is one.
  const documentEl = root.querySelector("html") ?? root;
  const out: Collected = {
    metas: [],
    links: [],
    jsonLd: [],
    images: [],
    headings: [],
    title: null,
  };
  collect(documentEl, out);

  const social: Record<string, string> = {};
  let metaDescription: string | null = null;
  let hasViewportMeta = false;
  for (const m of out.metas) {
    const key = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase().trim();
    if (!key) continue;
    const content = (m.getAttribute("content") ?? "").trim();
    if (key === "description") metaDescription = content || null;
    else if (key === "viewport") hasViewportMeta = content.length > 0;
    else if (key.startsWith("og:") || key.startsWith("twitter:")) social[key] = content;
  }

  const canonicalEl = out.links.find(
    (l) => (l.getAttribute("rel") ?? "").toLowerCase().trim() === "canonical",
  );

  return {
    title: out.title,
    metaDescription,
    canonical: canonicalEl?.getAttribute("href")?.trim() || null,
    social,
    headings: out.headings,
    jsonLd: out.jsonLd,
    images: {
      total: out.images.length,
      withAlt: out.images.filter((i) => (i.getAttribute("alt") ?? "").trim().length > 0).length,
    },
    hasViewportMeta,
    // Body-scoped: <head> has no visible text, and scoping here rather than
    // filtering keeps the rule obvious.
    text: textOf(root.querySelector("body") ?? documentEl),
  };
}
```

- [ ] **Step 5: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/extract.test.ts`
Expected: 9 passed, plus the parser-reality cases below.

- [ ] **Step 5b: Pin the parser-reality cases**

`node-html-parser` diverges from a browser in ways that quietly corrupt exactly the fields Task 6 measures. Add a second describe block with inline HTML strings (no new fixture files) covering each:

- a `<template>` holding an `<h1>`, an `<img alt>` and a JSON-LD `<script>` contributes NOTHING to `headings`, `images` or `jsonLd`, while a real sibling `<h1>` still counts;
- `<p>Welcome to <b>Acme</b>Corp today.</p>` → text contains `"AcmeCorp"`, one word;
- `<p>Call <a href="tel:+12085550199">208-555-0199</a>. Now.</p>` → text contains `"208-555-0199."`, no space before the period;
- `<p>alpha</p><p>beta</p>` with no whitespace between the tags → `"alpha beta"`, not `"alphabeta"`;
- `<h1>Big Bold<br>Headline</h1>` → heading text `"Big Bold Headline"`;
- a `<title>` inside `<body>` stays out of `text` but is still read into `title`.

- [ ] **Step 6: Commit**

```bash
git add src/prospect/extract.ts tests/prospect/extract.test.ts tests/fixtures/prospect/
git commit -m "feat(prospect): HTML extraction of the AEO signals, with page fixtures"
```

---

### Task 4: robots matrix, link and sitemap parsing (pure)

**Files:**
- Create: `src/prospect/crawl.ts` (pure half — the network half lands in Task 5)
- Test: `tests/prospect/robots.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/prospect/robots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AI_AGENTS,
  ALL_AGENTS,
  evaluateAgentAccess,
  sameOriginLinks,
  parseSitemapLocs,
  isSitemapIndex,
} from "../../src/prospect/crawl.js";

const accessFor = (robots: string | null, agent: string): boolean =>
  evaluateAgentAccess(robots).find((a) => a.agent === agent)!.allowed;

describe("evaluateAgentAccess", () => {
  it("treats a missing robots.txt as full access for every agent", () => {
    const matrix = evaluateAgentAccess(null);
    expect(matrix).toHaveLength(ALL_AGENTS.length);
    expect(matrix.every((a) => a.allowed)).toBe(true);
    expect(matrix.every((a) => a.matchedRule === null)).toBe(true);
  });

  it("blocks every agent under a wildcard Disallow: /", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /");
    expect(matrix.every((a) => !a.allowed)).toBe(true);
    expect(matrix[0]!.matchedRule).toContain("Disallow: /");
  });

  it("blocks only the named AI agent when the rule is agent-specific", () => {
    const robots = "User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /";
    expect(accessFor(robots, "GPTBot")).toBe(false);
    expect(accessFor(robots, "ClaudeBot")).toBe(true);
    expect(accessFor(robots, "Googlebot")).toBe(true);
  });

  it("lets an agent-specific group override a blocking wildcard", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\nDisallow: /";
    expect(accessFor(robots, "Googlebot")).toBe(true);
    expect(accessFor(robots, "GPTBot")).toBe(false);
  });

  it("does not treat a path-scoped Disallow as a site-wide block", () => {
    const matrix = evaluateAgentAccess("User-agent: *\nDisallow: /admin\nDisallow: /cart");
    expect(matrix.every((a) => a.allowed)).toBe(true);
  });

  it("groups consecutive User-agent lines into one rule set", () => {
    const robots = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /";
    expect(accessFor(robots, "GPTBot")).toBe(false);
    expect(accessFor(robots, "CCBot")).toBe(false);
    expect(accessFor(robots, "PerplexityBot")).toBe(true);
  });

  it("ignores comments and matches agents case-insensitively", () => {
    const robots = "# keep the bots out\nUser-agent: gptbot\nDisallow: / # everything";
    expect(accessFor(robots, "GPTBot")).toBe(false);
  });

  it("covers the six AI agents the report scores", () => {
    expect([...AI_AGENTS]).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]);
  });
});

describe("sameOriginLinks", () => {
  const html = `<a href="/services">a</a><a href="/services#top">b</a>
    <a href="https://acme.example/about">c</a><a href="https://other.example/x">d</a>
    <a href="mailto:hi@acme.example">e</a><a>no href</a>`;

  it("returns absolute, deduped, same-origin http(s) links without fragments", () => {
    expect(sameOriginLinks(html, "https://acme.example/")).toEqual([
      "https://acme.example/services",
      "https://acme.example/about",
    ]);
  });
});

describe("sitemap parsing", () => {
  it("pulls every <loc> out of a urlset", () => {
    const xml = `<urlset><url><loc>https://acme.example/</loc></url>
      <url><loc> https://acme.example/about </loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/", "https://acme.example/about"]);
    expect(isSitemapIndex(xml)).toBe(false);
  });

  it("recognizes a sitemap index", () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.example/sitemap-1.xml</loc></sitemap></sitemapindex>`;
    expect(isSitemapIndex(xml)).toBe(true);
    expect(parseSitemapLocs(xml)).toEqual(["https://acme.example/sitemap-1.xml"]);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/robots.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/crawl.js`.

- [ ] **Step 3: Write the pure half of `src/prospect/crawl.ts`**

> **Superseded during execution (commit 6f1f31d).** The code below decides root
> access by exact string equality against `"/"` and picks a group with `.find()`.
> Both are wrong per RFC 9309: `Disallow: /*` and `Disallow: /$` are equally valid
> spellings of a site-wide block, and EVERY group naming an agent must be combined
> rather than the first one winning. Sitemap `<loc>` values also arrive XML-escaped.
> The shipped `src/prospect/crawl.ts` is the corrected version — read it, not this.

```ts
import { parse, HTMLElement, NodeType } from "node-html-parser";
import type { RobotsAgentAccess } from "./types.js";

/** The answer-engine crawlers the report scores. */
export const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;

/** The classical baseline — a prospect blocking these has a bigger problem than AEO. */
export const CLASSICAL_AGENTS = ["Googlebot", "Bingbot"] as const;

export const ALL_AGENTS: string[] = [...AI_AGENTS, ...CLASSICAL_AGENTS];

type RobotsRule = { type: "allow" | "disallow"; path: string; line: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

/** Parse robots.txt into agent groups. Consecutive `User-agent:` lines share one
 *  rule set, per the robots.txt convention. */
export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = (rawLine.split("#")[0] ?? "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      current.rules.push({ type: field === "allow" ? "allow" : "disallow", path: value, line });
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Can each agent fetch the site root? Only rules that cover "/" decide: a
 *  `Disallow: /admin` scopes a section, not the site, and must not read as a
 *  block in the report. An agent-specific group wins over the wildcard group. */
export function evaluateAgentAccess(robotsTxt: string | null): RobotsAgentAccess[] {
  if (robotsTxt === null) {
    return ALL_AGENTS.map((agent) => ({ agent, allowed: true, matchedRule: null }));
  }
  const groups = parseRobots(robotsTxt);
  return ALL_AGENTS.map((agent) => {
    const lower = agent.toLowerCase();
    const specific = groups.find((g) => g.agents.includes(lower));
    const group = specific ?? groups.find((g) => g.agents.includes("*"));
    if (!group) return { agent, allowed: true, matchedRule: null };
    const header = `User-agent: ${specific ? agent : "*"}`;
    const rootRules = group.rules.filter((r) => r.path === "/");
    const block = rootRules.find((r) => r.type === "disallow");
    const allow = rootRules.find((r) => r.type === "allow");
    if (block && !allow) return { agent, allowed: false, matchedRule: `${header} → ${block.line}` };
    return {
      agent,
      allowed: true,
      matchedRule: allow ? `${header} → ${allow.line}` : null,
    };
  });
}

/** Same-origin http(s) hrefs in document order, absolute, fragment-stripped, deduped. */
export function sameOriginLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (el: HTMLElement): void => {
    for (const child of el.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const e = child as HTMLElement;
      if (e.tagName === "A") {
        const href = e.getAttribute("href");
        if (href) {
          let u: URL | null = null;
          try {
            u = new URL(href, base);
          } catch {
            u = null;
          }
          if (u && u.origin === base.origin && (u.protocol === "http:" || u.protocol === "https:")) {
            u.hash = "";
            const norm = u.toString();
            if (!seen.has(norm)) {
              seen.add(norm);
              out.push(norm);
            }
          }
        }
      }
      walk(e);
    }
  };
  walk(parse(html));
  return out;
}

export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/robots.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/crawl.ts tests/prospect/robots.test.ts
git commit -m "feat(prospect): AI-crawler robots matrix, link and sitemap parsing"
```

---

### Task 5: the crawl itself

**Files:**
- Modify: `src/prospect/crawl.ts` (append the network half)
- Test: `tests/prospect/crawl.test.ts`

Injectable `CrawlDeps` keep every test offline. The homepage is the ONLY fatal fetch: it failing means there is nothing to audit, so `crawlSite` throws (the CLI exits, nothing is persisted). robots/sitemap/llms/secondary pages all degrade.

- [ ] **Step 1: Write the failing test**

`tests/prospect/crawl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { crawlSite, type CrawlDeps, type FetchResponse } from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

/** URL-routed fetch stub: anything not in the map is a 404. */
function stubDeps(routes: Record<string, Partial<FetchResponse>>, over: Partial<CrawlDeps> = {}): CrawlDeps {
  return {
    async fetchUrl(url) {
      const hit = routes[url];
      if (!hit) return { status: 404, body: "", headers: {} };
      return { status: hit.status ?? 200, body: hit.body ?? "", headers: hit.headers ?? {} };
    },
    async renderPages(urls) {
      return new Map(urls.map((u) => [u, fixture("rich.html")]));
    },
    maxPages: 20,
    delayMs: 0,
    ...over,
  };
}

const HOME = "https://acme.example/";

describe("crawlSite", () => {
  it("captures the raw and rendered extract of every discovered page", async () => {
    const deps = stubDeps({
      [HOME]: { body: fixture("bare.html"), headers: { "x-frame-options": "SAMEORIGIN" } },
      "https://acme.example/services": { body: fixture("bare.html") },
      "https://acme.example/about": { body: fixture("bare.html") },
    });
    const result = await crawlSite(HOME, deps);

    expect(result.origin).toBe("https://acme.example");
    expect(result.pages.map((p) => p.url)).toEqual([HOME]);
    expect(result.pages[0]!.raw!.text).toBe("");
    expect(result.pages[0]!.rendered!.text).toContain("Treasure Valley");
    expect(result.homeHeaders["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("discovers pages from nav links when there is no sitemap", async () => {
    const deps = stubDeps({
      [HOME]: { body: fixture("rich.html") },
      "https://acme.example/services": { body: fixture("rich.html") },
      "https://acme.example/about": { body: fixture("rich.html") },
    });
    const result = await crawlSite(HOME, deps);
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/services",
      "https://acme.example/about",
    ]);
    expect(result.sitemap).toEqual({ present: false, urlCount: 0 });
  });

  it("prefers sitemap URLs and honours maxPages", async () => {
    const locs = Array.from(
      { length: 5 },
      (_, i) => `<url><loc>https://acme.example/p${i}</loc></url>`,
    ).join("");
    const routes: Record<string, Partial<FetchResponse>> = {
      [HOME]: { body: fixture("rich.html") },
      "https://acme.example/sitemap.xml": { body: `<urlset>${locs}</urlset>` },
    };
    for (let i = 0; i < 5; i++) routes[`https://acme.example/p${i}`] = { body: fixture("rich.html") };
    const result = await crawlSite(HOME, stubDeps(routes, { maxPages: 3 }));

    expect(result.sitemap).toEqual({ present: true, urlCount: 5 });
    expect(result.pages).toHaveLength(3);
    expect(result.pages.map((p) => p.url)).toEqual([
      HOME,
      "https://acme.example/p0",
      "https://acme.example/p1",
    ]);
  });

  it("follows one level of sitemap index", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/sitemap.xml": {
          body: `<sitemapindex><sitemap><loc>https://acme.example/sm-1.xml</loc></sitemap></sitemapindex>`,
        },
        "https://acme.example/sm-1.xml": {
          body: `<urlset><url><loc>https://acme.example/deep</loc></url></urlset>`,
        },
        "https://acme.example/deep": { body: fixture("rich.html") },
      }),
    );
    expect(result.pages.map((p) => p.url)).toContain("https://acme.example/deep");
  });

  it("reads robots.txt into the agent matrix", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/robots.txt": { body: "User-agent: GPTBot\nDisallow: /" },
      }),
    );
    expect(result.robotsTxt).toContain("GPTBot");
    expect(result.agentAccess.find((a) => a.agent === "GPTBot")!.allowed).toBe(false);
  });

  it("ignores an SPA catch-all HTML response for robots.txt and llms.txt", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/robots.txt": { body: "<!doctype html><html><body>404</body></html>" },
        "https://acme.example/llms.txt": { body: "<!doctype html><html><body>404</body></html>" },
      }),
    );
    expect(result.robotsTxt).toBeNull();
    expect(result.llmsTxt).toEqual({ present: false, firstLine: null });
  });

  it("records llms.txt when it is real text", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps({
        [HOME]: { body: fixture("rich.html") },
        "https://acme.example/llms.txt": { body: "# Acme Roofing\n\nCommercial roofing in Boise." },
      }),
    );
    expect(result.llmsTxt).toEqual({ present: true, firstLine: "# Acme Roofing" });
  });

  it("drops a page that errors without losing the crawl", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async fetchUrl(url) {
            if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
            if (url === "https://acme.example/services") throw new Error("ECONNRESET");
            return { status: 404, body: "", headers: {} };
          },
        },
      ),
    );
    const services = result.pages.find((p) => p.url === "https://acme.example/services")!;
    expect(services.error).toContain("ECONNRESET");
    expect(services.raw).toBeNull();
    expect(result.pages[0]!.raw).not.toBeNull();
  });

  it("throws when the homepage itself is unreachable", async () => {
    await expect(
      crawlSite(HOME, stubDeps({ [HOME]: { status: 503, body: "" } })),
    ).rejects.toThrow(/503/);
  });

  it("survives a renderer that fails entirely", async () => {
    const result = await crawlSite(
      HOME,
      stubDeps(
        { [HOME]: { body: fixture("rich.html") } },
        {
          async renderPages() {
            throw new Error("playwright missing");
          },
        },
      ),
    );
    expect(result.pages[0]!.rendered).toBeNull();
    expect(result.pages[0]!.raw).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/crawl.test.ts`
Expected: FAIL — `crawlSite is not a function`.

- [ ] **Step 3: Append the network half to `src/prospect/crawl.ts`**

Add these imports to the top of the file (merge with the existing import line):

```ts
import type { CrawlResult, PageCapture, RobotsAgentAccess } from "./types.js";
import { extractPage } from "./extract.js";
```

Then append:

```ts
export type FetchResponse = { status: number; body: string; headers: Record<string, string> };

export type CrawlDeps = {
  fetchUrl: (url: string) => Promise<FetchResponse>;
  /** Rendered DOM per URL. A URL absent from the map has no rendered extract. */
  renderPages: (urls: string[]) => Promise<Map<string, string>>;
  maxPages: number;
  delayMs: number;
};

/** Honest, identified UA — we audit on the prospect's behalf and say so. */
export const USER_AGENT = "ReddoorAudit/1.0 (+https://reddoorla.com/; operator-run site audit)";

const ASSET_EXT = /\.(pdf|jpe?g|png|gif|webp|avif|svg|zip|mp4|mov|css|js|xml|json)$/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Never throws — a missing robots/sitemap/llms file is information, not a failure. */
async function optional(deps: CrawlDeps, url: string): Promise<FetchResponse | null> {
  try {
    const res = await deps.fetchUrl(url);
    return res.status >= 400 ? null : res;
  } catch {
    return null;
  }
}

/** A text sidecar that actually is text. Netlify/SPA catch-alls answer 200 with
 *  an HTML shell for /robots.txt and /llms.txt; reading that as a robots file
 *  would invent rules the site never wrote. */
function textSidecar(res: FetchResponse | null): string | null {
  if (!res) return null;
  const body = res.body.trim();
  if (!body || body.startsWith("<")) return null;
  return res.body;
}

function normalizeCandidates(urls: string[], origin: string, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (ASSET_EXT.test(u.pathname)) continue;
    u.hash = "";
    const norm = u.toString();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Fetch the prospect's site: robots/sitemap/llms sidecars, then up to
 * `maxPages` same-origin pages, each captured BOTH as raw HTTP HTML (what a
 * non-JS crawler sees) and as rendered DOM (what a browser sees). Sequential
 * and delayed — this is someone else's server.
 */
export async function crawlSite(rawUrl: string, deps: CrawlDeps): Promise<CrawlResult> {
  const start = new URL(rawUrl);
  const origin = start.origin;

  let home: FetchResponse;
  try {
    home = await deps.fetchUrl(start.toString());
  } catch (err) {
    throw Object.assign(
      new Error(`Could not reach ${start.toString()}: ${err instanceof Error ? err.message : String(err)}`),
      { exitCode: 1 },
    );
  }
  if (home.status >= 400) {
    throw Object.assign(
      new Error(`${start.toString()} returned HTTP ${home.status} — nothing to audit.`),
      { exitCode: 1 },
    );
  }

  const robotsTxt = textSidecar(await optional(deps, `${origin}/robots.txt`));
  const agentAccess: RobotsAgentAccess[] = evaluateAgentAccess(
    robotsTxt && /user-agent/i.test(robotsTxt) ? robotsTxt : null,
  );

  const llmsRaw = textSidecar(await optional(deps, `${origin}/llms.txt`));
  const llmsTxt = llmsRaw
    ? { present: true, firstLine: llmsRaw.split(/\r?\n/).find((l) => l.trim())?.trim() ?? null }
    : { present: false, firstLine: null };

  const sitemapRes = await optional(deps, `${origin}/sitemap.xml`);
  let sitemapUrls: string[] = [];
  let sitemapPresent = false;
  if (sitemapRes && /<(urlset|sitemapindex)[\s>]/i.test(sitemapRes.body)) {
    sitemapPresent = true;
    if (isSitemapIndex(sitemapRes.body)) {
      for (const child of parseSitemapLocs(sitemapRes.body).slice(0, 3)) {
        const nested = await optional(deps, child);
        if (nested) sitemapUrls.push(...parseSitemapLocs(nested.body));
      }
    } else {
      sitemapUrls = parseSitemapLocs(sitemapRes.body);
    }
  }

  const pageUrls = normalizeCandidates(
    [start.toString(), ...sitemapUrls, ...sameOriginLinks(home.body, start.toString())],
    origin,
    deps.maxPages,
  );

  const rendered = await deps.renderPages(pageUrls).catch(() => new Map<string, string>());

  const pages: PageCapture[] = [];
  for (const url of pageUrls) {
    let res: FetchResponse | null = null;
    let error: string | null = null;
    if (url === start.toString()) {
      res = home;
    } else {
      if (deps.delayMs > 0) await sleep(deps.delayMs);
      try {
        res = await deps.fetchUrl(url);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const renderedHtml = rendered.get(url) ?? null;
    const usable = res !== null && res.status < 400;
    pages.push({
      url,
      status: res?.status ?? null,
      raw: usable ? extractPage(res!.body) : null,
      rendered: renderedHtml ? extractPage(renderedHtml) : null,
      error: error ?? (res && res.status >= 400 ? `HTTP ${res.status}` : null),
    });
  }

  const homeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(home.headers)) homeHeaders[k.toLowerCase()] = v;

  return {
    origin,
    robotsTxt,
    agentAccess,
    sitemap: { present: sitemapPresent, urlCount: sitemapUrls.length },
    llmsTxt,
    homeHeaders,
    pages,
  };
}

/** Real deps: identified sequential fetches + one shared Playwright chromium.
 *  Playwright is imported lazily so unit tests (which inject deps) never load it. */
export function defaultCrawlDeps(over: Partial<CrawlDeps> = {}): CrawlDeps {
  return {
    async fetchUrl(url) {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, body: await res.text(), headers };
    },
    async renderPages(urls) {
      const { chromium } = await import("@playwright/test");
      const out = new Map<string, string>();
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ userAgent: USER_AGENT });
        const page = await ctx.newPage();
        for (const url of urls) {
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
            out.set(url, await page.content());
          } catch {
            // A page that won't render simply has no rendered extract.
          }
        }
      } finally {
        await browser.close();
      }
      return out;
    },
    maxPages: 20,
    delayMs: 500,
    ...over,
  };
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/crawl.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/crawl.ts tests/prospect/crawl.test.ts
git commit -m "feat(prospect): polite raw+rendered crawl with sidecar discovery"
```

---

### Task 6: deterministic checks

**Files:**
- Create: `src/prospect/checks.ts`
- Test: `tests/prospect/checks.test.ts`

**One rule the whole module follows:** content signals (meta, headings, schema) are read from the page's **raw** extract — that is what a non-JS crawler sees, and this audit exists to measure exactly that. `rendered` is the fallback only when the raw fetch failed. The raw-vs-rendered gap is reported separately as `jsDependence`, so nothing is double-counted; it is explained twice in the report, which is the point.

- [ ] **Step 1: Write the failing test**

`tests/prospect/checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runChecks, SECURITY_HEADERS } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

function page(url: string, rawHtml: string, renderedHtml = rawHtml): PageCapture {
  return {
    url,
    status: 200,
    raw: extractPage(rawHtml),
    rendered: extractPage(renderedHtml),
    error: null,
  };
}

function crawl(over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: null,
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
      { agent: "OAI-SearchBot", allowed: true, matchedRule: null },
      { agent: "ClaudeBot", allowed: true, matchedRule: null },
      { agent: "PerplexityBot", allowed: true, matchedRule: null },
      { agent: "Google-Extended", allowed: true, matchedRule: null },
      { agent: "CCBot", allowed: true, matchedRule: null },
      { agent: "Googlebot", allowed: true, matchedRule: null },
      { agent: "Bingbot", allowed: false, matchedRule: "User-agent: * → Disallow: /" },
    ],
    sitemap: { present: true, urlCount: 4 },
    llmsTxt: { present: false, firstLine: null },
    homeHeaders: { "x-frame-options": "SAMEORIGIN", "strict-transport-security": "max-age=1" },
    pages: [page("https://acme.example/", fixture("rich.html"))],
    ...over,
  };
}

describe("runChecks — crawler access", () => {
  it("splits AI blocks from classical blocks", () => {
    const c = runChecks(crawl());
    expect(c.crawlerAccess.blockedAi).toEqual(["GPTBot"]);
    expect(c.crawlerAccess.allowedAi).toEqual([
      "OAI-SearchBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]);
    expect(c.crawlerAccess.blockedClassical).toEqual(["Bingbot"]);
  });
});

describe("runChecks — JS dependence", () => {
  it("is zero when the raw HTML already carries the copy", () => {
    const c = runChecks(crawl());
    expect(c.jsDependence.avgMissing).toBe(0);
  });

  it("is near one when the raw HTML is an empty shell", () => {
    const c = runChecks(
      crawl({ pages: [page("https://acme.example/", fixture("bare.html"), fixture("rich.html"))] }),
    );
    expect(c.jsDependence.avgMissing).toBeGreaterThan(0.9);
    expect(c.jsDependence.perPage[0]!.url).toBe("https://acme.example/");
  });

  it("ignores pages that have no rendered capture", () => {
    const p = page("https://acme.example/", fixture("rich.html"));
    p.rendered = null;
    expect(runChecks(crawl({ pages: [p] })).jsDependence.perPage).toEqual([]);
  });
});

describe("runChecks — schema", () => {
  it("finds the declared types and names the missing ones", () => {
    const c = runChecks(crawl());
    expect(c.schema.typesFound).toContain("LocalBusiness");
    expect(c.schema.missingExpected).toEqual(["Service", "FAQPage", "Article"]);
    expect(c.schema.invalidBlocks).toBe(0);
  });

  it("counts a malformed JSON-LD block", () => {
    const html = `<html><head><script type="application/ld+json">{ nope }</script></head><body>x</body></html>`;
    const c = runChecks(crawl({ pages: [page("https://acme.example/", html)] }));
    expect(c.schema.invalidBlocks).toBe(1);
    expect(c.schema.typesFound).toEqual([]);
  });

  it("reads @graph entries", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":["FAQPage","WebPage"]}]}</script></head><body>x</body></html>`;
    const c = runChecks(crawl({ pages: [page("https://acme.example/", html)] }));
    expect(c.schema.typesFound.sort()).toEqual(["FAQPage", "Organization", "WebPage"]);
  });
});

describe("runChecks — meta, headings, technical", () => {
  it("counts complete metadata on a well-marked page", () => {
    const c = runChecks(crawl());
    expect(c.meta).toEqual({
      pageCount: 1,
      missingTitle: 0,
      missingDescription: 0,
      missingCanonical: 0,
      missingSocial: 0,
    });
    expect(c.headings).toEqual({ pagesWithoutH1: 0, pagesWithLevelSkips: 0 });
    expect(c.viewportOk).toBe(true);
    expect(c.sitemapPresent).toBe(true);
    expect(c.llmsTxtPresent).toBe(false);
  });

  it("counts the gaps on a bare page", () => {
    const c = runChecks(crawl({ pages: [page("https://acme.example/", fixture("bare.html"))] }));
    expect(c.meta.missingDescription).toBe(1);
    expect(c.meta.missingCanonical).toBe(1);
    expect(c.meta.missingSocial).toBe(1);
    expect(c.headings.pagesWithoutH1).toBe(1);
  });

  it("flags a heading level skip", () => {
    const html = `<html><body><h1>A</h1><h3>B</h3></body></html>`;
    expect(runChecks(crawl({ pages: [page("https://acme.example/", html)] })).headings)
      .toEqual({ pagesWithoutH1: 0, pagesWithLevelSkips: 1 });
  });

  it("reports present and missing security headers", () => {
    const c = runChecks(crawl());
    expect(c.securityHeaders.present).toEqual(["strict-transport-security", "x-frame-options"]);
    expect(c.securityHeaders.missing).toEqual(
      SECURITY_HEADERS.filter((h) => h !== "strict-transport-security" && h !== "x-frame-options"),
    );
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/checks.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/checks.js`.

- [ ] **Step 3: Write `src/prospect/checks.ts`**

```ts
import { AI_AGENTS, CLASSICAL_AGENTS } from "./crawl.js";
import type { ChecksResult, CrawlResult, PageCapture, PageExtract } from "./types.js";

/** The canonical header set the fleet's own netlify.toml template ships
 *  (src/recipes/sync-configs/templates.ts) — the same bar we hold our sites to. */
export const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

/** Schema types a business site is expected to declare, each with the concrete
 *  types that satisfy it. */
const EXPECTED_SCHEMA: { label: string; satisfiedBy: string[] }[] = [
  {
    label: "Organization",
    satisfiedBy: ["Organization", "LocalBusiness", "ProfessionalService", "Corporation"],
  },
  { label: "Service", satisfiedBy: ["Service", "Product", "Offer"] },
  { label: "FAQPage", satisfiedBy: ["FAQPage", "QAPage"] },
  { label: "Article", satisfiedBy: ["Article", "BlogPosting", "NewsArticle"] },
];

/** What a non-JS crawler sees. Falls back to the rendered DOM only when the raw
 *  fetch failed — otherwise the audit would grade the site on content its
 *  readers can't reach. */
function crawlerView(p: PageCapture): PageExtract | null {
  return p.raw ?? p.rendered;
}

/** Content words, deduped — the unit the JS-dependence delta is measured in. */
function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 3),
  );
}

function collectTypes(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") into.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") into.add(x);
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    if (key in obj) collectTypes(obj[key], into);
  }
}

export function runChecks(crawl: CrawlResult): ChecksResult {
  const aiSet = new Set<string>(AI_AGENTS);
  const classicalSet = new Set<string>(CLASSICAL_AGENTS);
  const blockedAi: string[] = [];
  const allowedAi: string[] = [];
  const blockedClassical: string[] = [];
  for (const a of crawl.agentAccess) {
    if (aiSet.has(a.agent)) (a.allowed ? allowedAi : blockedAi).push(a.agent);
    else if (classicalSet.has(a.agent) && !a.allowed) blockedClassical.push(a.agent);
  }

  const perPage: { url: string; missing: number }[] = [];
  for (const p of crawl.pages) {
    if (!p.raw || !p.rendered) continue;
    const renderedWords = wordSet(p.rendered.text);
    if (renderedWords.size === 0) continue;
    const rawWords = wordSet(p.raw.text);
    let missing = 0;
    for (const w of renderedWords) if (!rawWords.has(w)) missing++;
    perPage.push({ url: p.url, missing: missing / renderedWords.size });
  }
  const avgMissing =
    perPage.length === 0 ? 0 : perPage.reduce((s, p) => s + p.missing, 0) / perPage.length;

  const types = new Set<string>();
  let invalidBlocks = 0;
  for (const p of crawl.pages) {
    const view = crawlerView(p);
    if (!view) continue;
    for (const block of view.jsonLd) {
      try {
        collectTypes(JSON.parse(block), types);
      } catch {
        invalidBlocks++;
      }
    }
  }
  const typesFound = [...types];
  const missingExpected = EXPECTED_SCHEMA.filter(
    (e) => !e.satisfiedBy.some((t) => types.has(t)),
  ).map((e) => e.label);

  const views = crawl.pages.map(crawlerView).filter((v): v is PageExtract => v !== null);
  const meta = {
    pageCount: views.length,
    missingTitle: views.filter((v) => !v.title).length,
    missingDescription: views.filter((v) => !v.metaDescription).length,
    missingCanonical: views.filter((v) => !v.canonical).length,
    missingSocial: views.filter((v) => !v.social["og:title"] && !v.social["og:image"]).length,
  };

  const headings = {
    pagesWithoutH1: views.filter((v) => !v.headings.some((h) => h.level === 1)).length,
    pagesWithLevelSkips: views.filter((v) => {
      let prev = 0;
      for (const h of v.headings) {
        if (prev && h.level > prev + 1) return true;
        prev = h.level;
      }
      return false;
    }).length,
  };

  const present = SECURITY_HEADERS.filter((h) => h in crawl.homeHeaders);
  return {
    crawlerAccess: { blockedAi, allowedAi, blockedClassical },
    jsDependence: { avgMissing, perPage },
    schema: { typesFound, missingExpected, invalidBlocks },
    meta,
    headings,
    securityHeaders: { present, missing: SECURITY_HEADERS.filter((h) => !present.includes(h)) },
    sitemapPresent: crawl.sitemap.present,
    llmsTxtPresent: crawl.llmsTxt.present,
    viewportOk: views.length > 0 && views.every((v) => v.hasViewportMeta),
  };
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/checks.test.ts`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/checks.ts tests/prospect/checks.test.ts
git commit -m "feat(prospect): deterministic AEO checks over the crawl"
```

---

### Task 7: the four scores

**Files:**
- Modify: `src/prospect/checks.ts` (append `computeScores`)
- Test: `tests/prospect/scores.test.ts`

Four report scores, each 0–100 or `null` when its inputs are missing (a degraded stage must read "not measured", never 0 — a zero is a claim about the prospect's site).

- [ ] **Step 1: Write the failing test**

`tests/prospect/scores.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeScores } from "../../src/prospect/checks.js";
import type { AnalyzeResult, ChecksResult, ProbesResult } from "../../src/prospect/types.js";

const perfectChecks: ChecksResult = {
  crawlerAccess: {
    blockedAi: [],
    allowedAi: ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"],
    blockedClassical: [],
  },
  jsDependence: { avgMissing: 0, perPage: [] },
  schema: { typesFound: ["Organization", "Service", "FAQPage", "Article"], missingExpected: [], invalidBlocks: 0 },
  meta: { pageCount: 2, missingTitle: 0, missingDescription: 0, missingCanonical: 0, missingSocial: 0 },
  headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
  securityHeaders: { present: [], missing: [] },
  sitemapPresent: true,
  llmsTxtPresent: true,
  viewportOk: true,
};

const worstChecks: ChecksResult = {
  ...perfectChecks,
  crawlerAccess: {
    blockedAi: ["GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"],
    allowedAi: [],
    blockedClassical: ["Googlebot"],
  },
  jsDependence: { avgMissing: 1, perPage: [] },
  schema: { typesFound: [], missingExpected: ["Organization", "Service", "FAQPage", "Article"], invalidBlocks: 2 },
  meta: { pageCount: 2, missingTitle: 2, missingDescription: 2, missingCanonical: 2, missingSocial: 2 },
  headings: { pagesWithoutH1: 2, pagesWithLevelSkips: 2 },
  sitemapPresent: false,
  llmsTxtPresent: false,
  viewportOk: false,
};

const analyze = (answers: AnalyzeResult["buyerQuestions"][number]["answered"][]): AnalyzeResult => ({
  business: "Acme",
  entityClarity: { score: 80, missing: [] },
  buyerQuestions: answers.map((answered, i) => ({
    question: `q${i}`,
    answered,
    quotable: answered === "yes",
    page: null,
    evidence: null,
  })),
  fixes: [],
  narrative: { findability: "", readability: "", answers: "" },
});

const probes: ProbesResult = { answers: [], visibilityScore: 42, competitorsSeen: [] };

describe("computeScores", () => {
  it("scores a perfect site at 100 across the deterministic tiers", () => {
    const s = computeScores({ checks: perfectChecks, lighthouse: null, analyze: null, probes: null });
    expect(s.findability).toBe(100);
    expect(s.readability).toBe(100);
  });

  it("scores a fully blocked, fully client-rendered site at 0", () => {
    const s = computeScores({ checks: worstChecks, lighthouse: null, analyze: null, probes: null });
    expect(s.findability).toBe(0);
    expect(s.readability).toBe(0);
  });

  it("returns null for every score whose inputs are missing", () => {
    expect(computeScores({ checks: null, lighthouse: null, analyze: null, probes: null })).toEqual({
      findability: null,
      readability: null,
      answers: null,
      aiVisibility: null,
    });
  });

  it("grades answers as yes=1, partial=0.5, no=0", () => {
    const s = computeScores({
      checks: null,
      lighthouse: null,
      analyze: analyze(["yes", "partial", "no", "no"]),
      probes: null,
    });
    expect(s.answers).toBe(38);
  });

  it("passes the probe visibility score through", () => {
    expect(
      computeScores({ checks: null, lighthouse: null, analyze: null, probes }).aiVisibility,
    ).toBe(42);
  });

  it("folds the Lighthouse SEO score into findability when present", () => {
    const withLh = computeScores({
      checks: worstChecks,
      lighthouse: {
        performance: 50,
        accessibility: 50,
        bestPractices: 50,
        seo: 100,
        summary: "",
        status: "pass",
      },
      analyze: null,
      probes: null,
    });
    expect(withLh.findability).toBe(20);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/scores.test.ts`
Expected: FAIL — `computeScores is not a function`.

- [ ] **Step 3: Append `computeScores` to `src/prospect/checks.ts`**

Extend the type import at the top of the file to:

```ts
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  PageCapture,
  PageExtract,
  ProbesResult,
  Scores,
} from "./types.js";
```

Then append:

```ts
const pct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** The four report scores. A `null` means "not measured" — never fabricate a 0
 *  for a stage that failed; a zero is a claim about the prospect's site. */
export function computeScores(input: {
  checks: ChecksResult | null;
  lighthouse: LighthouseScores | null;
  analyze: AnalyzeResult | null;
  probes: ProbesResult | null;
}): Scores {
  const { checks, lighthouse, analyze, probes } = input;

  let findability: number | null = null;
  let readability: number | null = null;

  if (checks) {
    const aiTotal = checks.crawlerAccess.allowedAi.length + checks.crawlerAccess.blockedAi.length;
    const aiOpen = aiTotal === 0 ? 1 : checks.crawlerAccess.allowedAi.length / aiTotal;
    const classicalOpen = checks.crawlerAccess.blockedClassical.length === 0 ? 1 : 0;
    const pages = Math.max(1, checks.meta.pageCount);
    const metaComplete =
      1 -
      (checks.meta.missingTitle + checks.meta.missingDescription + checks.meta.missingCanonical) /
        (pages * 3);
    const technical =
      (checks.sitemapPresent ? 1 : 0) * 0.5 +
      (checks.viewportOk ? 1 : 0) * 0.25 +
      (checks.llmsTxtPresent ? 1 : 0) * 0.25;

    // Crawler access 40 / classical access 10 / metadata 15 / technical 15,
    // normalized to 0..1. Lighthouse SEO, when measured, takes the last 20
    // points; without it the deterministic part spans the full 100.
    const base01 =
      (aiOpen * 40 + classicalOpen * 10 + Math.max(0, metaComplete) * 15 + technical * 15) / 80;
    findability =
      lighthouse && lighthouse.seo !== null
        ? pct(base01 * 80 + lighthouse.seo * 0.2)
        : pct(base01 * 100);

    const structure =
      1 -
      (checks.headings.pagesWithoutH1 + checks.headings.pagesWithLevelSkips) / (pages * 2);
    const schemaCoverage =
      1 - checks.schema.missingExpected.length / 4 - Math.min(0.25, checks.schema.invalidBlocks * 0.1);
    readability = pct(
      (1 - checks.jsDependence.avgMissing) * 60 +
        Math.max(0, structure) * 25 +
        Math.max(0, schemaCoverage) * 15,
    );
  }

  let answers: number | null = null;
  if (analyze && analyze.buyerQuestions.length > 0) {
    const weight = { yes: 1, partial: 0.5, no: 0 } as const;
    const total = analyze.buyerQuestions.reduce((s, q) => s + weight[q.answered], 0);
    answers = pct((total / analyze.buyerQuestions.length) * 100);
  }

  return {
    findability,
    readability,
    answers,
    aiVisibility: probes ? pct(probes.visibilityScore) : null,
  };
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/scores.test.ts`
Expected: 6 passed. (Check the arithmetic against the fixtures if a number is off by a point — the weights, not the test, are the thing to adjust; keep perfect=100 and worst=0 exact.)

- [ ] **Step 5: Commit**

```bash
git add src/prospect/checks.ts tests/prospect/scores.test.ts
git commit -m "feat(prospect): the four report scores"
```

---

### Task 8: the Claude answerability pass

**Files:**
- Modify: `package.json` (add two devDependencies)
- Create: `src/prospect/analyze.ts`
- Test: `tests/prospect/analyze.test.ts`

One `claude-opus-5` call per audit. The model call is injected, so every test runs offline; the live shape is proven once in Task 14.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm add -D @anthropic-ai/sdk zod`

They go in `devDependencies` for the same reason airtable/resend do: consuming fleet sites install this package for `./forms` + `./configs/*` and must not inherit the audit chain. `tsup` externalizes all dependency groups, so nothing changes in the build config.

- [ ] **Step 2: Write the failing test**

`tests/prospect/analyze.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { analyzeSite, buildAnalyzeInput, AnalyzeSchema } from "../../src/prospect/analyze.js";
import { runChecks } from "../../src/prospect/checks.js";
import { extractPage } from "../../src/prospect/extract.js";
import type { CrawlResult, PageCapture } from "../../src/prospect/types.js";

function page(url: string, html: string): PageCapture {
  return { url, status: 200, raw: extractPage(html), rendered: extractPage(html), error: null };
}

const html = (title: string, body: string): string =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;

function crawl(pageCount = 1): CrawlResult {
  return {
    origin: "https://acme.example",
    robotsTxt: "User-agent: GPTBot\nDisallow: /",
    agentAccess: [
      { agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" },
      { agent: "ClaudeBot", allowed: true, matchedRule: null },
    ],
    sitemap: { present: true, urlCount: pageCount },
    llmsTxt: { present: false, firstLine: null },
    homeHeaders: {},
    pages: Array.from({ length: pageCount }, (_, i) =>
      page(`https://acme.example/p${i}`, html(`Page ${i}`, `Body copy number ${i}.`)),
    ),
  };
}

const validOutput = {
  business: "Acme Roofing — commercial roofing in Boise, Idaho",
  entityClarity: { score: 72, missing: ["service area"] },
  buyerQuestions: [
    {
      question: "What does a roof repair cost?",
      answered: "partial" as const,
      quotable: false,
      page: "https://acme.example/p0",
      evidence: "Most repairs run between $1,200 and $8,000",
    },
  ],
  fixes: [
    {
      title: "Unblock GPTBot",
      why: "robots.txt blocks it site-wide",
      impact: "high" as const,
      effort: "low" as const,
      tier: "crawl" as const,
    },
  ],
  narrative: { findability: "…", readability: "…", answers: "…" },
};

describe("buildAnalyzeInput", () => {
  it("puts the deterministic findings and each page's content in the prompt", () => {
    const c = crawl();
    const { system, user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(system).toContain("answer engine");
    expect(user).toContain("https://acme.example/p0");
    expect(user).toContain("Page 0");
    expect(user).toContain("Body copy number 0.");
    expect(user).toContain("GPTBot");
  });

  it("caps the page budget and the per-page text", () => {
    const c = crawl(20);
    c.pages[0]!.rendered!.text = "x".repeat(5000);
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).toContain("https://acme.example/p11");
    expect(user).not.toContain("https://acme.example/p12");
    expect(user).not.toContain("x".repeat(2000));
  });

  it("never ships raw HTML to the model", () => {
    const c = crawl();
    const { user } = buildAnalyzeInput("https://acme.example/", c, runChecks(c));
    expect(user).not.toContain("<html>");
    expect(user).not.toContain("<h1>");
  });
});

describe("analyzeSite", () => {
  it("returns the validated model output", async () => {
    const result = await analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
      run: async () => validOutput,
    });
    expect(result.business).toContain("Acme Roofing");
    expect(result.buyerQuestions[0]!.answered).toBe("partial");
  });

  it("rejects output that does not match the schema", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => ({ ...validOutput, buyerQuestions: [{ question: "q" }] }),
      }),
    ).rejects.toThrow();
  });

  it("propagates a model failure so the stage degrades", async () => {
    await expect(
      analyzeSite("https://acme.example/", crawl(), runChecks(crawl()), {
        run: async () => {
          throw new Error("529 overloaded");
        },
      }),
    ).rejects.toThrow(/529/);
  });

  it("exports a schema that accepts the documented shape", () => {
    expect(() => AnalyzeSchema.parse(validOutput)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it — must fail**

Run: `pnpm vitest run tests/prospect/analyze.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/analyze.js`.

- [ ] **Step 4: Write `src/prospect/analyze.ts`**

```ts
import { z } from "zod";
import type { AnalyzeResult, ChecksResult, CrawlResult } from "./types.js";

/** Bounds on what reaches the model: enough site to judge, small enough to stay
 *  inside one ~$0.50 call. */
const MAX_PAGES = 12;
const MAX_TEXT_CHARS = 1500;

export const AnalyzeSchema = z.object({
  business: z.string(),
  entityClarity: z.object({ score: z.number(), missing: z.array(z.string()) }),
  buyerQuestions: z.array(
    z.object({
      question: z.string(),
      answered: z.enum(["yes", "partial", "no"]),
      quotable: z.boolean(),
      page: z.string().nullable(),
      evidence: z.string().nullable(),
    }),
  ),
  fixes: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      impact: z.enum(["high", "medium", "low"]),
      effort: z.enum(["low", "medium", "high"]),
      tier: z.enum(["crawl", "content", "technical"]),
    }),
  ),
  narrative: z.object({
    findability: z.string(),
    readability: z.string(),
    answers: z.string(),
  }),
});

const SYSTEM = `You are an AEO/SEO analyst at Reddoor Creative reviewing a prospect's website.

Judge ONLY from the page content given to you — it is what a crawler can actually read. If you cannot
tell what the business does from that content, say so plainly: that IS the finding, because an answer
engine is working from the same material.

Return:
- business: what this company does, for whom, and where, in one or two sentences.
- entityClarity: 0-100 for how unambiguously the site establishes who/where/what it offers, plus the
  specific things missing.
- buyerQuestions: 6-10 questions a real buyer in this category asks before hiring. For each, whether
  the site answers it (yes/partial/no), whether there is a passage an AI could quote verbatim, the page
  it lives on, and the evidence quote (or null).
- fixes: prioritized, concrete, specific to this site. No generic SEO advice.
- narrative: two or three plain sentences per report section, addressed to the business owner. No
  jargon, no hedging.`;

function summarizeFindings(checks: ChecksResult): string {
  const blocked = checks.crawlerAccess.blockedAi;
  return [
    `Blocked AI crawlers: ${blocked.length ? blocked.join(", ") : "none"}`,
    `Blocked classical crawlers: ${
      checks.crawlerAccess.blockedClassical.length
        ? checks.crawlerAccess.blockedClassical.join(", ")
        : "none"
    }`,
    `Content only present after JavaScript runs: ${Math.round(checks.jsDependence.avgMissing * 100)}%`,
    `Schema types found: ${checks.schema.typesFound.join(", ") || "none"}`,
    `Expected schema missing: ${checks.schema.missingExpected.join(", ") || "none"}`,
    `Pages missing a description: ${checks.meta.missingDescription}/${checks.meta.pageCount}`,
    `Pages without an h1: ${checks.headings.pagesWithoutH1}/${checks.meta.pageCount}`,
    `sitemap.xml: ${checks.sitemapPresent ? "present" : "missing"} · llms.txt: ${
      checks.llmsTxtPresent ? "present" : "missing"
    }`,
  ].join("\n");
}

/** Build the (system, user) pair. Pure — no network, fully assertable. */
export function buildAnalyzeInput(
  url: string,
  crawl: CrawlResult,
  checks: ChecksResult,
): { system: string; user: string } {
  const pages = crawl.pages.slice(0, MAX_PAGES).map((p) => {
    const view = p.rendered ?? p.raw;
    const headings = view?.headings.map((h) => `${"#".repeat(h.level)} ${h.text}`).join("\n") ?? "";
    const text = (view?.text ?? "").slice(0, MAX_TEXT_CHARS);
    return [
      `URL: ${p.url}`,
      `Title: ${view?.title ?? "(none)"}`,
      `Description: ${view?.metaDescription ?? "(none)"}`,
      headings ? `Headings:\n${headings}` : "Headings: (none)",
      `Text: ${text || "(no text without JavaScript)"}`,
    ].join("\n");
  });

  const user = [
    `Site: ${url}`,
    "",
    "## What the automated checks found",
    summarizeFindings(checks),
    "",
    "## Pages",
    pages.join("\n\n---\n\n"),
  ].join("\n");

  return { system: SYSTEM, user };
}

export type AnalyzeDeps = {
  run: (input: { system: string; user: string }) => Promise<unknown>;
};

/** The real call: one Opus 5 request with adaptive thinking and a schema-constrained
 *  response. Imported lazily so the SDK never loads for a `--no-probes`-style run
 *  that never reaches this stage, nor for any other CLI command. */
export function defaultAnalyzeDeps(): AnalyzeDeps {
  return {
    async run({ system, user }) {
      const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
        import("@anthropic-ai/sdk"),
        import("@anthropic-ai/sdk/helpers/zod"),
      ]);
      const client = new Anthropic();
      const res = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(AnalyzeSchema) },
      });
      if (!res.parsed_output) throw new Error("analyze: the model returned no parsed output");
      return res.parsed_output;
    },
  };
}

export async function analyzeSite(
  url: string,
  crawl: CrawlResult,
  checks: ChecksResult,
  deps: AnalyzeDeps = defaultAnalyzeDeps(),
): Promise<AnalyzeResult> {
  const raw = await deps.run(buildAnalyzeInput(url, crawl, checks));
  return AnalyzeSchema.parse(raw);
}
```

- [ ] **Step 5: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/analyze.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If the installed `@anthropic-ai/sdk` types reject `thinking` or `output_config` on `messages.parse`, read `node_modules/@anthropic-ai/sdk` types for the current names — do NOT cast to `any` to get past it, and do not silently drop the parameter.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/prospect/analyze.ts tests/prospect/analyze.test.ts
git commit -m "feat(prospect): Claude answerability pass with a schema-constrained response"
```

---

### Task 9: live AI-visibility probes

**Files:**
- Create: `src/prospect/probes.ts`
- Test: `tests/prospect/probes.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/prospect/probes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildQueries,
  domainOf,
  runVisibilityProbes,
  perplexityEngine,
  type VisibilityEngine,
} from "../../src/prospect/probes.js";

const engine = (name: string, reply: (q: string) => { answer: string; citedDomains: string[] }): VisibilityEngine => ({
  name,
  ask: async (q) => reply(q),
});

describe("buildQueries", () => {
  it("asks the branded questions, then the buyer questions", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      buyerQuestions: ["What does a roof repair cost?", "Do you work on flat roofs?", "How fast?", "Extra"],
      competitors: [],
    });
    expect(queries[0]).toBe("who is Acme Roofing");
    expect(queries[1]).toBe("Acme Roofing reviews");
    expect(queries).toContain("What does a roof repair cost?");
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  it("adds comparison queries for each competitor", () => {
    const queries = buildQueries({
      business: "Acme Roofing",
      url: "https://acme.example/",
      buyerQuestions: [],
      competitors: ["bestroofs.example", "toproof.example"],
    });
    expect(queries).toContain("Acme Roofing vs bestroofs.example");
    expect(queries).toContain("Acme Roofing vs toproof.example");
  });

  it("falls back to the domain when there is no business name", () => {
    const queries = buildQueries({
      business: "",
      url: "https://acme.example/",
      buyerQuestions: [],
      competitors: [],
    });
    expect(queries[0]).toBe("who is acme.example");
  });
});

describe("domainOf", () => {
  it("strips the scheme, www and path", () => {
    expect(domainOf("https://www.acme.example/services")).toBe("acme.example");
    expect(domainOf("acme.example")).toBe("acme.example");
  });
});

describe("runVisibilityProbes", () => {
  const args = {
    url: "https://acme.example/",
    business: "Acme Roofing",
    buyerQuestions: ["What does a roof repair cost?"],
    competitors: [],
  };

  it("scores a citation or a brand mention as visible", async () => {
    const engines = [
      engine("perplexity", (q) =>
        q.startsWith("who is")
          ? { answer: "Acme Roofing is a Boise contractor.", citedDomains: ["acme.example"] }
          : { answer: "Several contractors serve Boise.", citedDomains: ["bestroofs.example"] },
      ),
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers).toHaveLength(3);
    const branded = result.answers.find((a) => a.query === "who is Acme Roofing")!;
    expect(branded.domainCited).toBe(true);
    expect(branded.brandMentioned).toBe(true);
    expect(result.visibilityScore).toBe(33);
  });

  it("counts the competitors the engines cited instead", async () => {
    const engines = [
      engine("perplexity", () => ({
        answer: "Try BestRoofs.",
        citedDomains: ["bestroofs.example", "www.bestroofs.example", "toproof.example"],
      })),
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.competitorsSeen[0]).toEqual({ domain: "bestroofs.example", count: 6 });
    expect(result.visibilityScore).toBe(0);
  });

  it("keeps the answers of a working engine when another one fails", async () => {
    const engines = [
      engine("perplexity", () => ({ answer: "Acme Roofing.", citedDomains: ["acme.example"] })),
      { name: "claude", ask: async () => { throw new Error("401 no key"); } },
    ];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers.every((a) => a.engine === "perplexity")).toBe(true);
    expect(result.visibilityScore).toBe(100);
  });

  it("throws when every engine fails, so the stage degrades", async () => {
    const engines = [{ name: "claude", ask: async () => { throw new Error("401 no key"); } }];
    await expect(runVisibilityProbes(args, engines)).rejects.toThrow(/no visibility engine/i);
  });

  it("truncates the receipt snippet", async () => {
    const engines = [engine("perplexity", () => ({ answer: "z".repeat(900), citedDomains: [] }))];
    const result = await runVisibilityProbes(args, engines);
    expect(result.answers[0]!.snippet.length).toBeLessThanOrEqual(300);
  });
});

describe("perplexityEngine", () => {
  it("reads the answer and citations out of a Sonar response", async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Acme Roofing is in Boise." } }],
          citations: ["https://acme.example/", "https://bestroofs.example/x"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const out = await perplexityEngine("pk-test", stub).ask("who is Acme Roofing");
    expect(out.answer).toContain("Boise");
    expect(out.citedDomains).toEqual(["acme.example", "bestroofs.example"]);
  });

  it("reads the newer search_results shape", async () => {
    const stub = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "x" } }],
          search_results: [{ url: "https://acme.example/" }],
        }),
        { status: 200 },
      );
    const out = await perplexityEngine("pk-test", stub).ask("q");
    expect(out.citedDomains).toEqual(["acme.example"]);
  });

  it("throws on a non-2xx so the engine degrades", async () => {
    const stub = async () => new Response("rate limited", { status: 429 });
    await expect(perplexityEngine("pk-test", stub).ask("q")).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/probes.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/probes.js`.

- [ ] **Step 3: Write `src/prospect/probes.ts`**

```ts
import type { ProbeAnswer, ProbesResult } from "./types.js";

/** One answer engine. Adding OpenAI or Gemini later means one more of these. */
export type VisibilityEngine = {
  name: string;
  ask: (query: string) => Promise<{ answer: string; citedDomains: string[] }>;
};

const MAX_QUERIES = 8;
const SNIPPET_CHARS = 300;

export function domainOf(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^www\./i, "").toLowerCase();
  }
}

export type ProbeInput = {
  url: string;
  business: string;
  buyerQuestions: string[];
  competitors: string[];
};

/** Branded questions first (they are the ones the prospect will check), then the
 *  category questions the analyze pass surfaced, then competitor comparisons. */
export function buildQueries(input: ProbeInput): string[] {
  const name = input.business.trim() || domainOf(input.url);
  const queries = [
    `who is ${name}`,
    `${name} reviews`,
    ...input.buyerQuestions.slice(0, 3),
    ...input.competitors.slice(0, 2).map((c) => `${name} vs ${c}`),
  ];
  return [...new Set(queries)].slice(0, MAX_QUERIES);
}

/** Ask every engine every query. An engine that throws is skipped for that query;
 *  only a total wipeout fails the stage. */
export async function runVisibilityProbes(
  input: ProbeInput,
  engines: VisibilityEngine[],
): Promise<ProbesResult> {
  const queries = buildQueries(input);
  const prospect = domainOf(input.url);
  const brand = input.business.trim().toLowerCase();
  const answers: ProbeAnswer[] = [];
  const competitorCounts = new Map<string, number>();

  for (const engine of engines) {
    for (const query of queries) {
      let reply: { answer: string; citedDomains: string[] };
      try {
        reply = await engine.ask(query);
      } catch {
        continue;
      }
      const citedDomains = reply.citedDomains.map(domainOf);
      const domainCited = citedDomains.includes(prospect);
      const brandMentioned = brand.length > 0 && reply.answer.toLowerCase().includes(brand);
      for (const d of citedDomains) {
        if (d === prospect) continue;
        competitorCounts.set(d, (competitorCounts.get(d) ?? 0) + 1);
      }
      answers.push({
        engine: engine.name,
        query,
        domainCited,
        brandMentioned,
        citedDomains,
        snippet: reply.answer.slice(0, SNIPPET_CHARS),
      });
    }
  }

  if (answers.length === 0) {
    throw new Error("no visibility engine returned an answer");
  }

  const visible = answers.filter((a) => a.domainCited || a.brandMentioned).length;
  return {
    answers,
    visibilityScore: Math.round((visible / answers.length) * 100),
    competitorsSeen: [...competitorCounts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

type SonarResponse = {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string }[];
};

/** Perplexity Sonar — citations come back with the answer, which is the whole
 *  reason it is the first engine. */
export function perplexityEngine(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): VisibilityEngine {
  return {
    name: "perplexity",
    async ask(query) {
      const res = await fetchImpl("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [{ role: "user", content: query }],
        }),
      });
      if (!res.ok) throw new Error(`perplexity: HTTP ${res.status}`);
      const data = (await res.json()) as SonarResponse;
      const answer = data.choices?.[0]?.message?.content ?? "";
      const cited =
        data.citations ??
        (data.search_results ?? []).map((r) => r.url).filter((u): u is string => Boolean(u));
      return { answer, citedDomains: cited.map(domainOf) };
    },
  };
}

type ContentBlock = {
  type: string;
  text?: string;
  url?: string;
  content?: ContentBlock[];
  citations?: { url?: string }[];
};

/** Claude with the web-search server tool. `pause_turn` is resumed explicitly —
 *  the SDK does not do it for you, and an unresumed pause silently truncates. */
export function claudeWebSearchEngine(): VisibilityEngine {
  return {
    name: "claude",
    async ask(query) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();
      const messages: { role: "user" | "assistant"; content: unknown }[] = [
        { role: "user", content: query },
      ];
      const collected: ContentBlock[] = [];
      for (let turn = 0; turn < 4; turn++) {
        const res = await client.messages.create({
          model: "claude-opus-5",
          max_tokens: 4000,
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
          messages: messages as never,
        });
        collected.push(...(res.content as unknown as ContentBlock[]));
        if (res.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: res.content });
      }

      const answer = collected
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n")
        .trim();
      const citedDomains: string[] = [];
      for (const block of collected) {
        if (block.type === "web_search_tool_result") {
          for (const r of block.content ?? []) if (r.url) citedDomains.push(domainOf(r.url));
        }
        for (const c of block.citations ?? []) if (c.url) citedDomains.push(domainOf(c.url));
      }
      return { answer, citedDomains };
    },
  };
}

/** Engines available from the current environment. Perplexity needs its key;
 *  Claude rides the same credential chain the analyze pass uses. */
export function defaultEngines(): VisibilityEngine[] {
  const engines: VisibilityEngine[] = [];
  const key = process.env.PERPLEXITY_API_KEY?.trim();
  if (key) engines.push(perplexityEngine(key));
  engines.push(claudeWebSearchEngine());
  return engines;
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/probes.test.ts`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/probes.ts tests/prospect/probes.test.ts
git commit -m "feat(prospect): AI-visibility probes across Perplexity and Claude web search"
```

---

### Task 10: the orchestrator

**Files:**
- Create: `src/prospect/pipeline.ts`
- Test: `tests/prospect/pipeline.test.ts`

The crawl is the one fatal stage — every other stage depends on it, so an unreachable site fails fast and persists nothing. Checks, Lighthouse, analyze and probes are each isolated: a failure degrades that report section and nothing else.

- [ ] **Step 1: Write the failing test**

`tests/prospect/pipeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runProspectAudit, type PipelineDeps } from "../../src/prospect/pipeline.js";
import type { CrawlDeps, FetchResponse } from "../../src/prospect/crawl.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "../fixtures/prospect", name), "utf-8");

const HOME = "https://acme.example/";

const crawlDeps = (over: Partial<CrawlDeps> = {}): CrawlDeps => ({
  async fetchUrl(url): Promise<FetchResponse> {
    if (url === HOME) return { status: 200, body: fixture("rich.html"), headers: {} };
    if (url.endsWith("/services") || url.endsWith("/about"))
      return { status: 200, body: fixture("rich.html"), headers: {} };
    return { status: 404, body: "", headers: {} };
  },
  async renderPages(urls) {
    return new Map(urls.map((u) => [u, fixture("rich.html")]));
  },
  maxPages: 5,
  delayMs: 0,
  ...over,
});

const analyzeOutput = {
  business: "Acme Roofing",
  entityClarity: { score: 70, missing: [] },
  buyerQuestions: [
    { question: "cost?", answered: "yes" as const, quotable: true, page: HOME, evidence: "…" },
  ],
  fixes: [
    {
      title: "Add FAQ schema",
      why: "…",
      impact: "high" as const,
      effort: "low" as const,
      tier: "content" as const,
    },
  ],
  narrative: { findability: "a", readability: "b", answers: "c" },
};

const deps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  crawl: crawlDeps(),
  analyze: { run: async () => analyzeOutput },
  engines: [
    { name: "perplexity", ask: async () => ({ answer: "Acme Roofing", citedDomains: ["acme.example"] }) },
  ],
  lighthouse: async () => ({
    performance: 80,
    accessibility: 90,
    bestPractices: 70,
    seo: 100,
    summary: "lighthouse: all categories passing",
    status: "pass" as const,
  }),
  ...over,
});

describe("runProspectAudit", () => {
  it("returns every stage populated on a healthy run", async () => {
    const result = await runProspectAudit(HOME, {}, deps());
    expect(result.url).toBe(HOME);
    expect(result.business).toBe("Acme Roofing");
    expect(result.crawl.ok).toBe(true);
    expect(result.checks.ok).toBe(true);
    expect(result.lighthouse.ok).toBe(true);
    expect(result.analyze.ok).toBe(true);
    expect(result.probes.ok).toBe(true);
    expect(result.scores.findability).toBeGreaterThan(0);
    expect(result.scores.answers).toBe(100);
    expect(result.scores.aiVisibility).toBe(100);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("prefers the operator's business name over the model's", async () => {
    const result = await runProspectAudit(HOME, { business: "Acme Roofing LLC" }, deps());
    expect(result.business).toBe("Acme Roofing LLC");
  });

  it("degrades the analyze section and its score, keeping the rest", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.analyze).toEqual({ ok: false, error: "529 overloaded" });
    expect(result.scores.answers).toBeNull();
    expect(result.checks.ok).toBe(true);
    expect(result.scores.readability).not.toBeNull();
  });

  it("degrades lighthouse without touching the other scores", async () => {
    const result = await runProspectAudit(
      HOME,
      {},
      deps({
        lighthouse: async () => {
          throw new Error("npx unavailable");
        },
      }),
    );
    expect(result.lighthouse.ok).toBe(false);
    expect(result.scores.findability).not.toBeNull();
  });

  it("skips probes entirely when asked", async () => {
    const result = await runProspectAudit(HOME, { probes: false }, deps());
    expect(result.probes).toEqual({ ok: false, error: "skipped (--no-probes)" });
    expect(result.scores.aiVisibility).toBeNull();
  });

  it("still runs probes when the analyze stage failed", async () => {
    const result = await runProspectAudit(
      HOME,
      { business: "Acme Roofing" },
      deps({
        analyze: {
          run: async () => {
            throw new Error("529 overloaded");
          },
        },
      }),
    );
    expect(result.probes.ok).toBe(true);
  });

  it("throws when the site is unreachable — nothing to persist", async () => {
    await expect(
      runProspectAudit(
        HOME,
        {},
        deps({ crawl: crawlDeps({ fetchUrl: async () => ({ status: 500, body: "", headers: {} }) }) }),
      ),
    ).rejects.toThrow(/500/);
  });

  it("reports stage progress to the caller", async () => {
    const seen: string[] = [];
    await runProspectAudit(HOME, {}, { ...deps(), onStage: (name, status) => seen.push(`${name}:${status}`) });
    expect(seen).toContain("crawl:ok");
    expect(seen).toContain("probes:ok");
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/pipeline.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/pipeline.js`.

- [ ] **Step 3: Write `src/prospect/pipeline.ts`**

```ts
import type { Site } from "../types.js";
import { crawlSite, defaultCrawlDeps, type CrawlDeps } from "./crawl.js";
import { computeScores, runChecks } from "./checks.js";
import { analyzeSite, defaultAnalyzeDeps, type AnalyzeDeps } from "./analyze.js";
import { defaultEngines, runVisibilityProbes, type VisibilityEngine } from "./probes.js";
import type {
  AnalyzeResult,
  ChecksResult,
  CrawlResult,
  LighthouseScores,
  ProbesResult,
  ProspectAuditResult,
  StageResult,
} from "./types.js";

export type StageName = "crawl" | "checks" | "lighthouse" | "analyze" | "probes";

export type PipelineDeps = {
  crawl?: CrawlDeps;
  analyze?: AnalyzeDeps;
  engines?: VisibilityEngine[];
  lighthouse?: (url: string) => Promise<LighthouseScores>;
  onStage?: (name: StageName, status: "start" | "ok" | "fail", detail?: string) => void;
};

export type ProspectAuditOptions = {
  business?: string;
  competitors?: string[];
  /** false → tier 3 is skipped deliberately (`--no-probes`). */
  probes?: boolean;
};

async function stage<T>(
  name: StageName,
  deps: PipelineDeps,
  fn: () => Promise<T>,
): Promise<StageResult<T>> {
  deps.onStage?.(name, "start");
  try {
    const data = await fn();
    deps.onStage?.(name, "ok");
    return { ok: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.onStage?.(name, "fail", error);
    return { ok: false, error };
  }
}

/** Reuse the fleet Lighthouse audit's deployed-URL path: with `deployedUrl` set
 *  it runs lhci against the live URL with no checkout and no dev server. */
async function defaultLighthouse(url: string): Promise<LighthouseScores> {
  const { lighthouseAudit } = await import("../audits/lighthouse.js");
  const site: Site = { path: "", name: new URL(url).hostname, deployedUrl: url };
  const result = await lighthouseAudit({ site });
  const summary = (result.details as { summary?: Record<string, number> } | undefined)?.summary ?? {};
  const score = (key: string): number | null =>
    typeof summary[key] === "number" ? Math.round(summary[key] * 100) : null;
  return {
    performance: score("performance"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    seo: score("seo"),
    summary: result.summary,
    status: result.status,
  };
}

/**
 * Run the full audit. The crawl is fatal — everything downstream reads it, so an
 * unreachable site throws and no report is written. Every other stage is
 * isolated: a failure becomes `{ok: false, error}` and its report section reads
 * "not measured".
 */
export async function runProspectAudit(
  url: string,
  opts: ProspectAuditOptions,
  deps: PipelineDeps = {},
): Promise<ProspectAuditResult> {
  const crawlDeps = deps.crawl ?? defaultCrawlDeps();
  deps.onStage?.("crawl", "start");
  let crawlData: CrawlResult;
  try {
    crawlData = await crawlSite(url, crawlDeps);
    deps.onStage?.("crawl", "ok");
  } catch (err) {
    deps.onStage?.("crawl", "fail", err instanceof Error ? err.message : String(err));
    throw err;
  }
  const crawl: StageResult<CrawlResult> = { ok: true, data: crawlData };

  const checks: StageResult<ChecksResult> = await stage("checks", deps, async () =>
    runChecks(crawlData),
  );

  const lighthouse: StageResult<LighthouseScores> = await stage("lighthouse", deps, async () =>
    (deps.lighthouse ?? defaultLighthouse)(url),
  );

  const analyze: StageResult<AnalyzeResult> = checks.ok
    ? await stage("analyze", deps, async () =>
        analyzeSite(url, crawlData, checks.data, deps.analyze ?? defaultAnalyzeDeps()),
      )
    : { ok: false, error: "skipped — the checks stage failed" };

  const business = opts.business?.trim() || (analyze.ok ? analyze.data.business : "") || null;

  let probes: StageResult<ProbesResult>;
  if (opts.probes === false) {
    probes = { ok: false, error: "skipped (--no-probes)" };
  } else {
    probes = await stage("probes", deps, async () =>
      runVisibilityProbes(
        {
          url,
          business: business ?? "",
          buyerQuestions: analyze.ok ? analyze.data.buyerQuestions.map((q) => q.question) : [],
          competitors: opts.competitors ?? [],
        },
        deps.engines ?? defaultEngines(),
      ),
    );
  }

  return {
    url,
    business,
    generatedAt: new Date().toISOString(),
    scores: computeScores({
      checks: checks.ok ? checks.data : null,
      lighthouse: lighthouse.ok ? lighthouse.data : null,
      analyze: analyze.ok ? analyze.data : null,
      probes: probes.ok ? probes.data : null,
    }),
    crawl,
    checks,
    lighthouse,
    analyze,
    probes,
  };
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/pipeline.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/pipeline.ts tests/prospect/pipeline.test.ts
git commit -m "feat(prospect): pipeline orchestrator with per-stage isolation"
```

---

### Task 11: the report renderer

**Files:**
- Create: `src/prospect/render.ts`
- Test: `tests/prospect/render.test.ts`

ONE renderer serves both the `--out` file and the hosted link, so the two can never drift. Self-contained HTML: no build step, no external CSS, Besley from Google Fonts with a serif fallback, `noindex`, and a print stylesheet so "print to PDF" is the PDF story.

- [ ] **Step 1: Write the failing test**

`tests/prospect/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderProspectReport } from "../../src/prospect/render.js";
import type { ProspectAuditResult } from "../../src/prospect/types.js";

function result(over: Partial<ProspectAuditResult> = {}): ProspectAuditResult {
  return {
    url: "https://acme.example/",
    business: "Acme Roofing",
    generatedAt: "2026-08-25T17:00:00.000Z",
    scores: { findability: 62, readability: 41, answers: 50, aiVisibility: 33 },
    crawl: {
      ok: true,
      data: {
        origin: "https://acme.example",
        robotsTxt: "User-agent: GPTBot\nDisallow: /",
        agentAccess: [{ agent: "GPTBot", allowed: false, matchedRule: "User-agent: GPTBot → Disallow: /" }],
        sitemap: { present: true, urlCount: 12 },
        llmsTxt: { present: false, firstLine: null },
        homeHeaders: {},
        pages: [],
      },
    },
    checks: {
      ok: true,
      data: {
        crawlerAccess: { blockedAi: ["GPTBot"], allowedAi: ["ClaudeBot"], blockedClassical: [] },
        jsDependence: { avgMissing: 0.82, perPage: [{ url: "https://acme.example/", missing: 0.82 }] },
        schema: { typesFound: ["LocalBusiness"], missingExpected: ["FAQPage"], invalidBlocks: 0 },
        meta: { pageCount: 4, missingTitle: 0, missingDescription: 2, missingCanonical: 1, missingSocial: 3 },
        headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 0 },
        securityHeaders: { present: ["x-frame-options"], missing: ["content-security-policy"] },
        sitemapPresent: true,
        llmsTxtPresent: false,
        viewportOk: true,
      },
    },
    lighthouse: {
      ok: true,
      data: { performance: 44, accessibility: 88, bestPractices: 75, seo: 92, summary: "lighthouse: 2 assertion(s) failed", status: "warn" },
    },
    analyze: {
      ok: true,
      data: {
        business: "Acme Roofing",
        entityClarity: { score: 55, missing: ["service area"] },
        buyerQuestions: [
          { question: "What does a repair cost?", answered: "partial", quotable: false, page: "https://acme.example/", evidence: "$1,200-$8,000" },
          { question: "Do you do flat roofs?", answered: "no", quotable: false, page: null, evidence: null },
        ],
        fixes: [
          { title: "Unblock GPTBot in robots.txt", why: "It cannot read a single page today.", impact: "high", effort: "low", tier: "crawl" },
          { title: "Add FAQ schema", why: "Answer engines quote FAQ blocks.", impact: "medium", effort: "medium", tier: "content" },
        ],
        narrative: { findability: "Two of six AI crawlers are blocked.", readability: "Most copy needs JavaScript.", answers: "Half the buyer questions go unanswered." },
      },
    },
    probes: {
      ok: true,
      data: {
        answers: [
          { engine: "perplexity", query: "who is Acme Roofing", domainCited: true, brandMentioned: true, citedDomains: ["acme.example"], snippet: "Acme Roofing is a Boise contractor." },
          { engine: "perplexity", query: "best roofer in Boise", domainCited: false, brandMentioned: false, citedDomains: ["bestroofs.example"], snippet: "BestRoofs is frequently recommended." },
        ],
        visibilityScore: 33,
        competitorsSeen: [{ domain: "bestroofs.example", count: 4 }],
      },
    },
    ...over,
  };
}

describe("renderProspectReport", () => {
  const html = renderProspectReport(result());

  it("is a self-contained, noindex HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("names the business and the audited URL", () => {
    expect(html).toContain("Acme Roofing");
    expect(html).toContain("https://acme.example/");
  });

  it("shows all four scores", () => {
    for (const label of ["Findability", "Readability", "Answers", "AI Visibility"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("62");
    expect(html).toContain("33");
  });

  it("leads with the probe receipts", () => {
    expect(html).toContain("What the AI engines said about you");
    expect(html).toContain("who is Acme Roofing");
    expect(html).toContain("BestRoofs is frequently recommended.");
    expect(html).toContain("bestroofs.example");
    expect(html.indexOf("What the AI engines said about you")).toBeLessThan(
      html.indexOf("What to fix first"),
    );
  });

  it("renders the findings and the fix list in impact order", () => {
    expect(html).toContain("GPTBot");
    expect(html).toContain("82%");
    expect(html).toContain("What does a repair cost?");
    expect(html.indexOf("Unblock GPTBot in robots.txt")).toBeLessThan(html.indexOf("Add FAQ schema"));
  });

  it("degrades a failed stage to 'Not measured' without throwing", () => {
    const degraded = renderProspectReport(
      result({
        probes: { ok: false, error: "no visibility engine returned an answer" },
        analyze: { ok: false, error: "529 overloaded" },
        scores: { findability: 62, readability: 41, answers: null, aiVisibility: null },
      }),
    );
    expect(degraded).toContain("Not measured");
    expect(degraded).toContain("no visibility engine returned an answer");
    expect(degraded).toContain("What the AI engines said about you");
  });

  it("escapes content that came from the prospect's site", () => {
    const evil = renderProspectReport(result({ business: '<script>alert("x")</script>' }));
    expect(evil).not.toContain('<script>alert("x")</script>');
    expect(evil).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/prospect/render.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/render.js`.

- [ ] **Step 3: Write `src/prospect/render.ts`**

```ts
import { escapeHtml, safeUrl } from "../util/html.js";
import type { Fix, ProspectAuditResult, StageResult } from "./types.js";

const RED = "#d71920";
const IMPACT_ORDER: Record<Fix["impact"], number> = { high: 0, medium: 1, low: 2 };

const STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #faf8f5; color: #1a1a1a;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
  h1, h2, h3 { font-family: Besley, Georgia, "Times New Roman", serif; font-weight: 600; line-height: 1.2; }
  h1 { font-size: 40px; margin: 0 0 8px; }
  h2 { font-size: 26px; margin: 48px 0 12px; border-top: 2px solid #e6e1da; padding-top: 24px; }
  h3 { font-size: 18px; margin: 24px 0 8px; }
  .lede { color: #57544f; margin: 0 0 8px; }
  .scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 32px 0; }
  .score { background: #fff; border: 1px solid #e6e1da; border-radius: 8px; padding: 16px; }
  .score .n { font-family: Besley, Georgia, serif; font-size: 38px; line-height: 1; color: ${RED}; }
  .score .n.na { font-size: 18px; color: #8a857e; }
  .score .l { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #57544f; margin-top: 8px; }
  .card { background: #fff; border: 1px solid #e6e1da; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .q { font-weight: 600; }
  .tag { display: inline-block; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    border-radius: 999px; padding: 2px 10px; border: 1px solid currentColor; }
  .yes { color: #14663c; } .partial { color: #8a6d00; } .no { color: ${RED}; }
  ul { padding-left: 20px; } li { margin: 6px 0; }
  .muted { color: #8a857e; }
  .cta { margin-top: 56px; background: ${RED}; color: #fff; border-radius: 8px; padding: 24px 28px; }
  .cta h2 { border: 0; padding: 0; margin: 0 0 8px; color: #fff; }
  .cta a { color: #fff; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  @media print { body { background: #fff; } .card, .score { break-inside: avoid; } }
`;

function scoreCard(label: string, value: number | null): string {
  const n =
    value === null
      ? `<div class="n na">Not measured</div>`
      : `<div class="n">${value}</div>`;
  return `<div class="score">${n}<div class="l">${escapeHtml(label)}</div></div>`;
}

/** Body for a stage that succeeded, or a uniform "Not measured" note when it didn't. */
function stageBody<T>(stage: StageResult<T>, body: (data: T) => string): string {
  return stage.ok
    ? body(stage.data)
    : `<p class="muted">Not measured — ${escapeHtml(stage.error)}</p>`;
}

export function renderProspectReport(result: ProspectAuditResult): string {
  const host = (() => {
    try {
      return new URL(result.url).hostname;
    } catch {
      return result.url;
    }
  })();
  const name = result.business ?? host;
  const date = new Date(result.generatedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const probesSection = stageBody(result.probes, (p) => {
    const rows = p.answers
      .map(
        (a) => `<div class="card">
        <div class="q">${escapeHtml(a.engine)} · “${escapeHtml(a.query)}”</div>
        <p>${escapeHtml(a.snippet)}${a.snippet.length >= 300 ? "…" : ""}</p>
        <p class="muted">${
          a.domainCited || a.brandMentioned
            ? "You were named in this answer."
            : "You were not named in this answer."
        }${
          a.citedDomains.length ? ` Cited: ${escapeHtml(a.citedDomains.join(", "))}` : ""
        }</p>
      </div>`,
      )
      .join("");
    const competitors = p.competitorsSeen.length
      ? `<h3>Who the engines cited instead</h3><ul>${p.competitorsSeen
          .map((c) => `<li>${escapeHtml(c.domain)} — ${c.count} time${c.count === 1 ? "" : "s"}</li>`)
          .join("")}</ul>`
      : "";
    return rows + competitors;
  });

  const findabilitySection = stageBody(result.checks, (c) => {
    const blocked = c.crawlerAccess.blockedAi.length
      ? `<p><strong>Blocked AI crawlers:</strong> ${escapeHtml(c.crawlerAccess.blockedAi.join(", "))}</p>`
      : `<p>Every AI crawler we checked can reach the site.</p>`;
    const classical = c.crawlerAccess.blockedClassical.length
      ? `<p><strong>Blocked search crawlers:</strong> ${escapeHtml(
          c.crawlerAccess.blockedClassical.join(", "),
        )}</p>`
      : "";
    const lh = result.lighthouse.ok
      ? `<p class="muted">Lighthouse — performance ${result.lighthouse.data.performance ?? "n/a"},
         SEO ${result.lighthouse.data.seo ?? "n/a"}, accessibility ${
           result.lighthouse.data.accessibility ?? "n/a"
         }.</p>`
      : `<p class="muted">Lighthouse not measured — ${escapeHtml(result.lighthouse.error)}</p>`;
    return `${blocked}${classical}
      <ul>
        <li>sitemap.xml: ${c.sitemapPresent ? "present" : "missing"}</li>
        <li>llms.txt: ${c.llmsTxtPresent ? "present" : "missing"}</li>
        <li>Pages missing a meta description: ${c.meta.missingDescription} of ${c.meta.pageCount}</li>
        <li>Pages missing a canonical URL: ${c.meta.missingCanonical} of ${c.meta.pageCount}</li>
        <li>Pages missing share images/titles: ${c.meta.missingSocial} of ${c.meta.pageCount}</li>
        <li>Security headers missing: ${
          c.securityHeaders.missing.length ? escapeHtml(c.securityHeaders.missing.join(", ")) : "none"
        }</li>
      </ul>${lh}`;
  });

  const readabilitySection = stageBody(result.checks, (c) => {
    const pct = Math.round(c.jsDependence.avgMissing * 100);
    return `<p><strong>${pct}%</strong> of the words a visitor reads only appear after JavaScript runs.
      Most AI crawlers do not run JavaScript, so that share of your site is invisible to them.</p>
      <ul>
        <li>Structured data found: ${c.schema.typesFound.length ? escapeHtml(c.schema.typesFound.join(", ")) : "none"}</li>
        <li>Expected structured data missing: ${
          c.schema.missingExpected.length ? escapeHtml(c.schema.missingExpected.join(", ")) : "none"
        }</li>
        <li>Pages without a top-level heading: ${c.headings.pagesWithoutH1} of ${c.meta.pageCount}</li>
      </ul>`;
  });

  const answersSection = stageBody(result.analyze, (a) => {
    const rows = a.buyerQuestions
      .map(
        (q) => `<tr>
          <td>${escapeHtml(q.question)}</td>
          <td><span class="tag ${q.answered}">${q.answered}</span></td>
          <td>${q.evidence ? escapeHtml(q.evidence) : '<span class="muted">no passage on the site</span>'}</td>
        </tr>`,
      )
      .join("");
    return `<p>${escapeHtml(a.narrative.answers)}</p>
      <table><tr><th>What buyers ask</th><th>Answered</th><th>Evidence</th></tr>${rows}</table>`;
  });

  const fixes = stageBody(result.analyze, (a) => {
    const sorted = [...a.fixes].sort((x, y) => IMPACT_ORDER[x.impact] - IMPACT_ORDER[y.impact]);
    return `<ol>${sorted
      .map(
        (f) => `<li><strong>${escapeHtml(f.title)}</strong> — ${escapeHtml(f.why)}
          <span class="muted">(${f.impact} impact, ${f.effort} effort)</span></li>`,
      )
      .join("")}</ol>`;
  });

  const narrative = result.analyze.ok
    ? `<p class="lede">${escapeHtml(result.analyze.data.narrative.findability)}
       ${escapeHtml(result.analyze.data.narrative.readability)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Can AI find ${escapeHtml(name)}? — Reddoor audit</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Besley:wght@400;600&display=swap" rel="stylesheet" />
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <h1>Can AI and Google actually find ${escapeHtml(name)}?</h1>
  <p class="lede"><a href="${safeUrl(result.url)}">${escapeHtml(result.url)}</a> · audited ${escapeHtml(date)} by Reddoor Creative</p>
  ${narrative}

  <div class="scores">
    ${scoreCard("Findability", result.scores.findability)}
    ${scoreCard("Readability", result.scores.readability)}
    ${scoreCard("Answers", result.scores.answers)}
    ${scoreCard("AI Visibility", result.scores.aiVisibility)}
  </div>

  <h2>What the AI engines said about you</h2>
  ${probesSection}

  <h2>What the crawlers can reach</h2>
  ${findabilitySection}

  <h2>What the crawlers can read</h2>
  ${readabilitySection}

  <h2>The questions your buyers ask</h2>
  ${answersSection}

  <h2>What to fix first</h2>
  ${fixes}

  <div class="cta">
    <h2>Want this fixed?</h2>
    <p>Reddoor Creative rebuilds sites so answer engines can read, quote and recommend them.
    Reply to the email this link came from, or start at
    <a href="https://reddoorla.com/">reddoorla.com</a>.</p>
  </div>
</div>
</body>
</html>`;
}
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/prospect/render.test.ts`
Expected: 7 passed.

The tests prove the sections exist and degrade correctly; whether the page LOOKS right is judged on a real report in Task 14, Step 3.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/render.ts tests/prospect/render.test.ts
git commit -m "feat(prospect): branded self-contained report renderer"
```

---

### Task 12: the CLI command

**Files:**
- Create: `src/cli/commands/prospect-audit.ts`
- Modify: `src/cli/bin.ts`
- Test: `tests/cli/prospect-audit-command.test.ts`

**One deliberate deviation from the spec:** progress is plain stderr lines from the pipeline's `onStage` callback, not listr2. The pipeline already owns stage sequencing and isolation; wrapping it in Listr would mean either duplicating that control flow or faking tasks around a promise it doesn't expose. Stderr also keeps `--json` stdout clean.

- [ ] **Step 1: Write the failing test**

`tests/cli/prospect-audit-command.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("prospect-audit CLI", () => {
  it("is registered with its flags", () => {
    const help = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf-8" });
    expect(help).toContain("prospect-audit");
  });

  it("rejects a non-http argument before doing any work", async () => {
    const { output, code } = await runProspectAuditCommand("not-a-url", {});
    expect(code).toBe(2);
    expect(output).toMatch(/https?:\/\//);
  });

  it("refuses to run with neither Turso nor --out — the report would vanish", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {});
    expect(code).toBe(2);
    expect(output).toContain("--out");
  });
});

describe("prospect-audit CLI — writing a file", () => {
  const out = resolve(tmpdir(), "prospect-cli-test.html");

  beforeEach(() => {
    delete process.env.TURSO_DATABASE_URL;
    if (existsSync(out)) rmSync(out);
  });
  afterEach(() => {
    if (existsSync(out)) rmSync(out);
  });

  it("renders the report to --out and reports the scores", async () => {
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      out,
      probes: false,
      deps: {
        crawl: {
          async fetchUrl(url: string) {
            if (url === "https://acme.example/")
              return { status: 200, body: "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Roofing in Boise.</p></body></html>", headers: {} };
            return { status: 404, body: "", headers: {} };
          },
          async renderPages() {
            return new Map<string, string>();
          },
          maxPages: 2,
          delayMs: 0,
        },
        analyze: {
          run: async () => ({
            business: "Acme Roofing",
            entityClarity: { score: 50, missing: [] },
            buyerQuestions: [{ question: "cost?", answered: "no", quotable: false, page: null, evidence: null }],
            fixes: [],
            narrative: { findability: "a", readability: "b", answers: "c" },
          }),
        },
        lighthouse: async () => {
          throw new Error("skipped in test");
        },
      },
    });

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf-8")).toContain("Acme Roofing");
    expect(output).toContain("Findability");
    expect(output).toContain(out);
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm test -- tests/cli/prospect-audit-command.test.ts`
(Uses the full `pnpm test` so `dist/` is rebuilt — the help assertion execs the built bin.)
Expected: FAIL — cannot resolve `../../src/cli/commands/prospect-audit.js`.

- [ ] **Step 3: Write `src/cli/commands/prospect-audit.ts`**

```ts
import { writeFile } from "node:fs/promises";
import { isHttpUrl } from "../../util/url.js";
import { resolveDashboardBaseUrl } from "../../dashboard/handler-helpers.js";
import type { PipelineDeps, StageName } from "../../prospect/pipeline.js";
import type { ProspectAuditResult } from "../../prospect/types.js";

export type ProspectAuditCliOptions = {
  business?: string;
  /** Comma-separated competitor domains. */
  competitors?: string;
  /** cac sets this false for `--no-probes`. */
  probes?: boolean;
  out?: string;
  json?: boolean;
  /** Test seam: injected pipeline deps. Never set from the CLI. */
  deps?: PipelineDeps;
};

function fail(message: string): { output: string; code: number } {
  return { output: message, code: 2 };
}

function scoreLine(label: string, value: number | null): string {
  return `${label.padEnd(14)} ${value === null ? "not measured" : String(value).padStart(3)}`;
}

function summarize(result: ProspectAuditResult, link: string | null, file: string | null): string {
  const lines = [
    `Prospect audit — ${result.business ?? result.url}`,
    "",
    scoreLine("Findability", result.scores.findability),
    scoreLine("Readability", result.scores.readability),
    scoreLine("Answers", result.scores.answers),
    scoreLine("AI Visibility", result.scores.aiVisibility),
  ];
  for (const [name, stage] of [
    ["checks", result.checks],
    ["lighthouse", result.lighthouse],
    ["analyze", result.analyze],
    ["probes", result.probes],
  ] as const) {
    if (!stage.ok) lines.push(`  ! ${name} not measured — ${stage.error}`);
  }
  if (file) lines.push("", `Report written to ${file}`);
  if (link) lines.push("", `Shareable link: ${link}`);
  return lines.join("\n");
}

/**
 * Run one prospect audit end to end. Progress goes to stderr so `--json` stdout
 * stays pipeable. Persistence needs Turso; without it `--out` is mandatory,
 * because an audit nobody can read afterwards is just a bill.
 */
export async function runProspectAuditCommand(
  url: string,
  opts: ProspectAuditCliOptions,
): Promise<{ output: string; code: number }> {
  if (!isHttpUrl(url)) {
    return fail(`"${url}" is not a URL. Pass the full address, e.g. https://example.com`);
  }
  const canPersist = Boolean(process.env.TURSO_DATABASE_URL);
  if (!canPersist && !opts.out) {
    return fail(
      "No TURSO_DATABASE_URL, so the report cannot be saved or shared. Re-run with --out <file>, or set the Turso credentials.",
    );
  }

  const { runProspectAudit } = await import("../../prospect/pipeline.js");
  const onStage = (name: StageName, status: "start" | "ok" | "fail", detail?: string): void => {
    if (status === "start") console.error(`… ${name}`);
    else if (status === "ok") console.error(`✓ ${name}`);
    else console.error(`! ${name} — ${detail ?? "failed"}`);
  };

  const result = await runProspectAudit(
    url,
    {
      ...(opts.business ? { business: opts.business } : {}),
      ...(opts.competitors
        ? { competitors: opts.competitors.split(",").map((c) => c.trim()).filter(Boolean) }
        : {}),
      ...(opts.probes === false ? { probes: false } : {}),
    },
    { ...(opts.deps ?? {}), onStage },
  );

  if (opts.json) return { output: JSON.stringify(result, null, 2), code: 0 };

  const { renderProspectReport } = await import("../../prospect/render.js");
  const html = renderProspectReport(result);

  let file: string | null = null;
  if (opts.out) {
    await writeFile(opts.out, html, "utf-8");
    file = opts.out;
  }

  let link: string | null = null;
  if (canPersist) {
    const { openDb, readDbConfig } = await import("../../db/client.js");
    const { createProspectAudit } = await import("../../db/prospect-audits.js");
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: result.url,
      business: result.business,
      resultJson: JSON.stringify(result),
    });
    link = `${resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL)}/r/${token}`;
  }

  return { output: summarize(result, link, file), code: 0 };
}
```

- [ ] **Step 4: Register it in `src/cli/bin.ts`**

Insert this block immediately before the `cli.command("report [site]", …)` registration (keep the `cli` / `.command` formatting of its neighbours):

```ts
cli
  .command("prospect-audit <url>", "AEO/SEO audit an external prospect's site and publish the report.")
  .option("--business <name>", "The prospect's business name (defaults to what the model reads off the site).")
  .option("--competitors <list>", "Comma-separated competitor domains to add comparison probes for.")
  .option("--no-probes", "Skip the live AI-visibility probes (tier 3).")
  .option("--out <file>", "Also write the rendered report to this file.")
  .option("--json", "Print the raw result JSON instead of the report summary.")
  .action(
    async (
      url: string,
      opts: {
        business?: string;
        competitors?: string;
        probes?: boolean;
        out?: string;
        json?: boolean;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () =>
          (await import("./commands/prospect-audit.js")).runProspectAuditCommand(url, opts),
        opts,
      ),
  );
```

- [ ] **Step 5: Run the test — must pass**

Run: `pnpm test -- tests/cli/prospect-audit-command.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/prospect-audit.ts src/cli/bin.ts tests/cli/prospect-audit-command.test.ts
git commit -m "feat(prospect): the prospect-audit CLI command"
```

---

### Task 13: the public hosted report

**Files:**
- Create: `netlify/functions/prospect-report.mts`
- Test: `tests/dashboard/prospect-report.test.ts`

This is the one route on the maintenance site that is NOT behind the operator's basic auth — the whole point is handing a prospect a link. It is guarded instead by an unguessable token, `noindex`, and a rate limit.

- [ ] **Step 1: Write the failing test**

`tests/dashboard/prospect-report.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import prospectReport from "../../netlify/functions/prospect-report.mjs";
import type { Context } from "@netlify/functions";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const ctx = (token?: string): Context => ({ params: token ? { token } : {} }) as unknown as Context;
const req = (method = "GET"): Request => new Request("https://dash.reddoor.test/r/abc", { method });

describe("GET /r/:token", () => {
  it("rejects a non-GET", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req("POST"), ctx("A".repeat(22)));
    expect(res.status).toBe(405);
  });

  it("404s a malformed token without touching the database", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectReport(req(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("503s when Turso is unconfigured", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).toBe(503);
  });

  it("404s a well-formed token with no row", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).toBe(404);
  });

  it("never asks for basic auth", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectReport(req(), ctx("A".repeat(22)));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `pnpm vitest run tests/dashboard/prospect-report.test.ts`
Expected: FAIL — cannot resolve `../../netlify/functions/prospect-report.mjs`.

- [ ] **Step 3: Write `netlify/functions/prospect-report.mts`**

```ts
import type { Context, Config } from "@netlify/functions";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { getProspectAuditByToken, isValidToken } from "../../src/db/prospect-audits.js";
import { renderProspectReport } from "../../src/prospect/render.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import type { ProspectAuditResult } from "../../src/prospect/types.js";

// The only public route on this site: a prospect opens it from a cold email, so
// there is no operator to authenticate. The 128-bit token IS the credential —
// hence noindex, a tight rate limit, and no directory listing anywhere.
export const config: Config = {
  path: ["/r/:token"],
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ["ip"],
  },
};

function plainText(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  const token = ctx.params?.token;
  // Shape-check before the database: anything else is a scanner, not a prospect.
  if (!token || !isValidToken(token)) return plainText("Not found.", 404);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[prospect-report] TURSO_DATABASE_URL missing");
    return plainText("Report storage is unconfigured.", 503);
  }

  try {
    const db = await openDb(readDbConfig());
    const row = await getProspectAuditByToken(db, token);
    if (!row) return plainText("Not found.", 404);

    const result = JSON.parse(row.result_json) as ProspectAuditResult;
    return new Response(renderProspectReport(result), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (err) {
    return handlerError("prospect-report", err);
  }
};
```

- [ ] **Step 4: Run the test — must pass**

Run: `pnpm vitest run tests/dashboard/prospect-report.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Typecheck both projects**

Run: `pnpm typecheck`
Expected: clean — this also runs `tsc -p tsconfig.netlify.json`, which covers the new function.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/prospect-report.mts tests/dashboard/prospect-report.test.ts
git commit -m "feat(prospect): public tokened report route at /r/:token"
```

---

### Task 14: full verification, changeset and handover

**Files:**
- Create: `.changeset/prospect-audit.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-24-prospect-audit-design.md` (status line only)

- [ ] **Step 1: Run the whole gate**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. If `test:coverage` is what CI gates on, also run `pnpm test:coverage` and confirm the thresholds (statements 78 / branches 67 / functions 76 / lines 80) still pass — the new module is well covered, so it should lift the numbers, not drop them.

- [ ] **Step 2: Prove the Anthropic call shape against the live API — once**

This is the only step in the plan that spends money (~$0.50) and the only one that can catch a wrong SDK parameter, because every test stubs the model.

Run:

```bash
npx tsx -e "
import { analyzeSite } from './src/prospect/analyze.js';
import { crawlSite, defaultCrawlDeps } from './src/prospect/crawl.js';
import { runChecks } from './src/prospect/checks.js';
const crawl = await crawlSite('https://reddoorla.com/', defaultCrawlDeps({ maxPages: 3 }));
const out = await analyzeSite('https://reddoorla.com/', crawl, runChecks(crawl));
console.log(out.business);
console.log(out.buyerQuestions.length, 'buyer questions');
"
```

Expected: a sentence describing Reddoor Creative and a buyer-question count between 6 and 10.
If the API rejects `thinking` or `output_config`, fix the call against the installed SDK's types (`node_modules/@anthropic-ai/sdk`), re-run, and commit the fix — do not paper over it with a cast.

- [ ] **Step 3: Run one real audit end to end**

Run:

```bash
node dist/cli/bin.js prospect-audit https://reddoorla.com/ --business "Reddoor Creative" --no-probes --out /tmp/reddoor-audit.html
```

Expected: stage lines on stderr, a score summary on stdout, and a readable report at `/tmp/reddoor-audit.html`. Open it. With `TURSO_DATABASE_URL` set, the summary also prints a `/r/<token>` link — fetch that link against the deployed site once it ships (Step 6).

- [ ] **Step 4: Write the changeset**

`.changeset/prospect-audit.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

Add `prospect-audit <url>`: a three-tier AEO/SEO audit of an external prospect's
site (crawler access + JS-dependence checks, a Claude answerability pass, and
live AI-visibility probes across Perplexity and Claude web search), rendered as
a branded report and published at a public tokened link (`/r/:token`).
```

- [ ] **Step 5: Document it in `README.md`**

Add to the CLI command list, matching the surrounding entry style:

```markdown
- `prospect-audit <url>` — AEO/SEO audit an external prospect's site and publish
  a shareable report. Flags: `--business <name>`, `--competitors <list>`,
  `--no-probes`, `--out <file>`, `--json`. Needs `ANTHROPIC_API_KEY` (or the
  standard Anthropic auth chain) and, for tier 3, `PERPLEXITY_API_KEY`;
  persistence and the shareable link need the Turso vars.
```

- [ ] **Step 6: Mark the spec built and commit**

Change the spec's status line from `**Status:** approved (Tucker, in-session)` to `**Status:** built — see docs/superpowers/plans/2026-08-24-prospect-audit.md`.

```bash
git add .changeset/prospect-audit.md README.md docs/superpowers/specs/2026-08-24-prospect-audit-design.md
git commit -m "docs(prospect): changeset, README entry, spec status"
git push -u origin feat/prospect-audit
```

Then open the PR:

```bash
gh pr create --title "feat(prospect): external AEO/SEO audit tool" --body "Implements docs/superpowers/specs/2026-08-24-prospect-audit-design.md …"
```

- [ ] **Step 7: Hand back the deploy-time items**

These are NOT code and must not be attempted silently — report them to Tucker with the PR:

1. Create the Perplexity API account and add `PERPLEXITY_API_KEY` to the local credentials file (`~/.config/reddoor-maint/credentials.env`) and to Netlify (`netlify env:set PERPLEXITY_API_KEY --secret --context production branch-deploy deploy-preview` on the `reddoor-maintenance` site — remember `env:clone` silently corrupts secrets).
2. After the deploy, fetch a real `/r/<token>` link on `reddoor-maintenance.netlify.app` and confirm it renders WITHOUT a basic-auth prompt and returns `x-robots-tag: noindex`.
3. Optional and separate: the `audit.reddoorla.com` DNS record plus the Netlify domain alias.

---

## Notes for whoever executes this

- **The spec said "colocated vitest per module"; the repo says otherwise.** Tests live in `tests/`, mirroring `src/` — that is what `vitest.config.ts` includes. The plan follows the repo.
- **The spec said to reuse "the fleet security audit's header logic".** There is none: `src/audits/security.ts` is Dependabot/pnpm-audit only, and the canonical header set lives in the sync-configs Netlify template. Task 6 takes the header list from that template, which is the real shared source of truth.
- **Lighthouse reuse is real** — `lighthouseAudit` takes the deployed-URL path whenever `site.deployedUrl` is set (`src/audits/lighthouse.ts:285`), which is exactly the checkout-free run this tool needs.
- **The spec's "answer-first structure signals" live in the analyze pass, not in `checks.ts`.** Whether a section opener could stand alone as an answer is a judgement about meaning; the `quotable` flag on each buyer question is that same signal, measured by the model against a real question instead of by a heuristic against a paragraph. `checks.ts` keeps only the mechanical heading checks (one h1, no level skips).
- **Every stage is injectable.** No test in this plan touches the network, the Anthropic API, or Turso-the-service; the only live calls are the two explicit verification steps in Task 14.
- **Nothing here writes to the fleet.** No audit registry entry, no Airtable, no `sites` row — a prospect is not a fleet site, and keeping that boundary is the reason this is its own module.

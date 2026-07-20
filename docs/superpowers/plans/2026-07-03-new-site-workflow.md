# New-Client-Site Workflow Implementation Plan

> Adopted from reddoor-starter on 2026-07-19 (clone-template hygiene — process
> docs don't ship in the template). Written 2026-07-03; the plan is complete
> and the workflow lives on as the `new-site` and `figma-slices` skills.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the awarded→launched pipeline from the 2026-07-03 spec: a `reddoor-maint ensure-site` CLI command (fleet-inventory row from day one), a `/new-site` bootstrap skill, and a `/figma-slices` build skill.

**Architecture:** One small, TDD'd addition to `@reddoorla/maintenance` (find-or-create on the Airtable Websites table, injected-base pattern like `preflight`), plus two operator skills as markdown procedures in `~/.claude/skills/` that orchestrate existing tools (`gh`, Figma MCP, the maintenance CLI). Skills carry no code of their own — every action they take is a documented invocation of something that already exists.

**Tech Stack:** TypeScript (reddoor-maintenance conventions: injected `AirtableBase`, `makeFakeBase` tests, cac CLI), Claude Code skills (SKILL.md frontmatter format matching `~/.claude/skills/rfp-analyze`), Figma MCP, GitHub CLI.

**Repos touched:** `reddoor-maintenance` (Tasks 1–3), `~/.claude/skills/` (Tasks 4–5, not a git repo). Work in a reddoor-maintenance worktree off `origin/main` (`git -C <repo> worktree add <dir> origin/main -b feat/ensure-site`). Run `pnpm install` there first.

---

### Task 1: `ensureSite` — find-or-create Websites row (pure-ish logic)

**Files:**

- Create: `src/reports/airtable/ensure-site.ts`
- Test: `tests/reports/airtable/ensure-site.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/reports/airtable/ensure-site.test.ts
import { describe, it, expect } from "vitest";
import { ensureSite } from "../../../src/reports/airtable/ensure-site.js";
import { makeFakeBase, type FakeRecord } from "../_helpers/fake-airtable-base.js";

function existingSite(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "recEXIST",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      Status: "maintenance",
      ...over,
    },
  };
}

describe("ensureSite", () => {
  it("creates a row with in-development defaults when the slug is unknown", async () => {
    const base = makeFakeBase({ Websites: [] });
    const result = await ensureSite(base, {
      slug: "roalson",
      url: "https://roalson.netlify.app",
      pointOfContact: "owner@roalson.com",
    });
    expect(result.status).toBe("created");
    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Websites");
    expect(create).toBeDefined();
    const fields = (create as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields).toMatchObject({
      Name: "roalson",
      Status: "in development",
      url: "https://roalson.netlify.app",
      "point of contact": "owner@roalson.com",
      "Git repo": "reddoorla/roalson",
    });
  });

  it("matches an existing row by slug (Name slugifies to the input) and does NOT create", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const result = await ensureSite(base, { slug: "acme-co" });
    expect(result.status).toBe("exists");
    expect(base.__calls.some((c) => c.kind === "create")).toBe(false);
  });

  it("fills ONLY blank fields on an existing row — never overwrites operator data", async () => {
    const base = makeFakeBase({
      Websites: [existingSite({ url: undefined, "point of contact": "kept@client.com" })],
    });
    const result = await ensureSite(base, {
      slug: "acme-co",
      url: "https://acme.example.com",
      pointOfContact: "IGNORED@example.com",
    });
    expect(result.status).toBe("exists");
    expect(result.updatedFields).toEqual(["url"]);
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update).toBeDefined();
    const fields = (update as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields).toEqual({ url: "https://acme.example.com" });
  });

  it("is a no-op update when nothing is blank", async () => {
    const base = makeFakeBase({
      Websites: [
        existingSite({
          "point of contact": "kept@client.com",
          "Git repo": "reddoorla/acme-co",
        }),
      ],
    });
    const result = await ensureSite(base, {
      slug: "acme-co",
      url: "https://elsewhere.example.com",
      pointOfContact: "x@y.com",
      gitRepo: "reddoorla/other",
    });
    expect(result.updatedFields).toEqual([]);
    expect(base.__calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("rejects an empty/unslugifiable slug", async () => {
    const base = makeFakeBase({ Websites: [] });
    await expect(ensureSite(base, { slug: "  " })).rejects.toThrow(/slug/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/reports/airtable/ensure-site.test.ts`
Expected: FAIL — `Cannot find module '../../../src/reports/airtable/ensure-site.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/reports/airtable/ensure-site.ts
import type { AirtableBase } from "./client.js";
import { WEBSITES_TABLE, listWebsites, siteSlug } from "./websites.js";
import type { WebsiteRow } from "./websites.js";

export type EnsureSiteInput = {
  /** Canonical slug — becomes the Airtable Name on create, matches by siteSlug(Name) otherwise. */
  slug: string;
  url?: string;
  pointOfContact?: string;
  /** owner/repo. Default on create: `reddoorla/<slug>`. */
  gitRepo?: string;
};

export type EnsureSiteResult = {
  status: "created" | "exists";
  siteId: string;
  /** Airtable column names written on the exists path (create path writes all). */
  updatedFields: string[];
};

/** Column-name map (load-bearing magic strings — see websites.ts's mapRow header). */
const COLS = {
  url: "url",
  pointOfContact: "point of contact",
  gitRepo: "Git repo",
} as const;

/**
 * Find-or-create the Websites row for a slug so a new site exists in the fleet
 * inventory (audits, form-ingest slug resolution, reports) from day one.
 *
 * Fill-blanks-only on the exists path: this command runs from a bootstrap skill
 * that may be re-run to resume — it must never clobber operator-edited cells.
 * Frequencies are deliberately NOT set (launch flips the lifecycle); Status is
 * only written on create ("in development").
 */
export async function ensureSite(
  base: AirtableBase,
  input: EnsureSiteInput,
): Promise<EnsureSiteResult> {
  const slug = siteSlug(input.slug);
  if (!slug) throw new Error(`ensure-site: '${input.slug}' does not slugify to a usable slug`);

  const existing = (await listWebsites(base)).find((w) => siteSlug(w.name) === slug);

  if (!existing) {
    const fields: Record<string, unknown> = {
      Name: slug,
      Status: "in development",
      [COLS.gitRepo]: input.gitRepo ?? `reddoorla/${slug}`,
    };
    if (input.url) fields[COLS.url] = input.url;
    if (input.pointOfContact) fields[COLS.pointOfContact] = input.pointOfContact;
    const created = (await base(WEBSITES_TABLE).create([{ fields }])) as Array<{
      id: string;
    }>;
    return { status: "created", siteId: created[0]!.id, updatedFields: [] };
  }

  const updates: Record<string, unknown> = {};
  const blank = (v: unknown) => v === null || v === undefined || v === "";
  if (input.url && blank(existing.url || null)) updates[COLS.url] = input.url;
  if (input.pointOfContact && blank(existing.pointOfContact))
    updates[COLS.pointOfContact] = input.pointOfContact;
  if (input.gitRepo && blank(existing.gitRepo)) updates[COLS.gitRepo] = input.gitRepo;

  const updatedFields = Object.keys(updates);
  if (updatedFields.length > 0) {
    await base(WEBSITES_TABLE).update([{ id: existing.id, fields: updates }]);
  }
  return { status: "exists", siteId: existing.id, updatedFields };
}
```

Note for the implementer: check `websites.ts` exports `WEBSITES_TABLE` (it does, line ~5) and that `existing.url` maps `""` for missing url cells (mapRow uses `String(f["url"] ?? "")` — hence the `existing.url || null` normalization above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/reports/airtable/ensure-site.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/ensure-site.ts tests/reports/airtable/ensure-site.test.ts
git commit -m "feat(airtable): ensureSite — find-or-create Websites row, fill-blanks-only"
```

---

### Task 2: `ensure-site` CLI command

**Files:**

- Create: `src/cli/commands/ensure-site.ts`
- Modify: `src/cli/bin.ts` (add command block after the `preflight` block, ~line 400)
- Test: `tests/cli/ensure-site-command.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/cli/ensure-site-command.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/reports/airtable/ensure-site.js", () => ({
  ensureSite: vi.fn(),
}));
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => "FAKE_BASE"),
  readAirtableConfig: vi.fn(() => ({ apiKey: "k", baseId: "b" })),
}));
import { ensureSite } from "../../src/reports/airtable/ensure-site.js";
import { runEnsureSiteCommand } from "../../src/cli/commands/ensure-site.js";

describe("runEnsureSiteCommand", () => {
  it("rejects a missing slug (exit 2)", async () => {
    const res = await runEnsureSiteCommand(undefined, {});
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("slug");
  });

  it("reports a created row", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "created",
      siteId: "recNEW",
      updatedFields: [],
    });
    const res = await runEnsureSiteCommand("roalson", {
      url: "https://roalson.netlify.app",
      contact: "owner@roalson.com",
    });
    expect(res.code).toBe(0);
    expect(res.output).toContain("created");
    expect(vi.mocked(ensureSite)).toHaveBeenCalledWith(
      "FAKE_BASE",
      expect.objectContaining({
        slug: "roalson",
        url: "https://roalson.netlify.app",
        pointOfContact: "owner@roalson.com",
      }),
    );
  });

  it("reports exists + which blanks were filled", async () => {
    vi.mocked(ensureSite).mockResolvedValue({
      status: "exists",
      siteId: "recEXIST",
      updatedFields: ["url"],
    });
    const res = await runEnsureSiteCommand("acme-co", {});
    expect(res.code).toBe(0);
    expect(res.output).toContain("exists");
    expect(res.output).toContain("url");
  });

  it("surfaces errors as exit 1", async () => {
    vi.mocked(ensureSite).mockRejectedValue(new Error("boom"));
    const res = await runEnsureSiteCommand("bad", {});
    expect(res.code).toBe(1);
    expect(res.output).toContain("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/cli/ensure-site-command.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the command**

```ts
// src/cli/commands/ensure-site.ts
import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { ensureSite } from "../../reports/airtable/ensure-site.js";

export type EnsureSiteCommandOptions = {
  url?: string;
  contact?: string;
  gitRepo?: string;
  cwd?: string;
};

/**
 * `ensure-site <slug>` — create/verify the fleet-inventory row for a new site.
 * Day-one step of the /new-site bootstrap skill. Fill-blanks-only; safe to re-run.
 */
export async function runEnsureSiteCommand(
  slug: string | undefined,
  opts: EnsureSiteCommandOptions,
): Promise<{ output: string; code: number }> {
  if (!slug)
    return {
      output: "Provide a <slug> (e.g. `ensure-site roalson`).",
      code: 2,
    };
  try {
    const base = openBase(readAirtableConfig());
    const result = await ensureSite(base, {
      slug,
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.contact ? { pointOfContact: opts.contact } : {}),
      ...(opts.gitRepo ? { gitRepo: opts.gitRepo } : {}),
    });
    const filled =
      result.updatedFields.length > 0
        ? ` — filled blank field(s): ${result.updatedFields.join(", ")}`
        : "";
    return {
      output: `[${slug}] ${result.status} (${result.siteId})${filled}`,
      code: 0,
    };
  } catch (err) {
    const e = err as { message?: string; exitCode?: number };
    return { output: e.message ?? String(err), code: e.exitCode ?? 1 };
  }
}
```

- [ ] **Step 4: Wire into bin.ts** (after the `preflight` command block; follow its exact style)

```ts
cli
  .command("ensure-site <slug>", "Create/verify the Airtable Websites row for a new site.")
  .option("--url <url>", "Deployed URL (e.g. the Netlify site URL).")
  .option("--contact <email>", "point of contact — the client address reports resolve to.")
  .option("--git-repo <owner/repo>", "GitHub identity. Default on create: reddoorla/<slug>.")
  .action(
    async (
      slug: string,
      opts: {
        url?: string;
        contact?: string;
        gitRepo?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/ensure-site.js")).runEnsureSiteCommand(slug, opts),
        opts,
      ),
  );
```

- [ ] **Step 5: Run the full gates**

Run: `pnpm vitest run tests/cli/ensure-site-command.test.ts` → 4 passed
Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:dist` → all green

- [ ] **Step 6: Changeset + commit**

```bash
cat > .changeset/ensure-site-command.md <<'EOF'
---
"@reddoorla/maintenance": minor
---

New `ensure-site <slug>` command: find-or-create the Airtable Websites row for
a new site (Status "in development", Git repo default `reddoorla/<slug>`),
fill-blanks-only on re-run so operator edits are never clobbered. Day-one step
of the /new-site bootstrap workflow — the row makes audits, form-ingest slug
resolution, and reports work from birth.
EOF
git add -A && git commit -m "feat(cli): ensure-site command"
```

---

### Task 3: PR, review, merge (reddoor-maintenance)

- [ ] **Step 1:** Push and open the PR: `git push -u origin feat/ensure-site` then `gh pr create -R reddoorla/reddoor-maintenance` with a body citing the workflow spec (reddoor-starter `docs/superpowers/specs/2026-07-03-new-site-workflow-design.md`).
- [ ] **Step 2:** Run the contract's 3-lens adversarial review on the diff (fresh subagents: Airtable-semantics correctness / idempotency-and-data-safety / CLI-conventions). Fold any findings.
- [ ] **Step 3:** Verify the branch-tip check CONCLUSION explicitly (`gh pr checks --watch` reading the actual pass line, or check-runs API on the head SHA — never infer from silence), squash-merge, add the prettier-formatted autonomy-journal row (on the PR branch, before merge).

---

### Task 4: `/new-site` skill

**Files:**

- Create: `~/.claude/skills/new-site/SKILL.md`

- [ ] **Step 1: Write SKILL.md** — complete content:

```markdown
---
name: new-site
description: Bootstrap a new Reddoor client site from the reddoor-starter template — repo, CI + branch protection, Airtable fleet row, Prismic/Netlify setup prompts, verification. Use when a new client project starts ("new site", "bootstrap <client>", "spin up the repo for <client>"). Idempotent — re-run to resume a partial bootstrap.
---

# New client site bootstrap

Input: a slug (kebab-case client identifier, e.g. `roalson`). Confirm it with
the operator before creating anything. Everything below is idempotent: check
before create, and re-running resumes at whatever is missing.

## Scriptable steps (do these)

1. **Repo**: `gh repo view reddoorla/<slug>` — if missing:
   `gh repo create reddoorla/<slug> --private=false --template reddoorla/reddoor-starter`
   Clone to `~/Documents/GitHub/<slug>`.
2. **Rename**: set `package.json#name` to `<slug>` (drives audit slug-matching).
   Leave `slicemachine.config.json`'s `your-prismic-repo-name` sentinel until
   step 6 — it keeps placeholder builds green.
3. **CI input**: in `.github/workflows/ci.yml` set `netlify-site: "<slug>"`
   (matches the Netlify site created in step 7).
4. **Branch protection** (day one — the fleet lesson):
   `gh api -X PUT repos/reddoorla/<slug>/branches/main/protection`
   with required status check `ci / ci` (strict), no force pushes/deletions.
   NOTE: `gh api PUT` sits in the ask-tier — expect and accept the prompt.
5. **Fleet row**: `reddoor-maint ensure-site <slug> --url https://<slug>.netlify.app --contact <client email>`
   (ask the operator for the client contact if unknown; skip --contact rather
   than guessing).
6. **PROMPT the operator — Prismic**: create the Prismic repository (dashboard;
   suggested name `<slug>`), then replace the sentinel in
   `slicemachine.config.json` with the real name. This re-arms loud-fail
   prerendering by design.
7. **PROMPT the operator — Netlify**: create the site (name `<slug>`, link the
   repo, build settings come from netlify.toml), then set env vars:
   `FORMS_INGEST_URL=https://reddoor-maintenance.netlify.app/api/forms/<slug>`,
   `FORMS_INGEST_TOKEN` (shared value — operator pastes), optional
   `PUBLIC_TURNSTILE_SITE_KEY` (per-domain widget at dash.cloudflare.com).
   `RENOVATE_TOKEN` needs nothing — org secret, all-repos visibility.
8. Commit the config edits as `chore: bootstrap <slug>` and push (a PR is
   unnecessary noise on an empty repo's first config commit — but CI must go
   green on main afterward; verify the run conclusion explicitly).

## Verification (all must pass before handing off to /figma-slices)

- `pnpm install && pnpm build` green locally (placeholder tolerance until step 6;
  loud-fail after).
- CI green on the repo (check the actual run conclusion).
- Renovate: workflow present; dashboard issue appears after the first Monday
  run (do not block on it; note it).
- Airtable row exists (`reddoor-maint ensure-site <slug>` reports `exists`).
- `https://<slug>.netlify.app/robots.txt` shows the real origin after the first
  deploy (needs Netlify's `URL` env at build — comes free with the starter).

Print a checklist of anything not yet done and stop there — do not improvise
around a missing operator step.

## Hand-off

Next: `/figma-slices <figma-url>` for the build phase (see the workflow spec in
reddoor-starter `docs/superpowers/specs/2026-07-03-new-site-workflow-design.md`).
```

- [ ] **Step 2: Self-review against spec Phase 1** — every numbered spec step must appear; check the ask-tier note matches the operator's live settings (gh api PUT is in `ask`).

---

### Task 5: `/figma-slices` skill

**Files:**

- Create: `~/.claude/skills/figma-slices/SKILL.md`

- [ ] **Step 1: Write SKILL.md** — complete content:

```markdown
---
name: figma-slices
description: Implement a client site's design from Figma as Prismic slices — inventory pass (one approval), then per-slice full implementation with tests, a11y, and deploy-preview review. Use when a Figma file is ready for a site build ("implement the figma", "build the slices", "figma to slices"). Requires the Figma MCP connection.
---

# Figma → Prismic slices

Input: a Figma file URL + the target repo (bootstrapped by /new-site). Two
stages; Stage A ends in the operator's inventory approval — the single
design-judgment gate per site.

## Stage A — inventory (one approval)

1. `mcp__figma__get_metadata` + per-frame `get_screenshot` over the file.
2. Propose, in one message: (a) the slice inventory — design section → slice
   name, variations, fields; (b) custom types + route map (page/uid
   conventions per the starter's prismicio.ts); (c) Figma variables →
   Tailwind `@theme` token mapping for app.css; (d) for each slice, a
   **site-only vs upstream-candidate** call (structural-generic = candidate).
3. The operator approves/edits. Their upstream calls are final.

## Stage B — per-slice loop (full implementation)

For each approved slice, in inventory order:

1. `get_design_context` + `get_variable_defs` + `get_screenshot` on its section.
2. `model.json` + `mocks.json` first (content model review is cheaper than
   component review).
3. Svelte component to match the design. Starter conventions, non-negotiable:
   runes; `class: passedClasses` prop; motion via `$lib/transitions` (never raw
   `svelte/transition`); `prefers-reduced-motion` respected on all movement;
   `use:trapFocus` on any overlay; images via `$lib/utils/image` +
   `HeroBackgroundImage`/`Img` where they fit; no new deps without asking.
4. Colocated `.test.ts` (jsdom) + an a11y-fixtures entry so the axe CI gate
   covers it.
5. Verify in the slice simulator + `pnpm build`; PR in small batches (2-4
   slices); the operator reviews the Netlify deploy preview.
6. **Upstream twin** (only for slices the operator marked): a separate
   reddoor-starter PR with the plain-styled twin — same model/fields/a11y,
   unopinionated CSS, and its own tests. Cite the origin site in the PR body.

## Definition of done (per site)

Every inventory slice merged; content-author walkthrough possible in Prismic
(mocks render in the simulator); `pnpm check/lint/test/build` green; axe gate
green with all new components exercised; upstream twins PR'd. Hand off to the
launch phase (`reddoor-maint launch <slug>` after content + pre-launch
checklist — see the workflow spec).
```

- [ ] **Step 2: Self-review against spec Phase 2** — Stage A/B contract, the upstream-twin rule, and the conventions list must match the spec and the Wave-1 component names actually on main.

---

## Self-review (run after writing, fix inline)

1. **Spec coverage**: Phase 1 → Tasks 2/4; the ensure-site helper → Tasks 1–3; Phase 2 → Task 5; Phase 3 uses existing machinery (no task — deliberate); harvest track already landed (no task — deliberate).
2. **Placeholder scan**: none — all code and skill content is inline.
3. **Type consistency**: `EnsureSiteInput.pointOfContact` ↔ CLI `--contact` mapping is explicit in Task 2 Step 3; `runEnsureSiteCommand(slug, opts)` signature matches the bin.ts wiring.

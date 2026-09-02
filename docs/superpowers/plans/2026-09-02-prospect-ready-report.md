# Prospect-Ready Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the prospect-audit report safe to put in front of a prospect — no self-contradictions, no promise the visibility section disowns, one story across web, print and email — and land the first Gate B item (a goal on every client-facing run).

**Architecture:** Two repos. `reddoor-maintenance` produces the stored result (pipeline, analyze prompt, accuracy stage, email, cockpit dispatch). `reddoor-website` renders it (`src/lib/report/model.ts` → `toReportView` → Svelte components; `print/+page.svelte` is a separate flat render of the same view). Reports render from stored JSON at request time, so renderer fixes apply to every stored audit; producer fixes apply to runs from the next merge. Every new claim the report makes must be a pure function with a test, and every honesty rule the report states must be checkable against real producer output (`tests/prospect/fixtures/*` in maintenance, `src/lib/report/*.test.ts` in the website).

**Tech Stack:** TypeScript, vitest, zod (schemas), SvelteKit + Svelte 5 (website), pnpm. Both repos gate on `pnpm lint && tsc && pnpm test` (website adds `pnpm check` and a Playwright smoke suite).

**Decisions already made (do not relitigate):**

- Fixes tied to a measurement render first as findings; model-authored fixes render below, labelled as recommendations, and may not predict what an engine will cite, repeat, rank or recommend.
- The emailed report is retired. The email becomes a short note and the link. `render.ts` stays only for the CLI's local HTML file.
- Tim already has the cockpit (Google auth). The cockpit is the client-facing run path and must require a goal.
- Gate B follows: re-run the test sites on the new shape, then run ten deliberately neglected sites.

**Website flow:** branch off `origin/staging`, PR into `staging`. Tucker promotes with a merge commit. **Maintenance flow:** branch off `main`, PR into `main`. Both repos are PUBLIC — no client names, prices or internal strategy in code, comments, tests or this doc.

---

## File map

**reddoor-maintenance**

- Create `src/prospect/measured-fixes.ts` — pure: stage data → `Fix[]` with `origin: "measured"`.
- Create `tests/prospect/measured-fixes.test.ts`.
- Modify `src/prospect/types.ts` — `Fix.origin`.
- Modify `src/prospect/analyze.ts` — prompt rule against engine-outcome rationales; model fixes stamped `origin: "recommendation"`.
- Modify `src/prospect/pipeline.ts` — merge measured fixes ahead of model fixes.
- Modify `src/prospect/goals.ts:723` — drop the unsourced rate claim.
- Modify `src/prospect/accuracy.ts` — contradiction rule; conflation field.
- Modify `tests/prospect/accuracy.test.ts`.
- Modify `src/prospect/email.ts` — note + link; no report attachment.
- Modify `tests/prospect/email.test.ts`.
- Modify `src/dashboard/prospect-audit-trigger.ts`, `src/dashboard/prospect-audits-render.ts`, `netlify/functions/prospect-audit-run.mts` — required goal.
- Modify `tests/dashboard/prospect-audit-trigger.test.ts` (exists; extend).
- Modify (private repo `reddoorla/reddoor-prospect-runner`) `.github/workflows/prospect-audit.yml` — `goal` required, no sentinel.

**reddoor-website**

- Modify `src/lib/report/model.ts` — `Fix.origin`, `openingSummary`, `ownSiteCitations`, `Accuracy.conflation`, listing-site list.
- Modify `src/lib/report/model.test.ts`.
- Create `src/lib/report/report-copy.test.ts` — source-text guards (pattern: `token-privacy.test.ts`).
- Modify `src/lib/report/FixList.svelte`, `SourceCheck.svelte`, `GoalFit.svelte`, `Standing.svelte`, `ScoreBars.svelte`.
- Modify `src/routes/audit/[token]/+page.svelte`, `src/routes/audit/[token]/print/+page.svelte`.

---

### Task 1: Measured fixes come first (maintenance)

**Files:**

- Create: `src/prospect/measured-fixes.ts`
- Create: `tests/prospect/measured-fixes.test.ts`
- Modify: `src/prospect/types.ts:219-231`

- [ ] **Step 1: Add `origin` to `Fix`**

In `src/prospect/types.ts`, inside `export type Fix = { … }` after `addresses?`:

```ts
  /** Where the fix came from. "measured": produced by code from a check that
   *  ran on this audit — a finding. "recommendation": written by the model —
   *  judgement, rendered below the findings and labelled as such. Absent on
   *  reports stored before the split, which were all model-written. */
  origin?: "measured" | "recommendation";
```

- [ ] **Step 2: Write the failing test**

`tests/prospect/measured-fixes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { measuredFixes, type MeasuredInput } from "../../src/prospect/measured-fixes.js";

/**
 * The fix list used to be entirely model-written, and the one measured defect
 * on a page (a plain-text phone number) never reached it while ten
 * suggestions did. These are the fixes CODE writes from what the audit
 * measured. Each one is a finding, so each one names its receipt.
 */
const empty = (): MeasuredInput => ({
  goalFit: null,
  checks: null,
  phones: null,
  brokenLinks: null,
  brokenImages: null,
});

const req = (key: string, status: "met" | "missing" | "unmeasured") => ({
  key,
  label: key,
  status,
  evidence: null,
  why: "why",
  scope: "content" as const,
});

describe("measuredFixes", () => {
  it("returns nothing when nothing was measured", () => {
    expect(measuredFixes(empty())).toEqual([]);
  });

  it("turns a missing goal requirement into the first fix, tagged to it", () => {
    const fixes = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "enquire",
        source: "operator",
        requirements: [req("price-signal", "missing"), req("tappable-phone", "met")],
        met: 1,
        total: 2,
      },
    });
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({
      addresses: "price-signal",
      origin: "measured",
      impact: "high",
    });
  });

  it("never proposes a fix for a met or unmeasured requirement", () => {
    const fixes = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "book",
        source: "inferred",
        requirements: [req("booking-link", "met"), req("hours", "unmeasured")],
        met: 1,
        total: 1,
      },
    });
    expect(fixes).toEqual([]);
  });

  it("asks for a tappable phone number only when one is plain text", () => {
    const linked = measuredFixes({
      ...empty(),
      phones: [{ normalized: "13105551234", linked: true }],
    });
    expect(linked).toEqual([]);
    // Absent `linked` is an older row that never measured it — never a defect.
    const unmeasured = measuredFixes({ ...empty(), phones: [{ normalized: "13105551234" }] });
    expect(unmeasured).toEqual([]);
    const plain = measuredFixes({
      ...empty(),
      phones: [{ normalized: "13105551234", linked: false }],
    });
    expect(plain.map((f) => f.title)).toEqual(["Make your phone number tappable"]);
    expect(plain[0]!.why).toContain("1 number");
  });

  it("counts pages without a top heading and pages without a canonical address", () => {
    const fixes = measuredFixes({
      ...empty(),
      checks: {
        headings: { pagesWithoutH1: 2, pagesWithLevelSkips: 0 },
        meta: {
          pageCount: 20,
          missingCanonical: 20,
          missingTitle: 0,
          missingDescription: 0,
          missingSocial: 0,
        },
        schema: { typesFound: [], missingExpected: [], invalidBlocks: 0 },
        crawlerAccessMeasured: true,
        crawlerAccess: { blockedAi: [], allowedAi: [], blockedClassical: [] },
      },
    });
    expect(fixes.map((f) => f.title)).toEqual([
      "Give 2 pages a top heading",
      "Tell search engines which address is the real one for each page",
    ]);
    expect(fixes[1]!.why).toContain("20 of 20");
  });

  it("names the crawlers robots.txt turns away, and says nothing when it turns none away", () => {
    const blocked = measuredFixes({
      ...empty(),
      checks: {
        headings: { pagesWithoutH1: 0, pagesWithLevelSkips: 0 },
        meta: {
          pageCount: 5,
          missingCanonical: 0,
          missingTitle: 0,
          missingDescription: 0,
          missingSocial: 0,
        },
        schema: { typesFound: [], missingExpected: [], invalidBlocks: 0 },
        crawlerAccessMeasured: true,
        crawlerAccess: { blockedAi: ["GPTBot", "ClaudeBot"], allowedAi: [], blockedClassical: [] },
      },
    });
    expect(blocked[0]).toMatchObject({ tier: "crawl", impact: "high", effort: "low" });
    expect(blocked[0]!.why).toContain("GPTBot");
  });

  it("reports broken links and images as one fix each, with the count", () => {
    const fixes = measuredFixes({ ...empty(), brokenLinks: 3, brokenImages: 1 });
    expect(fixes.map((f) => f.title)).toEqual(["Repair 3 broken links", "Replace 1 broken image"]);
  });

  it("never predicts what an answer engine will do", () => {
    const all = measuredFixes({
      ...empty(),
      goalFit: {
        goal: "enquire",
        source: "operator",
        requirements: [req("price-signal", "missing")],
        met: 0,
        total: 1,
      },
      phones: [{ normalized: "1", linked: false }],
      checks: {
        headings: { pagesWithoutH1: 1, pagesWithLevelSkips: 0 },
        meta: {
          pageCount: 3,
          missingCanonical: 3,
          missingTitle: 0,
          missingDescription: 0,
          missingSocial: 0,
        },
        schema: { typesFound: [], missingExpected: ["FAQPage"], invalidBlocks: 0 },
        crawlerAccessMeasured: true,
        crawlerAccess: { blockedAi: ["GPTBot"], allowedAi: [], blockedClassical: [] },
      },
      brokenLinks: 1,
      brokenImages: 1,
    });
    for (const f of all) {
      expect(`${f.title} ${f.why}`).not.toMatch(/\b(cite|cited|citation|recommend|rank|repeat)/i);
      expect(f.origin).toBe("measured");
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/prospect/measured-fixes.test.ts`
Expected: FAIL — cannot resolve `../../src/prospect/measured-fixes.js`.

- [ ] **Step 4: Implement**

`src/prospect/measured-fixes.ts`:

```ts
/**
 * Fixes that CODE writes from what the audit measured.
 *
 * The fix list used to be entirely model-written, and it argued outcomes the
 * visibility section disowns ("has no service page to cite") while the one
 * measured defect on the same page never reached it. These are findings: each
 * one comes from a check that ran, names its count, and says what a visitor or
 * a crawler can or cannot do on the site today. None of them predicts what an
 * answer engine will do — nothing here can, and the report says so.
 *
 * Order is the recommendation: goal requirements first (they are the reason
 * the site exists), then the things a visitor hits (phone, broken links), then
 * what a crawler hits (headings, canonicals, robots).
 */
import type { Fix, ChecksResult } from "./types.js";
import type { GoalFit } from "./goals.js";

export type MeasuredInput = {
  goalFit: GoalFit | null;
  checks: Pick<
    ChecksResult,
    "headings" | "meta" | "schema" | "crawlerAccessMeasured" | "crawlerAccess"
  > | null;
  /** consistency.phones, narrowed to what this needs. Null when the stage did
   *  not run. `linked` is OPTIONAL on the stored row: absent means "not
   *  measured", and only an explicit false is a plain-text number. */
  phones: { normalized: string; linked?: boolean }[] | null;
  brokenLinks: number | null;
  brokenImages: number | null;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function measuredFixes(input: MeasuredInput): Fix[] {
  const out: Fix[] = [];

  for (const r of input.goalFit?.requirements ?? []) {
    if (r.status !== "missing") continue;
    out.push({
      title: r.label.charAt(0).toUpperCase() + r.label.slice(1),
      why: r.why,
      impact: "high",
      effort: r.scope === "quick" ? "low" : r.scope === "content" ? "medium" : "high",
      tier: r.scope === "quick" ? "technical" : "content",
      addresses: r.key,
      origin: "measured",
    });
  }

  const plain = (input.phones ?? []).filter((p) => p.linked === false).length;
  if (plain > 0) {
    out.push({
      title: "Make your phone number tappable",
      why: `${plural(plain, "number is", "numbers are")} written as plain text. On a phone that is something a visitor has to memorise and retype; as a link it is one tap, and it is the moment they were most likely to call.`,
      impact: "medium",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }

  if ((input.brokenLinks ?? 0) > 0) {
    out.push({
      title: `Repair ${plural(input.brokenLinks!, "broken link", "broken links")}`,
      why: "A visitor who follows one lands on an error page, and a crawler that follows one stops there.",
      impact: "medium",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }
  if ((input.brokenImages ?? 0) > 0) {
    out.push({
      title: `Replace ${plural(input.brokenImages!, "broken image", "broken images")}`,
      why: "It shows as an empty box or a missing-image icon on the page a visitor is reading.",
      impact: "low",
      effort: "low",
      tier: "technical",
      addresses: null,
      origin: "measured",
    });
  }

  const c = input.checks;
  if (c) {
    if (c.crawlerAccessMeasured && c.crawlerAccess.blockedAi.length > 0) {
      out.unshift({
        title: `Let ${c.crawlerAccess.blockedAi.join(", ")} read your site`,
        why: `Your robots.txt turns away ${c.crawlerAccess.blockedAi.join(", ")}. A crawler that is refused cannot read a page, so nothing else in this report can help for it until this changes.`,
        impact: "high",
        effort: "low",
        tier: "crawl",
        addresses: null,
        origin: "measured",
      });
    }
    if (c.headings.pagesWithoutH1 > 0) {
      out.push({
        title: `Give ${plural(c.headings.pagesWithoutH1, "page", "pages")} a top heading`,
        why: `${c.headings.pagesWithoutH1} of ${c.meta.pageCount} pages have no top-level heading, so a reader or a crawler arriving on them is not told what the page is about.`,
        impact: "medium",
        effort: "low",
        tier: "technical",
        addresses: null,
        origin: "measured",
      });
    }
    if (c.meta.missingCanonical > 0) {
      out.push({
        title: "Tell search engines which address is the real one for each page",
        why: `${c.meta.missingCanonical} of ${c.meta.pageCount} pages do not declare a canonical address. When the same page is reachable at more than one address, a search engine has to guess which one to keep.`,
        impact: "medium",
        effort: "low",
        tier: "technical",
        addresses: null,
        origin: "measured",
      });
    }
  }

  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/prospect/measured-fixes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/prospect/measured-fixes.ts tests/prospect/measured-fixes.test.ts src/prospect/types.ts
git commit -m "feat(prospect): fixes that code writes from what the audit measured"
```

---

### Task 2: Merge measured fixes ahead of model fixes, and forbid engine promises in the prompt (maintenance)

**Files:**

- Modify: `src/prospect/analyze.ts` (prompt text near line 165; `reconcileFixes` at 519; result assembly at 540)
- Modify: `src/prospect/pipeline.ts` (the `reconciled` block added on 2026-09-02, after `goalFit`)
- Modify: `src/prospect/goals.ts:723`
- Test: `tests/prospect/analyze.test.ts`, `tests/prospect/pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/prospect/analyze.test.ts`:

```ts
describe("fix rationales may not promise engine outcomes", () => {
  it("the prompt forbids predicting what an engine will cite, repeat, rank or recommend", () => {
    const { system } = buildAnalyzePrompt(
      "https://acme.example/",
      crawlData(),
      checksData(),
      "enquire",
      null,
    );
    expect(system).toMatch(
      /Never predict what an answer engine will cite, repeat, rank or recommend/,
    );
  });
});
```

(`buildAnalyzePrompt` is whatever `analyze.ts` already exports for its prompt — the existing tests in this file call it; match their helper names for `crawlData`/`checksData`.)

Append to `tests/prospect/pipeline.test.ts`, inside `describe("runProspectAudit")`:

```ts
it("puts measured fixes first and stamps the model's as recommendations", async () => {
  const withPlainPhone = fixture("rich.html").replace("</body>", "<p>Call 310-555-1234</p></body>");
  const result = await runProspectAudit(
    HOME,
    { goal: "enquire" },
    {
      ...deps(),
      crawl: crawlDeps({
        async fetchUrl(url) {
          return url === HOME || url.endsWith("/services") || url.endsWith("/about")
            ? { status: 200, body: withPlainPhone, headers: {} }
            : { status: 404, body: "", headers: {} };
        },
        async renderPages(urls) {
          return new Map(urls.map((u) => [u, withPlainPhone]));
        },
      }),
      analyze: {
        run: async () => ({
          ...analyzeOutput,
          fixes: [
            {
              title: "Rewrite the homepage",
              why: "w",
              impact: "high",
              effort: "low",
              tier: "content",
              addresses: null,
            },
          ],
        }),
      },
    },
  );
  const an = result.analyze;
  if (!an?.ok) throw new Error("analyze did not run");
  const origins = an.data.fixes.map((f) => f.origin);
  expect(origins.indexOf("recommendation")).toBeGreaterThan(origins.lastIndexOf("measured"));
  expect(an.data.fixes.at(-1)).toMatchObject({
    title: "Rewrite the homepage",
    origin: "recommendation",
  });
  expect(an.data.fixes.some((f) => f.title === "Make your phone number tappable")).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/prospect/analyze.test.ts tests/prospect/pipeline.test.ts`
Expected: FAIL — prompt text absent; `origin` undefined.

- [ ] **Step 3: Prompt rule and origin stamp in `analyze.ts`**

In the `- fixes:` paragraph of the system prompt (around line 165), replace:

```
- fixes: prioritized, concrete, specific to this site. No generic SEO advice.
```

with:

```
- fixes: prioritized, concrete, specific to this site. No generic SEO advice.
  Each "why" describes what a buyer or a crawler can or cannot read on the site TODAY. Never predict
  what an answer engine will cite, repeat, rank or recommend: the report states elsewhere, with
  evidence, that nothing on the site reliably moves that, and a fix that promises it contradicts the
  report. "A buyer cannot find a price" is a reason; "an engine will have nothing to cite" is not.
```

At the result assembly (line ~540) change:

```ts
    fixes: reconcileFixes(parsed.fixes, goalFit),
```

to:

```ts
    fixes: reconcileFixes(parsed.fixes, goalFit).map((f) => ({ ...f, origin: "recommendation" as const })),
```

- [ ] **Step 4: Merge in `pipeline.ts`**

Add the import at the top: `import { measuredFixes } from "./measured-fixes.js";`

Replace the `reconciled` block with:

```ts
// The fix list, in the order the report recommends: what we MEASURED first
// (each one a finding with a count), then what the model wrote, stamped as
// a recommendation. Reconciliation against the printed checklist still
// happens here, because on an ordinary audit the checklist is only known
// here. A model fix that addresses the same requirement as a measured one is
// dropped — the finding already says it.
const reconciled: StageResult<AnalyzeResult> = analyze.ok
  ? {
      ok: true,
      data: {
        ...analyze.data,
        fixes: mergeFixes(
          measuredFixes({
            goalFit: goalFit.ok ? goalFit.data : null,
            checks: checks.ok ? checks.data : null,
            phones: checks.ok ? (checks.data.consistency?.phones ?? null) : null,
            brokenLinks: assets.ok ? assets.data.brokenLinks.length : null,
            brokenImages: assets.ok ? assets.data.brokenImages.length : null,
          }),
          goalFit.ok ? reconcileFixes(analyze.data.fixes, goalFit.data) : analyze.data.fixes,
        ),
      },
    }
  : analyze;
```

and add, above `runProspectAudit`:

```ts
/** Measured fixes first; a model fix tagged to a requirement a measured fix
 *  already covers is dropped rather than printed twice. */
export function mergeFixes(measured: Fix[], model: Fix[]): Fix[] {
  const covered = new Set(measured.map((f) => f.addresses).filter((k): k is string => !!k));
  return [...measured, ...model.filter((f) => !(f.addresses && covered.has(f.addresses)))];
}
```

(`Fix` is already imported from `./types.js` in pipeline.ts; if not, add it.)

- [ ] **Step 5: Drop the unsourced rate claim in `goals.ts:723`**

Replace:

```
"It is the most common question buyers ask before making contact, and the one most sites never answer. A range, a starting point or a worked example is enough — silence sends them to someone who does say.",
```

with:

```
"Buyers ask this before making contact, and a site that does not answer it sends them to one that does. A range, a starting point or a worked example is enough.",
```

Then run `pnpm vitest run tests/prospect/goals.test.ts` and update any assertion that quoted the old sentence.

- [ ] **Step 6: Run the tests, then the whole gate**

Run: `pnpm vitest run tests/prospect/` then `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/prospect/analyze.ts src/prospect/pipeline.ts src/prospect/goals.ts tests/prospect/analyze.test.ts tests/prospect/pipeline.test.ts tests/prospect/goals.test.ts
git commit -m "feat(prospect): measured fixes first, model fixes labelled, no engine promises"
```

---

### Task 3: The contradiction rule and the name-collision finding (maintenance)

**Files:**

- Modify: `src/prospect/accuracy.ts` (schema ~line 125; system prompt ~148-190; `verifyQuotes` ~485; `checkAccuracy` ~575; `AccuracyResult` ~98)
- Test: `tests/prospect/accuracy.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/prospect/accuracy.test.ts` (reuse the file's existing crawl/answer fixture helpers; the names below assume `crawlWith(pages)` and `brandedAnswer(text, cited)` — match whatever the file already uses):

```ts
describe("a place the site itself names is never 'contradicted'", () => {
  it("flips contradicted to confirmed when the site uses the claim's own terms", async () => {
    const crawl = crawlWith([
      {
        url: "https://acme.example/",
        text: "Acme Design. HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
      },
      {
        url: "https://acme.example/about",
        text: "We are conveniently located near the Los Angeles metro area.",
      },
    ]);
    const answers = [brandedAnswer("Acme Design (Los Angeles-based) is a studio.", ["yelp.com"])];
    const run = async () => ({
      assertions: [
        {
          claim: "Acme Design is based in Los Angeles.",
          engineQuote: "Acme Design (Los Angeles-based)",
          verdict: "contradicted",
          siteQuote: "HQ mailing address: 1 Main St, Fair Oaks Ranch, TX.",
          searchTerms: ["Los Angeles"],
        },
      ],
      conflation: { detected: false, otherNames: [], engineQuote: null },
    });
    const result = await checkAccuracy("https://acme.example/", crawl, answers, [], {
      run,
      ownership: fakeOwnership,
    });
    expect(result.assertions[0]).toMatchObject({
      verdict: "confirmed",
      siteQuote: expect.stringContaining("Los Angeles"),
    });
  });
});

describe("name collision", () => {
  it("records when the engine describes more than one business under the name", async () => {
    const crawl = crawlWith([{ url: "https://acme.example/", text: "Acme Design, Boise." }]);
    const answers = [
      brandedAnswer(
        '"Acme Design" is a name used by several companies. The main one is Acme Design Photography (Virginia).',
        [],
      ),
    ];
    const run = async () => ({
      assertions: [],
      conflation: {
        detected: true,
        otherNames: ["Acme Design Photography"],
        engineQuote: '"Acme Design" is a name used by several companies',
      },
    });
    const result = await checkAccuracy("https://acme.example/", crawl, answers, [], {
      run,
      ownership: fakeOwnership,
    });
    expect(result.conflation).toEqual({
      detected: true,
      otherNames: ["Acme Design Photography"],
      engineQuote: '"Acme Design" is a name used by several companies',
    });
  });

  it("discards a conflation whose quote is not in the answer", async () => {
    const crawl = crawlWith([{ url: "https://acme.example/", text: "Acme Design, Boise." }]);
    const answers = [brandedAnswer("Acme Design is a Boise studio.", [])];
    const run = async () => ({
      assertions: [],
      conflation: {
        detected: true,
        otherNames: ["Someone Else"],
        engineQuote: "several companies",
      },
    });
    const result = await checkAccuracy("https://acme.example/", crawl, answers, [], {
      run,
      ownership: fakeOwnership,
    });
    expect(result.conflation).toEqual({ detected: false, otherNames: [], engineQuote: null });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/prospect/accuracy.test.ts`
Expected: FAIL — schema rejects `conflation`; verdict stays `contradicted`.

- [ ] **Step 3: Schema and result type**

In `AccuracySchema`, after the `assertions` array:

```ts
  /** Does the answer describe MORE THAN ONE business under this name, or a
   *  different business first? For a common name this is the headline finding
   *  of the branded search, and it was only ever visible inside a truncated
   *  quote. */
  conflation: z
    .object({
      detected: z.boolean(),
      otherNames: z.array(z.string()).max(6),
      engineQuote: z.string().nullable(),
    })
    .default({ detected: false, otherNames: [], engineQuote: null }),
```

In `AccuracyResult`, add:

```ts
  /** The engine confused this business with others of the same name. `engineQuote`
   *  is verified against the answer text like every other quote; a conflation
   *  whose quote is not in the answer is discarded, not trusted. */
  conflation: { detected: boolean; otherNames: string[]; engineQuote: string | null };
```

- [ ] **Step 4: Prompt**

In `buildSystemPrompt`, after the `searchTerms` bullet, add:

```
Separately, return "conflation": does the answer describe MORE THAN ONE business under this name, or
describe a different business first? If so, detected is true, otherNames lists the OTHER businesses
named (never this one), and engineQuote is the exact sentence that says the name belongs to several
businesses — copied verbatim, it is checked against the answer character by character. Otherwise
detected is false with an empty otherNames and a null engineQuote.
```

- [ ] **Step 5: The contradiction rule in `verifyQuotes`**

`verifyQuotes` needs the search terms. Change its signature to add `searchTermsByClaim: Map<string, string[]>` as the last parameter, and inside the loop, before `const quoteReal = …`, add:

```ts
// A place or a name the site itself uses, anywhere, cannot be "contradicted":
// a Texas mailing address on one page and "near the Los Angeles metro" on
// another are the site saying both, not the engine getting it wrong. When
// the site uses the claim's own distinctive terms exactly, the honest
// verdict is confirmed, quoting the site's own sentence.
let verdict: typeof a.verdict = a.verdict;
let siteQuote: string | null = a.siteQuote;
if (a.verdict === "contradicted") {
  for (const term of distinctive(searchTermsByClaim.get(a.claim) ?? [])) {
    if (findTerm(site, term) !== "exact") continue;
    const flat = siteText.replace(/\s+/g, " ");
    const at = site.indexOf(normalize(term));
    verdict = "confirmed";
    siteQuote = `…${flat.slice(Math.max(0, at - 80), at + term.length + 80).trim()}…`;
    break;
  }
}
```

then use `verdict` and `siteQuote` in place of `a.verdict` / `a.siteQuote` for the rest of the loop body (`quoteReal`, `needsQuote`, `quoteSupports`, and the pushed object). For the flipped case the quote is a real substring by construction, and `quoteSupportsClaim` will pass because the term is in both.

In `checkAccuracy`, build `termsByClaim` BEFORE `verifyQuotes` and pass it; then add conflation verification before the return:

```ts
const answerText = normalize(branded.map((a) => a.fullAnswer ?? "").join("\n"));
const c = parsed.conflation;
const conflation =
  c.detected && c.engineQuote !== null && answerText.includes(normalize(c.engineQuote))
    ? { detected: true, otherNames: c.otherNames, engineQuote: c.engineQuote }
    : { detected: false, otherNames: [], engineQuote: null };
```

and include `conflation` in both return objects (the early `branded.length === 0` return gets `conflation: { detected: false, otherNames: [], engineQuote: null }`).

- [ ] **Step 6: Run the tests, fix any fixture in `pipeline-accuracy.test.ts` that builds an `AccuracyResult` by hand (add `conflation`)**

Run: `pnpm vitest run tests/prospect/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/prospect/accuracy.ts tests/prospect/accuracy.test.ts tests/prospect/pipeline-accuracy.test.ts
git commit -m "fix(prospect): a place the site names is never 'contradicted'; record name collisions"
```

---

### Task 4: The email is a note and a link (maintenance)

**Files:**

- Modify: `src/prospect/email.ts` (`AuditEmailContent`, `buildAuditEmail`, `sendAuditEmail`)
- Modify: `tests/prospect/email.test.ts`
- Modify: `src/cli/commands/prospect-audit.ts` if it references `attachmentHtml`

- [ ] **Step 1: Write the failing tests**

Replace the three tests `"shows the three site scores…"`, `"lists only the top few fixes…"` and `"explains fixes are unavailable…"` in `tests/prospect/email.test.ts` with:

```ts
it("is a note and a link — no scores, no fixes, no findings", () => {
  const { html } = buildAuditEmail(result(), { link: "https://reddoorla.com/audit/tok" });
  expect(html).toContain("https://reddoorla.com/audit/tok");
  expect(html).not.toMatch(/Findability|Readability|Answers|\/100|Top fixes/);
  expect(html).not.toMatch(/Google|recommend/i);
});

it("says plainly when there is no link, and still attaches nothing from the old renderer", () => {
  const built = buildAuditEmail(result(), { link: null });
  expect(built.html).toMatch(/could not be saved/);
  expect(built).not.toHaveProperty("attachmentHtml");
});

it("still names the reasons a stage did not run, because this sheet is internal", () => {
  const { html } = buildAuditEmail(result({ probes: { ok: false, error: "spend cap" } }), {
    link: "https://x/y",
  });
  expect(html).toContain("spend cap");
});
```

and update the `sendAuditEmail` tests so the only attachment expected is the PDF when one is supplied (no `.html` attachment at all).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/prospect/email.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `email.ts`: remove `attachmentHtml` from `AuditEmailContent`; remove the `renderProspectReport` import; delete `scoresTableHtml` and `fixesHtml` and their helpers (`IMPACT_ORDER`, `TOP_FIX_COUNT`) if nothing else uses them; rewrite the body of `buildAuditEmail`:

```ts
const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:24px;background:#faf8f5;color:#1a1a1a;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <h1 style="font-size:22px;margin:0 0 4px;">Audit ready — ${escapeHtml(name)}</h1>
  <p style="margin:0 0 16px;color:#57544f;">
    <a href="${escapeHtml(safeUrl(result.url))}">${escapeHtml(result.url)}</a> · audited ${escapeHtml(formatIsoDate(result.generatedAt))}
  </p>
  ${linkHtml(opts.link)}
  ${notMeasuredHtml(notMeasuredLines(result))}
  ${INTERNAL_NOTE}
</body>
</html>`;

return { subject, html };
```

Change `linkHtml`'s no-link copy to: `No shareable link — the audit could not be saved to the database. Re-run it; there is nothing to forward from this email.` Change `INTERNAL_NOTE` to: `Internal note — it names the reasons a section could not be measured. The report itself is the link above; there is no other version.`

In `sendAuditEmail`: delete `renderReport` from `SendAuditEmailOptions`, delete the `attachmentHtml`/`filename` lines, and build `attachments` as `opts.pdf ? [ …the existing PDF entry… ] : []`.

In `src/cli/commands/prospect-audit.ts` the local HTML file (line 233) stays — it is the operator's artefact — but add a one-line comment above it: `// Operator-only. The client-facing report is the web page; nothing rendered here is sent to anyone.`

- [ ] **Step 4: Run the tests, then the gate**

Run: `pnpm vitest run tests/prospect/email.test.ts tests/cli/prospect-audit-email.test.ts` then the full gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prospect/email.ts tests/prospect/email.test.ts src/cli/commands/prospect-audit.ts tests/cli/prospect-audit-email.test.ts
git commit -m "feat(prospect): the email is a note and the link — the old renderer is no longer sent"
```

---

### Task 5: A goal on every cockpit run (maintenance + private runner)

**Files:**

- Modify: `src/dashboard/prospect-audit-trigger.ts` (`ProspectAuditDispatchInputs`, `ProspectAuditTriggerInput`, `triggerProspectAudit`)
- Modify: `src/dashboard/prospect-audits-render.ts` (form + fetch body)
- Modify: `netlify/functions/prospect-audit-run.mts` (read `goal`)
- Modify: `tests/dashboard/prospect-audit-trigger.test.ts`
- Modify (private repo): `.github/workflows/prospect-audit.yml`

- [ ] **Step 1: Write the failing test**

In `tests/dashboard/prospect-audit-trigger.test.ts` add:

```ts
it("refuses a run with no goal — every client-facing audit grades the site against one", async () => {
  const r = await triggerProspectAudit(deps(), target, {
    url: "https://acme.example/",
    business: null,
    requestedBy: "x",
    goal: "",
  });
  expect(r).toEqual({ status: "missing-goal" });
});

it("refuses a goal outside the operator set", async () => {
  const r = await triggerProspectAudit(deps(), target, {
    url: "https://acme.example/",
    business: null,
    requestedBy: "x",
    goal: "unknown",
  });
  expect(r).toEqual({ status: "missing-goal" });
});

it("forwards the goal to the dispatcher", async () => {
  const seen: unknown[] = [];
  const d = { ...deps(), dispatch: async (t: unknown) => (seen.push(t), { ok: true as const }) };
  await triggerProspectAudit(d, target, {
    url: "https://acme.example/",
    business: null,
    requestedBy: "x",
    goal: "enquire",
  });
  expect(seen[0]).toMatchObject({ inputs: { goal: "enquire" } });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/dashboard/prospect-audit-trigger.test.ts`
Expected: FAIL — type error / status mismatch.

- [ ] **Step 3: Implement**

`prospect-audit-trigger.ts`: add `goal: string` to `ProspectAuditDispatchInputs` and to `ProspectAuditTriggerInput`; add `| { status: "missing-goal" }` to `ProspectAuditTriggerResult`; import `GOALS` from `../cli/commands/prospect-audit.js` (it already exports the operator list) — or, to avoid a cli import from the dashboard, define `export const OPERATOR_GOALS = ["book", "enquire", "call", "visit", "buy", "demo", "partner"] as const;` in `src/prospect/goals.ts` next to `SiteGoal` and import it in both places. In `triggerProspectAudit`, right after the private-host check:

```ts
// Gate B: a client-facing audit grades the site against a goal the operator
// chose. Inference is for internal runs; the cockpit is the client path.
const goal = input.goal.trim();
if (!(OPERATOR_GOALS as readonly string[]).includes(goal)) return { status: "missing-goal" };
```

and pass `goal` in `inputs`.

`prospect-audits-render.ts`: after the business input in the form add

```html
<label
  >Goal
  <select name="goal" required>
    <option value="">What should the site get a visitor to do?</option>
    <option value="book">Book an appointment</option>
    <option value="enquire">Start a project or ask for a quote</option>
    <option value="call">Pick up the phone</option>
    <option value="visit">Come in person</option>
    <option value="buy">Buy something</option>
    <option value="demo">Talk to sales</option>
    <option value="partner">Ask about distribution or partnership</option>
  </select>
</label>
```

and send `goal: form.elements.goal.value` in the JSON body. Map `missing-goal` to a 400 with the message "Choose what the site should get a visitor to do." wherever `respondToProspectAuditTrigger` maps statuses.

`prospect-audit-run.mts`: read `const goal = typeof payload.goal === "string" ? payload.goal : "";` and pass it.

Private runner `prospect-audit.yml`: make `goal` `required: true`, delete the `default:` line and the `"(read it off the site)"` option, and delete the run-step filter that stripped the sentinel. Push directly to that repo's `main` (single collaborator, private).

- [ ] **Step 4: Run the tests and the gate**

Run: `pnpm vitest run tests/dashboard/` then the full gate.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/prospect-audit-trigger.ts src/dashboard/prospect-audits-render.ts netlify/functions/prospect-audit-run.mts src/prospect/goals.ts tests/dashboard/prospect-audit-trigger.test.ts
git commit -m "feat(cockpit): a client-facing audit needs a goal — Gate B"
```

---

### Task 6: View model — fix origin, the opener, own-site citations, conflation (website)

**Files:**

- Modify: `src/lib/report/model.ts`
- Test: `src/lib/report/model.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/model.test.ts`:

```ts
describe("openingSummary — the first sentence, built from the verdicts", () => {
  // The model-written opener said pricing answers "exist" on a page while the
  // table two screens down said No. The opener is now derived from the same
  // verdicts the table prints, so it cannot disagree with them.
  it("names the goal, the count, and the unanswered questions", () => {
    const v = toReportView(asReport(FULL));
    expect(openingSummary(v)).toBe(
      "Your site is built to get a visitor to start a project or ask for a quote. Of the five questions buyers ask first, it answers two clearly and one partly. It does not answer: what does this cost, or is there a minimum size of project you take on.",
    );
  });

  it("says nothing about a goal when none was measured", () => {
    const v = toReportView(asReport({ ...FULL, goalFit: undefined }));
    expect(openingSummary(v)).toMatch(/^Of the five questions/);
  });

  it("is null when no question was judged", () => {
    const v = toReportView(asReport({ ...FULL, analyze: { ok: false, error: "x" } }));
    expect(openingSummary(v)).toBeNull();
  });
});

describe("ownSiteCitations — how often the engine cited the site itself", () => {
  it("counts the site's own domain across branded answers, ignoring www", () => {
    const v = toReportView(
      asReport({
        ...FULL,
        probes: {
          ok: true,
          data: {
            answers: [
              probe({
                kind: "branded",
                citedDomains: ["www.reddoorla.com", "yelp.com", "reddoorla.com"],
              }),
              probe({ kind: "branded", citedDomains: ["linkedin.com"] }),
              probe({ kind: "category", citedDomains: ["reddoorla.com"] }),
            ],
          },
        },
      }),
    );
    expect(ownSiteCitations(v)).toBe(2);
  });
});

describe("fixes keep their origin, and old reports read as recommendations", () => {
  it("passes origin through", () => {
    const v = toReportView(
      asReport({
        ...FULL,
        analyze: {
          ok: true,
          data: { ...FULL.analyze.data, fixes: [fix({ origin: "measured" }), fix({})] },
        },
      }),
    );
    expect(v.fixes.map((f) => f.origin)).toEqual(["measured", "recommendation"]);
  });
});

describe("accuracy.conflation", () => {
  it("degrades to not-detected on a report stored before the field existed", () => {
    const v = toReportView(
      asReport({
        ...FULL,
        accuracy: {
          ok: true,
          data: {
            assertions: [],
            sources: [],
            siteFullyRead: true,
            pagesRead: 1,
            pagesTotal: 1,
            answersRead: 1,
          },
        },
      }),
    );
    expect(v.accuracy?.conflation).toEqual({ detected: false, otherNames: [], engineQuote: null });
  });
});
```

(`FULL`'s buyer questions are five: yes, yes, partial, no, no — adjust the expected sentence to the fixture's actual question texts, which the summary lists in the table's order. Add a `fix()` helper if the file lacks one, mirroring `probe()`.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/report/model.test.ts`
Expected: FAIL — `openingSummary`/`ownSiteCitations` not exported; `origin` undefined; `conflation` undefined.

- [ ] **Step 3: Implement in `model.ts`**

`Fix` type: add `origin: "measured" | "recommendation";`. Where `fixes` is assembled in `toReportView` (`fixes: analyze?.fixes ?? []`), change to:

```ts
    fixes: (analyze?.fixes ?? []).map((f) => ({ ...f, origin: f.origin ?? "recommendation" })),
```

(and widen the `analyze` stage type's `fixes?: (Fix & { origin?: Fix["origin"] })[]` or `Partial`.)

`Accuracy` type: add `conflation: { detected: boolean; otherNames: string[]; engineQuote: string | null };` and where `accuracy` is unwrapped, normalise: `accuracy: accuracy ? { ...accuracy, conflation: accuracy.conflation ?? { detected: false, otherNames: [], engineQuote: null } } : null`.

Add, after `goalVerdict`:

```ts
const COUNT_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const count = (n: number): string => COUNT_WORDS[n] ?? String(n);

/**
 * The first sentence of the report, derived from the same verdicts the
 * question table prints — so it cannot say an answer exists where the table
 * says No. The model still writes the fix rationales; it no longer writes the
 * summary of what it found.
 */
export function openingSummary(view: ReportView): string | null {
  const judged = view.buyerQuestions.filter((q) => q.answered !== "unknown");
  if (judged.length === 0) return null;
  const parts: string[] = [];
  if (view.goalFit && view.goalFit.goal !== "unknown") {
    parts.push(
      `Your site is built to get a visitor to ${GOAL_LABELS[view.goalFit.goal] ?? view.goalFit.goal}.`,
    );
  }
  const yes = judged.filter((q) => q.answered === "yes").length;
  const partial = judged.filter((q) => q.answered === "partial").length;
  const no = judged
    .filter((q) => q.answered === "no")
    .map((q) => q.question.replace(/[?.]$/, "").replace(/^./, (c) => c.toLowerCase()));
  const answered =
    yes === 0 && partial === 0
      ? "it answers none of them"
      : `it answers ${count(yes)} clearly${partial ? ` and ${count(partial)} partly` : ""}`;
  parts.push(`Of the ${count(judged.length)} questions buyers ask first, ${answered}.`);
  if (no.length) {
    const list = no.length === 1 ? no[0] : `${no.slice(0, -1).join(", ")}, or ${no.at(-1)}`;
    parts.push(`It does not answer: ${list}.`);
  }
  return parts.join(" ");
}

/** How many times the engine cited the site itself across the branded answers.
 *  The accuracy section lists what the engine read INSTEAD, and without this
 *  number a reader sees "reading your own site" over a list that never names it. */
export function ownSiteCitations(view: ReportView): number {
  const own = domainLabel(new URL(view.url).hostname);
  return view.brandedProbes.reduce(
    (n, p) => n + p.citedDomains.filter((d) => domainLabel(d) === own).length,
    0,
  );
}
```

(`domainLabel` already exists in this file — it strips `www.` and lower-cases; if it does more, add a small `bareHost()` that does only that and use it here.)

Extend `LISTING_SITES` with: `"dribbble.com"`, `"behance.net"`, `"medium.com"`, `"businesswire.com"`, `"prnewswire.com"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/report/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report/model.ts src/lib/report/model.test.ts
git commit -m "feat(report): opener derived from verdicts; fix origin; own-site citations; conflation"
```

---

### Task 7: Render it — web page (website)

**Files:**

- Modify: `src/routes/audit/[token]/+page.svelte`
- Modify: `src/lib/report/FixList.svelte`, `SourceCheck.svelte`, `GoalFit.svelte`, `Standing.svelte`, `ScoreBars.svelte`
- Create: `src/lib/report/report-copy.test.ts`

- [ ] **Step 1: Write the failing source-text guards**

`src/lib/report/report-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Sentences the report must and must not contain. Svelte templates have no
 * seam to import, and every one of these is a sentence a reader actually saw
 * on the live report — the pattern is token-privacy.test.ts.
 */
const code = (p: string) => readFileSync(p, "utf-8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
const PAGE = "src/routes/audit/[token]/+page.svelte";
const PRINT = "src/routes/audit/[token]/print/+page.svelte";

describe("one story, on every surface", () => {
  it("the opener is derived, not model-written", () => {
    expect(code(PAGE)).toContain("openingSummary(view)");
    expect(code(PRINT)).toContain("openingSummary(view)");
    expect(code(PAGE)).not.toMatch(/narrative\.answers/);
    expect(code(PRINT)).not.toMatch(/narrative\.answers/);
  });

  it("recommendations are labelled as judgement, never as promises", () => {
    const src = code("src/lib/report/FixList.svelte");
    expect(src).toMatch(/Our recommendations/);
    expect(src).toMatch(/not a promise about what an engine will do/);
  });

  it("the accuracy section says how often the site itself was cited, and never 'cited on that answer'", () => {
    const src = code("src/lib/report/SourceCheck.svelte");
    expect(src).toContain("ownSiteCitations(view)");
    expect(src).not.toMatch(/Cited on that answer/);
    expect(src).toMatch(/Also read for that answer/);
    expect(src).not.toMatch(/instead of you/);
  });

  it("'not judged' names the statements it did not judge", () => {
    const src = code("src/lib/report/SourceCheck.svelte");
    expect(src).toMatch(/u\.claim/);
    expect(src).not.toMatch(/\.join\("; "\)/);
  });

  it("a name collision is a finding, not a truncated quote", () => {
    expect(code("src/lib/report/SourceCheck.svelte")).toMatch(/conflation\.detected/);
    expect(code(PRINT)).toMatch(/conflation\.detected/);
  });

  it("one assistant was tested, and the copy says so in the singular", () => {
    for (const p of [
      PAGE,
      PRINT,
      "src/lib/report/SourceCheck.svelte",
      "src/lib/report/Standing.svelte",
    ]) {
      expect(code(p)).not.toMatch(/\bengines\b/);
    }
    expect(code(PAGE)).not.toMatch(/visibility score above/);
    expect(code(PAGE)).not.toMatch(/Every finding here is one you can reproduce/);
  });

  it("the robots.txt explanation appears once", () => {
    const src = code("src/lib/report/ScoreBars.svelte");
    expect(src.match(/pass\/fail, not a score/g) ?? []).toHaveLength(1);
  });

  it("the goal is shown as a choice when an operator made it", () => {
    expect(code("src/lib/report/GoalFit.svelte")).toMatch(/fit\.source === "operator"/);
  });

  it("the question table shows the passage, not only the verdict", () => {
    expect(code(PAGE)).toMatch(/q\.evidence/);
    expect(code(PRINT)).toMatch(/q\.evidence/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/report/report-copy.test.ts`
Expected: FAIL on every `it`.

- [ ] **Step 3: `+page.svelte`**

Import `openingSummary` from `$lib/report/model`. Replace the `narrative.answers` block under the H1 with:

```svelte
      {#if openingSummary(view)}
        <p class="type-lede m-0 max-w-[52ch] border-l-2 border-primary pl-6 text-black">
          {openingSummary(view)}
        </p>
      {/if}
```

In the branded disclosure (line ~246) retitle `"What the engines said when asked about you by name"` → `"What the assistant said when asked about you by name"`, and delete the sentence `which is why it is kept out of the visibility score above` (rewrite that paragraph to end at `…would find you.`). In "Under the hood" replace `Every finding here is one you can reproduce. If any of it looks wrong…` with `Every finding here comes with the receipt we based it on. If any of it looks wrong, tell us — we would rather correct it than defend it.` and change `we tested one AI assistant, not all of them` to `we tested one AI assistant (Claude), not all of them`. In the question table add a third column:

```svelte
                      <th class="type-eyebrow border-b border-light py-2 text-left text-muted">What it says</th>
…
                        <td class="border-b border-light py-2.5 align-top text-sm text-muted">
                          {#if q.evidence}&ldquo;{q.evidence}&rdquo;{:else if q.answered === "unknown"}not judged on this audit{:else}no passage an assistant could quote{/if}
                        </td>
```

(`BuyerQuestion` in model.ts already carries `evidence: string | null`; if the view strips it, keep it.)

- [ ] **Step 4: `FixList.svelte`**

Split into two lists:

```svelte
<script lang="ts">
  …
  let { fixes }: { fixes: Fix[] } = $props();
  const measured = $derived(fixes.filter((f) => f.origin === "measured"));
  const recommended = $derived(fixes.filter((f) => f.origin !== "measured"));
</script>

{#if measured.length}
  <p class="type-eyebrow m-0 pb-3 text-dark">What we measured</p>
  <ol class="m-0 flex list-none flex-col border-t border-light p-0">
    {#each measured as fix, i (fix.title)}
      … existing <li> markup, numbered i + 1 …
    {/each}
  </ol>
{/if}
{#if recommended.length}
  <p class="type-eyebrow m-0 pt-8 pb-1 text-dark">Our recommendations</p>
  <p class="type-meta m-0 max-w-[62ch] pb-3 text-muted">
    These are judgement, not measurement: things we would do next, in order. None of them is a
    promise about what an engine will do.
  </p>
  <ol class="m-0 flex list-none flex-col border-t border-light p-0">
    {#each recommended as fix, i (fix.title)}
      … existing <li> markup, numbered measured.length + i + 1 …
    {/each}
  </ol>
{/if}
```

Extract the `<li>` into a `{#snippet fixRow(fix, n)}` at the top of the template so the markup exists once.

- [ ] **Step 5: `SourceCheck.svelte`**

Import `ownSiteCitations`. Change the confirmed group's `lede` to a function of the count — simplest: keep `GROUPS` static and render the count under the confirmed group's lede:

```svelte
          {#if group.verdict === "confirmed"}
            <p class="type-meta m-0 max-w-[62ch] text-muted">
              Across the answers we checked, the assistant cited your own site
              {ownSiteCitations(view) === 1 ? "once" : `${ownSiteCitations(view)} times`}. The sources listed under each statement are what it read alongside it.
            </p>
          {/if}
```

Rename `Cited on that answer:` → `Also read for that answer:` and `Who the engine read instead of you` → `Who else the engine read`. Replace the template sentence `These are where stale hours, old phone numbers and a previous owner's name live.` with `These are the pages the assistant reads about you that you did not write. You cannot edit most of them, but you can make your own pages say the thing plainly enough that they stop being the best available source.`

Rewrite the "Not judged" paragraph as a list:

```svelte
        {#if unverified.length}
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            {#each unverified as u (u.claim)}
              <li class="type-meta max-w-[62ch] text-muted">
                &ldquo;{u.claim}&rdquo; — {u.unverifiedReason ?? "we could not check it against your pages"}
              </li>
            {/each}
          </ul>
        {/if}
```

Add the conflation finding at the top of the `{:else}` branch, before the groups:

```svelte
    {#if acc.conflation.detected}
      <div class="flex flex-col gap-2 border-l-2 border-primary pl-6">
        <p class="type-question m-0 max-w-[40ch] text-primary">The assistant is not sure which {who} you are</p>
        <p class="type-meta m-0 max-w-[62ch] text-muted">
          Asked about you by name, it described more than one business{acc.conflation.otherNames.length ? ` — including ${acc.conflation.otherNames.join(", ")}` : ""}. Until your own pages make the name, the place and the work unambiguous, anything it says about &ldquo;{who}&rdquo; may be about someone else.
        </p>
        {#if acc.conflation.engineQuote}
          <p class="type-meta m-0 max-w-[66ch] border-l-2 border-light pl-4 text-muted">The AI said: &ldquo;{acc.conflation.engineQuote}&rdquo;</p>
        {/if}
      </div>
    {/if}
```

Change `engine` → `assistant` in visible copy throughout this file.

- [ ] **Step 6: `GoalFit.svelte`, `Standing.svelte`, `ScoreBars.svelte`**

`GoalFit.svelte`: where the lede prints `Your site is built to get a visitor to …`, branch on source:

```svelte
  {#if fit.source === "operator"}
    You told us your site is built to get a visitor to {GOAL_LABELS[fit.goal]}.
  {:else}
    As far as we can tell from reading it, your site is built to get a visitor to {GOAL_LABELS[fit.goal]}.
  {/if}
```

`Standing.svelte`: `went to directories and review sites` → `went to directories, review sites and platforms we recognise`; `engine` → `assistant` in visible copy; `in any of the ${total} questions we asked` stays.

`ScoreBars.svelte`: delete the second copy of the pass/fail paragraph (keep the one with the CDN caveat).

- [ ] **Step 7: Run the guards, unit tests, lint, check**

Run: `pnpm vitest run src/lib/report/ && pnpm lint && pnpm check`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/routes/audit/[token]/+page.svelte src/lib/report/*.svelte src/lib/report/report-copy.test.ts
git commit -m "fix(report): one story on the web page — derived opener, labelled recommendations, own-site citations, name collision"
```

---

### Task 8: Render it — print sheet (website)

**Files:**

- Modify: `src/routes/audit/[token]/print/+page.svelte`

- [ ] **Step 1: The guards in Task 7 already cover the print sheet's opener, conflation, evidence and singular copy. Add to `report-copy.test.ts`:**

```ts
it("the print sheet carries the visibility caveat beside the count, and a next step", () => {
  const src = code(PRINT);
  expect(src).toMatch(/nothing we can do to your website reliably moves it/);
  expect(src).toMatch(/Half an hour/);
  expect(src).toMatch(/row\.siteQuote/);
});
```

Run it; expected FAIL.

- [ ] **Step 2: Implement**

Under the `Named in N of M` line add:

```svelte
      <p class="caveat">This is a measurement, not a scorecard — nothing we can do to your website reliably moves it. What it is good for is knowing where you stand and who the assistant reaches for instead.</p>
```

Replace the H1's summary paragraph with `{openingSummary(view)}`. In the accuracy block add `{#if row.siteQuote}<p class="quote">Your site says: &ldquo;{row.siteQuote}&rdquo;</p>{/if}` after `The AI said`, print the `Cited:` line only when it differs from the previous row (reuse the `withCitations` shape: compute `const rows = withCitations(accuracy.assertions)` in the script), add the conflation block (same copy as the web, in the sheet's own classes), add the evidence column to the question table, and before the footer add:

```svelte
  <section class="next">
    <h2>Next</h2>
    <p>Half an hour, and we will walk you through it. No pitch deck — we go through these findings live and tell you honestly which parts you can handle in-house. Reply to whoever sent you this, or start at reddoorla.com/contact.</p>
  </section>
```

Hide the site chrome on paper: in the `<style>` block add `:global(header), :global(footer), :global(nav) { display: none; }` and `.caveat { color: #57544f; font-size: 9.5pt; margin: 4pt 0 0; }`.

- [ ] **Step 3: Verify**

Run: `pnpm vitest run src/lib/report/ && pnpm lint && pnpm check && pnpm test:unit`
Then load `/audit/<any stored token>/print` on `pnpm dev` and read it top to bottom once.

- [ ] **Step 4: Commit**

```bash
git add src/routes/audit/[token]/print/+page.svelte src/lib/report/report-copy.test.ts
git commit -m "fix(report): the print sheet says the same thing as the page"
```

---

### Task 9: Gates, PRs, and the re-run

- [ ] **Step 1: Maintenance gate + PR into `main`** — `pnpm lint && pnpm exec tsc --noEmit && pnpm exec tsc --noEmit -p tsconfig.netlify.json && pnpm test`. PR title: `feat(prospect): prospect-ready report — measured fixes, honest email, name collisions, goal required`.
- [ ] **Step 2: Website gate + PR into `staging`** — `pnpm lint && pnpm check && pnpm test`. Kill stale `:5173` first. PR title: `fix(report): one story on every surface`.
- [ ] **Step 3: After both merge and Tucker promotes, re-audit reddoorla.com from the cockpit with goal `enquire` and read the whole page once more.** The opener, the fix list and the table must agree; the accuracy section must state the own-site count; the email must be a note.
- [ ] **Step 4: Re-run the test sites on the new shape** (operational, not code): sequential, 30s gap, quiet machine, from the cockpit so each carries a goal. Record which lost a stage and re-queue those.
- [ ] **Step 5: Ten deliberately neglected sites** — ask Tim for candidates in the channel (older builds, non-Reddoor, small). This settles whether "Does it work" is padding.

---

## Self-review

**Spec coverage.** Fix policy → Tasks 1, 2, 6, 7. Deterministic opener → 6, 7, 8. Own-site citations copy → 6, 7. Contradiction rule → 3. Name collision → 3, 6, 7, 8. Email retire → 4. Print sheet → 8. Small copy (engines singular, leftover sentence, duplicate paragraph, reproduce, evidence column, listing list, rate claim) → 2, 6, 7. Goal required → 5, 7. Readability ingredients: **not in this plan** — it needs the score inputs exposed from `checks` and a decision on what to show; filed as the first follow-up. Second engine: not in this plan by decision.

**Placeholders.** Task 2 step 1 and Task 3 step 1 name helper functions the test files are assumed to have (`buildAnalyzePrompt`, `crawlWith`, `brandedAnswer`, `fakeOwnership`); the implementer must use the file's real helper names. Everything else is complete code.

**Type consistency.** `Fix.origin` optional in maintenance (`types.ts`), required in the website view (`model.ts`) with the `?? "recommendation"` default at the boundary. `conflation` optional at the website boundary, required in `AccuracyResult`. `MeasuredInput.phones` uses `{ normalized, linked }`, both fields present on `ContactVariant`. `mergeFixes` and `measuredFixes` are the only new exports; `openingSummary` and `ownSiteCitations` are the website's.

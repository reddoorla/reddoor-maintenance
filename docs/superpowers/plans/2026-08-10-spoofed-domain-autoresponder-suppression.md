# Same-Domain Spoof Autoresponder Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the fleet's form autoresponder from emailing addresses on the submitting site's own domain, so bots spoofing a client's address can no longer backscatter "We got your message" into the client's inbox.

**Architecture:** One guard added to `buildAutoresponder` in `src/forms/notify.ts`, reusing the existing pure `hostsMatch` helper from `src/forms/ingest.ts` (no import cycle: ingest never imports notify — notify is injected into ingest via deps). Fail-open on missing/unparseable site url. POC notification and `spam_auto` handling untouched.

**Tech Stack:** TypeScript, vitest (`pnpm test`), changesets. Repo: `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance`.

**Spec:** `docs/superpowers/specs/2026-08-10-spoofed-domain-autoresponder-suppression-design.md`

---

### Task 1: Spoof guard in `buildAutoresponder`

**Files:**

- Modify: `src/forms/notify.ts` (imports at top; guard inside `buildAutoresponder`, directly after the `if (!submission.email) return null;` line)
- Test: `tests/forms/notify.test.ts` (new `describe` block after the existing `describe("spam suppression", ...)` block)

- [ ] **Step 1: Write the failing tests**

Add to `tests/forms/notify.test.ts`, after the `describe("spam suppression", ...)` block. `makeWebsiteRow()`'s default `url` is `"https://acme.example.com"`; pass `url` explicitly anyway so each case is self-describing:

```ts
describe("same-domain spoof suppression", () => {
  // Bots spoof the site's own address as the submitter email; the autoresponder
  // then backscatters "We got your message" into the client's inbox (MSOT,
  // 2026-08-08). The POC notification must still send — only the autoresponder
  // is suppressed.
  it("suppresses the autoresponder when the submitter email is on the site's own domain", () => {
    const site = makeWebsiteRow({
      url: "https://acme.example.com",
      pointOfContact: "owner@acme.example.com",
    });
    const sub = makeSubmissionRow({ email: "info@acme.example.com" });
    expect(buildAutoresponder(site, sub)).toBeNull();
    expect(buildPocNotification(site, sub)).not.toBeNull();
  });

  it("matches subdomains of the site host, either direction", () => {
    const site = makeWebsiteRow({ url: "https://acme.example.com" });
    expect(
      buildAutoresponder(site, makeSubmissionRow({ email: "bob@mail.acme.example.com" })),
    ).toBeNull();
    const wwwSite = makeWebsiteRow({ url: "https://www.acme.com" });
    expect(buildAutoresponder(wwwSite, makeSubmissionRow({ email: "info@acme.com" }))).toBeNull();
  });

  it("is case-insensitive", () => {
    const site = makeWebsiteRow({ url: "https://acme.example.com" });
    expect(
      buildAutoresponder(site, makeSubmissionRow({ email: "Info@ACME.Example.COM" })),
    ).toBeNull();
  });

  it("still autoresponds to genuine outside leads", () => {
    const site = makeWebsiteRow({ url: "https://acme.example.com" });
    expect(buildAutoresponder(site, makeSubmissionRow({ email: "lead@gmail.com" }))).not.toBeNull();
  });

  it("does not match a lookalike domain that merely ends with the site host", () => {
    const site = makeWebsiteRow({ url: "https://acme.example.com" });
    expect(
      buildAutoresponder(site, makeSubmissionRow({ email: "x@notacme.example.com.evil.net" })),
    ).not.toBeNull();
    const apex = makeWebsiteRow({ url: "https://solutionsoftx.com" });
    expect(
      buildAutoresponder(apex, makeSubmissionRow({ email: "x@medicalsolutionsoftx.com" })),
    ).not.toBeNull();
  });

  it("fails open when the site url is empty or unparseable", () => {
    const empty = makeWebsiteRow({ url: "" });
    expect(
      buildAutoresponder(empty, makeSubmissionRow({ email: "info@acme.example.com" })),
    ).not.toBeNull();
    const junk = makeWebsiteRow({ url: "not a url" });
    expect(
      buildAutoresponder(junk, makeSubmissionRow({ email: "info@acme.example.com" })),
    ).not.toBeNull();
  });
});
```

Note the lookalike test's second case: `x@notacme.example.com.evil.net` — `hostsMatch` requires a `.`-label boundary, so neither this nor `medicalsolutionsoftx.com` vs `solutionsoftx.com` may match. `hostsMatch` already guarantees this; the tests pin it.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm vitest run tests/forms/notify.test.ts`
Expected: the four suppression/matching tests FAIL (autoresponder currently returned, not null); the outside-lead and fail-open tests PASS.

- [ ] **Step 3: Implement the guard**

In `src/forms/notify.ts`, add to the existing imports at the top:

```ts
import { hostsMatch } from "./ingest.js";
```

In `buildAutoresponder`, directly after `if (!submission.email) return null;`:

```ts
// A submitter email on the site's OWN domain is never a real lead wanting a
// confirmation — it is the spoofed-sender backscatter case (a bot writes the
// site's info@ as its email and the "We got your message" lands in the
// client's inbox). The POC notification still sends; only this email is
// suppressed. Unparseable/blank site url → fail open and send, same
// philosophy as turnstileHostnameAcceptable.
const emailDomain = submission.email.split("@").pop() ?? "";
let siteHost = "";
try {
  siteHost = new URL(site.url).hostname;
} catch {
  /* fail open */
}
if (siteHost && hostsMatch(emailDomain, siteHost)) return null;
```

(`hostsMatch("", host)` is false by definition, so a malformed email with no `@` tail also fails open.)

- [ ] **Step 4: Run the file's tests to verify they pass**

Run: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm vitest run tests/forms/notify.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS / no type errors. (If the repo has no separate typecheck script, `pnpm build` serves the same purpose.)

- [ ] **Step 6: Commit**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git add src/forms/notify.ts tests/forms/notify.test.ts
git commit -m "fix(forms): suppress autoresponder when submitter email is on the site's own domain"
```

---

### Task 2: Changeset

**Files:**

- Create: `.changeset/spoofed-domain-autoresponder.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@reddoorla/maintenance": patch
---

forms: suppress the autoresponder when the submitter's email is on the site's own domain

A spam bot filled the MSOT contact form using the site's own info@ address as
its email (2026-08-08, spamScore 55 — under the 60 auto-spam threshold). The
"We got your message" autoresponder backscattered into the client's inbox as an
unexplained confirmation. A submitter address on the site's own domain is never
a real outside lead needing a confirmation, so buildAutoresponder now returns
null for it (hostsMatch semantics: exact host or subdomain, case-insensitive,
label-boundary safe; blank/unparseable site url fails open). The POC
notification is unchanged — a human still sees and judges the submission.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git add .changeset/spoofed-domain-autoresponder.md
git commit -m "chore: changeset for spoof autoresponder suppression"
```

---

## Self-Review

- **Spec coverage:** exact-domain, subdomain, www, case-insensitivity, fail-open, label-boundary — each has a test in Task 1 Step 1; "POC notification unchanged" is asserted in the first test. No per-site config added (spec: none). ✓
- **Placeholders:** none; every step has complete code/commands. ✓
- **Type consistency:** `hostsMatch(a: string, b: string): boolean` matches its export in `src/forms/ingest.ts:428`; `buildAutoresponder(site: WebsiteRow, submission: SubmissionRow)` signature untouched. ✓

# Vuln "auto-fix exhausted" signal — design

**Date:** 2026-06-23
**Status:** approved (brainstorm), ready for implementation plan

## Goal

Add a distinct dashboard signal for the case where the fleet's **automatic** vulnerability
fix has **already been tried and failed**: Renovate has been auto-dispatched across multiple
nightly cycles for the same critical/high vuln episode, and the vuln is *still present*. Today
that site looks identical to one whose vuln was detected an hour ago — both render the plain
`vuln` attention chip. The operator can't tell "Renovate's got it" from "Renovate can't fix this,
it needs you."

## Background — the automatic fix already exists

The remediation loop runs nightly in `fleet-security.yml`:

1. the security audit writes each active site's vuln counts to Airtable
   (`securityVulnsCritical` / `securityVulnsHigh` on the Websites row), then
2. `renovate-dispatch --fleet` (`src/cli/commands/renovate-dispatch.ts`) fires each
   critical/high-vuln repo's `renovate.yml` `workflow_dispatch`, so Renovate's OSV alerts
   open the remediation PR off-schedule (then auto-merge per the shared preset).

So an "automatic fix attempt" = a `renovate-dispatch` of a vulnerable site. The fix **failed**
when, several attempts later, the critical/high count has not returned to 0. The two dominant
failure modes:

- **No available fix** — the vuln is in an unpatched (often transitive) dependency. Renovate
  opens no useful PR; the vuln festers indefinitely. *This is the most important case to surface,
  and the one a human most needs to act on.*
- **Fix PR keeps failing CI / conflicting** — Renovate opens the security PR but it never merges.

## Why a counter (rejected alternative)

The cheap alternative — derive "tried and failed" from the existing `renovateFailingCis` field
(vuln present **and** a failing Renovate PR) — was **rejected**. It needs zero new state, but it
misses the *no-available-fix* case entirely: with no PR, `renovateFailingCis` stays 0 and the vuln
is never flagged. That is precisely the case where automation is most stuck. A per-site **attempt
counter** catches both the no-fix case (re-dispatched every cycle → counter climbs) and the
failing-PR case.

## Decisions (locked)

- **Mechanism:** per-site attempt counter, persisted on the Websites row.
- **Threshold:** `>= 3` nightly cycles (~72h of trying) before flagging "exhausted". Below the
  threshold the item renders as a normal `vuln` — Renovate keeps its clean shot.
- **Representation:** a flavor of the *existing* `vuln` attention item (same `vuln:<siteId>` diff
  key for NEW/WORSE continuity), not a new `kind`. A flag, a forced-critical severity, a distinct
  chip + filter token.

## Data model

One new Airtable **Websites** field:

| Airtable field | Type | `WebsiteRow` property | Coercion |
| --- | --- | --- | --- |
| `Security Auto-Fix Attempts` | Number (integer) | `securityAutoFixAttempts: number \| null` | `?? null` on read, like the sibling count fields |

Mapping added in `src/reports/airtable/websites.ts` `mapRow` alongside the other security fields:

```ts
securityAutoFixAttempts: (f["Security Auto-Fix Attempts"] as number | undefined) ?? null,
```

A null counter (field absent, or never dispatched) reads as 0 everywhere via `?? 0` — so before
the field exists the signal simply never fires (safe degradation).

## Counter lifecycle — owned by `renovate-dispatch`

The counter's whole lifecycle lives in `renovate-dispatch`, which already runs nightly *after* the
security audit has written fresh counts. A **pure** planner computes the writes; the command applies
them best-effort.

### Pure planner — `computeAutoFixAttemptUpdates` (new, in `src/github/renovate-dispatch.ts`)

```ts
/** Given the just-fetched sites and the dispatch result, compute the per-site
 *  auto-fix-attempt counter changes. Pure; returns only rows whose value changes.
 *  - a dispatched vuln site            → attempts + 1   (a fresh failed-so-far attempt)
 *  - a site now at 0 critical/high     → reset to 0     (the episode resolved)
 *  - skipped (healthy PR in flight)    → unchanged      (a fix IS in flight, not a failure)
 *  - failed dispatch / not-dispatched  → unchanged
 */
export function computeAutoFixAttemptUpdates(
  sites: WebsiteRow[],
  result: RenovateDispatchResult,
): { id: string; attempts: number }[] {
  const dispatched = new Set(result.dispatched); // repos (owner/repo)
  const updates: { id: string; attempts: number }[] = [];
  for (const s of sites) {
    if (!isDashboardVisible(s)) continue;
    const repo = s.gitRepo?.trim();
    if (!repo) continue;
    const current = s.securityAutoFixAttempts ?? 0;
    const vulns = (s.securityVulnsCritical ?? 0) + (s.securityVulnsHigh ?? 0);
    let next = current;
    if (vulns === 0) next = 0;
    else if (dispatched.has(repo)) next = current + 1;
    if (next !== current) updates.push({ id: s.id, attempts: next });
  }
  return updates;
}
```

Properties that make this correct and cheap:

- **Skipped ≠ failed.** A site skipped because it has a *healthy* open Renovate PR keeps its
  current count — a fix is genuinely in flight; only a real dispatch (Renovate had nothing better to
  do than try again) counts as a failed-so-far attempt. (A *conflicting* PR is dispatched by the
  existing logic, so it correctly counts.)
- **First detection is not "exhausted."** Cycle 1 takes the counter 0→1 (normal vuln). It crosses
  the `>= 3` threshold only after surviving cycle 1, 2, and 3 — i.e. the dispatch on the 3rd night.
- **Self-clearing.** The moment the audit writes 0 critical/high, the next dispatch run resets the
  counter, so a resolved-then-recurring vuln starts a fresh episode from 0.
- **Write-minimal.** Only changed rows are returned, so a steady fleet writes nothing.

### Airtable writer — `updateAutoFixAttempts` (new, in `websites.ts`)

Exact sibling of `updateGitHubSignals`:

```ts
/** Persist a site's auto-fix attempt counter (one field, its own writer so the
 *  nightly dispatch can update it without touching the audit's count fields). */
export async function updateAutoFixAttempts(
  base: AirtableBase,
  recordId: string,
  attempts: number,
): Promise<void> {
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: { "Security Auto-Fix Attempts": attempts } }]);
}
```

### Command wiring — `runRenovateDispatchCommand`

After `dispatchRenovateAcross`, apply the planned updates **best-effort** (the command must keep
its "always exits 0, never fails the sweep" contract — and the write must not break before the
Airtable field is created):

```ts
const updates = computeAutoFixAttemptUpdates(websites, result);
let attemptsWritten = 0;
let attemptsFailed = 0;
for (const u of updates) {
  try {
    await updateAutoFixAttempts(base, u.id, u.attempts);
    attemptsWritten++;
  } catch {
    attemptsFailed++; // field not yet created / transient — never throw
  }
}
lines.push(`AUTO_FIX_ATTEMPTS_SUMMARY written=${attemptsWritten} failed=${attemptsFailed}`);
```

(The `AUTO_FIX_ATTEMPTS_SUMMARY` line mirrors the existing `RENOVATE_DISPATCH_SUMMARY` so the
workflow can grep it; the `fleet-security.yml` step needs no behavioral change — it already runs
this command and tolerates non-fatal output.)

## Signal logic — `collectVulnAlerts`

Add the flavor to the existing collector (`src/alerts/digest-collectors.ts`). The exhausted item
keeps the `vuln` kind and `vuln:<siteId>` key (continuity), forces `critical` severity (a stuck
vuln is always urgent, even high-only), and carries a new optional flag:

```ts
const AUTO_FIX_EXHAUSTED_CYCLES = 3;
// ...
const attempts = s.securityAutoFixAttempts ?? 0;
const exhausted = attempts >= AUTO_FIX_EXHAUSTED_CYCLES;
items.push({
  key: `vuln:${s.id}`,
  kind: "vuln",
  siteName: s.name,
  title: exhausted
    ? `${metric} critical/high ${metric === 1 ? "vuln" : "vulns"} — auto-fix failed (${attempts}×)`
    : `${metric} critical/high ${metric === 1 ? "vuln" : "vulns"}`,
  url: dashboardUrl(baseUrl, s.name),
  severity: exhausted ? "critical" : critical > 0 ? "critical" : "warning",
  metric,
  autoFixExhausted: exhausted || undefined, // omit when false (keeps existing snapshots stable)
});
```

`AttentionItem` (in `src/alerts/attention.ts`) gains one optional field:

```ts
/** Set by collectVulnAlerts when the auto-fix (Renovate) has been retried past the
 *  exhaustion threshold without clearing the vuln — render as a distinct "auto-fix
 *  failed" chip and filter token. Absent on every other item. */
autoFixExhausted?: boolean;
```

`metric` stays `critical + high`, so the count-based NEW/WORSE diff is unchanged. (Note: the plain →
exhausted *flavor* change alone does **not** trip a WORSE badge unless the underlying count also
rises — the escalation is conveyed by the distinct chip, the forced-critical severity, and the
filter, which is sufficient and avoids polluting the vuln-count metric.)

## Rendering — `src/dashboard/fleet-render.ts`

- **Filter token.** `signalsAttr` adds `auto-fix-failed` to a card's `data-signals` when any of its
  items has `autoFixExhausted` (in addition to the existing `vulns` token, so the card still matches
  the `vulns` filter too).
- **Filter chip.** Add `"auto-fix-failed"` to the `FILTERS` list so the summary bar gets its chip.
- **Chip styling.** `chips()` renders an exhausted item with a distinct class (`chip critical stuck`)
  so it reads visually apart from a fresh critical vuln; add a small `.chip.stuck` rule to the style
  block (e.g. a wrench/`⛔` marker or a heavier border). The chip *text* already carries the
  "auto-fix failed (N×)" wording from the title.
- **Summary count.** `CockpitSummary` gains `autoFixStuck: number` (count of tagged items with
  `autoFixExhausted`), surfaced in the heads line as `${autoFixStuck} auto-fix stuck`. Computed in
  `buildCockpitModel` as `tagged.filter((i) => i.autoFixExhausted).length`.

No tier change: an exhausted vuln is already an `AttentionItem`, so `assignTier` keeps the site on
the 🔴 attention tier. It also flows unchanged into the nightly digest email (same collector),
where the escalated title makes the "auto-fix failed" state visible in the operator's inbox too.

## Error handling / safety

- `renovate-dispatch` stays best-effort and **always exits 0**; the new counter writes are each
  individually `try`/`catch`ed so a missing field or transient Airtable error can never fail the
  security sweep.
- Ships **dark**: until `Security Auto-Fix Attempts` exists in Airtable, reads coerce to 0 (signal
  never fires) and writes no-op (caught), so deploying before the field is added is harmless.
- Pure functions (`computeAutoFixAttemptUpdates`, `collectVulnAlerts`) take their inputs explicitly
  and are fully unit-testable with no IO.

## Testing

- **`computeAutoFixAttemptUpdates`** (pure, primary coverage):
  - dispatched vuln site → `+1`; multi-site mix returns only changed rows
  - vulns now 0 with attempts>0 → reset to 0; vulns 0 with attempts already 0 → no update
  - skipped repo (in `result.skipped`) → unchanged; failed repo → unchanged
  - inactive / no-repo sites excluded
  - null `securityAutoFixAttempts` treated as 0 (first dispatch → 1)
- **`collectVulnAlerts`**: attempts `< 3` → normal title/severity, no flag; attempts `>= 3` →
  forced critical, `autoFixExhausted: true`, escalated title; vulns 0 but attempts present → no item.
- **Row mapping**: `Security Auto-Fix Attempts` present → number; absent → null.
- **`signalsAttr` / render**: an exhausted item yields `auto-fix-failed` in `data-signals` and the
  `chip stuck` class; `FILTERS` includes the new chip.
- **`buildCockpitModel`**: `summary.autoFixStuck` counts exhausted items.
- **Command**: existing guard tests stay green; add one asserting the `AUTO_FIX_ATTEMPTS_SUMMARY`
  line is emitted (with a fake base/writer) — or cover the planner purely and keep the command thin.

## Rollout

1. **Manual prereq (one step):** add the `Security Auto-Fix Attempts` Number field to the Airtable
   Websites table (same kind of one-click setup as the announce/launch features). *Can alternatively
   be created via the Airtable MCP during implementation.*
2. Ship the code (changeset: **minor**). It's inert until the field exists; once it does, the counter
   begins accruing on the next nightly `fleet-security` run and the first "auto-fix failed" chip can
   appear ~3 nights after a genuinely stuck vuln.

## Files touched

- `src/reports/airtable/websites.ts` — `WebsiteRow.securityAutoFixAttempts`, `mapRow` entry,
  `updateAutoFixAttempts` writer.
- `src/github/renovate-dispatch.ts` — `computeAutoFixAttemptUpdates` pure planner.
- `src/cli/commands/renovate-dispatch.ts` — apply updates best-effort + summary line.
- `src/alerts/attention.ts` — `AttentionItem.autoFixExhausted?`.
- `src/alerts/digest-collectors.ts` — exhausted flavor in `collectVulnAlerts` + threshold constant.
- `src/dashboard/fleet-render.ts` — `signalsAttr` token, `FILTERS` chip, `chips()` class + style,
  summary head.
- `src/dashboard/fleet-cockpit.ts` — `CockpitSummary.autoFixStuck` + its tally.
- Tests alongside each; one `.changeset/*.md` (minor).

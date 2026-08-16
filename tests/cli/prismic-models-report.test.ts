import { describe, it, expect } from "vitest";
import { renderModelReport, isClean } from "../../src/cli/commands/prismic-models-report.js";
import type { ModelDiff } from "../../src/prismic/models/index.js";

const emptyDiff = (): ModelDiff => ({ toCreate: [], toUpdate: [], unchanged: [], remoteOnly: [] });
const localEntry = (
  kind: "customtype" | "slice",
  id: string,
  model: Record<string, unknown> = {},
) => ({
  kind,
  id,
  model: { ...model, id },
  path: `${kind}/${id}`,
});
const remoteEntry = (
  kind: "customtype" | "slice",
  id: string,
  model: Record<string, unknown> = {},
) => ({
  kind,
  id,
  model: { ...model, id },
});

describe("isClean", () => {
  it("is clean when everything is unchanged", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"));
    expect(isClean(d)).toBe(true);
  });

  it("is not clean with a model to create", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(isClean(d)).toBe(false);
  });

  it("is not clean with a model to update", () => {
    const d = emptyDiff();
    d.toUpdate.push({ local: localEntry("slice", "hero"), remote: remoteEntry("slice", "hero") });
    expect(isClean(d)).toBe(false);
  });

  // A remote-only model IS drift. It is the out-of-band cloud edit the nightly
  // check exists to catch, and the silent-field-drop class in reverse.
  it("is not clean with a remote-only model", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    expect(isClean(d)).toBe(false);
  });
});

describe("renderModelReport", () => {
  it("says everything matches on a clean diff", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"), localEntry("customtype", "page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("2 model(s) match Prismic");
    expect(out).not.toContain("REMOTE-ONLY");
  });

  it("lists new models under NEW with their repo path", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(renderModelReport("espada", d, { apply: false })).toContain(
      "NEW  slice hero  (slice/hero)",
    );
  });

  it("lists changed models with their field-level lines", () => {
    const d = emptyDiff();
    d.toUpdate.push({
      local: localEntry("slice", "hero", {
        variations: [{ id: "default", primary: { wash: { type: "Boolean" } } }],
      }),
      remote: remoteEntry("slice", "hero", { variations: [{ id: "default", primary: {} }] }),
    });
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("CHANGED  slice hero");
    expect(out).toContain("+ default.primary.wash");
  });

  it("lists remote-only models under a REMOTE-ONLY heading that says they are never deleted", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("REMOTE-ONLY");
    expect(out).toContain("frozen_page");
    expect(out).toMatch(/never deleted/i);
  });

  it("labels a dry run as a dry run and an applied run as pushed", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(renderModelReport("espada", d, { apply: false })).toMatch(/DRY RUN/);
    expect(renderModelReport("espada", d, { apply: true })).toMatch(/pushed/i);
  });

  it("surfaces per-model push failures", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [{ kind: "slice", id: "hero", error: "422 unprocessable" }],
    });
    expect(out).toContain("FAILED  slice hero: 422 unprocessable");
  });

  it("names the Prismic repository in the header so a wrong-repo run is obvious", () => {
    expect(renderModelReport("the-pointe-burbank", emptyDiff(), { apply: false })).toContain(
      "the-pointe-burbank",
    );
  });

  // TWO SOURCES OF TRUTH FOR ONE SAFETY-CRITICAL FACT. `remoteOnly` now exists on
  // BOTH the `ModelDiff` (where this renderer reads it) and on `PushReport` as
  // `remoteOnlyReported` — the field Task 10 added so that a consumer holding
  // only the report can still tell "this checkout lost every slice" apart from
  // "everything is in sync".
  //
  // Two sources for one fact is itself a defect shape: they can disagree, and
  // the disagreement is silent. It means something upstream is broken — a diff
  // computed against a different remote read than the push ran against, a report
  // built from a stale diff, or a caller passing a mismatched pair. Any of those
  // makes every other number in the report untrustworthy, because they were all
  // derived from the same inputs.
  //
  // So the renderer RECONCILES rather than picking a winner. It has both; the
  // check is nearly free; and a mismatch must be loud, because the quiet version
  // is a report that looks authoritative and is not.
  it("reconciles the diff's remoteOnly against the push report's, and says so loudly on a mismatch", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        // Disagrees with the diff above: the diff saw one remote-only model,
        // the push run recorded none.
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("frozen_page");
  });

  it("says nothing about reconciliation when the two agree", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        remoteOnlyReported: [{ kind: "customtype", id: "frozen_page" }],
      },
    });
    expect(out).not.toMatch(/INCONSISTENT/);
    expect(out).toContain("REMOTE-ONLY");
  });

  // A dry run never builds a PushReport, so the reconciliation must be SKIPPED
  // rather than treated as "the report said none". Absent and empty are
  // different facts — the rule this whole plan is built around.
  it("does not report an inconsistency when there is no push report at all", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    expect(renderModelReport("espada", d, { apply: false })).not.toMatch(/INCONSISTENT/);
  });

  // ---------------------------------------------------------------------------
  // The reconciliation, generalised. `remoteOnly` is not the only fact this
  // renderer is handed twice — `mode`/`apply` and the failure list are too, and
  // the three-line summary is derived from all of them. Each pair below agrees
  // by construction at the current caller, which is exactly the argument that
  // was made for `remoteOnly` before Task 10 added its second source.
  // ---------------------------------------------------------------------------

  // The WORST mislabel this renderer can produce. `mode` is the push run's own
  // record of whether anything went on the wire; `opts.apply` is what the caller
  // believes. If they disagree, the headline verdict is a lie in one of the two
  // directions that matter most: "3/3 model(s) pushed" for a run that sent
  // nothing, or "DRY RUN — nothing was sent" for a run that rewrote three models
  // in a live repository.
  it("reconciles the caller's apply flag against the push report's recorded mode", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "dry",
        sent: [{ kind: "slice", id: "hero", action: "insert" }],
        failed: [],
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toMatch(/mode/);
  });

  // Same defect shape as `remoteOnly`, same treatment. `opts.failed` and
  // `opts.report.failed` are one fact supplied twice; `??` picks a winner
  // silently, which is the behaviour this file's own header argues against.
  it("reconciles the caller's failure list against the push report's", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [{ kind: "slice", id: "hero", error: "422 unprocessable" }],
      report: {
        mode: "apply",
        sent: [{ kind: "slice", id: "hero", action: "insert" }],
        failed: [],
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("hero");
  });

  // Identity is (kind, id), never id alone — the rule diff.ts states for the
  // comparison and which applies verbatim here. A slice and a custom type may
  // share an id, so keying on id alone would reconcile the two as one model and
  // report agreement where the two sources name DIFFERENT resources.
  it("does not reconcile a slice against a custom type of the same id", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("slice", "page"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        remoteOnlyReported: [{ kind: "customtype", id: "page" }],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
  });

  // Task 10's invariant: `pushModels` builds its work list from `toCreate` +
  // `toUpdate` and drops every item into exactly one of `sent`/`failed`. The
  // summary arithmetic depends on that, so the renderer checks it rather than
  // assuming it — a model in NEITHER bucket is a model that silently vanished,
  // and the arithmetic version of the summary would have reported it as pushed.
  it("flags a model the push run neither sent nor failed", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"), localEntry("slice", "banner"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [{ kind: "slice", id: "hero", action: "insert" }],
        failed: [],
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("banner");
  });

  it("flags a model the push run recorded in BOTH buckets", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [{ kind: "slice", id: "hero", action: "insert" }],
        failed: [{ kind: "slice", id: "hero", error: "422 unprocessable" }],
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toMatch(/BOTH/);
  });

  // Reachable with NO report at all: a caller holding only a failure list can
  // still pair it with the wrong diff, and `n - failed.length` would then print
  // a negative numerator with no explanation.
  it("flags a caller-supplied failure naming a model this diff is not pushing", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [
        { kind: "slice", id: "hero", error: "422" },
        { kind: "slice", id: "ghost", error: "422" },
      ],
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("ghost");
  });

  // THE ORDERING REQUIREMENT, which the plan states and does not test. A report
  // that says "nothing to push" while its own two sources disagree is the most
  // dangerous output this renderer can produce, and the clean early return is
  // precisely the path that would skip the check.
  it("reconciles BEFORE the clean early return, and never prints the clean verdict unqualified", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        // The diff saw no remote-only models; the push run recorded one. On a
        // clean diff that is the alamo-anatomy shape — the two reads disagree
        // about whether Prismic holds a model this checkout does not.
        remoteOnlyReported: [{ kind: "customtype", id: "frozen_page" }],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("frozen_page");
    expect(out).not.toContain("nothing to push");
  });

  // `n - failed.length` ASSUMES every worked model landed in one of the two
  // buckets. `report.sent` MEASURES it. When a model vanishes from both, the
  // derived number claims it was pushed and the measured one does not — so the
  // measured one wins wherever it exists.
  it("reports the push run's measured sent count, never n minus the failures", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"), localEntry("slice", "banner"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [{ kind: "slice", id: "hero", action: "insert" }],
        failed: [],
        remoteOnlyReported: [],
      },
    });
    expect(out).toContain("1/2 model(s) pushed");
    expect(out).not.toContain("2/2 model(s) pushed");
  });

  // ---------------------------------------------------------------------------
  // Output shape. This string is used VERBATIM as a PR comment body, inside a
  // fenced block, on a change to a live client site's content model. GitHub
  // collapses long comments from the top, so what leads matters.
  // ---------------------------------------------------------------------------

  it("leads with the verdict, before the itemized detail", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out.indexOf("DRY RUN")).toBeLessThan(out.indexOf("NEW  slice hero"));
  });

  // A push REPLACES the whole model, and Prismic's Migration API then drops the
  // document data for any field the new model no longer declares — HTTP 200, no
  // warning. So a `-` line is not "a change", it is data loss on a live site,
  // and it must not sit unmarked among forty `+` lines.
  //
  // This is also a CONTRACT TEST against `describeDiff`'s output format: the
  // renderer classifies by the `- ` prefix and the `~ (model) repeatable` line
  // that diff.ts emits. If that format ever changes, this test goes red rather
  // than the warning silently going to zero.
  it("calls out a removed field as destructive", () => {
    const d = emptyDiff();
    d.toUpdate.push({
      local: localEntry("customtype", "page", { json: { Main: {} } }),
      remote: remoteEntry("customtype", "page", {
        json: { Main: { headline: { type: "StructuredText" } } },
      }),
    });
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("- Main.headline (only in Prismic — pushing DELETES it)");
    expect(out).toMatch(/DESTRUCTIVE/);
    // Ahead of the detail it summarises — see the leads-with-the-verdict test.
    expect(out.indexOf("DESTRUCTIVE")).toBeLessThan(out.indexOf("- Main.headline"));
  });

  // diff.ts names this one explicitly: "`repeatable` flipping is destructive,
  // not cosmetic". It touches neither field zone, so it renders as a single
  // metadata line with no `-` on it.
  it("calls out a repeatable flip as destructive", () => {
    const d = emptyDiff();
    d.toUpdate.push({
      local: localEntry("customtype", "page", { repeatable: false }),
      remote: remoteEntry("customtype", "page", { repeatable: true }),
    });
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("~ (model) repeatable");
    expect(out).toMatch(/DESTRUCTIVE/);
  });

  it("does not cry destructive over a pure field addition", () => {
    const d = emptyDiff();
    d.toUpdate.push({
      local: localEntry("customtype", "page", {
        json: { Main: { headline: { type: "StructuredText" } } },
      }),
      remote: remoteEntry("customtype", "page", { json: { Main: {} } }),
    });
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("+ Main.headline");
    expect(out).not.toMatch(/DESTRUCTIVE/);
  });

  // The alamo-anatomy shape, and the reason `remoteOnlyReported` exists at all:
  // a slice-library path that stops resolving answers zero local models, so
  // every model Prismic holds sorts into `remoteOnly` and nothing else is
  // populated. The REMOTE-ONLY block alone renders that as a routine "you have
  // some cloud-only models" note; it is not.
  it("names the catastrophe when the checkout matched nothing at all", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("slice", "hero"), remoteEntry("customtype", "page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toMatch(/MATCHED NOTHING/);
    // Beside the verdict it qualifies, not underneath a heading further down —
    // "0 model(s) would be pushed; 0 already match" is the line that most needs
    // the qualification, and it is the line a collapsed comment shows.
    expect(out.indexOf("MATCHED NOTHING")).toBeLessThan(out.indexOf("REMOTE-ONLY"));
  });

  it("does not cry catastrophe when the repo still matched something", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"));
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("REMOTE-ONLY");
    expect(out).not.toMatch(/MATCHED NOTHING/);
  });

  // "0 model(s) match Prismic — nothing to push." is a SUCCESS verdict for a
  // state no live fleet site can legitimately be in. Every in-scope repository
  // holds models on both sides, so zero-on-both-sides is a wrong
  // `repositoryName` or a library path that no longer resolves — not a clean run.
  it("distinguishes a zero-model clean run from a healthy one", () => {
    const out = renderModelReport("espada", emptyDiff(), { apply: false });
    expect(out).toContain("0 model(s) match Prismic");
    expect(out).toMatch(/NOTHING WAS FOUND ON EITHER SIDE/);
  });

  it("does not cry about zero models when models actually matched", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"));
    expect(renderModelReport("espada", d, { apply: false })).not.toMatch(
      /NOTHING WAS FOUND ON EITHER SIDE/,
    );
  });

  // `PushReport.failed.status` exists so an operator can tell a dead write token
  // (fix the secret) from a rejected model (fix the model). A renderer that
  // drops it hands a human N identical lines and no way to tell which of the two
  // jobs they have.
  it("says a 401/403 is the token, not the model", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [{ kind: "slice", id: "hero", error: "POST … -> 403 explicit deny", status: 403 }],
    });
    expect(out).toMatch(/write token/i);
  });

  it("stays quiet about the token when the failure is a rejected model", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [{ kind: "slice", id: "hero", error: "422 unprocessable", status: 422 }],
    });
    expect(out).toContain("FAILED  slice hero");
    expect(out).not.toMatch(/write token/i);
  });

  // Absent and empty, once more: an apply run with no failure information at all
  // must not render a FAILED section, and must not read as an inconsistency.
  it("renders no FAILED section and no inconsistency when no failures were supplied", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, { apply: true });
    expect(out).not.toContain("FAILED");
    expect(out).not.toMatch(/INCONSISTENT/);
    expect(out).toContain("1/1 model(s) pushed");
  });
});

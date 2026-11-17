import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { RUN_WINDOW_MINUTES, untilWords, type CycleView } from "../../src/lib/overview/cycle.js";
import { NIGHTLY_STEPS } from "../../src/lib/overview/view.js";
import { NIGHTLIES } from "../../../scripts/nightly-conductor.mjs";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { NOW, night, snapshot } from "./fixtures.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { StepResult } from "../../../src/fleet-daily/types.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";

/**
 * P1-87 PR 5a: the nightly audit bar's model (plan, "The model"). Each fixture site
 * carries only the stamps its test names: `healthy()` stamps every check at 06:30Z,
 * which would read as tonight's run.
 */

const SHORTS = [
  "Backup",
  "CMS check",
  "CMS sync",
  "Security",
  "Site checks",
  "Build and tests",
  "Live forms",
  "Report drafts",
];

/** A maintained site with only the given stamps. The helper's default `urlCheckedAt`
 *  is 2100, a future stamp that would read as tonight's, so it is cleared here. */
function site(id: string, stamps: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({ id, name: id, status: "maintained", urlCheckedAt: null, ...stamps });
}

/** A `fleet_daily` night whose every step is given (default: all ran to the end). */
function nightWith(date: string, steps: Record<string, StepResult | null>): OverviewNight {
  const n = night(date);
  const ok: StepResult = { outcome: "completed", runId: 1, conclusion: "success" };
  return {
    ...n,
    counts: {
      ...n.counts,
      steps: Object.fromEntries(
        NIGHTLIES.map((x: { file: string }) => [
          x.file,
          x.file in steps ? (steps[x.file] ?? null) : ok,
        ]),
      ),
    },
  };
}

const cycle = (s: ReturnType<typeof snapshot>, now: Date): CycleView =>
  overviewFromSnapshot(s, now).cycle;

describe("the bar's model: a recorded night (plan, Tests 1, 2, 8, 9, 10)", () => {
  it("shows all eight steps, ran to the end, with the CMS check's time", () => {
    const s = snapshot({
      nights: [night("2026-10-26")],
      sites: [site("recA", { prismicModelsCheckedAt: "2026-10-27T06:15:00.000Z" })],
    });
    const v = cycle(s, NOW);
    expect(v.mode).toBe("recorded");
    expect(v.steps.map((x) => x.short)).toEqual(SHORTS);
    expect(v.steps.map((x) => x.state)).toEqual(Array(8).fill("done"));
    expect(v.steps[1]!.time).toBe("11:15pm");
    expect(v.steps[1]!.words).toBe("ran to the end, 11:15pm PT");
    for (const i of [0, 2, 7]) expect(v.steps[i]!.time).toBeNull();
    expect(v.line).toBe(
      "Night of Oct 26: 8 of 8 steps ran to the end · next run starts 11:07pm PT",
    );
    expect(v.marker).not.toBeNull();
    expect(v.marker!).toBeCloseTo(0.3623, 3);
    expect(v.runningLabel).toBeNull();
    expect(v.next).toEqual({
      startIso: "2026-10-28T06:07:00.000Z",
      startsAt: "11:07pm PT",
    });
  });

  it("words and counts per step: null, failed, skipped and running", () => {
    const s = snapshot({
      nights: [
        nightWith("2026-10-26", {
          "fleet-db-backup.yml": null,
          "fleet-prismic-drift.yml": { outcome: "completed", runId: 1, conclusion: "failure" },
          "fleet-prismic-sync.yml": { outcome: "skipped", runId: null, conclusion: null },
          "fleet-security.yml": { outcome: "running", runId: 1, conclusion: null },
        }),
      ],
      sites: [site("recA", { prismicModelsCheckedAt: "2026-10-27T06:15:00.000Z" })],
    });
    const v = cycle(s, NOW);
    expect(v.steps.map((x) => x.state)).toEqual([
      "none",
      "problem",
      "none",
      "none",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(v.steps[0]!.words).toBe("not recorded");
    expect(v.steps[2]!.words).toBe("already run that night");
    expect(v.steps[3]!.words).toBe("still running when the night was written");
    // A failure keeps its stamp's time.
    expect(v.steps[1]!.words).toBe("failed, 11:15pm PT");
    expect(v.steps[1]!.time).toBe("11:15pm");
    // The line counts only the steps that ran to the end.
    expect(v.line).toBe(
      "Night of Oct 26: 4 of 8 steps ran to the end · next run starts 11:07pm PT",
    );
  });

  it("a row written before the window ends is recorded: the marker is 0 and the page re-reads the next night", () => {
    const v = cycle(
      snapshot({ nights: [night("2026-10-26")] }),
      new Date("2026-10-27T09:00:00.000Z"),
    );
    expect(v.mode).toBe("recorded");
    expect(v.marker).toBe(0);
    expect(v.refresh).toEqual({
      fromIso: "2026-10-28T06:07:00.000Z",
      untilIso: "2026-10-28T11:07:00.000Z",
    });
  });

  it("only tonight's row counts: an older recorded night is never shown as this run", () => {
    const v = cycle(snapshot({ nights: [night("2026-10-25")], sites: [] }), NOW);
    expect(v.mode).toBe("unrecorded");
    expect(v.steps.every((x) => x.state === "none")).toBe(true);
  });
});

describe("the bar mid-run: running (plan, Tests 3 to 6, 9)", () => {
  const NOW_RUN = new Date("2026-10-27T07:30:00.000Z");

  it("CMS check stamped: it is finished, and CMS sync or Security is running", () => {
    const s = snapshot({
      nights: [],
      sites: [
        site("recA", { prismicModelsCheckedAt: "2026-10-27T06:10:00.000Z" }),
        // Yesterday's audit, on another site: before tonight's start, so ignored.
        site("recB", { lastSecurityAuditAt: "2026-10-26T05:00:00.000Z" }),
      ],
    });
    const v = cycle(s, NOW_RUN);
    expect(v.mode).toBe("running");
    expect(v.steps.map((x) => x.state)).toEqual([
      "done",
      "done",
      "running",
      "running",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(v.steps[1]!.words).toBe("finished at 11:10pm PT");
    expect(v.steps[1]!.time).toBe("11:10pm");
    expect(v.steps[0]!.words).toBe("finished");
    expect(v.steps[2]!.words).toBe("running now, or the step beside it");
    expect(v.steps[4]!.words).toBe("not started yet");
    expect(v.runningLabel).toBe("CMS sync or Security");
    expect(v.line).toBe("Running since 11:07pm PT · now on CMS sync or Security");
    expect(v.marker).toBeNull();
  });

  it("nothing stamped: Backup or CMS check is running", () => {
    const v = cycle(snapshot({ nights: [], sites: [site("recA")] }), NOW_RUN);
    expect(v.mode).toBe("running");
    expect(v.steps.map((x) => x.state)).toEqual([
      "running",
      "running",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(v.runningLabel).toBe("Backup or CMS check");
    expect(v.line).toBe("Running since 11:07pm PT · now on Backup or CMS check");
  });

  it("Live forms stamped: Report drafts alone is running", () => {
    const s = snapshot({
      nights: [],
      sites: [site("recA", { formE2eCheckedAt: "2026-10-27T06:20:00.000Z" })],
    });
    const v = cycle(s, NOW_RUN);
    expect(v.steps.map((x) => x.state).filter((x) => x === "running")).toHaveLength(1);
    expect(v.steps[7]!.state).toBe("running");
    expect(v.runningLabel).toBe("Report drafts");
  });

  it("Site checks stamped but CMS check not: Build and tests is the one running step", () => {
    const s = snapshot({
      nights: [],
      sites: [site("recA", { lastLighthouseAuditAt: "2026-10-27T06:40:00.000Z" })],
    });
    const v = cycle(s, NOW_RUN);
    expect(v.steps.slice(0, 5).map((x) => x.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(v.steps[1]!.time).toBeNull();
    expect(v.steps[1]!.words).toBe("finished");
    expect(v.steps[4]!.words).toBe("finished at 11:40pm PT");
    expect(v.steps[5]!.state).toBe("running");
    expect(v.steps.filter((x) => x.state === "running")).toHaveLength(1);
  });

  it("refreshes every 2 minutes until the window ends, from now", () => {
    const v = cycle(snapshot({ nights: [], sites: [site("recA")] }), NOW_RUN);
    expect(v.refresh).toEqual({
      fromIso: "2026-10-27T07:30:00.000Z",
      untilIso: "2026-10-27T11:07:00.000Z",
    });
  });
});

describe("the bar after the window with no row: unrecorded (plan, Test 7)", () => {
  const NOW_LATE = new Date("2026-10-27T12:30:00.000Z");

  it("infers the steps from tonight's stamps, with nothing running", () => {
    const s = snapshot({
      nights: [],
      sites: [site("recA", { prismicModelsCheckedAt: "2026-10-27T06:15:00.000Z" })],
    });
    const v = cycle(s, NOW_LATE);
    expect(v.mode).toBe("unrecorded");
    expect(v.steps.map((x) => x.state)).toEqual([
      "done",
      "done",
      "none",
      "none",
      "none",
      "none",
      "none",
      "none",
    ]);
    expect(v.steps[2]!.words).toBe("not recorded");
    expect(v.line).toBe(
      "The run that started Oct 26, 11:07pm PT has not been recorded · next run starts 11:07pm PT",
    );
    expect(v.refresh).toEqual({
      fromIso: "2026-10-28T06:07:00.000Z",
      untilIso: "2026-10-28T11:07:00.000Z",
    });
  });

  it("with nights unreadable, says the record could not be read", () => {
    const v = cycle(snapshot({ nights: null }), NOW_LATE);
    expect(v.mode).toBe("unrecorded");
    expect(v.line).toBe("The nightly record could not be read · next run starts 11:07pm PT");
  });

  it("the marker runs along the wait to the next start, from the window's end", () => {
    const v = cycle(snapshot({ nights: [] }), NOW_LATE);
    // (12:30 - 11:07) / (06:07 + 24h - 11:07) = 83 / 1140
    expect(v.marker!).toBeCloseTo(83 / 1140, 6);
  });
});

describe("the start, in winter (plan, Test 11)", () => {
  it("reads 10:07pm PT in November", () => {
    const v = cycle(snapshot({ nights: [] }), new Date("2026-11-17T18:00:00.000Z"));
    expect(v.next.startsAt).toBe("10:07pm PT");
  });
});

describe("the pins against the code (plan, Test 12)", () => {
  it("each step's wait is the conductor's", () => {
    expect(NIGHTLY_STEPS.map((s) => s.waitMinutes)).toEqual(
      NIGHTLIES.map((n: { waitMinutes: number }) => n.waitMinutes),
    );
  });

  it("the run window is the conductor job's timeout-minutes", () => {
    const yml = readFileSync(
      new URL("../../../.github/workflows/fleet-nightly.yml", import.meta.url),
      "utf8",
    );
    const first = /timeout-minutes:\s*(\d+)/.exec(yml);
    expect(first).not.toBeNull();
    expect(RUN_WINDOW_MINUTES).toBe(Number(first![1]));
    expect(RUN_WINDOW_MINUTES).toBe(300);
  });
});

describe("untilWords (plan, Test 13)", () => {
  const at = (iso: string) => Date.parse(iso);
  const START = "2026-10-28T06:07:00.000Z";

  it("says the time left to the next start, in whole hours above an hour, else minutes", () => {
    expect(untilWords(START, at("2026-10-27T19:07:00.000Z"))).toBe("in 11 hours");
    expect(untilWords(START, at("2026-10-28T05:27:00.000Z"))).toBe("in 40 minutes");
    expect(untilWords(START, at("2026-10-28T06:06:00.000Z"))).toBe("in 1 minute");
    expect(untilWords(START, at("2026-10-28T06:07:00.000Z"))).toBe("starting now");
    expect(untilWords(START, at("2026-10-28T06:08:00.000Z"))).toBe("starting now");
  });
});

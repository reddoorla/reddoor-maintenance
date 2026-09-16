import { describe, it, expect } from "vitest";
import {
  isFeatureUpdateBranch,
  renovateOutcome,
  renovateOutcomeLine,
  renovateOutcomeSummary,
  RENOVATE_DROUGHT_WARN_DAYS,
  type RenovateOutcome,
} from "../../src/audits/protection-coverage.js";
import type { RenovateMergeWindow } from "../../src/github/gh.js";

/*
 * S7 — the Renovate OUTCOME metric, proven in BOTH directions.
 *
 * House rule (CLAUDE.md): a new gate, alarm, check or probe must be shown to
 * PASS on a known-good input before any FAIL it produces is reported as a
 * finding. A threshold that fires on everything is indistinguishable from one
 * that fires correctly, so a one-directional proof is worth nothing.
 *
 * The two fixtures below are REAL, VERBATIM GitHub data: every merged
 * `renovate/*` head on all 26 non-archived public repos in the `reddoorla` org,
 * captured 2026-09-14 from
 *   GET /repos/reddoorla/<name>/pulls?state=closed&sort=updated&direction=desc&per_page=100
 * (one request per repo — the whole cost of the metric). Nothing is
 * hand-picked: the full window is frozen for every repo, and the historical
 * control is the SAME data filtered by merge date, so neither snapshot can be
 * tuned to suit the threshold.
 *
 * FAIL control — 2026-09-14 (today): the grouped non-major channel has been dry
 * since mid-August. Every measured repo must warn.
 * PASS control — 2026-08-10 (a Monday, five weeks earlier): the channel was
 * demonstrably delivering. Not one repo may warn.
 *
 * Honest limitation of the historical control, stated because it cuts the
 * right way: an 08-10 window would have reached FURTHER back than today's
 * does, so filtering today's window by date can only MISS older merges, never
 * invent them. That can only push a repo's measured age up or turn it
 * unmeasured — i.e. it can only make the PASS control harder to earn. It is
 * earned anyway.
 */

type SnapshotEntry = [
  repo: string,
  truncated: 0 | 1,
  merges: Array<[head: string, mergedAt: string]>,
];

/** Every merged `renovate/*` head in each repo's window, newest first. */
const FLEET_WINDOW: SnapshotEntry[] = [
  [
    ".github",
    0,
    [
      ["renovate/all-minor-patch", "2026-08-12T12:50:34Z"],
      ["renovate/all-minor-patch", "2026-08-03T20:56:38Z"],
      ["renovate/actions-setup-node-7.x", "2026-08-03T20:41:51Z"],
      ["renovate/actions-checkout-7.x", "2026-08-03T20:41:05Z"],
    ],
  ],
  [
    "1836dig",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T18:01:57Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:28:33Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T19:05:27Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:11:36Z"],
      ["renovate/lock-file-maintenance", "2026-08-10T13:27:25Z"],
      ["renovate/cookie-0.7.0-1.x", "2026-08-03T20:39:43Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:31:06Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:51:51Z"],
    ],
  ],
  ["29-navy", 0, []],
  [
    "alamo-anatomy",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:08:49Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:27:29Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:18:23Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:17:55Z"],
      ["renovate/typescript-6.x", "2026-08-12T20:04:24Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:17:25Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-08-08T12:21:59Z"],
      ["renovate/prettier-plugin-svelte-4.x", "2026-08-03T20:45:47Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:39:48Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:06Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:47:22Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:35:22Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:20:53Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:40:39Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T12:03:19Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-06-25T22:01:13Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-24T00:07:19Z"],
      ["renovate/npm-svelte-vulnerability", "2026-06-23T23:06:34Z"],
    ],
  ],
  [
    "beachfront-dentistry",
    0,
    [
      ["renovate/npm-vitest-vulnerability", "2026-09-11T02:07:45Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-03T00:08:43Z"],
      ["renovate/lock-file-maintenance", "2026-08-13T05:17:35Z"],
      ["renovate/all-minor-patch", "2026-08-13T05:02:28Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:39:52Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:11Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:51:55Z"],
    ],
  ],
  [
    "caltex-landing",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:23:20Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:46:06Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:34:15Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:11:45Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:20Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:31:31Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:48:02Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:38:22Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:20:56Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:40:43Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T12:04:15Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-23T23:06:41Z"],
    ],
  ],
  [
    "canvas-starter",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:45:37Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:00:42Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:48:15Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:11:50Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:28Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:39:57Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:16Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:37:05Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:00Z"],
      ["renovate/all-minor-patch", "2026-07-28T17:46:51Z"],
      ["renovate/actions-checkout-digest", "2026-07-28T17:37:26Z"],
    ],
  ],
  [
    "composition-hospitality",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:25:54Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:48:28Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:36:38Z"],
      ["renovate/all-minor-patch", "2026-08-10T19:46:26Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-08-08T12:35:31Z"],
    ],
  ],
  [
    "data-dynamiq",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:57:21Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:18:05Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:59:11Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:11:57Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:30Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:21Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:31:17Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:38:38Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:34:43Z"],
      ["renovate/pin-dependencies", "2026-07-17T19:09:54Z"],
      ["renovate/all-minor-patch", "2026-07-14T17:30:39Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T11:57:04Z"],
    ],
  ],
  [
    "erp-industrial",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:17:52Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:40:31Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:28:33Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:02Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:40:02Z"],
      ["renovate/node-24.x", "2026-08-03T20:26:26Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:05Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-07-27T18:48:52Z"],
    ],
  ],
  [
    "espada",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:09:10Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:28:22Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:18:33Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:37:20Z"],
      ["renovate/typescript-6.x", "2026-08-12T20:04:30Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-08-08T12:22:28Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:40:07Z"],
      ["renovate/node-24.x", "2026-08-03T20:26:31Z"],
      ["renovate/cookie-0.7.0-2.x", "2026-08-03T14:53:30Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:54:45Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:42:32Z"],
      ["renovate/pin-dependencies", "2026-07-17T19:09:51Z"],
      ["renovate/all-minor-patch", "2026-07-14T17:30:27Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T12:10:18Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-23T23:10:58Z"],
    ],
  ],
  [
    "gallerysonder",
    0,
    [
      ["renovate/npm-sharp-vulnerability", "2026-09-14T17:54:48Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:04:52Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T19:35:08Z"],
      ["renovate/typescript-6.x", "2026-08-12T20:04:36Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:22:49Z"],
      ["renovate/all-minor-patch", "2026-08-10T19:46:35Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-08-08T12:48:55Z"],
      ["renovate/prettier-plugin-svelte-4.x", "2026-08-03T20:40:12Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:37Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:45:02Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:34:56Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:21:00Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:40:47Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T12:00:49Z"],
    ],
  ],
  [
    "hedloc",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:17:52Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:40:34Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:28:44Z"],
      ["renovate/cookie-0.7.0-1.x", "2026-08-10T17:55:31Z"],
      ["renovate/all-minor-patch", "2026-08-10T17:51:35Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:42Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:35:53Z"],
      ["renovate/cookie-0.7.0-2.x", "2026-08-03T14:53:34Z"],
      ["renovate/all-minor-patch", "2026-07-27T18:00:17Z"],
      ["renovate/pin-dependencies", "2026-07-26T19:55:51Z"],
      ["renovate/all-minor-patch", "2026-07-14T17:30:53Z"],
    ],
  ],
  [
    "la-homelessness-initiative",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:49:37Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:04:12Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:51:16Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:11Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:23:26Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:31:22Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:34:21Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:59:18Z"],
      ["renovate/pin-dependencies", "2026-07-20T16:24:06Z"],
      ["renovate/all-minor-patch", "2026-07-14T17:44:30Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T11:54:31Z"],
    ],
  ],
  [
    "la-homelessness-youth",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:21:35Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:45:37Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:33:11Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:17Z"],
      ["renovate/lock-file-maintenance", "2026-08-10T12:52:55Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:35:46Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:09Z"],
      ["renovate/all-minor-patch", "2026-08-01T03:16:58Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:21:06Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:40:35Z"],
    ],
  ],
  [
    "medical-solutions-of-texas",
    0,
    [
      ["renovate/npm-sharp-vulnerability", "2026-09-14T17:55:07Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:18:41Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:59:36Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:23Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:26:01Z"],
      ["renovate/prettier-plugin-svelte-4.x", "2026-08-03T20:40:17Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:48Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:31:11Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:36:29Z"],
      ["renovate/all-minor-patch", "2026-07-26T17:58:29Z"],
      ["renovate/pin-dependencies", "2026-07-20T16:24:02Z"],
      ["renovate/all-minor-patch", "2026-07-14T17:30:46Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T11:55:51Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-25T08:53:17Z"],
      ["renovate/npm-svelte-vulnerability", "2026-06-25T02:53:47Z"],
    ],
  ],
  [
    "reddoor-maintenance",
    1,
    [
      ["renovate/npm-sharp-vulnerability", "2026-09-10T05:35:34Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T17:32:37Z"],
    ],
  ],
  [
    "reddoor-md-pdf",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:57:59Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:19:39Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:59:44Z"],
    ],
  ],
  [
    "reddoor-starter",
    1,
    [
      ["renovate/npm-sharp-vulnerability", "2026-09-14T17:48:30Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:28:35Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:29Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:45Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:40:21Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:26:54Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:13Z"],
      ["renovate/all-minor-patch", "2026-08-01T00:21:03Z"],
      ["renovate/actions-checkout-7.x", "2026-07-27T10:35:00Z"],
      ["renovate/all-minor-patch", "2026-07-26T20:20:13Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:51:12Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:49:29Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-07-02T18:40:05Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-29T11:54:39Z"],
    ],
  ],
  [
    "reddoor-starter-blux",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:46:26Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:00:56Z"],
    ],
  ],
  [
    "reddoor-website",
    1,
    [
      ["renovate/npm-vitest-vulnerability", "2026-09-11T00:09:18Z"],
      ["renovate/npm-sharp-vulnerability", "2026-09-10T05:30:13Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:18:40Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:34Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:30:49Z"],
      ["renovate/actions-setup-node-7.x", "2026-08-03T20:40:27Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:56:13Z"],
      ["renovate/all-minor-patch", "2026-08-03T15:07:19Z"],
      ["renovate/all-minor-patch", "2026-08-01T00:20:52Z"],
      ["renovate/actions-checkout-7.x", "2026-07-27T10:40:40Z"],
      ["renovate/all-minor-patch", "2026-07-26T20:25:38Z"],
      ["renovate/postcss-8.x-lockfile", "2026-06-15T16:35:38Z"],
    ],
  ],
  [
    "revogen",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:45:59Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-03T15:50:06Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:48:08Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:19:52Z"],
      ["renovate/typescript-6.x", "2026-08-12T20:04:42Z"],
      ["renovate/prettier-plugin-svelte-4.x", "2026-08-11T20:26:31Z"],
      ["renovate/npm-sveltejs-kit-vulnerability", "2026-08-08T12:45:16Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:40:31Z"],
      ["renovate/actions-setup-node-7.x", "2026-08-03T20:27:02Z"],
      ["renovate/all-minor-patch", "2026-07-27T10:40:06Z"],
      ["renovate/all-minor-patch", "2026-07-26T19:35:22Z"],
      ["renovate/all-minor-patch", "2026-07-17T19:21:20Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:46:00Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T11:56:39Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-25T08:53:08Z"],
      ["renovate/npm-svelte-vulnerability", "2026-06-25T02:53:34Z"],
    ],
  ],
  [
    "the-pointe-burbank",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:56:33Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T16:14:58Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:57:49Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:43Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:53Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:40:36Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:27:07Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:37:47Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:18Z"],
      ["renovate/all-minor-patch", "2026-07-31T21:43:18Z"],
      ["renovate/actions-checkout-digest", "2026-07-31T21:36:19Z"],
    ],
  ],
  [
    "the-tower-burbank",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:36:14Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:55:21Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:42:34Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:12:49Z"],
      ["renovate/lock-file-maintenance", "2026-08-11T21:25:42Z"],
      ["renovate/jsdom-30.x", "2026-08-03T20:40:41Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:27:13Z"],
      ["renovate/lock-file-maintenance", "2026-08-03T18:37:09Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:24Z"],
    ],
  ],
  ["vida-legacy-foundation", 0, [["renovate/npm-pnpm-vulnerability", "2026-09-02T18:33:38Z"]]],
  [
    "vineyard-custom-homes",
    0,
    [
      ["renovate/lock-file-maintenance", "2026-09-14T17:10:17Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-09-02T15:29:11Z"],
      ["renovate/lock-file-maintenance", "2026-08-31T18:19:42Z"],
      ["renovate/all-minor-patch", "2026-08-12T20:19:58Z"],
      ["renovate/typescript-6.x", "2026-08-12T20:04:49Z"],
      ["renovate/concurrently-10.x", "2026-08-03T20:27:19Z"],
      ["renovate/all-minor-patch", "2026-08-03T14:52:29Z"],
      ["renovate/actions-checkout-7.x", "2026-07-26T18:00:10Z"],
      ["renovate/pin-dependencies", "2026-07-16T15:44:24Z"],
      ["renovate/npm-pnpm-vulnerability", "2026-06-29T12:03:51Z"],
      ["renovate/npm-vite-vulnerability", "2026-06-25T02:54:03Z"],
    ],
  ],
];

/** The exact instants the two controls are frozen at. 2026-08-10 and
 *  2026-09-14 are both Mondays — the preset's update window is
 *  `before 11am on monday`, so comparing like-for-like weekdays keeps the
 *  cadence phase identical in both snapshots. */
const TODAY = new Date("2026-09-14T12:00:00Z");
const CONTROL_0810 = new Date("2026-08-10T12:00:00Z");

/** Rebuild one repo's `RenovateMergeWindow` as it stood at `asOf`. */
function windowAt(entry: SnapshotEntry, asOf: Date): RenovateMergeWindow {
  const cutoff = asOf.toISOString();
  return {
    merges: entry[2]
      .filter(([, mergedAt]) => mergedAt <= cutoff)
      .map(([headRef, mergedAt]) => ({ headRef, mergedAt })),
    // Carried forward from today's reading, and sound in the only direction
    // that matters: a repo with <100 closed PRs today had <100 then too, so a
    // `false` here can never be wrong. A `true` can only turn "never" into
    // "window full" — both unmeasured, same verdict.
    truncated: entry[1] === 1,
  };
}

function fleetAt(asOf: Date): RenovateOutcome[] {
  return FLEET_WINDOW.map((entry) => renovateOutcome(windowAt(entry, asOf), asOf));
}

describe("S7 outcome metric — both directions against real fleet snapshots", () => {
  it("FAIL control: on 2026-09-14 every measured repo is in drought", () => {
    // ── the FAIL control, verbatim ──
    expect(renovateOutcomeSummary(fleetAt(TODAY))).toBe(
      "RENOVATE_OUTCOME drought=21 delivering=0 unmeasured=5 threshold=21d",
    );
    const measured = fleetAt(TODAY).filter((o) => o.state !== "unmeasured");
    expect(measured.every((o) => o.state === "drought")).toBe(true);
  });

  it("PASS control: on 2026-08-10 not one repo warns", () => {
    // ── the PASS control, verbatim ──
    expect(renovateOutcomeSummary(fleetAt(CONTROL_0810))).toBe(
      "RENOVATE_OUTCOME drought=0 delivering=20 unmeasured=6 threshold=21d",
    );
  });

  it("the PASS control holds at EVERY instant on 2026-08-10, not just the flattering one", () => {
    // Freezing a control at one clock reading is how an instrument gets tuned
    // by accident: 2026-08-10 is a Monday, so midnight sits a full week after
    // the previous window and late evening sits minutes after that day's own
    // merges. Both extremes must stay clean, or the threshold is riding on the
    // hour picked rather than on the fleet's behaviour.
    for (const instant of ["2026-08-10T00:00:00Z", "2026-08-10T23:59:59Z"]) {
      const outcomes = fleetAt(new Date(instant));
      expect({ instant, drought: outcomes.filter((o) => o.state === "drought").length }).toEqual({
        instant,
        drought: 0,
      });
    }
  });

  it("the two populations are separated by a band, and the threshold sits inside it", () => {
    const aged = (asOf: Date) =>
      fleetAt(asOf)
        .flatMap((o) => (o.state === "unmeasured" ? [] : [o.days]))
        .sort((a, b) => a - b);
    const healthy = aged(CONTROL_0810);
    const today = aged(TODAY);
    // Worst repo while the channel was delivering vs best repo today.
    expect(healthy[healthy.length - 1]).toBe(14);
    expect(today[0]).toBe(32);
    // 21 is inside the empty band with real margin on both sides — this is the
    // justification for the constant, and it fails loudly if the fleet moves.
    expect(RENOVATE_DROUGHT_WARN_DAYS).toBeGreaterThan(healthy[healthy.length - 1]! + 6);
    expect(RENOVATE_DROUGHT_WARN_DAYS).toBeLessThan(today[0]! - 6);
  });

  it("a threshold of 14 days would have warned during KNOWN-HEALTHY operation", () => {
    // The negative control on the constant itself. Two repos sat 14 days
    // between grouped merges while the channel was working, so the obvious
    // "two missed Mondays" threshold would have fired on healthy operation —
    // which is precisely the state in which a verdict is worth nothing.
    const healthy = fleetAt(CONTROL_0810).flatMap((o) =>
      o.state === "unmeasured" ? [] : [o.days],
    );
    expect(healthy.filter((d) => d > 14).length).toBe(0);
    expect(healthy.filter((d) => d > 13).length).toBe(2);
  });
});

describe("what the metric counts", () => {
  it("excludes the two channels that kept flowing straight through the drought", () => {
    // 78 Renovate PRs landed fleet-wide between 2026-08-31 and 2026-09-14, all
    // on these two shapes. Counting them is exactly how the existing surfaces
    // read green through a month of feature-version drift.
    expect(isFeatureUpdateBranch("renovate/lock-file-maintenance")).toBe(false);
    expect(isFeatureUpdateBranch("renovate/npm-sharp-vulnerability")).toBe(false);
    expect(isFeatureUpdateBranch("renovate/npm-sveltejs-kit-vulnerability")).toBe(false);
    expect(isFeatureUpdateBranch("renovate/all-minor-patch")).toBe(true);
    expect(isFeatureUpdateBranch("renovate/typescript-6.x")).toBe(true);
    // A package whose NAME contains "vulnerability" is still a feature bump;
    // the exclusion is Renovate's branch shape, not a substring.
    expect(isFeatureUpdateBranch("renovate/vulnerability-scanner-2.x")).toBe(true);
    expect(isFeatureUpdateBranch("fix/something")).toBe(false);
  });

  it("counting security + lockfile merges hides 20 of the 21 droughts", () => {
    // The naive metric — "days since ANY renovate/* PR merged" — run on the
    // same fixture, same day, same window.
    const naive = FLEET_WINDOW.map((entry) => {
      const last = windowAt(entry, TODAY).merges[0];
      return last
        ? Math.floor((TODAY.getTime() - new Date(last.mergedAt).getTime()) / 86_400_000)
        : null;
    }).filter((d): d is number => d !== null);
    expect(naive.length).toBe(25);
    // It finds exactly ONE repo — `reddoorla/.github`, which ships no lockfile
    // and so receives no `npm-*-vulnerability` PRs at all. Every repo that has
    // an npm manager has its drought papered over by the security channel,
    // which is the precise mechanism that keeps the three existing surfaces
    // green. The naive metric is not merely less sensitive; on 20 of 21 repos
    // it is the wrong answer.
    expect(naive.filter((d) => d > RENOVATE_DROUGHT_WARN_DAYS).length).toBe(1);
    expect(fleetAt(TODAY).filter((o) => o.state === "drought").length).toBe(21);
  });
});

describe("unmeasured is never clean", () => {
  const feature = { headRef: "renovate/all-minor-patch", mergedAt: "2026-09-10T00:00:00Z" };

  it("a FULL window with no feature merge is unmeasured, not a drought", () => {
    // reddoor-maintenance's real state: it merges enough PRs that 100 closed
    // ones reach back under a fortnight, so its last feature update is simply
    // older than anything this read can see.
    const outcome = renovateOutcome(
      {
        merges: [{ headRef: "renovate/npm-sharp-vulnerability", mergedAt: "2026-09-14T00:00:00Z" }],
        truncated: true,
      },
      TODAY,
    );
    expect(outcome.state).toBe("unmeasured");
    expect(renovateOutcomeLine(outcome)).toContain("window is FULL");
  });

  it("a repo that never merged one is unmeasured, not a drought", () => {
    // Otherwise every freshly bootstrapped repo warns forever from day one.
    const outcome = renovateOutcome({ merges: [], truncated: false }, TODAY);
    expect(outcome.state).toBe("unmeasured");
    expect(renovateOutcomeLine(outcome)).toContain("never merged");
  });

  it("both unmeasured states print every run — silence is not a verdict", () => {
    for (const truncated of [true, false]) {
      expect(renovateOutcomeLine(renovateOutcome({ merges: [], truncated }, TODAY))).toContain(
        "UNMEASURED",
      );
    }
  });

  it("a healthy repo prints no line at all", () => {
    const outcome = renovateOutcome({ merges: [feature], truncated: false }, TODAY);
    expect(outcome).toEqual({
      state: "delivering",
      days: 4,
      lastBranch: "renovate/all-minor-patch",
      lastMergedAt: "2026-09-10T00:00:00Z",
    });
    expect(renovateOutcomeLine(outcome)).toBeNull();
  });

  it("the boundary is exclusive: exactly 21 days still delivers, 22 warns", () => {
    const at = (days: number) =>
      renovateOutcome(
        {
          merges: [
            {
              headRef: "renovate/all-minor-patch",
              mergedAt: new Date(TODAY.getTime() - days * 86_400_000).toISOString(),
            },
          ],
          truncated: false,
        },
        TODAY,
      ).state;
    expect(at(RENOVATE_DROUGHT_WARN_DAYS)).toBe("delivering");
    expect(at(RENOVATE_DROUGHT_WARN_DAYS + 1)).toBe("drought");
  });
});

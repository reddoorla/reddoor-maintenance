import { vi } from "vitest";

/**
 * Shift the suite's wall clock forward by `REDDOOR_TIME_TRAVEL_DAYS`, so a test that
 * silently depends on "today" fails HERE — in a scheduled run, against a horizon — rather
 * than on `main` some quiet morning after it rots.
 *
 * The failure this exists to catch: a test pins an absolute date fixture, then lets the
 * production code fall back to `new Date()`. It is green the day it is written and stays
 * green until wall time walks past whatever staleness window the code applies, at which
 * point it is red FOREVER and nobody touched anything. It has already happened twice in
 * `tests/dashboard/prismic-drift-wiring.test.ts` — on 2026-08-16 (two tests, fixed) and
 * again on 2026-08-19 (a third test twelve lines below the comment explaining the trap,
 * which took `main` red for three days because CI here only runs on push).
 *
 * Loaded ONLY when the env var is set (see vitest.config.ts), so `pnpm test` is untouched.
 *
 * ## Why this runs at module level
 *
 * An earlier version of this shim set the clock inside `beforeAll`. It did not work: the
 * suite ran on the REAL clock and reported a confident, meaningless green. Test files'
 * own hooks and mock resets run around a setup file's `beforeAll` and undo it. Module
 * level executes before any of that. `tests/time-travel-guard.test.ts` asserts the shift
 * actually landed, because a probe that silently fails to apply is worse than no probe —
 * it manufactures false confidence in exactly the place you went looking for a problem.
 *
 * ## Known gap
 *
 * A test that calls `vi.useRealTimers()` or resets timer mocks in its own hooks reverts to
 * the real clock and is therefore invisible to this guard. So is anything inside the test
 * files that exec `dist/cli/bin.js` in a subprocess — a separate process does not inherit
 * a faked clock. This guard narrows the window; it does not close it.
 */
const raw = process.env.REDDOOR_TIME_TRAVEL_DAYS?.trim();
const days = Number(raw);

// Fail loudly on a malformed value. Defaulting here would mean a typo'd CI input yields a
// green run that proved nothing — the precise failure mode this file exists to prevent.
if (!raw || !Number.isFinite(days) || days <= 0) {
  throw new Error(
    `time-travel setup: REDDOOR_TIME_TRAVEL_DAYS must be a positive number of days, got ${JSON.stringify(raw)}`,
  );
}

const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// `shouldAdvanceTime` keeps timers ticking, so async tests that await a real delay still
// settle instead of hanging the suite.
vi.useFakeTimers({ shouldAdvanceTime: true });
vi.setSystemTime(target);

// Raw fd: vitest swallows `console` from setup files, and a silent shim is untrustworthy.
process.stderr.write(`[time-travel] +${days}d — tests see ${target.toISOString()}\n`);
